// @vitest-environment jsdom
// Código do condomínio no login (docs/05_arquitetura_saas.md SAAS-05, §6.2): o cabeçalho X-Condominio vai SÓ no
// POST /auth/login (nas outras rotas teria precedência sobre o prefixo do cookie), só com código preenchido, e o
// código fica lembrado como preferência de UI depois de um login com sucesso. A resposta da API para código
// inexistente (igual à de credencial inválida) é testada na API: saas-isolamento.test.ts.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api';
import { createHttpApi } from '../api/http/createHttpApi';
import { ApiError, type Api, type LoginInput, type UsuarioSessao } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';
import { CHAVE_CODIGO_CONDOMINIO, lembrarCodigo, lerCodigoLembrado } from '../auth/preferenciaCondominio';
import { ToastProvider } from '../components/Toast';
import { LoginPage } from '../features/auth/LoginPage';

const USUARIO = { id: 'u-1', nome: 'Roberto Faria', login: 'roberto.faria', papel: 'sindico', ativo: true, ultimoAcesso: null, deveTrocarSenha: false };
const SESSAO = { expiraEm: '2026-10-18T15:00:00.000Z', inatividadeMin: 30 };
const CONDOMINIO = { codigo: 'parque', nome: 'Condomínio de teste' };

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('cliente HTTP: X-Condominio só no login', () => {
  function montar() {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const data = config.url === '/auth/login' || config.url === '/auth/me'
        ? { data: { usuario: USUARIO, condominio: CONDOMINIO, sessao: SESSAO } }
        : config.url === '/auth/trocar-senha' ? { data: { usuario: USUARIO } } : { data: [] };
      return { status: 200, statusText: '', data, headers: {}, config, request: {} };
    });
    return { api: createHttpApi('/api/v1', { adapter }), adapter };
  }
  const cabecalho = (c: InternalAxiosRequestConfig) => c.headers?.get?.('X-Condominio') ?? (c.headers as Record<string, unknown> | undefined)?.['X-Condominio'];

  it('com código: normaliza e manda no login; nenhuma outra chamada leva o cabeçalho', async () => {
    const { api, adapter } = montar();
    const u = await api.auth.login({ login: 'roberto.faria', senha: 'segredo-de-teste', condominio: '  Parque ' });
    expect(u.condominio).toEqual(CONDOMINIO);
    await api.auth.me();
    await api.auth.trocarSenha({ senhaAtual: 'a', novaSenha: 'b' });
    await api.auth.logout();
    const chamadas = adapter.mock.calls.map(([c]) => [c.url, cabecalho(c)]);
    expect(chamadas[0]).toEqual(['/auth/login', 'parque']);
    for (const [url, valor] of chamadas.slice(1)) expect([url, valor]).toEqual([url, undefined]);
    // O código não vai no corpo (o contrato do login continua { login, senha }).
    expect(JSON.parse(adapter.mock.calls[0]![0].data as string)).toEqual({ login: 'roberto.faria', senha: 'segredo-de-teste' });
  });

  it('sem código (vazio, só espaços ou ausente): sem cabeçalho (piloto, na transição)', async () => {
    const { api, adapter } = montar();
    for (const condominio of [undefined, '', '   ']) await api.auth.login({ login: 'x', senha: 'y', condominio } as LoginInput);
    for (const [c] of adapter.mock.calls) expect(cabecalho(c)).toBeUndefined();
  });

  it('condomínio da resposta: só código no formato e nome; trocar-senha não traz condomínio', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const condominio = config.url === '/auth/me' ? { codigo: 'Não É Slug', nome: 'X' } : null;
      const data = config.url === '/auth/trocar-senha' ? { data: { usuario: USUARIO } } : { data: { usuario: USUARIO, condominio, sessao: SESSAO } };
      return { status: 200, statusText: '', data, headers: {}, config, request: {} };
    });
    const api = createHttpApi('/api/v1', { adapter });
    expect((await api.auth.login({ login: 'x', senha: 'y' })).condominio).toBeNull();
    expect((await api.auth.me())!.condominio).toBeNull();
    expect(await api.auth.trocarSenha({ senhaAtual: 'a', novaSenha: 'b' })).not.toHaveProperty('condominio');
  });
});

describe('preferência do código no navegador', () => {
  it('guarda só o código, normalizado e no formato; valor adulterado no storage é ignorado', () => {
    lembrarCodigo(' PARQUE ');
    expect(lerCodigoLembrado()).toBe('parque');
    expect(window.localStorage.length).toBe(1);
    lembrarCodigo('x'); // fora do formato: não substitui
    expect(lerCodigoLembrado()).toBe('parque');
    window.localStorage.setItem(CHAVE_CODIGO_CONDOMINIO, '<script>');
    expect(lerCodigoLembrado()).toBe('');
  });

  it('storage indisponível: lê vazio e não quebra', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    expect(lerCodigoLembrado()).toBe('');
    expect(() => lembrarCodigo('parque')).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('tela de login', () => {
  function montarTela(login: (i: LoginInput) => Promise<UsuarioSessao>) {
    const api = {
      auth: { login: vi.fn(login), me: vi.fn(async () => null), logout: vi.fn(async () => undefined), trocarSenha: vi.fn() },
    } as unknown as Api;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ApiProvider api={api}>
            <AuthProvider>
              <MemoryRouter initialEntries={['/login']}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="*" element={<p>dentro</p>} />
                </Routes>
              </MemoryRouter>
            </AuthProvider>
          </ApiProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    return api.auth.login as unknown as ReturnType<typeof vi.fn>;
  }
  const preencher = (codigo: string | null, login = 'roberto.faria', senha = 'segredo-de-teste') => {
    if (codigo !== null) fireEvent.change(screen.getByLabelText('Código do condomínio'), { target: { value: codigo } });
    fireEvent.change(screen.getByLabelText('Usuário'), { target: { value: login } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  };

  it('campo acessível, sem autocomplete e sem valor fixo; código preenchido vai normalizado e fica lembrado', async () => {
    const login = montarTela(async () => ({ ...USUARIO, papel: 'sindico', condominio: CONDOMINIO }) as UsuarioSessao);
    const campo = await screen.findByLabelText('Código do condomínio');
    expect(campo).toHaveProperty('value', '');
    expect(campo.getAttribute('autocomplete')).toBe('off');
    preencher(' PARQUE ');
    await screen.findByText('dentro');
    expect(login).toHaveBeenCalledWith({ login: 'roberto.faria', senha: 'segredo-de-teste', condominio: 'parque' });
    expect(lerCodigoLembrado()).toBe('parque');
  });

  it('pré-preenche com o código lembrado', async () => {
    lembrarCodigo('parque');
    montarTela(async () => USUARIO as UsuarioSessao);
    expect(await screen.findByLabelText('Código do condomínio')).toHaveProperty('value', 'parque');
  });

  it('vazio entra sem código (piloto) e lembra o código que a API devolveu', async () => {
    const login = montarTela(async () => ({ ...USUARIO, condominio: CONDOMINIO }) as UsuarioSessao);
    await screen.findByLabelText('Código do condomínio');
    preencher(null);
    await screen.findByText('dentro');
    expect(login.mock.calls[0]![0]).toMatchObject({ condominio: '' });
    expect(lerCodigoLembrado()).toBe('parque');
  });

  it('formato inválido: não chama a API e mostra a regra do formato', async () => {
    const login = montarTela(async () => USUARIO as UsuarioSessao);
    await screen.findByLabelText('Código do condomínio');
    preencher('1parque');
    expect(await screen.findByText(/começando por letra/)).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
    expect(lerCodigoLembrado()).toBe('');
  });

  it('credencial inválida (inclui código inexistente): mensagem única e o código NÃO é lembrado', async () => {
    montarTela(async () => { throw new ApiError(401, 'CREDENCIAIS_INVALIDAS', 'Usuário ou senha inválidos.'); });
    await screen.findByLabelText('Código do condomínio');
    await act(async () => preencher('nao-existe'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Usuário ou senha inválidos.'));
    expect(lerCodigoLembrado()).toBe('');
  });
});
