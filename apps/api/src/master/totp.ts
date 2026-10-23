// TOTP (RFC 6238 sobre o HOTP da RFC 4226) com node:crypto, sem dependência nova (docs/05_arquitetura_saas.md SAAS-08).
// Parâmetros fixos, os que todo aplicativo autenticador aceita: HMAC-SHA1, 6 dígitos, passo de 30 s, segredo de 160 bits.
// Janela de ±1 passo (relógio do celular adiantado ou atrasado até 30 s). Anti-replay: quem chama passa o último passo
// já aceito e só um passo MAIOR vale; o passo aceito é gravado no banco de forma atômica (sessao-master.service.ts).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_PASSO_S = 30;
export const TOTP_DIGITOS = 6;
export const TOTP_JANELA = 1;
/** 160 bits: o tamanho recomendado pela RFC 4226 para HMAC-SHA1. */
export const TOTP_BYTES_SEGREDO = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += BASE32[(valor << (5 - bits)) & 31];
  return saida;
}

/** Aceita minúsculas, espaços e `=` de preenchimento (o que um humano copia do autenticador). */
export function deBase32(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let valor = 0;
  const saida: number[] = [];
  for (const c of limpo) {
    const i = BASE32.indexOf(c);
    if (i < 0) throw new Error('base32 inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

export const novoSegredoTotp = (): Buffer => randomBytes(TOTP_BYTES_SEGREDO);

export const passoDe = (instante: Date): number => Math.floor(instante.getTime() / 1000 / TOTP_PASSO_S);

/** HOTP (RFC 4226 §5.3), truncamento dinâmico, `digitos` casas com zeros à esquerda. */
export function hotp(segredo: Uint8Array, contador: number, digitos = TOTP_DIGITOS, algoritmo: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = createHmac(algoritmo, segredo).update(msg).digest();
  const o = h[h.length - 1]! & 0x0f;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digitos).padStart(digitos, '0');
}

export const totp = (segredo: Uint8Array, instante: Date, digitos = TOTP_DIGITOS) => hotp(segredo, passoDe(instante), digitos);

const iguais = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Passo aceito, ou null. Confere os passos da janela (atual ±1) que sejam MAIORES que `ultimoPassoAceito` (anti-replay:
 * o mesmo código, ou um código mais antigo que o último usado, nunca vale de novo). Código fora do formato: null, sem HMAC.
 */
export function verificarTotp(segredo: Uint8Array, codigo: string, agora: Date, ultimoPassoAceito: number | null): number | null {
  if (!/^\d{6}$/.test(codigo)) return null;
  const atual = passoDe(agora);
  let aceito: number | null = null;
  // Confere todos os candidatos (sem sair cedo): o tempo não revela em qual passo o código bateu.
  for (let p = atual - TOTP_JANELA; p <= atual + TOTP_JANELA; p++) {
    if (p <= 0 || (ultimoPassoAceito !== null && p <= ultimoPassoAceito)) continue;
    if (iguais(hotp(segredo, p), codigo) && aceito === null) aceito = p;
  }
  return aceito;
}

/** URI `otpauth://` (formato do Google Authenticator, aceito pelos demais) para cadastrar o segredo no aplicativo. */
export function uriOtpauth(segredo: Uint8Array, conta: string, emissor = 'Portaria Parque'): string {
  const rotulo = `${encodeURIComponent(emissor)}:${encodeURIComponent(conta)}`;
  const q = new URLSearchParams({ secret: base32(segredo), issuer: emissor, algorithm: 'SHA1', digits: String(TOTP_DIGITOS), period: String(TOTP_PASSO_S) });
  return `otpauth://totp/${rotulo}?${q.toString()}`;
}
