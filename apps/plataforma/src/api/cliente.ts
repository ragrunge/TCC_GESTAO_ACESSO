// Cliente HTTP do app do Master. Sessão por cookie HttpOnly da plataforma (o front nunca vê token): só `withCredentials`.
// Todo erro vira ApiError. O interceptor não navega: avisa o contexto de sessão (sessao/SessaoMaster.tsx), que decide.
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

export class ApiError extends Error {
  /** 429: segundos até poder tentar de novo (Retry-After). */
  retryAfterSegundos?: number;
  constructor(public status: number, public code: string, message: string, public detalhes?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Erros de campo da API (400/422): `[{ field, message }]`. */
export function errosDeCampo(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.detalhes)) return {};
  const saida: Record<string, string> = {};
  for (const d of e.detalhes as { field?: unknown; message?: unknown }[]) {
    if (typeof d.field === 'string' && typeof d.message === 'string' && !saida[d.field]) saida[d.field] = d.message;
  }
  return saida;
}

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
  if (status === 401) return 'Entre na plataforma para continuar.';
  if (status === 403) return 'Seu perfil não tem permissão para esta ação.';
  if (status === 404) return 'Não encontrado.';
  if (status === 429) return 'Muitas tentativas. Aguarde e tente novamente.';
  if (status >= 500) return 'O servidor não respondeu como esperado. Tente novamente em instantes.';
  return 'Requisição recusada.';
}

export function paraApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (!axios.isAxiosError(err)) return new ApiError(0, 'ERRO_DESCONHECIDO', 'Erro inesperado.');
  const r = err.response;
  if (!r) return new ApiError(0, 'FALHA_DE_REDE', 'Não foi possível falar com o servidor. Verifique a conexão e tente novamente.');
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

export type EventoSessao = 'expirada' | 'troca_obrigatoria';

/** Rotas cujo 401 é resposta esperada (credencial errada, boot sem sessão), não "sessão expirada". */
const SEM_AVISO_401 = new Set(['/plataforma/auth/login', '/plataforma/auth/me', '/plataforma/auth/logout']);

export interface ClienteHttp {
  http: AxiosInstance;
  aoEvento(cb: (e: EventoSessao) => void): () => void;
}

export function criarCliente(base: string, opcoes: { adapter?: AxiosRequestConfig['adapter'] } = {}): ClienteHttp {
  const http = axios.create({
    baseURL: base, withCredentials: true, timeout: 150_000, // o provisionamento leva segundos (CREATE DATABASE + migrações)
    headers: { 'Content-Type': 'application/json' },
    ...(opcoes.adapter ? { adapter: opcoes.adapter } : {}),
  });
  const ouvintes = new Set<(e: EventoSessao) => void>();
  http.interceptors.response.use((r) => r, (err: unknown) => {
    const e = paraApiError(err);
    const url = axios.isAxiosError(err) ? err.config?.url ?? '' : '';
    if (e.status === 401 && !SEM_AVISO_401.has(url)) ouvintes.forEach((cb) => cb('expirada'));
    if (e.status === 403 && e.code === 'TROCA_DE_SENHA_OBRIGATORIA') ouvintes.forEach((cb) => cb('troca_obrigatoria'));
    return Promise.reject(e);
  });
  return { http, aoEvento: (cb) => { ouvintes.add(cb); return () => { ouvintes.delete(cb); }; } };
}
