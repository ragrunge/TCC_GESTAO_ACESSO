// Segredo TOTP do Master cifrado em repouso (docs/05_arquitetura_saas.md SAAS-08): mesmo padrão do envelope das chaves de
// condomínio (saas/chave-mestra.ts) e do cofre dos anexos: AES-256-GCM pela chave mestra do ambiente, nonce de 12 bytes
// por cifragem, tag de 16 bytes, AAD que amarra o cifrado ao usuário (`portaria:totp:<master_usuario_id>`): copiar o
// segredo de um Master para a linha de outro falha no GCM em vez de entregar o segundo fator de outra pessoa.
// Layout da coluna `totp_cifrado`: nonce (12) || cifrado || tag (16). A versão da mestra fica em `totp_mestra_versao`.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { type ChaveMestra, ErroChave } from '../saas/chave-mestra';

const NONCE = 12;
const TAG = 16;

export const aadTotp = (masterUsuarioId: string) => `portaria:totp:${masterUsuarioId}`;

export interface TotpCifrado {
  totpCifrado: Buffer;
  totpMestraVersao: number;
}

export function cifrarSegredoTotp(mestra: ChaveMestra, masterUsuarioId: string, segredo: Buffer): TotpCifrado {
  if (segredo.length < 16 || segredo.length > 64) throw new ErroChave('segredo TOTP com tamanho inválido');
  const nonce = randomBytes(NONCE);
  const c = createCipheriv('aes-256-gcm', mestra.chave, nonce, { authTagLength: TAG });
  c.setAAD(Buffer.from(aadTotp(masterUsuarioId), 'utf8'));
  return { totpCifrado: Buffer.concat([nonce, c.update(segredo), c.final(), c.getAuthTag()]), totpMestraVersao: mestra.versao };
}

/** Lança ErroChave se a mestra for de outra versão ou se o GCM não autenticar. Quem chama zera o Buffer depois do uso. */
export function decifrarSegredoTotp(mestra: ChaveMestra, masterUsuarioId: string, e: { totpCifrado: Uint8Array; totpMestraVersao: number }): Buffer {
  if (e.totpMestraVersao !== mestra.versao) {
    throw new ErroChave(`segredo TOTP cifrado com a mestra v${e.totpMestraVersao}, mas o ambiente tem a v${mestra.versao}`);
  }
  const b = Buffer.from(e.totpCifrado);
  if (b.length <= NONCE + TAG) throw new ErroChave('segredo TOTP com tamanho inválido');
  try {
    const d = createDecipheriv('aes-256-gcm', mestra.chave, b.subarray(0, NONCE), { authTagLength: TAG });
    d.setAAD(Buffer.from(aadTotp(masterUsuarioId), 'utf8'));
    d.setAuthTag(b.subarray(b.length - TAG));
    return Buffer.concat([d.update(b.subarray(NONCE, b.length - TAG)), d.final()]);
  } catch {
    throw new ErroChave('segredo TOTP não autenticou (chave mestra errada ou linha adulterada)');
  }
}
