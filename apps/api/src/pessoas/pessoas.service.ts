// Cadastro de pessoas (RF-02, RN-10, LGPD art. 18). Regras do cadastro e da edição:
// - nome, telefone (10 ou 11 dígitos, com DDD) e CPF obrigatórios; CPF validado pelo dígito verificador;
// - o CPF não é guardado: só a máscara e o HMAC (documento_busca), único -> 409 PESSOA_DUPLICADA (tradução do 23505);
// - exceção "sem CPF": nome e telefone continuam obrigatórios, e a deduplicação é por nome + telefone;
// - prestador exige empresa (RF-36); porteiro só cadastra visitante e prestador (pessoa.cadastrar_morador);
// - correção (pessoa.editar, SI/AD) grava antes e depois no audit_log (snapshot sem HMAC e com telefone mascarado).
// O CPF digitado só existe nesta requisição: nunca vai para log, trilha ou resposta.
import { Inject, Injectable } from '@nestjs/common';
import { pode } from '@portaria/domain/rbac';
import { cpfValido } from '@portaria/domain/rules';
import { codigoUnidade } from '@portaria/domain/units';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { Contexto } from '../auth/tipos';
import { CONFIG, type Config } from '../config/config';
import { diaBrt } from '../comum/datas';
import { AcessoNegado, codigoPg, erroApi } from '../comum/erros';
import { codificarCursor, decodificarCursor, Pagina } from '../comum/pagina';
import { RELOGIO, type Relogio } from '../comum/relogio';
import { DB, type Db, type Executor } from '../database/database.module';
import { documentoBusca, mascararCpf } from '../db/cpf';
import { funcionario, pessoa, unidade, vinculoUnidade } from '../db/schema';
import { carregarVinculos } from '../vinculos/vinculo-view';
import { BuscaService, nomeSemAcentoSql, normalizar } from './busca.service';
import { colunasPessoa, paraPessoaApi, veTelefoneCompleto, type LinhaPessoa, type PessoaApi } from './pessoa-view';

type Categoria = (typeof pessoa.categoria.enumValues)[number];

export interface NovaPessoa {
  nome: string; documento?: string; telefone: string; categoria: Categoria; empresa?: string; servico?: string; semCpf?: boolean;
}
export interface EdicaoPessoa {
  nome?: string; telefone?: string; documento?: string; empresa?: string | null; servico?: string | null;
}

const soDigitos = (s: string) => s.replace(/\D/g, '');
const telefoneValido = (t: string) => /^\d{10,11}$/.test(soDigitos(t));
const vazioParaNulo = (s: string | null | undefined) => (s ?? '').trim() || null;

const duplicada = () => erroApi(409, 'PESSOA_DUPLICADA', 'Já existe cadastro com este CPF.');

/** Ordem de prioridade do "vínculo principal" na lista do Cadastro */
const PRIORIDADE = ['aprovado', 'legado', 'pendente', 'rejeitado', 'encerrado'] as const;

const CursorPessoas = z.strictObject({ n: z.string().max(400), id: z.uuid() });

@Injectable()
export class PessoasService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(BuscaService) private readonly busca: BuscaService,
  ) {}

  /**
   * Valida e monta os valores de uma pessoa nova (também usado por funcionários). Lança 422/409 legíveis antes de
   * qualquer INSERT; a unicidade do CPF é garantida de novo pelo índice único (corrida -> 23505 -> 409).
   */
  async valoresNovaPessoa(exec: Executor, i: NovaPessoa, agora: Date) {
    const nome = i.nome.trim();
    if (!nome) throw erroApi(422, 'NOME_OBRIGATORIO', 'Informe o nome.');
    if (!telefoneValido(i.telefone)) throw erroApi(422, 'TELEFONE_INVALIDO', 'Informe o telefone com DDD (10 ou 11 dígitos).');
    if (i.categoria === 'prestador' && !(i.empresa ?? '').trim()) throw erroApi(422, 'EMPRESA_OBRIGATORIA', 'Prestador exige empresa (RF-36).');
    const telefone = soDigitos(i.telefone);
    let mascarado: string | null = null;
    let busca: string | null = null;
    if (i.semCpf) {
      // Sem CPF não há chave única: evita o cadastro em dobro por nome + telefone.
      const [igual] = await exec.select({ id: pessoa.id }).from(pessoa)
        .where(and(eq(pessoa.semCpf, true), eq(pessoa.telefone, telefone), sql`${nomeSemAcentoSql()} = ${normalizar(nome)}`)).limit(1);
      if (igual) throw erroApi(409, 'PESSOA_DUPLICADA', 'Já existe cadastro sem CPF com este nome e telefone.');
    } else {
      const cpf = soDigitos(i.documento ?? '');
      if (!cpf) throw erroApi(422, 'DOCUMENTO_OBRIGATORIO', 'Informe o CPF.');
      if (!cpfValido(cpf)) throw erroApi(422, 'CPF_INVALIDO', 'CPF inválido (confira os dígitos).');
      mascarado = mascararCpf(cpf);
      busca = documentoBusca(cpf, this.config.hmacCpfKey);
      const [existe] = await exec.select({ id: pessoa.id }).from(pessoa).where(eq(pessoa.documentoBusca, busca)).limit(1);
      if (existe) throw duplicada();
    }
    return {
      nome, categoria: i.categoria, semCpf: !!i.semCpf, documentoMascarado: mascarado, documentoBusca: busca, telefone,
      empresa: vazioParaNulo(i.empresa), servico: vazioParaNulo(i.servico), criadoEm: agora, atualizadoEm: agora,
    };
  }

  async criar(ctx: Contexto, i: NovaPessoa): Promise<PessoaApi> {
    // Porteiro: só visitante e prestador. O 403 sai com a ação tentada (o filtro grava acesso.negado).
    if ((i.categoria === 'morador' || i.categoria === 'funcionario') && !pode(ctx.ator.papel, 'pessoa.cadastrar_morador')) {
      throw new AcessoNegado('pessoa.cadastrar_morador', 'Seu perfil só cadastra visitante e prestador.');
    }
    const agora = this.relogio.agora();
    try {
      return await this.db.transaction(async (tx) => {
        const valores = await this.valoresNovaPessoa(tx, i, agora);
        const [nova] = await tx.insert(pessoa).values(valores).returning(colunasPessoa);
        await this.auditoria.registrar(tx, { ator: ctx.ator, ip: ctx.ip, acao: 'pessoa.criar', entidade: 'pessoa', registroId: nova!.id, depois: nova });
        return paraPessoaApi(nova!, { telefoneCompleto: veTelefoneCompleto(ctx.ator.papel) });
      });
    } catch (e) {
      if (codigoPg(e) === '23505') throw duplicada();
      throw e;
    }
  }

  /** RN-09 e LGPD art. 18 (correção). Campo ausente não muda; CPF informado tira a pessoa de "sem CPF". */
  async editar(ctx: Contexto, id: string, i: EdicaoPessoa): Promise<PessoaApi> {
    const agora = this.relogio.agora();
    try {
      return await this.db.transaction(async (tx) => {
        const [antes] = await tx.select(colunasPessoa).from(pessoa).where(eq(pessoa.id, id)).for('update');
        if (!antes) throw erroApi(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
        if (antes.anonimizadaEm) throw erroApi(409, 'PESSOA_ANONIMIZADA', 'Cadastro anonimizado não pode ser editado.');
        const mudancas: Partial<typeof pessoa.$inferInsert> = {};
        if (i.nome !== undefined) {
          const nome = i.nome.trim();
          if (!nome) throw erroApi(422, 'NOME_OBRIGATORIO', 'Informe o nome.');
          if (nome !== antes.nome) mudancas.nome = nome;
        }
        if (i.telefone !== undefined) {
          if (!telefoneValido(i.telefone)) throw erroApi(422, 'TELEFONE_INVALIDO', 'Informe o telefone com DDD (10 ou 11 dígitos).');
          const tel = soDigitos(i.telefone);
          if (tel !== antes.telefone) mudancas.telefone = tel;
        }
        if (i.documento !== undefined && soDigitos(i.documento) !== '') {
          const cpf = soDigitos(i.documento);
          if (!cpfValido(cpf)) throw erroApi(422, 'CPF_INVALIDO', 'CPF inválido (confira os dígitos).');
          const busca = documentoBusca(cpf, this.config.hmacCpfKey);
          const [outra] = await tx.select({ id: pessoa.id }).from(pessoa).where(eq(pessoa.documentoBusca, busca)).limit(1);
          if (outra && outra.id !== id) throw duplicada();
          if (!outra) {
            mudancas.documentoBusca = busca;
            mudancas.documentoMascarado = mascararCpf(cpf);
            mudancas.semCpf = false;
          }
        }
        if (i.empresa !== undefined && vazioParaNulo(i.empresa) !== antes.empresa) mudancas.empresa = vazioParaNulo(i.empresa);
        if (i.servico !== undefined && vazioParaNulo(i.servico) !== antes.servico) mudancas.servico = vazioParaNulo(i.servico);
        const empresaFinal = 'empresa' in mudancas ? mudancas.empresa : antes.empresa;
        if (antes.categoria === 'prestador' && !(empresaFinal ?? '').trim()) throw erroApi(422, 'EMPRESA_OBRIGATORIA', 'Prestador exige empresa (RF-36).');
        if (Object.keys(mudancas).length === 0) return paraPessoaApi(antes, { telefoneCompleto: true }); // nada mudou: sem trilha
        const [depois] = await tx.update(pessoa).set({ ...mudancas, atualizadoEm: agora }).where(eq(pessoa.id, id)).returning(colunasPessoa);
        await this.auditoria.registrar(tx, { ator: ctx.ator, ip: ctx.ip, acao: 'pessoa.editar', entidade: 'pessoa', registroId: id, antes, depois });
        return paraPessoaApi(depois!, { telefoneCompleto: true });
      });
    } catch (e) {
      if (codigoPg(e) === '23505') throw duplicada();
      throw e;
    }
  }

  /** Lista do Cadastro: ordem nome + id (keyset). Filtro por texto NÃO entra aqui (pode ser CPF): é a busca por POST. */
  async listar(f: { limite: number; cursor?: string; categoria?: Categoria }) {
    const agora = this.relogio.agora();
    const hoje = diaBrt(agora);
    const depois = f.cursor ? decodificarCursor(f.cursor, CursorPessoas) : null;
    const filtros: SQL[] = [];
    if (f.categoria) filtros.push(eq(pessoa.categoria, f.categoria));
    if (depois) filtros.push(sql`(${pessoa.nome}, ${pessoa.id}) > (${depois.n}, ${depois.id}::uuid)`);
    const linhas = await this.db.select(colunasPessoa).from(pessoa)
      .where(filtros.length ? and(...filtros) : undefined)
      .orderBy(asc(pessoa.nome), asc(pessoa.id))
      .limit(f.limite + 1);
    const pagina = linhas.slice(0, f.limite);
    const ids = pagina.map((p) => p.id);
    const [validas, ultimos, principais] = await Promise.all([
      this.busca.unidadesValidas(ids, hoje), this.busca.ultimosAcessos(ids), this.vinculosPrincipais(ids),
    ]);
    const ultimo = pagina[pagina.length - 1];
    const proximo = linhas.length > f.limite && ultimo ? codificarCursor({ n: ultimo.nome, id: ultimo.id }) : null;
    return new Pagina(pagina.map((p) => {
      const us = validas.get(p.id) ?? [];
      return {
        ...paraPessoaApi(p),
        ultimoAcesso: this.busca.textoUltimoAcesso(ultimos.get(p.id), agora),
        unidadesVinculadas: us.map((u) => u.id),
        unidadesVinculadasCodigos: us.map((u) => codigoUnidade(u)),
        vinculoPrincipal: principais.get(p.id) ?? null,
      };
    }), proximo);
  }

  /** Um vínculo por pessoa (aprovado > legado > pendente > rejeitado > encerrado), para a coluna da lista. */
  private async vinculosPrincipais(ids: string[]) {
    type Principal = { id: string; unidadeId: string; unidadeCodigo: string; tipo: string; status: (typeof PRIORIDADE)[number] };
    const mapa = new Map<string, Principal>();
    if (!ids.length) return mapa;
    const linhas = await this.db.select({
      pessoaId: vinculoUnidade.pessoaId, id: vinculoUnidade.id, unidadeId: vinculoUnidade.unidadeId, tipo: vinculoUnidade.tipo,
      status: vinculoUnidade.status, bloco: unidade.bloco, numero: unidade.numero,
    }).from(vinculoUnidade).innerJoin(unidade, eq(unidade.id, vinculoUnidade.unidadeId))
      .where(inArray(vinculoUnidade.pessoaId, ids))
      .orderBy(asc(vinculoUnidade.registradoEm), asc(vinculoUnidade.id));
    for (const l of linhas) {
      const atual = mapa.get(l.pessoaId);
      if (!atual || PRIORIDADE.indexOf(l.status) < PRIORIDADE.indexOf(atual.status)) {
        mapa.set(l.pessoaId, { id: l.id, unidadeId: l.unidadeId, unidadeCodigo: codigoUnidade({ bloco: l.bloco, numero: l.numero }), tipo: l.tipo, status: l.status });
      }
    }
    return mapa;
  }

  /**
   * Ficha: pessoa, funcionário (se for) e vínculos. `eventos` continua null aqui: os últimos acessos vêm do módulo de
   * eventos (`GET /eventos-acesso?pessoaId=`), que o adaptador do front chama em paralelo (sem acoplar os módulos).
   */
  async ficha(ctx: Contexto, id: string) {
    const hoje = diaBrt(this.relogio.agora());
    const [p] = await this.db.select(colunasPessoa).from(pessoa).where(eq(pessoa.id, id));
    if (!p) throw erroApi(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
    const [f] = await this.db.select().from(funcionario).where(eq(funcionario.pessoaId, id));
    const vinculos = await carregarVinculos(this.db, eq(vinculoUnidade.pessoaId, id), hoje);
    return {
      pessoa: paraPessoaApi(p as LinhaPessoa, { telefoneCompleto: veTelefoneCompleto(ctx.ator.papel) }),
      funcionario: f ? {
        pessoaId: f.pessoaId, funcao: f.funcao, ativo: f.ativo,
        escala: { diasSemana: f.diasSemana, horaInicio: f.horaInicio.slice(0, 5), horaFim: f.horaFim.slice(0, 5) },
      } : null,
      vinculos,
      eventos: null,
    };
  }
}
