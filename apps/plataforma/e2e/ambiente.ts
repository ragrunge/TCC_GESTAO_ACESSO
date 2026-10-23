// Constantes do e2e do app do Master. Tudo fictício e só da API de teste (apps/api/test/e2e): a senha é a do modo e2e e o
// segredo TOTP é o de apps/api/test/e2e/masters.ts (público de propósito; não vale em nenhum outro ambiente).
import { createHmac } from 'node:crypto';

export const PORTA_API_E2E = 3102;
export const PORTA_E2E = 5181;
export const API_E2E = `http://127.0.0.1:${PORTA_API_E2E}`;
export const SENHA_E2E = 'senha-e2e-portaria-parque';
export const TOTP_E2E = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const MASTER = 'master@exemplo.test';
export const NOVO_MASTER = 'novo.master@exemplo.test';

/** RFC 6238 (HMAC-SHA1, 6 dígitos, 30 s), como o aplicativo autenticador. */
export function codigoTotp(base32 = TOTP_E2E, agora = Date.now()): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, v = 0;
  const bytes: number[] = [];
  for (const c of base32) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { bytes.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(agora / 30_000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, '0');
}
