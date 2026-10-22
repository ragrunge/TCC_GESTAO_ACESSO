// Código do condomínio (docs/05_arquitetura_saas.md SAAS-05): o slug curto que a portaria digita no login e que vai no
// cabeçalho `X-Condominio`. Fonte única do formato para a API (resolvedor e registro do piloto) e para o front.
// Não é segredo nem dado pessoal: só escolhe o banco onde o login é procurado.

/** 3 a 31 caracteres, a-z, 0-9 e hífen, começando por letra. */
export const CODIGO_CONDOMINIO = /^[a-z][a-z0-9-]{2,30}$/;

/** O que o login aceita como digitado: sem espaços nas pontas e em minúsculas. */
export function normalizarCodigoCondominio(valor: string): string {
  return valor.trim().toLowerCase();
}

/** Código já normalizado e no formato. */
export function codigoCondominioValido(codigo: string): boolean {
  return CODIGO_CONDOMINIO.test(codigo);
}

/** Siglas das unidades da federação (cadastro do condomínio na plataforma; mesmo CHECK de `condominio.uf`). */
export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;
export type Uf = (typeof UFS)[number];
