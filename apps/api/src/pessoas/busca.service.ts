// Busca de pessoas (RF-18, RF-34) e busca global do topo. Mesmo comportamento de `buscarPessoas` do mock:
//   nome     sem acento e sem caixa, por substring (ILIKE; a spec §3.5 deixa pg_trgm para quando a medição pedir);
//   CPF      11 dígitos: igualdade pelo HMAC (documento_busca, chave PORTARIA_HMAC_CPF_KEY); 3 a 10 dígitos: parcial nos
//            6 dígitos visíveis do mascarado (o mesmo que a tela já mostra);
//   unidade  "4-32", "T4-32": pessoas com vínculo pendente, aprovado ou legado nela;
//   placa    4+ caracteres: pessoas com vínculo VÁLIDO na unidade do veículo ativo;
//   ordem    nome exato, começa com, contém, outros critérios; depois alfabética.
// Anonimizada nunca aparece. O CPF digitado só existe nesta requisição: vem no CORPO de um POST (não na URL, que
// proxies e a borda da Vercel registram), não é logado (log em allowlist) e leitura não grava trilha.
import { Inject, Injectable } from '@nestjs/common';
import { fmtData, fmtHora } from '@portaria/domain/time';
import { codigoUnidade, parseCodigoUnidade } from '@portaria/domain/units';
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { CONFIG, type Config } from '../config/config';
import { diaBrt } from '../comum/datas';
import { RELOGIO, type Relogio } from '../comum/relogio';
import { DB, type Db } from '../database/database.module';
import { documentoBusca } from '../db/cpf';
import { areaComum, eventoAcesso, pessoa, unidade, veiculo, vinculoUnidade } from '../db/schema';
import { vinculoValidoSql } from '../vinculos/vinculo-valido';

/** Pessoa como a busca devolve: sem telefone e sem documento_busca (minimização; a ficha completa é outra rota). */
export interface PessoaBusca {
  id: string;
  nome: string;
  documentoTipo: 'cpf';
  /** "***.456.789-**" ou "(sem CPF)". */
  documentoMascarado: string;
  semCpf: boolean;
  categoria: (typeof pessoa.categoria.enumValues)[number];
  empresa?: string;
  servico?: string;
  importacaoId?: string;
  ultimoAcesso: string;
  unidadesVinculadas: string[];
  unidadesVinculadasCodigos: string[];
}

export interface ResultadoBusca { pessoas: PessoaBusca[]; temMais: boolean }

// Acentos do português (e vizinhos) nas duas caixas. `lower` sozinho não basta: com collation C (PGlite) ele só
// converte ASCII. O alvo é derivado por NFD, o mesmo que o `norm` do mock faz no navegador.
const COM_ACENTO = 'áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ';
const SEM_ACENTO = [...COM_ACENTO].map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()).join('');

/** Normalização do lado do JavaScript (igual à do mock): sem acento, minúscula, sem espaço nas pontas. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Escapa os curingas do LIKE (o escape padrão do Postgres é a barra invertida). */
const escaparLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const SEM_CPF = '(sem CPF)';

/** Nome sem acento e minúsculo no SQL (mesma normalização de `normalizar`). */
export const nomeSemAcentoSql = (col: SQL | typeof pessoa.nome = pessoa.nome): SQL => sql`translate(lower(${col}), ${COM_ACENTO}, ${SEM_ACENTO})`;

@Injectable()
export class BuscaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Nome normalizado no SQL. Calculado por linha (sem índice): com milhares de pessoas a varredura custa milissegundos. */
  private nomeNormalizado(): SQL {
    return nomeSemAcentoSql();
  }

  async pessoas(q: string, o: { limite: number; semMoradores?: boolean }): Promise<ResultadoBusca> {
    const consulta = q.trim();
    const nq = normalizar(consulta);
    if (!nq) return { pessoas: [], temMais: false };
    const agora = this.relogio.agora();
    const hoje = diaBrt(agora);
    const valido = vinculoValidoSql(hoje);
    const digitos = consulta.replace(/\D/g, '');
    const placa = consulta.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const nome = this.nomeNormalizado();
    const padrao = `%${escaparLike(nq)}%`;

    const criterios: SQL[] = [sql`${nome} LIKE ${padrao}`];
    if (digitos.length === 11) {
      criterios.push(eq(pessoa.documentoBusca, documentoBusca(digitos, this.config.hmacCpfKey)));
    } else if (digitos.length >= 3) {
      criterios.push(sql`regexp_replace(coalesce(${pessoa.documentoMascarado}, ''), '[^0-9]', '', 'g') LIKE ${`%${digitos}%`}`);
    }
    const cod = parseCodigoUnidade(consulta);
    if (cod) {
      criterios.push(sql`${pessoa.id} IN (SELECT ${vinculoUnidade.pessoaId} FROM ${vinculoUnidade}
        JOIN ${unidade} ON ${unidade.id} = ${vinculoUnidade.unidadeId}
        WHERE ${unidade.torre} = ${cod.torre} AND ${unidade.numero} = ${cod.numero}
          AND ${vinculoUnidade.status} IN ('pendente', 'aprovado', 'legado'))`);
    }
    if (placa.length >= 4) {
      criterios.push(sql`${pessoa.id} IN (SELECT ${vinculoUnidade.pessoaId} FROM ${vinculoUnidade}
        JOIN ${veiculo} ON ${veiculo.unidadeId} = ${vinculoUnidade.unidadeId}
        WHERE ${veiculo.ativo} AND ${veiculo.placa} LIKE ${`%${escaparLike(placa)}%`} AND ${valido})`);
    }
    const filtros: SQL[] = [isNull(pessoa.anonimizadaEm), or(...criterios)!];
    // Portaria: quem tem vínculo válido em alguma unidade é morador, qualquer que seja a categoria gravada.
    if (o.semMoradores) {
      // Referência explícita à linha externa (o Drizzle pode escrever a coluna sem o nome da tabela numa consulta simples).
      filtros.push(sql`NOT EXISTS (SELECT 1 FROM ${vinculoUnidade} WHERE ${vinculoUnidade.pessoaId} = ${sql.raw('"pessoa"."id"')} AND ${valido})`);
    }
    const rank = sql`CASE WHEN ${nome} = ${nq} THEN 0 WHEN ${nome} LIKE ${`${escaparLike(nq)}%`} THEN 1
      WHEN ${nome} LIKE ${padrao} THEN 2 ELSE 3 END`;
    const linhas = await this.db.select({
      id: pessoa.id, nome: pessoa.nome, categoria: pessoa.categoria, semCpf: pessoa.semCpf,
      documentoMascarado: pessoa.documentoMascarado, empresa: pessoa.empresa, servico: pessoa.servico, importacaoId: pessoa.importacaoId,
    }).from(pessoa)
      .where(and(...filtros))
      .orderBy(asc(rank), asc(nome), asc(pessoa.nome), asc(pessoa.id))
      .limit(o.limite + 1);

    const pagina = linhas.slice(0, o.limite);
    const ids = pagina.map((p) => p.id);
    const [vinculos, ultimos] = await Promise.all([this.unidadesValidas(ids, hoje), this.ultimosAcessos(ids)]);
    return {
      temMais: linhas.length > o.limite,
      pessoas: pagina.map((p): PessoaBusca => {
        const us = vinculos.get(p.id) ?? [];
        return {
          id: p.id, nome: p.nome, documentoTipo: 'cpf', categoria: p.categoria, semCpf: p.semCpf,
          documentoMascarado: p.semCpf ? SEM_CPF : (p.documentoMascarado ?? SEM_CPF),
          ...(p.empresa ? { empresa: p.empresa } : {}), ...(p.servico ? { servico: p.servico } : {}),
          ...(p.importacaoId ? { importacaoId: p.importacaoId } : {}),
          ultimoAcesso: this.textoUltimoAcesso(ultimos.get(p.id), agora),
          unidadesVinculadas: us.map((u) => u.id), unidadesVinculadasCodigos: us.map((u) => codigoUnidade(u)),
        };
      }),
    };
  }

  /** Busca do topo: até 6 pessoas (2+ caracteres) e as unidades pelo código ou pela placa. */
  async global(q: string) {
    const consulta = q.trim();
    const { pessoas, temMais } = consulta.length >= 2 ? await this.pessoas(consulta, { limite: 6 }) : { pessoas: [], temMais: false };
    const unidades: { id: string; motivo: string }[] = [];
    const cod = parseCodigoUnidade(consulta);
    if (cod) {
      const [u] = await this.db.select({ id: unidade.id, ativo: unidade.ativo }).from(unidade)
        .where(and(eq(unidade.torre, cod.torre), eq(unidade.numero, cod.numero)));
      if (u) unidades.push({ id: u.id, motivo: u.ativo ? 'Unidade' : 'Unidade (desativada)' });
    }
    const placa = consulta.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (placa.length >= 3) {
      const vs = await this.db.select({ unidadeId: veiculo.unidadeId, placa: veiculo.placa, modelo: veiculo.modelo }).from(veiculo)
        .where(and(eq(veiculo.ativo, true), sql`${veiculo.placa} LIKE ${`%${escaparLike(placa)}%`}`))
        .orderBy(asc(veiculo.placa)).limit(6);
      for (const v of vs) unidades.push({ id: v.unidadeId, motivo: `Placa ${v.placa.slice(0, 3)}-${v.placa.slice(3)} · ${v.modelo}` });
    }
    return { pessoas, unidades, temMaisPessoas: temMais };
  }

  /** Unidades com vínculo válido de cada pessoa (uma consulta para a página toda, sem N+1). */
  async unidadesValidas(ids: string[], hoje: string) {
    const mapa = new Map<string, { id: string; torre: number; numero: string }[]>();
    if (!ids.length) return mapa;
    const linhas = await this.db.select({ pessoaId: vinculoUnidade.pessoaId, id: unidade.id, torre: unidade.torre, numero: unidade.numero })
      .from(vinculoUnidade).innerJoin(unidade, eq(unidade.id, vinculoUnidade.unidadeId))
      .where(and(inArray(vinculoUnidade.pessoaId, ids), vinculoValidoSql(hoje)))
      .orderBy(asc(unidade.torre), asc(sql`${unidade.numero}::numeric`));
    for (const l of linhas) mapa.set(l.pessoaId, [...(mapa.get(l.pessoaId) ?? []), { id: l.id, torre: l.torre, numero: l.numero }]);
    return mapa;
  }

  /**
   * Último acesso (entrada, negado ou recusado) de cada pessoa, pela ordem da cadeia (seq), como o mock.
   * Limitação conhecida: usa os valores gravados no evento, não os efetivos depois de uma correção (o módulo de
   * registro de acesso traz a view de valores efetivos).
   */
  async ultimosAcessos(ids: string[]) {
    type Ultimo = { tipo: string; ocorridoEm: Date; torre: number | null; numero: string | null; area: string | null };
    const mapa = new Map<string, Ultimo>();
    if (!ids.length) return mapa;
    const linhas = await this.db.selectDistinctOn([eventoAcesso.pessoaId], {
      pessoaId: eventoAcesso.pessoaId, tipo: eventoAcesso.tipo, ocorridoEm: eventoAcesso.ocorridoEm,
      torre: unidade.torre, numero: unidade.numero, area: areaComum.nome,
    }).from(eventoAcesso)
      .leftJoin(unidade, eq(unidade.id, eventoAcesso.unidadeDestinoId))
      .leftJoin(areaComum, eq(areaComum.id, eventoAcesso.areaComumId))
      .where(and(inArray(eventoAcesso.pessoaId, ids), notInArray(eventoAcesso.tipo, ['saida', 'correcao'])))
      .orderBy(eventoAcesso.pessoaId, desc(eventoAcesso.seq));
    for (const l of linhas) mapa.set(l.pessoaId, l);
    return mapa;
  }

  /** "Hoje 14:32 · T4-32", "08/10 · Salão de festas (negado)" ou "Sem acessos" (mesmo texto do mock). */
  textoUltimoAcesso(u: { tipo: string; ocorridoEm: Date; torre: number | null; numero: string | null; area: string | null } | undefined, agora: Date) {
    if (!u) return 'Sem acessos';
    const t = u.ocorridoEm.getTime();
    const quando = fmtData(agora.getTime()) === fmtData(t) ? `Hoje ${fmtHora(t)}` : fmtData(t).slice(0, 5);
    const destino = u.torre !== null && u.numero !== null ? codigoUnidade({ torre: u.torre, numero: u.numero }) : u.area;
    return `${quando}${destino ? ` · ${destino}` : ''}${u.tipo === 'negado' ? ' (negado)' : u.tipo === 'recusado' ? ' (recusado)' : ''}`;
  }
}
