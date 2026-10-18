import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/types';

export const mensagemErro = (e: unknown): string =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Erro inesperado.';

/** Carrega dados assíncronos e permite recarregar. Ignora respostas de chamadas antigas. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const contador = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const recarregar = useCallback(async () => {
    const meu = ++contador.current;
    setLoading(true);
    try {
      const r = await fnRef.current();
      if (meu === contador.current) { setData(r); setError(null); }
    } catch (e) {
      if (meu === contador.current) setError(mensagemErro(e));
    } finally {
      if (meu === contador.current) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void recarregar(); }, deps);
  return { data, error, loading, recarregar };
}

/** Hora simulada atual, atualizada a cada segundo. */
import { agora } from '@portaria/domain/time';
export function useAgora(intervaloMs = 1000): number {
  const [t, setT] = useState(agora());
  useEffect(() => {
    const id = setInterval(() => setT(agora()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return t;
}
