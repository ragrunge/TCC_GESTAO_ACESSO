// Encadeamento SHA-256 da trilha de auditoria (RNF-01, spec seção 4.3).
// hash = SHA-256( hashAnterior + JSON canônico dos campos do evento )
import type { EventoAcesso } from './types';

export const CAMPOS_CANONICOS = [
  'seq', 'id', 'codigo', 'tipo', 'categoriaPessoa', 'pessoaId', 'unidadeDestinoId', 'pontoAcesso',
  'autorizadoPorTipo', 'autorizadoPorPessoaId', 'autorizadoPorNome', 'autorizacaoPreviaId',
  'justificativa', 'restricaoId', 'operadorId', 'ocorridoEm', 'registradoEm', 'retroativo',
  'refereEventoId', 'corrigeEventoId', 'observacao',
] as const;

export async function sha256Hex(texto: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto (crypto.subtle) indisponível: abra o app em localhost ou HTTPS.');
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Objeto canônico: campos em ordem fixa, ausentes como null. */
export function camposCanonicos(ev: Omit<EventoAcesso, 'hash' | 'hashAnterior'>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const c of CAMPOS_CANONICOS) {
    const v = (ev as unknown as Record<string, unknown>)[c];
    obj[c] = v === undefined ? null : v;
  }
  return obj;
}

/** JSON canônico que entra no hash. */
export const jsonCanonico = (ev: Omit<EventoAcesso, 'hash' | 'hashAnterior'>): string => JSON.stringify(camposCanonicos(ev));

let genese: Promise<string> | null = null;
/** Hash de gênese: SHA-256 da string "genesis". */
export const hashGenese = () => (genese ??= sha256Hex('genesis'));

export async function calcularHash(hashAnterior: string, ev: Omit<EventoAcesso, 'hash' | 'hashAnterior'>): Promise<string> {
  return sha256Hex(hashAnterior + jsonCanonico(ev));
}

export interface ResultadoIntegridade {
  valido: boolean;
  verificados: number;
  ultimoSeq: number;
  ultimoHash: string;
  primeiroSeqInvalido?: number;
  primeiroEventoIdInvalido?: string;
  motivo?: 'hash_divergente' | 'hash_anterior_incoerente' | 'lacuna_de_seq';
}

/** Percorre a cadeia em ordem de seq, recalcula cada hash e aponta o primeiro registro adulterado. */
export async function verificarCadeia(eventos: readonly EventoAcesso[]): Promise<ResultadoIntegridade> {
  const ordenados = [...eventos].sort((a, b) => a.seq - b.seq);
  let esperadoAnterior = await hashGenese();
  let seqAnterior = 0;
  let verificados = 0;
  for (const ev of ordenados) {
    const falha = (motivo: ResultadoIntegridade['motivo']): ResultadoIntegridade => ({
      valido: false, verificados, ultimoSeq: seqAnterior, ultimoHash: esperadoAnterior,
      primeiroSeqInvalido: ev.seq, primeiroEventoIdInvalido: ev.id, motivo,
    });
    if (ev.seq !== seqAnterior + 1) return falha('lacuna_de_seq');
    if (ev.hashAnterior !== esperadoAnterior) return falha('hash_anterior_incoerente');
    const recalculado = await calcularHash(ev.hashAnterior, ev);
    if (recalculado !== ev.hash) return falha('hash_divergente');
    esperadoAnterior = ev.hash;
    seqAnterior = ev.seq;
    verificados++;
  }
  return { valido: true, verificados, ultimoSeq: seqAnterior, ultimoHash: esperadoAnterior };
}
