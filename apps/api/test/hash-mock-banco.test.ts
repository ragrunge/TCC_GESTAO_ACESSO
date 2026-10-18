// O mock do navegador e o banco produzem o MESMO hash para o mesmo evento (spec §4.3, decisão 21).
// Cada evento é montado primeiro no formato em que o mock o guarda (EventoAcesso do domain: camelCase, epoch ms,
// correcaoValores como objeto camelCase) e só então inserido no banco. O trigger define seq, registrado_em,
// hash_anterior e (fora da contingência) ocorrido_em; esses valores voltam para o objeto do mock, e o hash calculado
// pela função do domain (a mesma que o mock usa em gravarEvento) precisa ser igual ao que o banco gravou.
import { asc } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { FORMATO_HASH, calcularHash, jsonCanonicoV1, paraExportado, verificarCadeiaEventos } from '@portaria/domain/hashChain';
import { CHAVE_HMAC_DEMO, documentoBuscaCpf } from '@portaria/domain/cpf';
import type { EventoAcesso, ValoresCorrecao } from '@portaria/domain/types';
import { documentoBusca } from '../src/db/cpf';
import * as s from '../src/db/schema';
import { type Db, type Fixtures, JUSTIFICATIVA, novoBanco } from './helpers/banco';

let client: PGlite;
let db: Db;
let fx: Fixtures;

type Rascunho = Omit<EventoAcesso, 'id' | 'seq' | 'hash' | 'hashAnterior' | 'registradoEm'>;

/** Evento como o mock o monta (antes de o "servidor" numerar e carimbar). */
function rascunho(extra: Partial<Rascunho> = {}): Rascunho {
  return {
    formatoHash: FORMATO_HASH, tipo: 'entrada', categoriaPessoa: 'visitante', pessoaId: fx.visitante.id,
    unidadeDestinoId: fx.t432.id, areaComumId: null, pontoAcessoId: fx.ponto.id, autorizadoPorTipo: 'interfone',
    autorizadoPorPessoaId: fx.morador.id, autorizacaoPreviaId: null, justificativa: null, restricaoId: null,
    operadorId: fx.porteiro.id, operadorPapel: 'porteiro', ocorridoEm: Date.now(), retroativo: false, refereEventoId: null,
    corrigeEventoId: null, observacao: null, formularioContingencia: null, correcaoValores: null, empresa: null, servico: null,
    ...extra,
  };
}

const correcaoParaBanco = (v: Partial<ValoresCorrecao> | null) => {
  if (!v) return null;
  const o: Record<string, string | null> = {};
  if ('unidadeDestinoId' in v) o.unidade_destino_id = v.unidadeDestinoId ?? null;
  if ('ocorridoEm' in v) o.ocorrido_em = new Date(v.ocorridoEm!).toISOString();
  if ('pessoaId' in v) o.pessoa_id = v.pessoaId ?? null;
  if ('autorizadoPorPessoaId' in v) o.autorizado_por_pessoa_id = v.autorizadoPorPessoaId ?? null;
  return o;
};

/** Insere o rascunho no banco e devolve o evento do mock completado com o que o servidor definiu. */
async function inserirComoMock(r: Rascunho): Promise<{ mock: EventoAcesso; hashBanco: string }> {
  const [row] = await db.insert(s.eventoAcesso).values({
    tipo: r.tipo, categoriaPessoa: r.categoriaPessoa, pessoaId: r.pessoaId, unidadeDestinoId: r.unidadeDestinoId,
    areaComumId: r.areaComumId, pontoAcessoId: r.pontoAcessoId, autorizadoPorTipo: r.autorizadoPorTipo,
    autorizadoPorPessoaId: r.autorizadoPorPessoaId, autorizacaoPreviaId: r.autorizacaoPreviaId, justificativa: r.justificativa,
    restricaoId: r.restricaoId, operadorId: r.operadorId, operadorPapel: r.operadorPapel, ocorridoEm: new Date(r.ocorridoEm),
    retroativo: r.retroativo, formularioContingencia: r.formularioContingencia, refereEventoId: r.refereEventoId,
    corrigeEventoId: r.corrigeEventoId, correcaoValores: correcaoParaBanco(r.correcaoValores), empresa: r.empresa,
    servico: r.servico, observacao: r.observacao,
  }).returning();
  const semHash: Omit<EventoAcesso, 'hash'> = {
    ...r, id: row.id, seq: row.seq, registradoEm: row.registradoEm.getTime(), hashAnterior: row.hashAnterior,
    // fora da contingência o relógio é do servidor (o mock faz o mesmo: ocorridoEm = registradoEm)
    ocorridoEm: r.retroativo ? r.ocorridoEm : row.registradoEm.getTime(),
  };
  return { mock: { ...semHash, hash: await calcularHash(semHash) }, hashBanco: row.hash };
}

const mocks: EventoAcesso[] = [];
const bancos: string[] = [];

beforeAll(async () => {
  ({ client, db, fx } = await novoBanco());
  const add = async (r: Rascunho) => { const x = await inserirComoMock(r); mocks.push(x.mock); bancos.push(x.hashBanco); return x.mock; };
  const entrada = await add(rascunho({ observacao: 'Disse: "volto já" \\ barra\nlinha 2\u0001 ção 😀' }));
  await add(rascunho({ tipo: 'saida', autorizadoPorTipo: null, autorizadoPorPessoaId: null, refereEventoId: entrada.id }));
  await add(rascunho({ tipo: 'recusado', autorizadoPorTipo: 'morador_presente' }));
  await add(rascunho({ pessoaId: fx.semCpf.id, autorizadoPorTipo: 'excecao_porteiro', autorizadoPorPessoaId: null, justificativa: JUSTIFICATIVA }));
  // RF-36: prestador em área comum, com empresa e serviço copiados do cadastro
  await add(rascunho({
    categoriaPessoa: 'prestador', pessoaId: fx.prestador.id, unidadeDestinoId: null, areaComumId: fx.area.id,
    autorizadoPorTipo: 'excecao_porteiro', autorizadoPorPessoaId: null, justificativa: JUSTIFICATIVA, empresa: 'Elétrica Silva', servico: 'Reparo',
  }));
  await add(rascunho({ categoriaPessoa: 'funcionario', pessoaId: fx.funcionarioPessoa.id, unidadeDestinoId: null, autorizadoPorTipo: 'escala', autorizadoPorPessoaId: null }));
  await add(rascunho({ retroativo: true, formularioContingencia: 'FC-0042', ocorridoEm: Date.now() - 3 * 3600_000 + 123 }));
  await add(rascunho({
    tipo: 'correcao', autorizadoPorTipo: null, autorizadoPorPessoaId: null, operadorId: fx.admin.id, operadorPapel: 'administracao',
    corrigeEventoId: entrada.id, justificativa: 'Unidade digitada errada pelo porteiro',
    // ordem das chaves diferente da canônica, de propósito: a serialização reordena
    correcaoValores: { autorizadoPorPessoaId: null, unidadeDestinoId: fx.t111.id, ocorridoEm: Date.UTC(2026, 9, 17, 11, 15, 0, 123) },
  }));
});

describe('mesmo hash no mock (domain) e no banco (trigger)', () => {
  it('o hash calculado pelo domain a partir do evento do mock é o hash gravado pelo banco', () => {
    expect(mocks).toHaveLength(8);
    for (const [i, m] of mocks.entries()) expect(m.hash, `seq ${m.seq} (${m.tipo})`).toBe(bancos[i]);
  });

  it('a string canônica do mock é idêntica à evento_acesso_canonico(e), byte a byte', async () => {
    const { rows } = await client.query<{ canon: string }>('SELECT evento_acesso_canonico(e) AS canon FROM evento_acesso e ORDER BY seq');
    expect(rows.map((r) => r.canon)).toEqual(mocks.map((m) => jsonCanonicoV1(paraExportado(m))));
  });

  it('a cadeia montada só com eventos do mock verifica, e o último hash é a cabeça do banco', async () => {
    const r = await verificarCadeiaEventos(mocks);
    expect(r).toMatchObject({ valido: true, verificados: 8 });
    const [cab] = await db.select().from(s.eventoAcessoCadeia);
    expect(r.ultimoHash).toBe(cab.ultimoHash);
    const linhas = await db.select().from(s.eventoAcesso).orderBy(asc(s.eventoAcesso.seq));
    expect(linhas.map((l) => l.hash)).toEqual(mocks.map((m) => m.hash));
  });

  it('documento_busca: o HMAC do domain (WebCrypto) é igual ao de src/db/cpf.ts (node:crypto)', async () => {
    const chave = Buffer.from(CHAVE_HMAC_DEMO);
    expect(await documentoBuscaCpf('529.982.247-25', CHAVE_HMAC_DEMO)).toBe(documentoBusca('52998224725', chave));
    const outra = new Uint8Array(32).fill(7);
    expect(await documentoBuscaCpf('52998224725', outra)).toBe(documentoBusca('52998224725', Buffer.from(outra)));
  });
});
