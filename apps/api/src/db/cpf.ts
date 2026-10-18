// CPF no banco (decisão de MVP, ver db/README.md): o número NÃO é armazenado.
// - documento_mascarado: exibição (***.456.789-**)
// - documento_busca: HMAC-SHA256 com chave secreta (PORTARIA_HMAC_CPF_KEY), nunca SHA puro: o espaço do CPF
//   (10^9 bases) se percorre por força bruta em segundos, e o HMAC sem a chave não.
import { createHmac } from 'node:crypto';

const soDigitos = (s: string) => s.replace(/\D/g, '');

export function mascararCpf(cpf: string): string {
  const d = soDigitos(cpf);
  if (d.length !== 11) throw new Error('CPF deve ter 11 dígitos');
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/** Chave de 32 bytes em base64 (gerar com: openssl rand -base64 32). Separada da KEK dos documentos. */
export function chaveHmacDoAmbiente(valor = process.env.PORTARIA_HMAC_CPF_KEY): Buffer {
  if (!valor) throw new Error('PORTARIA_HMAC_CPF_KEY não definida');
  const chave = Buffer.from(valor, 'base64');
  if (chave.length < 32) throw new Error('PORTARIA_HMAC_CPF_KEY precisa de pelo menos 32 bytes (base64)');
  return chave;
}

export function documentoBusca(cpf: string, chave: Buffer): string {
  const d = soDigitos(cpf);
  if (d.length !== 11) throw new Error('CPF deve ter 11 dígitos');
  return createHmac('sha256', chave).update(d, 'utf8').digest('hex');
}
