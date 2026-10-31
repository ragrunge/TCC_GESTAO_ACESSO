// React Query (v5). Por enquanto só login, sessão e usuários usam; as demais telas seguem com useAsync.
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/types';

/**
 * Repetir só falha transitória (rede, 5xx). 4xx é resposta definitiva: 401 (sessão), 403 (permissão ou troca de
 * senha), 429 (bloqueio: repetir só alongaria o bloqueio) e 501 (módulo sem API) nunca são repetidos.
 */
export function deveRepetir(falhas: number, erro: unknown): boolean {
  if (erro instanceof ApiError && erro.status !== 0 && (erro.status < 500 || erro.status === 501)) return false;
  return falhas < 1;
}

export const criarQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: deveRepetir, staleTime: 30_000, gcTime: 5 * 60_000 },
    mutations: { retry: false },
  },
});
