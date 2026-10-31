// Cliente HTTP (axios) da API real. Sessão por cookie HttpOnly (spec §5.1): o front nunca lê nem guarda token, só
// manda o cookie (withCredentials). Base relativa '/api/v1' (mesma origem): em dev o proxy do Vite repassa para a
// API; em produção, o rewrite da Vercel (spec §14, nº 26).
//
// O interceptor NÃO navega (navegar escondido no interceptor esconde o efeito do call site): ele converte todo erro
// em ApiError e só emite um aviso ("expirada" / "troca_obrigatoria"). Quem decide o que fazer é o AuthContext.
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ApiError, type EventoSessao } from '../types';

/** Rotas cujo 401 é resposta esperada, não "sessão expirada": credencial errada, sem sessão no boot, logout repetido. */
const SEM_AVISO_401 = new Set(['/auth/login', '/auth/me', '/auth/logout']);

/** Retry-After em segundos (número) ou data HTTP. Indefinido se ausente ou ilegível. */
export function segundosRetryAfter(valor: unknown, agora = Date.now()): number | undefined {
  if (typeof valor !== 'string' || !valor.trim()) return undefined;
  const n = Number(valor);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(valor);
  return Number.isNaN(t) ? undefined : Math.max(0, Math.ceil((t - agora) / 1000));
}

export function tempoLegivel(segundos: number): string {
  if (segundos < 60) return segundos <= 1 ? '1 segundo' : `${segundos} segundos`;
  const min = Math.ceil(segundos / 60);
  return min === 1 ? '1 minuto' : `${min} minutos`;
}

function mensagemPorStatus(status: number): string {
  if (status === 401) return 'Entre no sistema para continuar.';
  if (status === 403) return 'Seu perfil não tem permissão para esta ação.';
  if (status === 404) return 'Recurso não encontrado.';
  if (status === 429) return 'Muitas tentativas. Aguarde e tente novamente.';
  if (status >= 500) return 'O servidor não respondeu como esperado. Tente novamente em instantes.';
  return 'Requisição recusada.';
}

/**
 * Qualquer erro do axios vira ApiError. Corpo de erro da API (skill rest-api, req-error-format):
 * { statusCode, error, code, message, details?, timestamp, path }. O status vem do HTTP, não do corpo.
 */
export function paraApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (!axios.isAxiosError(err)) return new ApiError(0, 'ERRO_DESCONHECIDO', 'Erro inesperado.');
  const r = err.response;
  if (!r) {
    const semRede = typeof navigator !== 'undefined' && navigator.onLine === false;
    return new ApiError(0, 'FALHA_DE_REDE', semRede
      ? 'Sem conexão — o sistema precisa de internet para registrar.'
      : 'Não foi possível falar com o servidor. Verifique a conexão e tente novamente.');
  }
  const corpo = (r.data && typeof r.data === 'object' ? r.data : {}) as { code?: unknown; message?: unknown; details?: unknown };
  const codigo = typeof corpo.code === 'string' ? corpo.code : `HTTP_${r.status}`;
  let mensagem = typeof corpo.message === 'string' && corpo.message ? corpo.message : mensagemPorStatus(r.status);
  let espera: number | undefined;
  if (r.status === 429) {
    espera = segundosRetryAfter(r.headers?.['retry-after']);
    if (espera !== undefined) mensagem = `Muitas tentativas. Tente novamente em ${tempoLegivel(espera)}.`;
  }
  const e = new ApiError(r.status, codigo, mensagem, corpo.details);
  if (espera !== undefined) e.retryAfterSegundos = espera;
  return e;
}

export interface ClienteHttp {
  http: AxiosInstance;
  aoEvento(cb: (e: EventoSessao) => void): () => void;
  /** Login/me com sucesso: rearma o aviso de sessão expirada. */
  sessaoAtiva(): void;
  /** Logout pedido pelo usuário: 401 de requisições ainda em voo não viram "sessão expirada". */
  sessaoEncerrada(): void;
}

export function criarCliente(base: string, opcoes: { adapter?: AxiosRequestConfig['adapter'] } = {}): ClienteHttp {
  const http = axios.create({
    baseURL: base,
    withCredentials: true,
    timeout: 20_000,
    headers: { 'Content-Type': 'application/json' },
    ...(opcoes.adapter ? { adapter: opcoes.adapter } : {}),
  });
  const ouvintes = new Set<(e: EventoSessao) => void>();
  // Um aviso por "vida" da sessão: N requisições paralelas com 401 emitem um só (sem toasts nem navegações repetidas).
  let expiradaAvisada = false;
  let trocaAvisada = false;
  const emitir = (e: EventoSessao) => ouvintes.forEach((cb) => cb(e));

  http.interceptors.response.use(undefined, (err: unknown) => {
    const e = paraApiError(err);
    const url = axios.isAxiosError(err) ? err.config?.url ?? '' : '';
    if (e.status === 401 && !SEM_AVISO_401.has(url) && !expiradaAvisada) {
      expiradaAvisada = true;
      emitir('expirada');
    } else if (e.status === 403 && e.code === 'TROCA_DE_SENHA_OBRIGATORIA' && !trocaAvisada) {
      trocaAvisada = true;
      emitir('troca_obrigatoria');
    }
    return Promise.reject(e);
  });

  return {
    http,
    aoEvento(cb) { ouvintes.add(cb); return () => { ouvintes.delete(cb); }; },
    sessaoAtiva() { expiradaAvisada = false; trocaAvisada = false; },
    sessaoEncerrada() { expiradaAvisada = true; trocaAvisada = true; },
  };
}
