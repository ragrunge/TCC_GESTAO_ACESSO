import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import type { Api } from './types';
import { createMockApi } from './mock/createMockApi';
import { createHttpApi } from './http/createHttpApi';
import { relogio } from '@portaria/domain/time';

export * from './types';

/**
 * Escolhe a implementação por VITE_API_MODE (mock | http). Padrão: mock.
 * Base padrão relativa '/api/v1' (mesma origem): proxy do Vite em dev, rewrite da Vercel em produção. Base
 * absoluta em outra origem quebraria o cookie SameSite=Strict e exigiria CORS: evitar.
 */
export function criarApi(): Api {
  const modo = import.meta.env.VITE_API_MODE ?? 'mock';
  if (modo === 'http') {
    // Contra a API real o relógio da tela é o de verdade: o relógio simulado do mock (09/10/2026) faria a tela recusar
    // um retroativo de ontem, calcular permanência negativa e filtrar o histórico fora do dia dos eventos gravados.
    relogio.definir(Date.now());
    return createHttpApi(import.meta.env.VITE_API_URL || '/api/v1');
  }
  return createMockApi();
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
