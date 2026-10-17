import { createMockApi } from '../api/mock/createMockApi';
import type { Api } from '../api/types';
import { ApiError } from '../api/types';
import { INICIO_SIMULADO, relogio } from '@portaria/domain/time';

export type Perfil = 'joao.lima' | 'sergio.matos' | 'paula.nogueira' | 'roberto.faria' | 'luiza.campos';

/** API de teste: sem latência, sem localStorage, relógio congelado em 09/10/2026 14:32. */
export function novaApi(opts: { ferramentasDev?: boolean } = {}): Api {
  relogio.congelar(INICIO_SIMULADO);
  return createMockApi({ latencia: 0, persistir: false, ferramentasDev: opts.ferramentasDev ?? false });
}

export async function entrarComo(api: Api, login: Perfil) {
  await api.auth.login({ login, senha: 'qualquer' });
}

/** Espera uma rejeição com ApiError e devolve o erro para asserções. */
export async function esperaErro(p: Promise<unknown>): Promise<ApiError> {
  try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; }
  throw new Error('esperava ApiError, mas a chamada teve sucesso');
}

export const id = {
  marcos: 'pe-marcos-pereira', bruno: 'pe-bruno-teixeira', enel: 'pe-tecnico-enel-diego-santos', marcia: 'pe-marcia-pereira',
  ana: 'pe-ana-ribeiro', lucia: 'pe-lucia-ribeiro', carla: 'pe-carla-mendes', rodrigo: 'pe-rodrigo-alves', valter: 'pe-valter-souza',
  lumen: 'pe-dedetizadora-lumen-ivo-paes', patricia: 'pe-patricia-ramos',
};
