import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import type { Api } from './types';
import { createHttpApi } from './http/createHttpApi';

export * from './types';

/**
 * Cliente da API real. Base padrão relativa '/api/v1' (mesma origem): proxy do Vite em dev, rewrite da Vercel em
 * produção. Base absoluta em outra origem quebraria o cookie SameSite=Strict e exigiria CORS: evitar.
 */
export function criarApi(): Api {
  return createHttpApi(import.meta.env.VITE_API_URL || '/api/v1');
}

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({ api, children }: { api?: Api; children: ReactNode }) {
  const valor = useMemo(() => api ?? criarApi(), [api]);
  return createElement(ApiContext.Provider, { value: valor }, children);
}

export function useApi(): Api {
  const a = useContext(ApiContext);
  if (!a) throw new Error('useApi fora de <ApiProvider>');
  return a;
}
