// Cookie de sessão: HttpOnly; Secure; SameSite=Strict; Path=/ (spec §5.1). SameSite=Strict é a proteção de CSRF
// inteira deste desenho: só vale com front e API no MESMO site (ver spec §14, deploy). Com Secure, o nome leva o
// prefixo __Host- (o navegador recusa o cookie se faltar Secure, se Path não for / ou se houver Domain).
import type { CookieOptions, Request, Response } from 'express';
import type { Config } from '../config/config';

const opcoes = (config: Config): CookieOptions => ({
  httpOnly: true,
  secure: config.cookie.secure,
  sameSite: 'strict',
  path: '/',
});

/** O valor do cookie é o token da sessão (base64url, 43 caracteres); o banco guarda só o hash dele (sessao.service.ts). */
export function gravarCookieSessao(res: Response, config: Config, token: string, expiraEm: Date) {
  res.cookie(config.cookie.nome, token, { ...opcoes(config), expires: expiraEm });
}

export function limparCookieSessao(res: Response, config: Config) {
  res.clearCookie(config.cookie.nome, opcoes(config));
}

const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** O token do cookie, se estiver no formato; qualquer outra coisa: null (401 sem ir ao banco). */
export function tokenDoCookie(valor: string | null): string | null {
  return valor && FORMATO_TOKEN.test(valor) ? valor : null;
}

/** Lê só o cookie de sessão do cabeçalho Cookie (sem parser genérico: um nome, um valor). */
export function lerCookieSessao(req: Request, config: Config): string | null {
  const cabecalho = req.headers.cookie;
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0 || parte.slice(0, i).trim() !== config.cookie.nome) continue;
    const valor = parte.slice(i + 1).trim();
    return valor || null; // o token é base64url: não precisa de decodeURIComponent
  }
  return null;
}
