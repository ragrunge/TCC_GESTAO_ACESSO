// CPF sem armazenar o número (decisão 18 da spec): máscara para exibição e HMAC-SHA256 para busca/unicidade.
// Mesmo algoritmo de apps/api/src/db/cpf.ts (lá com node:crypto e a chave PORTARIA_HMAC_CPF_KEY); aqui por
// WebCrypto, para rodar no navegador (mock) e no Node.
export const soDigitos = (s: string) => s.replace(/\D/g, '');

/** "***.456.789-**": expõe só os 6 dígitos do meio. */
export function mascararCpf(cpf: string): string {
  const d = soDigitos(cpf);
  if (d.length !== 11) throw new Error('CPF deve ter 11 dígitos');
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/**
 * Chave HMAC FIXA de demonstração, usada só pelo mock do navegador. Não é segredo: qualquer um que leia o código
 * pode recalcular o HMAC. Em produção a chave vem de PORTARIA_HMAC_CPF_KEY (32+ bytes aleatórios, fora do repositório).
 */
export const CHAVE_HMAC_DEMO: Uint8Array<ArrayBuffer> = new TextEncoder().encode('portaria-parque/demo/hmac-cpf/01'); // 32 bytes

// Tipo inferido (sem citar CryptoKey): compila com a lib DOM (web) e só com @types/node (API).
const importarRaw = (chave: Uint8Array<ArrayBuffer>) =>
  globalThis.crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const cacheChaves = new Map<string, ReturnType<typeof importarRaw>>();
function importarChave(chave: Uint8Array<ArrayBuffer>): ReturnType<typeof importarRaw> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto (crypto.subtle) indisponível: abra o app em localhost ou HTTPS.');
  const k = Array.from(chave).join(',');
  let p = cacheChaves.get(k);
  if (!p) {
    p = importarRaw(chave);
    cacheChaves.set(k, p);
  }
  return p;
}

/** HMAC-SHA256 em hex minúsculo. */
export async function hmacSha256Hex(chave: Uint8Array<ArrayBuffer>, texto: string): Promise<string> {
  const k = await importarChave(chave);
  const buf = await globalThis.crypto.subtle.sign('HMAC', k, new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** documento_busca: HMAC-SHA256(chave, 11 dígitos do CPF). */
// Sem valor padrão de propósito: a chave de demonstração precisa ser passada explicitamente, para que a API real
// nunca gere hash com ela por esquecimento.
export async function documentoBuscaCpf(cpf: string, chave: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = soDigitos(cpf);
  if (d.length !== 11) throw new Error('CPF deve ter 11 dígitos');
  return hmacSha256Hex(chave, d);
}

/** Telefone guardado só com dígitos; exibição "(11) 91234-5678". */
export const normalizarTelefone = (t: string | null | undefined) => soDigitos(t ?? '');
export function formatarTelefone(t: string | null | undefined): string {
  const d = soDigitos(t ?? '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || '—';
}
