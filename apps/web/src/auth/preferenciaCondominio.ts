// Código do condomínio lembrado no navegador da portaria (SAAS-05): PREFERÊNCIA DE UI, como o CLAUDE.md do projeto
// permite para o storage. Guarda só o código (público por natureza: a portaria o digita), nunca sessão, login,
// nome de usuário nem dado pessoal. Storage indisponível (aba privada, bloqueio): segue sem lembrar.
import { codigoCondominioValido, normalizarCodigoCondominio } from '@portaria/domain/condominio';

export const CHAVE_CODIGO_CONDOMINIO = 'portaria:preferencia:codigo-condominio';

/** O código lembrado, ou '' se não houver (ou se o valor guardado não estiver no formato). */
export function lerCodigoLembrado(): string {
  try {
    const v = normalizarCodigoCondominio(window.localStorage.getItem(CHAVE_CODIGO_CONDOMINIO) ?? '');
    return codigoCondominioValido(v) ? v : '';
  } catch {
    return '';
  }
}

/** Lembra o código (só se estiver no formato; o resto é ignorado). */
export function lembrarCodigo(codigo: string): void {
  const v = normalizarCodigoCondominio(codigo);
  if (!codigoCondominioValido(v)) return;
  try {
    window.localStorage.setItem(CHAVE_CODIGO_CONDOMINIO, v);
  } catch {
    // sem storage: a portaria digita de novo na próxima vez
  }
}
