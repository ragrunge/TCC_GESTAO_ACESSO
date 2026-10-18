// Adaptador HTTP (axios) com o transporte mockado: um `adapter` de teste no lugar da rede. Cobre o desembrulho dos
// formatos da API, a conversão de erro em ApiError, o aviso único de sessão expirada e o 429 com Retry-After.
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { createHttpApi, MENSAGEM_MODULO_INDISPONIVEL } from '../api/http/createHttpApi';
import { segundosRetryAfter } from '../api/http/cliente';
import { ApiError, type EventoSessao } from '../api/types';
import { deveRepetir } from '../app/queryClient';
import { esperaErro } from './helpers';

interface Resposta { status: number; data?: unknown; headers?: Record<string, string> }
type Rota = (c: InternalAxiosRequestConfig) => Resposta | Promise<Resposta>;

function transporte(rota: Rota) {
  return vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const r = await rota(config);
    const resp: AxiosResponse = { status: r.status, statusText: '', data: r.data ?? '', headers: r.headers ?? {}, config, request: {} };
    if (r.status >= 200 && r.status < 300) return resp;
    throw new AxiosError(`HTTP ${r.status}`, AxiosError.ERR_BAD_RESPONSE, config, {}, resp);
  });
}

const USUARIO = { id: 'u-1', nome: 'Roberto Faria', login: 'roberto.faria', papel: 'sindico', ativo: true, ultimoAcesso: null, deveTrocarSenha: false };
const SESSAO = { expiraEm: '2026-10-18T15:00:00.000Z', inatividadeMin: 30 };
const erro401 = { status: 401, data: { code: 'SESSAO_INVALIDA', message: 'Sua sessão expirou. Entre novamente.' } };

function montar(rota: Rota) {
  const adapter = transporte(rota);
  const api = createHttpApi('/api/v1', { adapter });
  const eventos: EventoSessao[] = [];
  api.aoEventoSessao!((e) => eventos.push(e));
  return { api, adapter, eventos };
}

describe('adaptador HTTP (axios)', () => {
  it('login: POST /auth/login com cookie (withCredentials), desembrulha { usuario, sessao }', async () => {
    const { api, adapter } = montar(() => ({ status: 200, data: { data: { usuario: { ...USUARIO, deveTrocarSenha: true }, sessao: SESSAO } } }));
    const u = await api.auth.login({ login: 'roberto.faria', senha: 'segredo-de-teste' });
    expect(u).toMatchObject({ id: 'u-1', papel: 'sindico', deveTrocarSenha: true });
    expect(u).not.toHaveProperty('sessao');
    const cfg = adapter.mock.calls[0]![0];
    expect(cfg.baseURL).toBe('/api/v1');
    expect(cfg.url).toBe('/auth/login');
    expect(cfg.method).toBe('post');
    expect(cfg.withCredentials).toBe(true);
    expect(JSON.parse(cfg.data as string)).toEqual({ login: 'roberto.faria', senha: 'segredo-de-teste' });
  });

  it('erro da API vira ApiError com status, código, mensagem e detalhes', async () => {
    const { api } = montar(() => ({
      status: 422, data: { code: 'SENHA_FRACA', message: 'A senha precisa ter pelo menos 12 caracteres.', details: [{ field: 'novaSenha', message: 'A senha precisa ter pelo menos 12 caracteres.' }] },
    }));
    const e = await esperaErro(api.auth.trocarSenha({ senhaAtual: 'a', novaSenha: 'curta' }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 422, code: 'SENHA_FRACA', message: 'A senha precisa ter pelo menos 12 caracteres.' });
    expect(e.detalhes).toEqual([{ field: 'novaSenha', message: 'A senha precisa ter pelo menos 12 caracteres.' }]);
  });

  it('401 do login é credencial inválida: mensagem única e nenhum aviso de sessão', async () => {
    const { api, eventos } = montar(() => ({ status: 401, data: { code: 'CREDENCIAIS_INVALIDAS', message: 'Usuário ou senha inválidos.' } }));
    const e = await esperaErro(api.auth.login({ login: 'x', senha: 'y' }));
    expect(e).toMatchObject({ status: 401, code: 'CREDENCIAIS_INVALIDAS', message: 'Usuário ou senha inválidos.' });
    expect(eventos).toEqual([]);
  });

  it('vários 401 simultâneos fora do login disparam "expirada" uma vez só; rearma depois de novo login', async () => {
    let logado = false;
    const { api, eventos } = montar((c) => (c.url === '/auth/login' && (logado = true) ? { status: 200, data: { data: { usuario: USUARIO, sessao: SESSAO } } } : erro401));
    const rs = await Promise.allSettled([api.usuarios.listar(), api.usuarios.listar(), api.usuarios.desativar('u-2'), api.auth.trocarSenha({ senhaAtual: 'a', novaSenha: 'b' })]);
    expect(rs.every((r) => r.status === 'rejected' && (r.reason as ApiError).status === 401)).toBe(true);
    expect(eventos).toEqual(['expirada']);
    await api.auth.login({ login: 'roberto.faria', senha: 'x' });
    expect(logado).toBe(true);
    await esperaErro(api.usuarios.listar());
    expect(eventos).toEqual(['expirada', 'expirada']);
  });

  it('me: 401 no boot devolve null sem aviso; sucesso desembrulha { usuario, sessao }', async () => {
    const semSessao = montar(() => erro401);
    expect(await semSessao.api.auth.me()).toBeNull();
    expect(semSessao.eventos).toEqual([]);
    const comSessao = montar(() => ({ status: 200, data: { data: { usuario: USUARIO, sessao: SESSAO } } }));
    expect(await comSessao.api.auth.me()).toMatchObject({ login: 'roberto.faria', deveTrocarSenha: false });
  });

  it('logout: 401 de requisições em voo não vira "sessão expirada", e logout sem sessão não é erro', async () => {
    const { api, eventos } = montar(() => erro401);
    await api.auth.logout();
    await esperaErro(api.usuarios.listar());
    expect(eventos).toEqual([]);
  });

  it('403 TROCA_DE_SENHA_OBRIGATORIA emite "troca_obrigatoria" (uma vez) e chega ao chamador como ApiError', async () => {
    const { api, eventos } = montar(() => ({ status: 403, data: { code: 'TROCA_DE_SENHA_OBRIGATORIA', message: 'Troque a senha provisória antes de continuar.' } }));
    const [a] = await Promise.allSettled([api.usuarios.listar(), api.usuarios.listar()]);
    expect((a as PromiseRejectedResult).reason).toMatchObject({ status: 403, code: 'TROCA_DE_SENHA_OBRIGATORIA' });
    expect(eventos).toEqual(['troca_obrigatoria']);
  });

  it('403 de permissão comum não desloga nem pede troca: só a mensagem', async () => {
    const { api, eventos } = montar(() => ({ status: 403, data: { code: 'SEM_PERMISSAO', message: 'Seu perfil não tem permissão para esta ação.' } }));
    expect(await esperaErro(api.usuarios.listar())).toMatchObject({ status: 403, code: 'SEM_PERMISSAO' });
    expect(eventos).toEqual([]);
  });

  it('429 traz o tempo do Retry-After na mensagem e em retryAfterSegundos', async () => {
    const { api, eventos } = montar(() => ({
      status: 429, headers: { 'retry-after': '900' },
      data: { code: 'LOGIN_BLOQUEADO', message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' },
    }));
    const e = await esperaErro(api.auth.login({ login: 'joao.lima', senha: 'errada' }));
    expect(e).toMatchObject({ status: 429, code: 'LOGIN_BLOQUEADO', retryAfterSegundos: 900 });
    expect(e.message).toBe('Muitas tentativas. Tente novamente em 15 minutos.');
    expect(eventos).toEqual([]);
  });

  it('429 sem Retry-After mantém a mensagem da API', async () => {
    const { api } = montar(() => ({ status: 429, data: { code: 'LOGIN_BLOQUEADO', message: 'Muitas tentativas. Aguarde e tente novamente.' } }));
    const e = await esperaErro(api.auth.trocarSenha({ senhaAtual: 'a', novaSenha: 'b' }));
    expect(e.message).toBe('Muitas tentativas. Aguarde e tente novamente.');
    expect(e.retryAfterSegundos).toBeUndefined();
  });

  it('Retry-After aceita segundos e data HTTP', () => {
    expect(segundosRetryAfter('42')).toBe(42);
    expect(segundosRetryAfter(new Date(1_000_000 + 90_000).toUTCString(), 1_000_000)).toBe(90);
    expect(segundosRetryAfter('lixo')).toBeUndefined();
    expect(segundosRetryAfter(undefined)).toBeUndefined();
  });

  it('falha de rede e corpo fora do formato viram ApiError legível', async () => {
    const rede = montar(() => { throw new AxiosError('Network Error', AxiosError.ERR_NETWORK); });
    expect(await esperaErro(rede.api.usuarios.listar())).toMatchObject({ status: 0, code: 'FALHA_DE_REDE' });
    const proxy = montar(() => ({ status: 502, data: '<html>Bad Gateway</html>' }));
    expect(await esperaErro(proxy.api.usuarios.listar())).toMatchObject({ status: 502, code: 'HTTP_502' });
  });

  it('usuários: criar e redefinir devolvem { usuario, senhaTemporaria }; papel vai por PATCH', async () => {
    const { api, adapter } = montar((c) => {
      if (c.url === '/usuarios' && c.method === 'post') return { status: 201, data: { data: { usuario: { ...USUARIO, id: 'u-9', login: 'novo.porteiro' }, senhaTemporaria: 'Tmp-ABCD-2345' } } };
      if (c.url === '/usuarios/u-9/redefinir-senha') return { status: 200, data: { data: { usuario: { ...USUARIO, id: 'u-9' }, senhaTemporaria: 'Tmp-WXYZ-6789' } } };
      if (c.url === '/usuarios/u-9' && c.method === 'patch') return { status: 200, data: { data: { ...USUARIO, id: 'u-9', papel: 'auditor' } } };
      return { status: 404, data: { code: 'NAO_ENCONTRADO', message: 'Recurso não encontrado.' } };
    });
    expect(await api.usuarios.criar({ nome: 'Novo Porteiro', login: 'novo.porteiro', papel: 'porteiro' }))
      .toMatchObject({ usuario: { id: 'u-9' }, senhaTemporaria: 'Tmp-ABCD-2345' });
    expect((await api.usuarios.redefinirAcesso('u-9')).senhaTemporaria).toBe('Tmp-WXYZ-6789');
    expect((await api.usuarios.alterarPapel('u-9', 'auditor')).papel).toBe('auditor');
    expect(JSON.parse(adapter.mock.calls[2]![0].data as string)).toEqual({ papel: 'auditor' });
  });

  it('listar percorre as páginas por cursor (envelope { data, pagination }) e devolve a lista inteira', async () => {
    const { api, adapter } = montar((c) => {
      const cursor = (c.params as { cursor?: string } | undefined)?.cursor;
      if (!cursor) return { status: 200, data: { data: [{ ...USUARIO, id: 'a' }, { ...USUARIO, id: 'b' }], pagination: { cursor: 'c1', hasNextPage: true } } };
      return { status: 200, data: { data: [{ ...USUARIO, id: 'c' }], pagination: { cursor: null, hasNextPage: false } } };
    });
    expect((await api.usuarios.listar()).map((u) => u.id)).toEqual(['a', 'b', 'c']);
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(adapter.mock.calls[0]![0].params).toEqual({ limite: 100 });
    expect(adapter.mock.calls[1]![0].params).toEqual({ limite: 100, cursor: 'c1' });
  });

  it('2xx fora do envelope { data } é RESPOSTA_INVALIDA, não dado silenciosamente errado', async () => {
    const { api } = montar(() => ({ status: 200, data: { usuario: USUARIO, sessao: SESSAO } }));
    expect(await esperaErro(api.auth.login({ login: 'x', senha: 'y' }))).toMatchObject({ code: 'RESPOSTA_INVALIDA' });
    const lista = montar(() => ({ status: 200, data: [USUARIO] }));
    expect(await esperaErro(lista.api.usuarios.listar())).toMatchObject({ code: 'RESPOSTA_INVALIDA' });
  });

  it('módulo sem API real: 501 local com mensagem amigável, sem ir à rede', async () => {
    const { api, adapter } = montar(() => ({ status: 200 }));
    const e = await esperaErro(api.eventos.listar());
    expect(e).toMatchObject({ status: 501, code: 'MODULO_INDISPONIVEL', message: MENSAGEM_MODULO_INDISPONIVEL });
    expect(adapter).not.toHaveBeenCalled();
    expect(api.modo).toBe('http');
    expect(api.rotasDisponiveis).toEqual(['usuarios', 'unidades']);
    expect(api.suporta!('unidades.criar')).toBe(true);
    expect(api.suporta!('veiculos.criar')).toBe(false);
    expect(await esperaErro(api.vinculos.listar())).toMatchObject({ status: 501 });
  });
});

describe('adaptador HTTP: catálogo, unidades, busca e contagem', () => {
  const UN = { id: 'u-432', torre: 4, numero: '32', ativo: true };
  const corpo = (c: InternalAxiosRequestConfig) => (c.data ? JSON.parse(c.data as string) : undefined);

  it('catálogo: GET /catalogo, unidades só com os campos da interface', async () => {
    const { api, adapter } = montar(() => ({ status: 200, data: { data: {
      unidades: [{ ...UN, codigo: 'T4-32', rotulo: 'Torre 4 · AP 32' }], areasComuns: [{ id: 'a1', nome: 'Piscina', ativo: true }], pontosAcesso: [],
    } } }));
    expect(await api.catalogo.obter()).toEqual({ unidades: [UN], areasComuns: [{ id: 'a1', nome: 'Piscina', ativo: true }] });
    expect(adapter.mock.calls[0]![0]).toMatchObject({ url: '/catalogo', method: 'get' });
  });

  it('listarPagina: torre, limite e cursor na query; pagination vira { itens, cursor, temMais }', async () => {
    const resumo = { unidade: UN, moradoresValidos: 3, pendentes: 0, restricoes: 0, cadastroCompleto: true };
    const { api, adapter } = montar(() => ({ status: 200, data: { data: [resumo], pagination: { cursor: 'c2', hasNextPage: true } } }));
    expect(await api.unidades.listarPagina({ torre: 4, cursor: 'c1', limite: 20 })).toEqual({ itens: [resumo], cursor: 'c2', temMais: true });
    expect(adapter.mock.calls[0]![0]).toMatchObject({ url: '/unidades', params: { torre: 4, cursor: 'c1', limite: 20 } });
    await api.unidades.listarPagina();
    expect(adapter.mock.calls[1]![0].params).toEqual({ limite: 50 });
    const ruim = montar(() => ({ status: 200, data: { data: [resumo] } }));
    expect(await esperaErro(ruim.api.unidades.listarPagina())).toMatchObject({ code: 'RESPOSTA_INVALIDA' });
  });

  it('detalhe: código legível na URL codificado; seções sem módulo na API chegam como null', async () => {
    const { api, adapter } = montar(() => ({ status: 200, data: { data: { unidade: UN, veiculos: [{ id: 'v1', unidadeId: 'u-432', placa: 'FKR2C41', modelo: 'Honda Fit', cor: 'prata' }] } } }));
    const d = await api.unidades.detalhe('T4-32');
    expect(adapter.mock.calls[0]![0].url).toBe('/unidades/T4-32');
    expect(d).toMatchObject({ unidade: UN, vinculos: null, autorizacoes: null, restricoes: null, eventos: null });
    expect(d.veiculos).toHaveLength(1);
  });

  it('CRUD de unidade: POST, PATCH e verbos de transição; erro de regra chega com o código da API', async () => {
    const { api, adapter } = montar((c) => {
      if (c.method === 'post' && c.url === '/unidades' && corpo(c).numero === '32') return { status: 409, data: { code: 'UNIDADE_DUPLICADA', message: 'Já existe a unidade T4-32 (ativa ou desativada).' } };
      if (c.method === 'patch') return { status: 422, data: { code: 'UNIDADE_REFERENCIADA', message: 'A T4-32 já tem registros.' } };
      return { status: c.method === 'post' && c.url === '/unidades' ? 201 : 200, data: { data: { ...UN, ativo: !c.url?.endsWith('/desativar') } } };
    });
    expect(await api.unidades.criar({ torre: 10, numero: '101' })).toEqual({ ...UN, ativo: true });
    expect(corpo(adapter.mock.calls[0]![0])).toEqual({ torre: 10, numero: '101' });
    expect((await esperaErro(api.unidades.criar({ torre: 4, numero: '32' }))).code).toBe('UNIDADE_DUPLICADA');
    expect((await esperaErro(api.unidades.editar({ id: 'u-432', torre: 4, numero: '99' })))).toMatchObject({ status: 422, code: 'UNIDADE_REFERENCIADA' });
    expect((await api.unidades.desativar('u-432')).ativo).toBe(false);
    expect((await api.unidades.reativar('u-432')).ativo).toBe(true);
    expect(adapter.mock.calls.map((c) => `${c[0].method} ${c[0].url}`)).toEqual([
      'post /unidades', 'post /unidades', 'patch /unidades/u-432', 'post /unidades/u-432/desativar', 'post /unidades/u-432/reativar',
    ]);
  });

  it('busca: POST com o termo no CORPO (CPF fora da URL); pessoas.buscar repassa limite e semMoradores', async () => {
    const pessoa = { id: 'p1', nome: 'Ana Ribeiro', documentoTipo: 'cpf', documentoMascarado: '***.982.247-**', categoria: 'morador', ultimoAcesso: 'Sem acessos', unidadesVinculadas: [], unidadesVinculadasCodigos: [] };
    const { api, adapter } = montar((c) => (c.url === '/busca'
      ? { status: 200, data: { data: { pessoas: [pessoa], unidades: [{ id: 'u-432', motivo: 'Unidade' }], temMaisPessoas: false } } }
      : { status: 200, data: { data: { pessoas: [pessoa], temMais: true } } }));
    const g = await api.busca.global('529.982.247-25');
    expect(g.pessoas[0]!.nome).toBe('Ana Ribeiro');
    expect(g.unidades).toEqual([{ id: 'u-432', motivo: 'Unidade' }]);
    expect(await api.pessoas.buscar('52998224725', { limite: 9, semMoradores: true })).toEqual([pessoa]);
    for (const [c] of adapter.mock.calls) {
      expect(c.method).toBe('post');
      expect(`${c.url}?${new URLSearchParams(c.params ?? {}).toString()}`).not.toMatch(/529|982|247/);
    }
    expect(corpo(adapter.mock.calls[0]![0])).toEqual({ q: '529.982.247-25' });
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({ q: '52998224725', limite: 9, semMoradores: true });
  });

  it('contagem de vínculos: GET /vinculos/contagem?status=pendente devolve o número', async () => {
    const { api, adapter } = montar(() => ({ status: 200, data: { data: { status: 'pendente', total: 3 } } }));
    expect(await api.vinculos.contar('pendente')).toBe(3);
    expect(adapter.mock.calls[0]![0]).toMatchObject({ url: '/vinculos/contagem', params: { status: 'pendente' } });
  });
});

describe('mock: paginação de unidades e contagem (mesmo contrato da API)', () => {
  it('listarPagina percorre as 165 sem repetir; torre filtra; cursor inválido é 400', async () => {
    const { novaApi, entrarComo } = await import('./helpers');
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const vistos: string[] = [];
    let cursor: string | null = null;
    do {
      const p = await api.unidades.listarPagina({ limite: 40, cursor });
      vistos.push(...p.itens.map((x) => x.unidade.id));
      cursor = p.cursor;
      expect(p.temMais).toBe(cursor !== null);
    } while (cursor);
    expect(new Set(vistos).size).toBe(165);
    const t4 = await api.unidades.listarPagina({ torre: 4 });
    expect(t4.itens).toHaveLength(20);
    expect(t4.temMais).toBe(false);
    expect((await esperaErro(api.unidades.listarPagina({ cursor: '%%' }))).code).toBe('CURSOR_INVALIDO');
    expect(await api.vinculos.contar('pendente')).toBe((await api.vinculos.listar({ status: 'pendente' })).length);
  });
});

describe('React Query: retry', () => {
  it('não repete 401, 403, 429 nem 501; repete uma vez falha de rede e 5xx', () => {
    for (const s of [400, 401, 403, 404, 422, 429, 501]) expect(deveRepetir(0, new ApiError(s, 'X', 'x'))).toBe(false);
    expect(deveRepetir(0, new ApiError(0, 'FALHA_DE_REDE', 'x'))).toBe(true);
    expect(deveRepetir(0, new ApiError(503, 'X', 'x'))).toBe(true);
    expect(deveRepetir(1, new ApiError(503, 'X', 'x'))).toBe(false);
  });
});

describe('mock cumpre a mesma interface', () => {
  it('login/me trazem deveTrocarSenha=false; criar e redefinir devolvem senha temporária; trocarSenha aplica a política mínima', async () => {
    const { novaApi, entrarComo } = await import('./helpers');
    const api = novaApi();
    expect(api.modo).toBe('mock');
    await entrarComo(api, 'roberto.faria');
    expect((await api.auth.me())?.deveTrocarSenha).toBe(false);
    const r = await api.usuarios.criar({ nome: 'Teste Temp', login: 'teste.temp', papel: 'porteiro' });
    expect(r.usuario.login).toBe('teste.temp');
    expect(r.senhaTemporaria).toMatch(/^[A-Za-z2-9]{16}$/);
    expect((await api.usuarios.redefinirAcesso(r.usuario.id)).senhaTemporaria).toHaveLength(16);
    expect((await esperaErro(api.auth.trocarSenha({ senhaAtual: 'x', novaSenha: 'curta' }))).code).toBe('SENHA_FRACA');
    expect((await api.auth.trocarSenha({ senhaAtual: 'x', novaSenha: 'uma-senha-bem-longa' })).deveTrocarSenha).toBe(false);
  });
});
