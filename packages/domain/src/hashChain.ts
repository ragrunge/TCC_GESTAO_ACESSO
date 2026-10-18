// Cadeia de hash da trilha de acessos (RF-32, RF-37, RNF-01; spec §4.3 e §4.7). FONTE ÚNICA da serialização:
// usada pelo mock do navegador, pela API (apps/api/src/db/cadeia.ts) e pelo verificador da exportação.
// Reproduz byte a byte `evento_acesso_canonico(e)` do banco (migração 0001):
//   hash = hex( SHA-256( UTF-8( hash_anterior || canonico ) ) )
//   canonico = JSON compacto, chaves na ordem de CAMPOS_CANONICOS_V1 (precedidas de "v"), null explícito,
//              instantes ISO 8601 UTC com ms (Date.toISOString), correcao_valores como objeto em ordem fixa.
// SHA-256 por WebCrypto (globalThis.crypto.subtle): funciona no navegador (localhost/HTTPS) e no Node 22.
import type { EventoAcesso, ValoresCorrecao } from './types';

/** Versão da serialização canônica gravada em `formato_hash`. */
export const FORMATO_HASH = 1;

/** Ordem dos campos na serialização canônica v1 (a chave "v" vem antes de todos). */
export const CAMPOS_CANONICOS_V1 = [
  'seq', 'id', 'tipo', 'categoria_pessoa', 'pessoa_id', 'unidade_destino_id', 'area_comum_id', 'ponto_acesso_id',
  'autorizado_por_tipo', 'autorizado_por_pessoa_id', 'autorizacao_previa_id', 'justificativa', 'restricao_id',
  'operador_id', 'operador_papel', 'ocorrido_em', 'registrado_em', 'retroativo', 'formulario_contingencia',
  'refere_evento_id', 'corrige_evento_id', 'correcao_valores', 'empresa', 'servico', 'observacao',
] as const;

/** Ordem das chaves de correcao_valores (só as presentes entram). Chave nova entra no fim. */
export const CHAVES_CORRECAO_V1 = ['unidade_destino_id', 'ocorrido_em', 'pessoa_id', 'autorizado_por_pessoa_id'] as const;

type CampoCanonico = (typeof CAMPOS_CANONICOS_V1)[number];

/** Evento no formato de exportação verificável: snake_case, ids como texto, instantes em ISO 8601 UTC com ms. */
export type EventoExportado = {
  [K in Exclude<CampoCanonico, 'seq' | 'retroativo' | 'correcao_valores'>]: string | null;
} & {
  v: number;
  seq: number;
  retroativo: boolean;
  correcao_valores: Record<string, string | null> | null;
  hash_anterior: string;
  hash: string;
};

export async function sha256Hex(texto: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto (crypto.subtle) indisponível: abra o app em localhost ou HTTPS.');
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let genese: Promise<string> | null = null;
/** Hash de gênese: SHA-256 hex da string "genesis" (hash_anterior do seq 1; mesmo valor gravado pela migração). */
export const hashGenese = () => (genese ??= sha256Hex('genesis'));

function canonCorrecao(v: Record<string, string | null> | null): Record<string, string | null> | null {
  if (v === null) return null;
  const out: Record<string, string | null> = {};
  for (const k of CHAVES_CORRECAO_V1) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = v[k] ?? null;
  return out;
}

/** JSON canônico v1: compacto, chaves na ordem fixa, null explícito. */
export function jsonCanonicoV1(e: EventoExportado): string {
  if (e.v !== 1) throw new Error(`formato de hash não suportado: v=${e.v}`);
  const obj: Record<string, unknown> = { v: 1 };
  for (const c of CAMPOS_CANONICOS_V1) {
    obj[c] = c === 'correcao_valores' ? canonCorrecao(e.correcao_valores) : (e[c] ?? null);
  }
  return JSON.stringify(obj);
}

/** Hash de um evento exportado: SHA-256(hash_anterior + JSON canônico v1). */
export const calcularHashExportado = (e: EventoExportado) => sha256Hex(e.hash_anterior + jsonCanonicoV1(e));

const iso = (ms: number) => new Date(ms).toISOString();

/** correcao_valores (camelCase, epoch) -> objeto do banco (snake_case, ISO), só com as chaves presentes. */
export function correcaoParaExportacao(v: Partial<ValoresCorrecao> | null): Record<string, string | null> | null {
  if (v === null) return null;
  const out: Record<string, string | null> = {};
  if ('unidadeDestinoId' in v) out.unidade_destino_id = v.unidadeDestinoId ?? null;
  if ('ocorridoEm' in v) out.ocorrido_em = v.ocorridoEm === undefined ? null : iso(v.ocorridoEm);
  if ('pessoaId' in v) out.pessoa_id = v.pessoaId ?? null;
  if ('autorizadoPorPessoaId' in v) out.autorizado_por_pessoa_id = v.autorizadoPorPessoaId ?? null;
  return out;
}

/** Evento do domínio (camelCase, epoch ms) -> formato de exportação/hash. */
export function paraExportado(e: Omit<EventoAcesso, 'hash'> & { hash?: string }): EventoExportado {
  return {
    v: e.formatoHash, seq: e.seq, id: e.id, tipo: e.tipo, categoria_pessoa: e.categoriaPessoa, pessoa_id: e.pessoaId,
    unidade_destino_id: e.unidadeDestinoId, area_comum_id: e.areaComumId, ponto_acesso_id: e.pontoAcessoId,
    autorizado_por_tipo: e.autorizadoPorTipo, autorizado_por_pessoa_id: e.autorizadoPorPessoaId,
    autorizacao_previa_id: e.autorizacaoPreviaId, justificativa: e.justificativa, restricao_id: e.restricaoId,
    operador_id: e.operadorId, operador_papel: e.operadorPapel, ocorrido_em: iso(e.ocorridoEm),
    registrado_em: iso(e.registradoEm), retroativo: e.retroativo, formulario_contingencia: e.formularioContingencia,
    refere_evento_id: e.refereEventoId, corrige_evento_id: e.corrigeEventoId,
    correcao_valores: correcaoParaExportacao(e.correcaoValores),
    empresa: e.empresa, servico: e.servico, observacao: e.observacao,
    hash_anterior: e.hashAnterior, hash: e.hash ?? '',
  };
}

/** Hash de um evento do domínio (o mock grava com isto; o banco calcula o mesmo valor no trigger). */
export const calcularHash = (ev: Omit<EventoAcesso, 'hash'>) => calcularHashExportado(paraExportado(ev));

/** Ponto de partida da verificação: gênese (seq 0) ou o selo/âncora do evento anterior ao primeiro verificado. */
export interface Ancora { seq: number; hash: string }

export interface ResultadoVerificacao {
  valido: boolean;
  verificados: number;
  ultimoSeq: number;
  ultimoHash: string;
  primeiroSeqInvalido?: number;
  primeiroEventoIdInvalido?: string;
  /**
   * lacuna_de_seq: falta evento (inclusive no fim, contra a cabeça da cadeia); hash_anterior_incoerente: encadeamento
   * quebrado; hash_divergente: conteúdo alterado; selo_divergente: a cadeia é coerente por dentro, mas não bate com o
   * selo diário (recalculada inteira depois de adulterada).
   */
  motivo?: 'lacuna_de_seq' | 'hash_anterior_incoerente' | 'hash_divergente' | 'selo_divergente';
}
/** Nome usado pela UI. */
export type ResultadoIntegridade = ResultadoVerificacao;

/**
 * Percorre os eventos em ordem de seq, recalcula cada hash e aponta o primeiro registro adulterado.
 * `ancora`: padrão gênese (seq 0). Depois de um descarte por retenção, use o selo do último seq descartado; numa
 * exportação parcial, o hash do evento imediatamente anterior ao primeiro exportado.
 */
export async function verificarCadeia(eventos: readonly EventoExportado[], ancora?: Ancora): Promise<ResultadoVerificacao> {
  const inicio = ancora ?? { seq: 0, hash: await hashGenese() };
  const ordenados = [...eventos].sort((a, b) => a.seq - b.seq);
  let seqAnterior = inicio.seq;
  let hashAnterior = inicio.hash;
  let verificados = 0;
  for (const e of ordenados) {
    const falha = (motivo: ResultadoVerificacao['motivo']): ResultadoVerificacao => ({
      valido: false, verificados, ultimoSeq: seqAnterior, ultimoHash: hashAnterior,
      primeiroSeqInvalido: e.seq, primeiroEventoIdInvalido: e.id ?? undefined, motivo,
    });
    if (e.seq !== seqAnterior + 1) return falha('lacuna_de_seq');
    if (e.hash_anterior !== hashAnterior) return falha('hash_anterior_incoerente');
    if ((await calcularHashExportado(e)) !== e.hash) return falha('hash_divergente');
    seqAnterior = e.seq;
    hashAnterior = e.hash;
    verificados++;
  }
  return { valido: true, verificados, ultimoSeq: seqAnterior, ultimoHash: hashAnterior };
}

/** Verifica a cadeia de eventos do domínio (mock): converte para o formato canônico e aplica `verificarCadeia`. */
export const verificarCadeiaEventos = (eventos: readonly EventoAcesso[], ancora?: Ancora) =>
  verificarCadeia(eventos.map(paraExportado), ancora);

/** Código de exibição do evento, derivado de `seq` (não é gravado nem entra no hash). */
export const codigoEvento = (seq: number) => `EV-${String(seq).padStart(6, '0')}`;
