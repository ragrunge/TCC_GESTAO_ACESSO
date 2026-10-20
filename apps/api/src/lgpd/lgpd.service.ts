// Direitos do titular (LGPD art. 18; spec §9.3): exportação dos dados da pessoa e anonimização a pedido.
//
// Exportação (SI/AD): formato `portaria-parque/lgpd-exportacao`, versão 1. Decisões de minimização:
//  - CPF: só a máscara. O número não é guardado (spec §14 nº 18): não há o que devolver além dela.
//  - HMAC do CPF (`documento_busca`): fora. É um código de busca derivado, não um dado que o titular forneceu; no arquivo
//    só serviria para cruzar o titular com o banco por quem tivesse a chave.
//  - Telefone: mascarado (últimos 4 dígitos). O arquivo sai do sistema (é entregue impresso ou por e-mail)
//    e a conferência de identidade no balcão é fraca; o titular conhece o próprio número e o corrige pela administração.
//    A §9.3 pede "dados cadastrais", sem exigir o número completo; o arquivo diz que ele é mantido e como conferi-lo.
//  - Eventos: só os da própria pessoa (data, ponto, unidade ou área, meio). Eventos em que ela AUTORIZOU a entrada de
//    outra pessoa são dados de terceiros e ficam fora.
//  - Documentos: metadados (tipo, tamanho, data, eliminação), nunca o conteúdo.
// A exportação vai para o audit_log (`lgpd.exportar`) com o solicitante (o ator) e só contagens.
//
// Anonimização (SI): só sem vínculo válido (mesma regra de `vinculoValido` do domain), feita pela função `lgpd_anonimizar_pessoa` (dados
// pessoais, foto, redação do audit_log da pessoa e registro em retencao_execucao, numa transação só). A foto é apagada
// do volume depois do COMMIT. Os eventos ficam: só ids, sem nome, até completar 3 anos (art. 16, I, e art. 7º, VI).
import { Inject, Injectable } from '@nestjs/common';
import { codigoUnidade } from '@portaria/domain/units';
import { ROTULO_CATEGORIA, ROTULO_MEIO } from '@portaria/domain/types';
import { and, asc, eq, inArray, isNotNull, max, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type Ator, AuditoriaService } from '../auditoria/auditoria.service';
import { mascararTelefone } from '../auditoria/snapshot';
import type { Contexto } from '../auth/tipos';
import { diaBrt } from '../comum/datas';
import { codigoPg, erroApi } from '../comum/erros';
import { RELOGIO, type Relogio } from '../comum/relogio';
import { DB, type Db, type Tx } from '../database/database.module';
import {
  documento, encomenda, eventoAcesso, ocorrencia, ocorrenciaAnexo, ocorrenciaEvento, pessoa, unidade, usuarioSistema, veiculo, vinculoUnidade,
} from '../db/schema';
import { CofreDocumentos } from '../documentos/cofre';
import { codigoEncomenda } from '../encomendas/encomendas.module';
import { montarViews } from '../eventos/evento-view';
import { EventosService } from '../eventos/eventos.service';
import { codigoOcorrencia } from '../ocorrencias/ocorrencias.module';
import { vinculoValidoSql } from '../vinculos/vinculo-valido';

/** Teto de eventos numa exportação de titular (o mesmo da exportação da trilha). */
const TETO_EVENTOS = 20_000;
const BRT_MS = 3 * 3600 * 1000;
const isoSP = (d: Date | null | undefined) => (d ? new Date(d.getTime() - BRT_MS).toISOString().replace('Z', '-03:00') : null);
const carimbo = (d: Date) => new Date(d.getTime() - BRT_MS).toISOString().slice(0, 10);
export const ANOS_RETENCAO = 3;
export const somarAnos = (d: Date, anos: number) => { const x = new Date(d); x.setUTCFullYear(x.getUTCFullYear() + anos); return x; };

/** O que fica depois da anonimização e por quê. */
export const RETIDO = [
  'Eventos de acesso em que a pessoa aparece (só pelo id, sem o nome), até completar 3 anos de cada evento: exercício regular de direitos (LGPD art. 16, I, e art. 7º, VI).',
  'Texto livre já gravado nesses eventos (justificativa, observação, formulário), que entra no hash e sai junto com o evento.',
  'Vínculos encerrados, autorizações e encomendas ligados à pessoa só pelo id.',
];

export interface ResultadoAnonimizacaoApi {
  pessoaId: string; registrosRedigidos: number; retido: string[]; eventosRetidos: number; retidoAte: string | null; documentosEliminados: number;
}

const conferente = alias(usuarioSistema, 'conferente');

@Injectable()
export class LgpdService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosService) private readonly eventos: EventosService,
    @Inject(CofreDocumentos) private readonly cofre: CofreDocumentos,
  ) {}

  // ----- Acesso (art. 18, II) --------------------------------------------------------------------------------------

  async exportar(ctx: Contexto, id: string) {
    const [p] = await this.db.select().from(pessoa).where(eq(pessoa.id, id));
    if (!p) throw erroApi(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
    const hoje = diaBrt(this.relogio.agora());

    const vinculos = await this.db.select({ v: vinculoUnidade, bloco: unidade.bloco, numero: unidade.numero, conferidoPor: conferente.nome })
      .from(vinculoUnidade).innerJoin(unidade, eq(unidade.id, vinculoUnidade.unidadeId))
      .leftJoin(conferente, eq(conferente.id, vinculoUnidade.conferidoPorId))
      .where(eq(vinculoUnidade.pessoaId, id)).orderBy(asc(vinculoUnidade.registradoEm), asc(vinculoUnidade.id));
    // Veículos: os das unidades em que a pessoa tem vínculo válido hoje (o veículo é da unidade, não da pessoa)
    const unidadesValidas = (await this.db.select({ u: vinculoUnidade.unidadeId }).from(vinculoUnidade)
      .where(and(eq(vinculoUnidade.pessoaId, id), vinculoValidoSql(hoje)))).map((x) => x.u);
    const veiculos = unidadesValidas.length
      ? await this.db.select({ placa: veiculo.placa, modelo: veiculo.modelo, cor: veiculo.cor, bloco: unidade.bloco, numero: unidade.numero })
        .from(veiculo).innerJoin(unidade, eq(unidade.id, veiculo.unidadeId))
        .where(and(inArray(veiculo.unidadeId, unidadesValidas), eq(veiculo.ativo, true))).orderBy(asc(veiculo.placa))
      : [];

    const linhas = await this.eventos.linhas({ pessoaId: id, excluirTipos: ['correcao'] }, TETO_EVENTOS);
    if (linhas.length > TETO_EVENTOS) {
      throw erroApi(422, 'EXPORTACAO_GRANDE', `A pessoa tem mais de ${TETO_EVENTOS.toLocaleString('pt-BR')} eventos; exporte a trilha por período.`);
    }
    const eventos = await montarViews(this.db, linhas); // valores efetivos (correções aplicadas)

    const encomendas = await this.db.select({ numero: encomenda.numero, recebidaEm: encomenda.recebidaEm, retiradaEm: encomenda.retiradaEm, bloco: unidade.bloco, numero2: unidade.numero })
      .from(encomenda).innerJoin(unidade, eq(unidade.id, encomenda.unidadeId))
      .where(eq(encomenda.retiradaPorPessoaId, id)).orderBy(asc(encomenda.retiradaEm));

    // Documentos: a foto (se houver) e os anexos das ocorrências ligadas a eventos da pessoa. Só metadados.
    const docs: { id: string; tipo: string; origem: string; mime: string; tamanhoBytes: number; enviadoEm: string | null; eliminadoEm: string | null }[] = [];
    if (p.fotoDocumentoId) {
      const [f] = await this.db.select().from(documento).where(eq(documento.id, p.fotoDocumentoId));
      if (f) docs.push({ id: f.id, tipo: 'foto', origem: 'cadastro', mime: f.mime, tamanhoBytes: f.tamanhoBytes, enviadoEm: isoSP(f.enviadoEm), eliminadoEm: isoSP(f.eliminadoEm) });
    }
    const idsEventos = linhas.map((l) => l.id);
    if (idsEventos.length) {
      for (let i = 0; i < idsEventos.length; i += 1000) {
        const anexos = await this.db.selectDistinct({ d: documento, numero: ocorrencia.numero, abertaEm: ocorrencia.abertaEm }).from(ocorrenciaEvento)
          .innerJoin(ocorrencia, eq(ocorrencia.id, ocorrenciaEvento.ocorrenciaId))
          .innerJoin(ocorrenciaAnexo, eq(ocorrenciaAnexo.ocorrenciaId, ocorrencia.id))
          .innerJoin(documento, eq(documento.id, ocorrenciaAnexo.documentoId))
          .where(inArray(ocorrenciaEvento.eventoId, idsEventos.slice(i, i + 1000)));
        for (const a of anexos) {
          if (docs.some((d) => d.id === a.d.id)) continue;
          docs.push({
            id: a.d.id, tipo: 'anexo_ocorrencia', origem: `ocorrência ${codigoOcorrencia(a.numero, a.abertaEm)}`, mime: a.d.mime,
            tamanhoBytes: a.d.tamanhoBytes, enviadoEm: isoSP(a.d.enviadoEm), eliminadoEm: isoSP(a.d.eliminadoEm),
          });
        }
      }
    }

    const agora = this.relogio.agora();
    const conteudo = {
      tipo: 'portaria-parque/lgpd-exportacao', versao: 1, geradoEm: isoSP(agora), geradoPor: ctx.ator.nome,
      titular: {
        id: p.id, nome: p.nome, categoria: ROTULO_CATEGORIA[p.categoria],
        cpf: p.anonimizadaEm ? '(anonimizado)' : p.semCpf ? '(sem CPF)' : p.documentoMascarado, semCpf: p.semCpf,
        telefone: p.telefone ? mascararTelefone(p.telefone) : null, empresa: p.empresa, servico: p.servico,
        cadastradoEm: isoSP(p.criadoEm), anonimizadaEm: isoSP(p.anonimizadaEm),
      },
      vinculos: vinculos.map(({ v, bloco, numero, conferidoPor }) => ({
        unidade: codigoUnidade({ bloco, numero }), tipo: v.tipo, status: v.status, vigenciaInicio: v.vigenciaInicio, vigenciaFim: v.vigenciaFim,
        prazoRegularizacao: v.prazoRegularizacao, decididoEm: isoSP(v.decididoEm), encerradoEm: isoSP(v.encerradoEm),
        comprovanteConferido: v.conferenciaTipoDocumento
          ? { tipo: v.conferenciaTipoDocumento, descricao: v.conferenciaDescricao, data: v.conferenciaData, conferidoPor: conferidoPor ?? null }
          : null,
      })),
      veiculos: veiculos.map((x) => ({ unidade: codigoUnidade({ bloco: x.bloco, numero: x.numero }), placa: `${x.placa.slice(0, 3)}-${x.placa.slice(3)}`, modelo: x.modelo, cor: x.cor })),
      eventos: eventos.map((e) => ({
        codigo: e.codigo, tipo: e.tipo, ocorridoEm: isoSP(new Date(e.ocorridoEm)), pontoAcesso: e.pontoAcessoNome,
        unidade: e.unidadeDestinoId ? e.unidadeRotulo : null, areaComum: e.areaComumNome,
        meio: e.autorizadoPorTipo ? ROTULO_MEIO[e.autorizadoPorTipo] : null, retroativo: e.retroativo,
      })),
      encomendasRetiradas: encomendas.map((x) => ({
        codigo: codigoEncomenda(x.numero), unidade: codigoUnidade({ bloco: x.bloco, numero: x.numero2 }), recebidaEm: isoSP(x.recebidaEm), retiradaEm: isoSP(x.retiradaEm),
      })),
      documentos: docs,
      observacoes: [
        'O número do CPF não é armazenado (só a máscara e um código de busca irreversível, que não consta deste arquivo).',
        'Telefone exibido mascarado; o número completo é mantido e pode ser conferido ou corrigido presencialmente na administração.',
        'Arquivos (foto, anexos) aparecem só com os metadados; o conteúdo pode ser consultado na administração.',
        'Eventos de acesso, trilha de alterações e registros de conferência são mantidos por 3 anos (exercício regular de direitos).',
      ],
    };
    await this.auditoria.registrar(this.db, {
      ator: ctx.ator, ip: ctx.ip, acao: 'lgpd.exportar', entidade: 'pessoa', registroId: p.id,
      depois: { vinculos: vinculos.length, veiculos: veiculos.length, eventos: eventos.length, encomendas: encomendas.length, documentos: docs.length },
    });
    return { nomeArquivo: `lgpd-${p.id.slice(0, 8)}-${carimbo(agora)}.json`, conteudo: `${JSON.stringify(conteudo, null, 2)}\n`, quantidade: eventos.length };
  }

  // ----- Eliminação (art. 18, VI) ----------------------------------------------------------------------------------

  /** A pedido (SI). 404, 409 (já anonimizada) ou 422 (vínculo válido); o resto do trabalho é de `anonimizarNaTx`. */
  async anonimizar(ctx: Contexto, id: string): Promise<ResultadoAnonimizacaoApi> {
    const hoje = diaBrt(this.relogio.agora());
    const r = await this.db.transaction(async (tx) => {
      const [p] = await tx.select({ id: pessoa.id, anonimizadaEm: pessoa.anonimizadaEm }).from(pessoa).where(eq(pessoa.id, id)).for('update');
      if (!p) throw erroApi(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
      if (p.anonimizadaEm) throw erroApi(409, 'PESSOA_JA_ANONIMIZADA', 'Esta pessoa já foi anonimizada.');
      const [valido] = await tx.select({ id: vinculoUnidade.id }).from(vinculoUnidade)
        .where(and(eq(vinculoUnidade.pessoaId, id), vinculoValidoSql(hoje))).limit(1);
      if (valido) throw erroApi(422, 'PESSOA_COM_VINCULO_VALIDO', 'A pessoa tem vínculo válido com uma unidade: encerre o vínculo antes de anonimizar.');
      return this.anonimizarNaTx(tx, { ator: ctx.ator, ip: ctx.ip }, id, 'pedido');
    });
    const eliminados = await this.apagarArquivos(r.arquivos);
    const retidos = await this.eventosRetidos(id);
    return { pessoaId: id, registrosRedigidos: r.registrosRedigidos, retido: RETIDO, ...retidos, documentosEliminados: eliminados };
  }

  /**
   * Anonimiza dentro da transação do chamador, com a pessoa já travada e a regra já conferida. Devolve os arquivos a
   * apagar DEPOIS do commit (apagar antes perderia o arquivo num rollback).
   */
  async anonimizarNaTx(tx: Tx, quem: { ator: Ator | null; ip?: string | null; nomeInformado?: string }, id: string, motivo: 'pedido' | 'retencao') {
    const [foto] = await tx.select({ caminho: documento.caminhoStorage }).from(pessoa)
      .innerJoin(documento, eq(documento.id, pessoa.fotoDocumentoId)).where(and(eq(pessoa.id, id), isNotNull(pessoa.fotoDocumentoId)));
    let registrosRedigidos: number;
    try {
      const res = (await tx.execute(sql`SELECT lgpd_anonimizar_pessoa(${id}::uuid, ${motivo}) AS n`)) as unknown as { rows: { n: number | string }[] };
      registrosRedigidos = Number(res.rows[0]?.n ?? 0);
    } catch (e) {
      // Corrida com outra anonimização (a função reconfere com a linha travada): mensagem legível, sem o texto do driver.
      if (codigoPg(e) === '23514') throw erroApi(409, 'PESSOA_JA_ANONIMIZADA', 'Esta pessoa já foi anonimizada.');
      throw e;
    }
    // Registrado DEPOIS da redação: este registro não tem dado pessoal (motivo, contagem e os campos removidos).
    await this.auditoria.registrar(tx, {
      ator: quem.ator, ip: quem.ip, nomeInformado: quem.nomeInformado, acao: 'lgpd.anonimizar', entidade: 'pessoa', registroId: id,
      depois: { motivo, registrosRedigidos, campos: ['nome', 'documento_mascarado', 'documento_busca', 'telefone', 'empresa', 'servico', 'foto_documento_id'], fotoEliminada: !!foto },
    });
    return { registrosRedigidos, arquivos: foto ? [foto.caminho] : [] };
  }

  /** Apaga do volume os arquivos de documentos já marcados como eliminados. Falha = fica para a varredura de órfãos. */
  async apagarArquivos(caminhos: string[]): Promise<number> {
    let n = 0;
    for (const c of caminhos) if (await this.cofre.eliminar(c)) n++;
    return n;
  }

  /** Eventos em que a pessoa aparece (como pessoa ou autorizadora) e o dia em que o último completa 3 anos. */
  private async eventosRetidos(id: string): Promise<{ eventosRetidos: number; retidoAte: string | null }> {
    const [r] = await this.db.select({ n: sql<number>`count(*)`.mapWith(Number), ultimo: max(eventoAcesso.registradoEm) }).from(eventoAcesso)
      .where(or(eq(eventoAcesso.pessoaId, id), eq(eventoAcesso.autorizadoPorPessoaId, id)));
    const ultimo = r?.ultimo ? new Date(r.ultimo) : null;
    return { eventosRetidos: r?.n ?? 0, retidoAte: ultimo ? diaBrt(somarAnos(ultimo, ANOS_RETENCAO)) : null };
  }
}
