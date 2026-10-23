import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, criarCliente, errosDeCampo, segundosRetryAfter } from '../api/cliente';
import { criarApi } from '../api/plataforma';

/** Adapter que responde com o status e o corpo dados (a mesma forma do envelope da API). */
const responder = (status: number, data: unknown, headers: Record<string, string> = {}): AxiosAdapter => async (config: InternalAxiosRequestConfig) => {
  const r = { status, statusText: '', data, headers, config };
  if (status >= 400) throw Object.assign(new Error('http'), { isAxiosError: true, response: r, config });
  return r;
};

describe('cliente HTTP', () => {
  it('erro da API vira ApiError com código, mensagem e detalhes; 429 usa Retry-After', async () => {
    const c = criarCliente('/api/v1', { adapter: responder(429, { code: 'LOGIN_BLOQUEADO', message: 'x' }, { 'retry-after': '120' }) });
    const e = await c.http.post('/plataforma/auth/login', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 429, code: 'LOGIN_BLOQUEADO', retryAfterSegundos: 120, message: 'Muitas tentativas. Tente novamente em 2 minutos.' });
    expect(segundosRetryAfter('abc')).toBeUndefined();
    const v = new ApiError(400, 'DADOS_INVALIDOS', 'Dados inválidos.', [{ field: 'codigo', message: 'ruim' }]);
    expect(errosDeCampo(v)).toEqual({ codigo: 'ruim' });
  });

  it('401 de rota autenticada avisa "expirada"; 401 do login não; 403 de troca avisa "troca_obrigatoria"', async () => {
    const eventos: string[] = [];
    const c401 = criarCliente('/api/v1', { adapter: responder(401, { code: 'SESSAO_INVALIDA', message: 'x' }) });
    c401.aoEvento((e) => eventos.push(e));
    await c401.http.post('/plataforma/auth/login').catch(() => undefined);
    expect(eventos).toEqual([]);
    await c401.http.get('/plataforma/condominios').catch(() => undefined);
    expect(eventos).toEqual(['expirada']);
    const c403 = criarCliente('/api/v1', { adapter: responder(403, { code: 'TROCA_DE_SENHA_OBRIGATORIA', message: 'x' }) });
    c403.aoEvento((e) => eventos.push(e));
    await c403.http.get('/plataforma/condominios').catch(() => undefined);
    expect(eventos).toEqual(['expirada', 'troca_obrigatoria']);
  });

  it('a API desembrulha { data } e manda o corpo do contrato', async () => {
    const adapter = vi.fn(responder(200, { data: { usuario: { id: '1' }, sessao: {} } }));
    const api = criarApi(criarCliente('/api/v1', { adapter }));
    const r = await api.login('m@exemplo.test', 'senha', '123456');
    expect(r.usuario.id).toBe('1');
    const cfg = adapter.mock.calls[0]![0];
    expect([cfg.method, cfg.url, JSON.parse(cfg.data as string)]).toEqual(['post', '/plataforma/auth/login', { email: 'm@exemplo.test', senha: 'senha', codigo: '123456' }]);
    expect(cfg.withCredentials).toBe(true);
  });
});
