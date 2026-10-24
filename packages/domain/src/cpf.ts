// CPF sem armazenar o número (decisão 18 da spec): máscara para exibição e HMAC-SHA256 para busca/unicidade.
// Mesmo algoritmo de apps/api/src/db/cpf.ts (lá com node:crypto e a chave PORTARIA_HMAC_CPF_KEY); aqui por
// WebCrypto, para rodar no navegador e no Node.
export const soDigitos = (s: string) => s.replace(/\D/g, '');

/** "***.456.789-**": expõe só os 6 dígitos do meio. */
export function mascararCpf(cpf: string): string {
  const d = soDigitos(cpf);
  if (d.length !== 11) throw new Error('CPF deve ter 11 dígitos');
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/**
 * Chave HMAC FIXA de demonstração, para desenvolvimento e testes. Não é segredo: qualquer um que leia o código
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

// ---- Máscaras de entrada (digitação progressiva). Puras e idempotentes: mascaraX(mascaraX(s)) === mascaraX(s).
// Aceitam texto colado com ou sem pontuação, descartam o que não cabe e limitam o tamanho. Só apresentação:
// a API normaliza (só dígitos / sem hífen) e continua aceitando os dois formatos.

/** CPF progressivo: "123" -> "123", "1234" -> "123.4", 11 dígitos -> "123.456.789-09". */
export function mascaraCpf(texto: string | null | undefined): string {
  const d = soDigitos(texto ?? '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Telefone progressivo: fixo "(11) 3456-7890" (10 dígitos), celular "(11) 98765-4321" (11). Celular = 9 logo após o DDD.
 * Descarta o "55" de quem cola "+55 11 ..." (só quando passaria de 11 dígitos).
 */
export function mascaraTelefone(texto: string | null | undefined): string {
  let d = soDigitos(texto ?? '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  const celular = d[2] === '9';
  const corte = celular ? 7 : 6; // dígitos antes do hífen, contando o DDD
  if (d.length <= corte) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, corte)}-${d.slice(corte)}`;
}

/** Placa: maiúsculas, 7 caracteres. Antiga com hífen ("ABC-1234", 5º caractere dígito); Mercosul sem ("ABC1D23"). */
export function mascaraPlaca(texto: string | null | undefined): string {
  const p = (texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  return /^[A-Z]{3}\d/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p; // ABC-1234 e ABC-1D23, como o formatarPlaca da exibição
}
