// Adaptador HTTP (axios) com o transporte mockado: um `adapter` de teste no lugar da rede. Cobre o desembrulho dos
// formatos da API, a conversão de erro em ApiError, o aviso único de sessão expirada e o 429 com Retry-After.
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { createHttpApi, diaParaMs, msParaDia, nomeDoAnexo } from '../api/http/createHttpApi';
import { brt } from '@portaria/domain/time';
import { segundosRetryAfter } from '../api/http/cliente';
import { ApiError, type EventoSessao } from '../api/types';
import { deveRepetir } from '../app/queryClient';
import { entrarComo, esperaErro, id, novaApi as novaApiMock, un } from './helpers';

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
/** EventoView como a API devolve (instantes em epoch ms). */
const EV = {
  id: 'ev1', seq: 7, formatoHash: 1, tipo: 'entrada', categoriaPessoa: 'visitante', pessoaId: 'p1', unidadeDestinoId: 'u-432', areaComumId: null,
  pontoAcessoId: 'pa1', autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: 'p2', autorizacaoPreviaId: null, justificativa: null, restricaoId: null,
  operadorId: 'u-1', operadorPapel: 'porteiro', ocorridoEm: 1_760_000_000_000, registradoEm: 1_760_000_000_000, retroativo: false,
  refereEventoId: null, corrigeEventoId: null, observacao: null, formularioContingencia: null, correcaoValores: null, empresa: null, servico: null,
  hashAnterior: 'a'.repeat(64), hash: 'b'.repeat(64), codigo: 'EV-000007', pessoaNome: 'Marcos', operadorNome: 'João', unidadeRotulo: 'T4-32',
  areaComumNome: null, pontoAcessoNome: 'Portaria social', autorizadoPorNome: 'Ana', saida: null, dentro: true, entradaCodigo: null,
  valoresOriginais: null, correcao: null, valoresCorrigidos: null, pessoaNomeOriginal: null, pessoaNomeCorrigida: null,
  autorizadoPorNomeOriginal: null, autorizadoPorNomeCorrigido: null, autorizacaoSemSolicitante: false,
};

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

  it('rotas e operações disponíveis: todas as do backend, incluindo LGPD e selo; operação desconhecida não', async () => {
    const { api, adapter } = montar(() => ({ status: 200 }));
    expect(adapter).not.toHaveBeenCalled();
    expect(api.modo).toBe('http');
    expect(api.rotasDisponiveis).toEqual(['painel', 'entrada', 'pessoas', 'historico', 'relatorios', 'usuarios', 'unidades', 'cadastro', 'vinculos', 'funcionarios', 'importar', 'encomendas', 'ocorrencias']);
    for (const op of ['unidades.criar', 'veiculos.criar', 'autorizacoes.criar', 'restricoes.aprovar', 'eventos.criar', 'auditoria.exportar', 'relatorios.exportarCsv',
      'encomendas.listarPagina', 'encomendas.entregar', 'encomendas.autorizarRetirada', 'ocorrencias.criar', 'ocorrencias.anexar', 'ocorrencias.baixarAnexo',
      'lgpd.exportarPessoa', 'lgpd.anonimizar', 'lgpd.aplicarRetencao', 'lgpd.ultimaRetencao', 'auditoria.selos', 'auditoria.selar', 'auditoria.conferirAncora']) {
      expect(api.suporta!(op), op).toBe(true);
    }
    expect(api.suporta!('modulo.inexistente')).toBe(false);
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

  it('detalhe: código legível na URL codificado; autorizações, restrições e acessos vêm dos módulos, pelo uuid', async () => {
    const { api, adapter } = montar((c) => (c.url === '/unidades/T4-32'
      ? { status: 200, data: { data: { unidade: UN, veiculos: [{ id: 'v1', unidadeId: 'u-432', placa: 'FKR2C41', modelo: 'Honda Fit', cor: 'prata' }] } } }
      : c.url === '/eventos-acesso' ? { status: 200, data: { data: [EV], pagination: { cursor: null, hasNextPage: false } } }
        : { status: 200, data: { data: [] } }));
    const d = await api.unidades.detalhe('T4-32');
    expect(adapter.mock.calls[0]![0].url).toBe('/unidades/T4-32');
    expect(d).toMatchObject({ unidade: UN, vinculos: null, autorizacoes: [], restricoes: [], eventos: [{ id: 'ev1' }] });
    expect(d.veiculos).toEqual([{ id: 'v1', unidadeId: 'u-432', placa: 'FKR-2C41', modelo: 'Honda Fit', cor: 'prata' }]);
    const urls = adapter.mock.calls.slice(1).map((c) => [c[0].url, c[0].params]);
    expect(urls).toEqual(expect.arrayContaining([
      ['/autorizacoes-previas', { unidadeId: 'u-432' }], ['/restricoes', { unidadeId: 'u-432' }],
      ['/eventos-acesso', { unidadeId: 'u-432', excluirTipos: 'correcao', limite: 12 }],
    ]));
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

describe('adaptador HTTP: pessoas, funcionários, veículos, vínculos e importação', () => {
  const corpo = (c: InternalAxiosRequestConfig) => (c.data ? JSON.parse(c.data as string) : undefined);
  const PESSOA = {
    id: 'p1', nome: 'Ana Ribeiro', documentoTipo: 'cpf', categoria: 'morador', semCpf: false, documentoMascarado: '***.982.247-**',
    telefoneMascarado: '(**) *****-0001', anonimizadaEm: null, criadoEm: 1,
  };
  const VINCULO = {
    id: 'v1', pessoaId: 'p1', unidadeId: 'u-432', tipo: 'inquilino', status: 'pendente',
    vigenciaInicio: '2026-10-01', vigenciaFim: '2027-07-31', prazoRegularizacao: null,
    conferencia: { tipoDocumento: 'contrato_locacao', data: '2026-10-17', conferidoPorId: 'u-2' },
    solicitadoPor: 'Paula Nogueira', solicitadoEm: 10, registradoPorId: 'u-2', encerradoEm: null,
    pessoaNome: 'Ana Ribeiro', pessoaDocumento: '***.982.247-**', pessoaCadastroCompleto: true, unidadeCodigo: 'T4-32',
    decididoPorNome: null, registradoPorNome: 'Paula Nogueira', conferidoPorNome: 'Paula Nogueira', legadoVencido: false,
  };
  const ESCALA = { diasSemana: [1, 2, 3, 4, 5], horaInicio: '22:00', horaFim: '06:00' };
  const FUNC = { pessoaId: 'p9', funcao: 'Vigia', escala: ESCALA, ativo: true, pessoa: { ...PESSOA, id: 'p9', categoria: 'funcionario' }, emEscalaAgora: true };

  it('datas de calendário: "YYYY-MM-DD" <-> início do dia BRT (ida e volta)', () => {
    expect(diaParaMs('2026-10-17')).toBe(brt(2026, 10, 17));
    expect(msParaDia(brt(2026, 10, 17))).toBe('2026-10-17');
    expect(msParaDia(null)).toBeNull();
    expect(diaParaMs(null)).toBeNull();
    expect(() => diaParaMs('17/10/2026')).toThrow();
  });

  it('pessoas.criar: POST /pessoas só com os campos preenchidos; sem CPF não manda documento', async () => {
    const { api, adapter } = montar(() => ({ status: 201, data: { data: PESSOA } }));
    const p = await api.pessoas.criar({ nome: 'Ana', documento: '529.982.247-25', telefone: '(11) 98765-0001', categoria: 'visitante', empresa: ' ' });
    expect(p).toMatchObject({ id: 'p1', telefoneMascarado: '(**) *****-0001' });
    expect(corpo(adapter.mock.calls[0]![0])).toEqual({ nome: 'Ana', documento: '529.982.247-25', telefone: '(11) 98765-0001', categoria: 'visitante' });
    await api.pessoas.criar({ nome: 'Cláudia', documento: '123', telefone: '11987650016', categoria: 'prestador', empresa: 'Autônoma', semCpf: true });
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({ nome: 'Cláudia', telefone: '11987650016', categoria: 'prestador', empresa: 'Autônoma', semCpf: true });
  });

  it('pessoas.editar: PATCH /pessoas/:id sem o id e sem chaves indefinidas; 409 vira ApiError', async () => {
    const { api, adapter } = montar((c) => (corpo(c).documento ? { status: 409, data: { code: 'PESSOA_DUPLICADA', message: 'Já existe cadastro com este CPF.' } } : { status: 200, data: { data: PESSOA } }));
    await api.pessoas.editar({ id: 'p1', nome: 'Ana R.', telefone: undefined });
    expect(adapter.mock.calls[0]![0]).toMatchObject({ method: 'patch', url: '/pessoas/p1' });
    expect(corpo(adapter.mock.calls[0]![0])).toEqual({ nome: 'Ana R.' });
    expect(await esperaErro(api.pessoas.editar({ id: 'p1', documento: '52998224725' }))).toMatchObject({ status: 409, code: 'PESSOA_DUPLICADA' });
  });

  it('listarPagina de pessoas: categoria e cursor na query (texto livre nunca na URL)', async () => {
    const linha = { ...PESSOA, ultimoAcesso: 'Sem acessos', unidadesVinculadas: [], unidadesVinculadasCodigos: [], vinculoPrincipal: null };
    const { api, adapter } = montar(() => ({ status: 200, data: { data: [linha], pagination: { cursor: null, hasNextPage: false } } }));
    const p = await api.pessoas.listarPagina({ categoria: 'morador', cursor: 'c1' });
    expect(p).toMatchObject({ temMais: false, cursor: null, itens: [{ id: 'p1', vinculoPrincipal: null }] });
    expect(adapter.mock.calls[0]![0]).toMatchObject({ url: '/pessoas', params: { limite: 50, categoria: 'morador', cursor: 'c1' } });
  });

  it('ficha: vínculos com datas convertidas, funcionário sem a pessoa, últimos acessos pelo módulo de eventos', async () => {
    const { api, adapter } = montar((c) => (c.url === '/eventos-acesso'
      ? { status: 200, data: { data: [], pagination: { cursor: null, hasNextPage: false } } }
      : { status: 200, data: { data: { pessoa: { ...PESSOA, telefone: '11987650001' }, funcionario: null, vinculos: [VINCULO], eventos: null } } }));
    const f = await api.pessoas.ficha('p1');
    expect(f.eventos).toEqual([]);
    expect(adapter.mock.calls[1]![0]).toMatchObject({ url: '/eventos-acesso', params: { pessoaId: 'p1', excluirTipos: 'correcao', limite: 10 } });
    expect(f.funcionario).toBeUndefined();
    expect(f.pessoa.telefone).toBe('11987650001');
    expect(f.vinculos[0]).toMatchObject({ vigenciaInicio: brt(2026, 10, 1), vigenciaFim: brt(2027, 7, 31), prazoRegularizacao: null, conferencia: { data: brt(2026, 10, 17) } });
  });

  it('pessoas.funcionario: 404 vira null (não é funcionário); outro erro propaga', async () => {
    // Só a escala da pessoa (o porteiro não lê a lista nem a ficha do funcionário)
    const { api } = montar((c) => (c.url === '/funcionarios/p1/escala' ? { status: 404, data: { code: 'FUNCIONARIO_NAO_ENCONTRADO', message: 'x' } }
      : c.url === '/funcionarios/p9/escala' ? { status: 200, data: { data: FUNC } } : { status: 500, data: {} }));
    expect(await api.pessoas.funcionario('p1')).toBeNull();
    expect(await api.pessoas.funcionario('p9')).toEqual({ pessoaId: 'p9', funcao: 'Vigia', escala: ESCALA, ativo: true });
    expect((await esperaErro(api.pessoas.funcionario('p2'))).status).toBe(500);
  });

  it('funcionários: listar percorre páginas; criar e editar mandam escala e o corpo certo', async () => {
    const { api, adapter } = montar((c) => (c.method === 'get'
      ? { status: 200, data: { data: [FUNC], pagination: { cursor: null, hasNextPage: false } } }
      : { status: c.method === 'post' ? 201 : 200, data: { data: FUNC } }));
    const l = await api.funcionarios.listar();
    expect(l[0]).toMatchObject({ pessoaId: 'p9', emEscalaAgora: true, pessoa: { id: 'p9' } });
    await api.funcionarios.criar({ nome: 'Nilo', documento: '529.982.247-25', telefone: '11977776666', funcao: 'Vigia', escala: ESCALA });
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({ nome: 'Nilo', documento: '529.982.247-25', telefone: '11977776666', funcao: 'Vigia', escala: ESCALA });
    await api.funcionarios.editar({ pessoaId: 'p9', ativo: false });
    expect(adapter.mock.calls[2]![0]).toMatchObject({ method: 'patch', url: '/funcionarios/p9' });
    expect(corpo(adapter.mock.calls[2]![0])).toEqual({ ativo: false });
  });

  it('veículos: criar e editar; placa da API exibida com hífen; 409 de placa vira mensagem', async () => {
    const VE = { id: 've1', unidadeId: 'u-432', placa: 'ABC1D23', modelo: 'Fit', cor: 'prata', ativo: true };
    const { api, adapter } = montar((c) => (c.method === 'patch' && corpo(c).placa ? { status: 409, data: { code: 'PLACA_DUPLICADA', message: 'Placa já cadastrada.' } }
      : { status: c.method === 'post' ? 201 : 200, data: { data: VE } }));
    expect((await api.veiculos.criar({ unidadeId: 'u-432', placa: 'abc-1d23', modelo: 'Fit', cor: 'prata' })).placa).toBe('ABC-1D23');
    expect(adapter.mock.calls[0]![0]).toMatchObject({ method: 'post', url: '/veiculos' });
    await api.veiculos.editar({ id: 've1', ativo: false });
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({ ativo: false });
    expect(await esperaErro(api.veiculos.editar({ id: 've1', placa: 'XYZ1234' }))).toMatchObject({ status: 409, message: 'Placa já cadastrada.' });
  });

  it('vínculos: listarPagina junta os status; criar converte datas; decidir vai para /aprovar ou /rejeitar', async () => {
    const { api, adapter } = montar((c) => (c.method === 'get'
      ? { status: 200, data: { data: [VINCULO], pagination: { cursor: 'c2', hasNextPage: true } } }
      : { status: 200, data: { data: VINCULO } }));
    const p = await api.vinculos.listarPagina({ status: ['aprovado', 'rejeitado', 'encerrado'], ordem: 'decisao' });
    expect(p.temMais).toBe(true);
    expect(adapter.mock.calls[0]![0]).toMatchObject({ url: '/vinculos', params: { limite: 50, status: 'aprovado,rejeitado,encerrado', ordem: 'decisao' } });
    await api.vinculos.criar({ pessoaId: 'p1', unidadeId: 'u-432', tipo: 'inquilino', vigenciaInicio: brt(2026, 10, 18), vigenciaFim: null, solicitadoPor: '' });
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({ pessoaId: 'p1', unidadeId: 'u-432', tipo: 'inquilino', vigenciaInicio: '2026-10-18', vigenciaFim: null });
    await api.vinculos.decidir({ id: 'v1', decisao: 'aprovar', justificativa: 'ignorada' });
    await api.vinculos.decidir({ id: 'v1', decisao: 'rejeitar', justificativa: 'Comprovante não confere' });
    expect(adapter.mock.calls[2]![0].url).toBe('/vinculos/v1/aprovar');
    expect(corpo(adapter.mock.calls[2]![0])).toEqual({});
    expect(adapter.mock.calls[3]![0].url).toBe('/vinculos/v1/rejeitar');
    expect(corpo(adapter.mock.calls[3]![0])).toEqual({ justificativa: 'Comprovante não confere' });
  });

  it('vínculos: conferência, regularizar e encerrar mandam datas como dia; autorizadores pela unidade', async () => {
    const { api, adapter } = montar((c) => (c.url?.endsWith('/autorizadores')
      ? { status: 200, data: { data: [{ pessoa: PESSOA, vinculo: { ...VINCULO, status: 'aprovado' } }] } }
      : { status: c.url?.endsWith('/conferencias') ? 201 : 200, data: { data: VINCULO } }));
    await api.vinculos.registrarConferencia('v1', { tipo: 'outro', descricao: 'Certidão', data: brt(2026, 10, 16) });
    expect(corpo(adapter.mock.calls[0]![0])).toEqual({ tipo: 'outro', descricao: 'Certidão', data: '2026-10-16' });
    await api.vinculos.regularizar('v1');
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({});
    await api.vinculos.regularizar('v1', { vigenciaFim: brt(2027, 1, 31) });
    expect(corpo(adapter.mock.calls[2]![0])).toEqual({ vigenciaFim: '2027-01-31' });
    await api.vinculos.encerrar('v1', { motivo: 'Locação encerrada pelo proprietário' });
    expect(adapter.mock.calls[3]![0].url).toBe('/vinculos/v1/encerrar');
    expect(corpo(adapter.mock.calls[3]![0])).toEqual({ motivo: 'Locação encerrada pelo proprietário' });
    const a = await api.vinculos.autorizadores('u-432');
    expect(adapter.mock.calls[4]![0]).toMatchObject({ method: 'get', url: '/unidades/u-432/autorizadores' });
    expect(a[0]).toMatchObject({ pessoa: { id: 'p1' }, vinculo: { status: 'aprovado', vigenciaFim: brt(2027, 7, 31) } });
  });

  it('detalhe da unidade: vínculos vêm da API (datas convertidas)', async () => {
    const UN = { id: 'u-432', torre: 4, numero: '32', ativo: true };
    const { api } = montar((c) => (c.url === '/unidades/u-432' ? { status: 200, data: { data: { unidade: UN, veiculos: [], vinculos: [VINCULO] } } }
      : c.url === '/eventos-acesso' ? { status: 200, data: { data: [], pagination: { cursor: null, hasNextPage: false } } } : { status: 200, data: { data: [] } }));
    const d = await api.unidades.detalhe('u-432');
    expect(d.vinculos).toHaveLength(1);
    expect(d.vinculos![0]!.vigenciaInicio).toBe(brt(2026, 10, 1));
    expect(d.autorizacoes).toEqual([]);
  });

  it('importação: confirmar reenvia as linhas do analisar (a API não as guarda); sem análise nesta aba é 404 local', async () => {
    const linhas = [{ linha: 2, torre: '4', unidade: '32', nome: 'Ana', documento: '52998224725', telefone: '11987650001', tipo: 'proprietario' }];
    const { api, adapter } = montar((c) => (c.url === '/importacoes'
      ? { status: 201, data: { data: { id: 'imp1', arquivo: 'a.csv', status: 'analisada', lidas: 1, importaveis: 1, rejeitadas: 0, avisos: 0, inconsistencias: [], amostra: [], prazoRegularizacao: '2027-01-16' } } }
      : { status: 200, data: { data: { importados: 1, reaproveitados: 0, prazoRegularizacao: '2027-01-16' } } }));
    const rel = await api.importacao.analisar({ arquivo: 'a.csv', linhas });
    expect(rel.prazoRegularizacao).toBe(brt(2027, 1, 16));
    expect(corpo(adapter.mock.calls[0]![0])).toEqual({ arquivo: 'a.csv', linhas });
    expect(await api.importacao.confirmar('imp1')).toEqual({ importados: 1, reaproveitados: 0, prazoRegularizacao: brt(2027, 1, 16) });
    expect(adapter.mock.calls[1]![0]).toMatchObject({ method: 'post', url: '/importacoes/imp1/confirmar' });
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({ linhas });
    // Já confirmada (linhas descartadas) ou outra aba: não vai à rede
    expect(await esperaErro(api.importacao.confirmar('imp1'))).toMatchObject({ status: 404, code: 'IMPORTACAO_NAO_ENCONTRADA' });
    expect(adapter).toHaveBeenCalledTimes(2);
  });
});

describe('mock: operações novas do lote de pessoas e vínculos (mesmo contrato da API)', () => {
  it('pessoas.listarPagina e vinculos.listarPagina percorrem tudo sem repetir; categoria e status filtram', async () => {
    const { novaApi, entrarComo } = await import('./helpers');
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const vistos: string[] = [];
    let cursor: string | null = null;
    do {
      const p = await api.pessoas.listarPagina({ limite: 5, cursor });
      vistos.push(...p.itens.map((x) => x.id));
      cursor = p.cursor;
    } while (cursor);
    expect(new Set(vistos).size).toBe((await api.pessoas.listar()).length);
    const moradores = await api.pessoas.listarPagina({ categoria: 'morador', limite: 100 });
    expect(moradores.itens.every((p) => p.categoria === 'morador')).toBe(true);
    expect(moradores.itens.find((p) => p.nome === 'Ana Ribeiro')?.vinculoPrincipal).toMatchObject({ status: 'aprovado', unidadeCodigo: 'T4-32' });
    const legados = await api.vinculos.listarPagina({ status: ['legado'], ordem: 'prazo', limite: 100 });
    const nLegados = await api.vinculos.contar('legado');
    expect(legados.itens.length).toBe(Math.min(100, nLegados));
    expect(legados.temMais).toBe(nLegados > 100);
    // ordem 'prazo': não decrescente
    const prazos = legados.itens.map((v) => v.prazoRegularizacao!);
    expect([...prazos].sort((x, y) => x - y)).toEqual(prazos);
    const decididos = await api.vinculos.listarPagina({ status: ['aprovado', 'rejeitado'], ordem: 'decisao', limite: 100 });
    expect(decididos.itens.every((v) => v.status === 'aprovado' || v.status === 'rejeitado')).toBe(true);
  });

  it('encerrar (RF-07): só aprovado ou legado, motivo >= 15, data não futura; depois é final', async () => {
    const { novaApi, entrarComo, esperaErro: erro } = await import('./helpers');
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const todos = await api.vinculos.listar();
    const aprovado = todos.find((v) => v.status === 'aprovado')!;
    const pendente = todos.find((v) => v.status === 'pendente')!;
    expect((await erro(api.vinculos.encerrar(pendente.id, { motivo: 'Motivo suficientemente longo' }))).code).toBe('VINCULO_NAO_ENCERRAVEL');
    expect((await erro(api.vinculos.encerrar(aprovado.id, { motivo: 'curto' }))).code).toBe('MOTIVO_OBRIGATORIO');
    expect((await erro(api.vinculos.encerrar(aprovado.id, { motivo: 'Motivo suficientemente longo', data: Date.now() + 400 * 86_400_000 }))).code).toBe('DATA_FUTURA');
    const v = await api.vinculos.encerrar(aprovado.id, { motivo: 'Mudou-se do condomínio em outubro' });
    expect(v).toMatchObject({ status: 'encerrado', justificativa: 'Mudou-se do condomínio em outubro' });
    expect(v.encerradoEm).not.toBeNull();
    expect((await erro(api.vinculos.encerrar(aprovado.id, { motivo: 'Motivo suficientemente longo' }))).code).toBe('VINCULO_NAO_ENCERRAVEL');
    expect((await erro(api.pessoas.listar().then(() => api.vinculos.encerrar('nao-existe', { motivo: 'Motivo suficientemente longo' })))).status).toBe(404);
  });

  it('veiculos.editar: formato e unicidade da placa ativa; desativado sai do detalhe e libera a placa', async () => {
    const { novaApi, entrarComo, esperaErro: erro, un } = await import('./helpers');
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const [a, b] = (await api.unidades.detalhe(un('T4-32'))).veiculos;
    expect((await erro(api.veiculos.editar({ id: a!.id, placa: 'XX' }))).code).toBe('PLACA_INVALIDA');
    expect((await erro(api.veiculos.editar({ id: a!.id, placa: b!.placa }))).code).toBe('PLACA_DUPLICADA');
    expect((await api.veiculos.editar({ id: a!.id, cor: 'azul' })).cor).toBe('azul');
    await api.veiculos.editar({ id: b!.id, ativo: false });
    const ids = (await api.unidades.detalhe(un('T4-32'))).veiculos.map((v) => v.id);
    expect(ids).toContain(a!.id);
    expect(ids).not.toContain(b!.id);
    expect((await api.veiculos.editar({ id: a!.id, placa: b!.placa })).placa).toBe(b!.placa);
  });
});


describe('adaptador HTTP: registro de acesso, autorizações, restrições, auditoria e relatórios', () => {
  const corpo = (c: InternalAxiosRequestConfig) => (c.data ? JSON.parse(c.data as string) : undefined);
  const pagina = (itens: unknown[], cursor: string | null = null) => ({ status: 200, data: { data: itens, pagination: { cursor, hasNextPage: cursor !== null } } });

  it('entrada: POST /eventos-acesso só com o que foi informado; retroativo leva ocorridoEm e formulário; o 422 do negado traz os detalhes', async () => {
    const { api, adapter } = montar((c) => (corpo(c)?.pessoaId === 'p-restrita'
      ? { status: 422, data: { code: 'PESSOA_EM_RESTRICAO', message: 'Entrada não permitida', details: { eventoId: 'ev9', codigo: 'EV-000009', restricoes: [] } } }
      : { status: 201, data: { data: EV } }));
    const ev = await api.eventos.criar({ pessoaId: 'p1', unidadeDestinoId: 'u-432', autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: 'p2', retroativo: false, ocorridoEm: null, justificativa: null });
    expect(ev).toMatchObject({ id: 'ev1', codigo: 'EV-000007' });
    expect(adapter.mock.calls[0]![0]).toMatchObject({ method: 'post', url: '/eventos-acesso' });
    expect(corpo(adapter.mock.calls[0]![0])).toEqual({ pessoaId: 'p1', unidadeDestinoId: 'u-432', autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: 'p2' });
    await api.eventos.criar({ pessoaId: 'p1', unidadeDestinoId: 'u-432', autorizadoPorTipo: 'excecao_porteiro', justificativa: 'x'.repeat(20), retroativo: true, ocorridoEm: 1_700_000_000_000.7, formularioContingencia: 'F-1' });
    expect(corpo(adapter.mock.calls[1]![0])).toMatchObject({ retroativo: true, ocorridoEm: 1_700_000_000_000, formularioContingencia: 'F-1' });
    const e = await esperaErro(api.eventos.criar({ pessoaId: 'p-restrita', unidadeDestinoId: 'u-432', autorizadoPorTipo: null }));
    expect(e).toMatchObject({ status: 422, code: 'PESSOA_EM_RESTRICAO', detalhes: { eventoId: 'ev9', codigo: 'EV-000009' } });
    expect(corpo(adapter.mock.calls[2]![0])).toEqual({ pessoaId: 'p-restrita', unidadeDestinoId: 'u-432', autorizadoPorTipo: null });
  });

  it('recusa, saída (retroativa) e correção: rotas e corpos', async () => {
    const { api, adapter } = montar(() => ({ status: 201, data: { data: EV } }));
    await api.eventos.registrarRecusa({ pessoaId: 'p1', unidadeDestinoId: 'u-432', meio: 'interfone', moradorPessoaId: 'p2' });
    expect(adapter.mock.calls[0]![0].url).toBe('/eventos-acesso/recusas');
    await api.eventos.registrarSaida('ev1');
    expect(adapter.mock.calls[1]![0]).toMatchObject({ url: '/eventos-acesso/ev1/saida' });
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({});
    await api.eventos.registrarSaida('ev1', { retroativo: true, ocorridoEm: 1_700_000_000_000, formularioContingencia: 'F-2', observacao: ' ' });
    expect(corpo(adapter.mock.calls[2]![0])).toEqual({ retroativo: true, ocorridoEm: 1_700_000_000_000, formularioContingencia: 'F-2' });
    await api.eventos.corrigir('ev1', { justificativa: 'Unidade digitada errada', valores: { unidadeDestinoId: 'u-711' } });
    expect(adapter.mock.calls[3]![0].url).toBe('/eventos-acesso/ev1/correcoes');
    expect(corpo(adapter.mock.calls[3]![0])).toEqual({ justificativa: 'Unidade digitada errada', valores: { unidadeDestinoId: 'u-711' } });
    await api.eventos.corrigir('ev1', { justificativa: 'Só anotação, sem valores', valores: {} });
    expect(corpo(adapter.mock.calls[4]![0])).toEqual({ justificativa: 'Só anotação, sem valores' });
  });

  it('listagem: filtros por id e data na query; o NOME vai no corpo do POST /busca (nunca na URL); presentes percorre e ordena', async () => {
    const { api, adapter } = montar((c) => (c.url === '/acessos/presentes'
      ? (c.params?.cursor ? pagina([{ ...EV, id: 'ev2', ocorridoEm: 5 }]) : pagina([{ ...EV, id: 'ev3', ocorridoEm: 9 }], 'c2'))
      : pagina([EV], 'prox')));
    const p = await api.eventos.listarPagina({ unidadeId: 'u-432', tipo: 'entrada', somenteExcecoes: true, excluirTipos: ['saida'], de: 10.5, limite: 20 });
    expect(p).toMatchObject({ cursor: 'prox', temMais: true, itens: [{ id: 'ev1' }] });
    expect(adapter.mock.calls[0]![0]).toMatchObject({ method: 'get', url: '/eventos-acesso',
      params: { unidadeId: 'u-432', tipo: 'entrada', somenteExcecoes: 'true', excluirTipos: 'saida', de: 10, limite: 20 } });
    await api.eventos.listarPagina({ pessoa: 'Ana Ribeiro', cursor: 'c1' });
    const busca = adapter.mock.calls[1]![0];
    expect(busca).toMatchObject({ method: 'post', url: '/eventos-acesso/busca' });
    expect(busca.params).toBeUndefined();
    expect(corpo(busca)).toEqual({ pessoa: 'Ana Ribeiro', limite: 50, cursor: 'c1' });
    const presentes = await api.eventos.presentes();
    expect(presentes.map((e) => e.id)).toEqual(['ev3', 'ev2']);
    const ruim = montar(() => pagina([{ id: 'x' }]));
    expect(await esperaErro(ruim.api.eventos.listarPagina())).toMatchObject({ code: 'RESPOSTA_INVALIDA' });
  });

  it('autorização prévia e restrição: datas de calendário (AAAA-MM-DD), verbos e listas', async () => {
    const { api, adapter } = montar((c) => (c.url?.endsWith('/revogar') ? { status: 204 }
      : c.url === '/restricoes/verificar' ? { status: 200, data: { data: { restrita: true, alertas: [{ id: 'r1' }] } } }
        : c.method === 'post' ? { status: 201, data: { data: { id: 'x1' } } } : { status: 200, data: { data: [] } }));
    await api.autorizacoes.criar({ unidadeId: 'u-432', pessoaId: 'p1', validaAte: brt(2026, 10, 20), diasSemana: [6], horaInicio: '08:00', horaFim: '10:00', solicitadaPorPessoaId: null, justificativa: 'Sem morador, combinado com a administração' });
    expect(corpo(adapter.mock.calls[0]![0])).toEqual({ unidadeId: 'u-432', pessoaId: 'p1', validaAte: '2026-10-20', diasSemana: [6], horaInicio: '08:00', horaFim: '10:00',
      solicitadaPorPessoaId: null, justificativa: 'Sem morador, combinado com a administração' });
    await api.autorizacoes.revogar('a1');
    expect(adapter.mock.calls[1]![0]).toMatchObject({ method: 'post', url: '/autorizacoes-previas/a1/revogar' });
    await api.autorizacoes.vigentes('p1', 'area1', { areaComum: true });
    expect(adapter.mock.calls[2]![0].params).toEqual({ pessoaId: 'p1', areaComumId: 'area1' });
    expect(await api.restricoes.verificar('p1', null)).toMatchObject({ restrita: true });
    expect(adapter.mock.calls[3]![0].params).toEqual({ pessoaId: 'p1' });
    await api.restricoes.criar({ pessoaId: 'p1', unidadeId: 'u-432', motivo: 'Não autoriza', validaAte: brt(2026, 12, 31), solicitadaPorPessoaId: 'p2', paraTodoCondominio: false });
    expect(corpo(adapter.mock.calls[4]![0])).toEqual({ pessoaId: 'p1', unidadeId: 'u-432', motivo: 'Não autoriza', validaAte: '2026-12-31', solicitadaPorPessoaId: 'p2' });
    await api.restricoes.aprovar('r1');
    expect(adapter.mock.calls[5]![0].url).toBe('/restricoes/r1/aprovar');
    expect(await api.restricoes.pendentes()).toEqual([]);
  });

  it('auditoria: exportação com os filtros no corpo; trilha de alterações paginada; integridade; relatórios por dia', async () => {
    const { api, adapter } = montar((c) => {
      if (c.url === '/auditoria/exportacoes') return { status: 200, data: { data: { nomeArquivo: 'evento-EV-000007.jsonl', conteudo: '{}\n', quantidade: 1 } } };
      if (c.url === '/auditoria/alteracoes') return pagina([{ id: 'al1', seq: 3 }], 'c9');
      if (c.url === '/auditoria/integridade') return { status: 200, data: { data: { valido: true, verificados: 7, ultimoSeq: 7, ultimoHash: 'b'.repeat(64) } } };
      if (c.url === '/relatorios/resumo/csv') return { status: 200, data: { data: { nomeArquivo: 'r.csv', conteudo: 'x', quantidade: 0 } } };
      return { status: 200, data: { data: { periodo: { de: 0, ate: 1 }, acessosPorDia: [] } } };
    });
    expect((await api.auditoria.exportar({ eventoId: 'ev1' })).nomeArquivo).toBe('evento-EV-000007.jsonl');
    expect(corpo(adapter.mock.calls[0]![0])).toEqual({ eventoId: 'ev1' });
    await api.auditoria.exportar({ pessoa: 'Ana', de: 5 });
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({ pessoa: 'Ana', de: 5 });
    expect(adapter.mock.calls[1]![0].params).toBeUndefined();
    expect(await api.auditoria.alteracoesPagina({ acao: 'autorizacao.criar', limite: 10 })).toMatchObject({ cursor: 'c9', temMais: true });
    expect(adapter.mock.calls[2]![0].params).toEqual({ acao: 'autorizacao.criar', limite: 10 });
    expect(await api.auditoria.verificarIntegridade()).toMatchObject({ valido: true, verificados: 7 });
    await api.relatorios.resumo({ de: brt(2026, 10, 1), ate: brt(2026, 10, 17, 23, 59), unidadeId: 'u-432', meio: 'escala' });
    expect(adapter.mock.calls[4]![0].params).toEqual({ de: '2026-10-01', ate: '2026-10-17', unidadeId: 'u-432', meio: 'escala' });
    expect((await api.relatorios.exportarCsv({})).nomeArquivo).toBe('r.csv');
  });
});

describe('adaptador HTTP: encomendas e ocorrências', () => {
  const corpo = (c: InternalAxiosRequestConfig) => (c.data ? JSON.parse(c.data as string) : undefined);
  const pagina = (itens: unknown[], cursor: string | null = null) => ({ status: 200, data: { data: itens, pagination: { cursor, hasNextPage: cursor !== null } } });
  const ENC = {
    id: 'e1', codigo: 'K12', unidadeId: 'u-432', destinatario: 'Ana', transportadora: 'Correios', codigoRastreio: 'BR1', recebidaPorId: 'u-1',
    recebidaEm: 1_760_000_000_000, unidadeConfirmada: true, retiradaEm: null, retiradaPorPessoaId: null, retiradaRegistradaPorId: null,
    retiradaAutorizacaoId: null, unidadeCodigo: 'T4-32', recebidaPorNome: 'João', retiradaPorNome: null, retiradaRegistradaPorNome: null, autorizacoes: [],
  };
  const OC = {
    id: 'o1', codigo: 'OC-2026-001', tipo: 'outro', descricao: 'Portão', unidadeId: null, envolvidos: '', abertaPorId: 'u-1', abertaEm: 1_760_000_000_000,
    status: 'aberta', abertaPorNome: 'João', historicoStatus: [], anexos: ['anexo-0a1b2c3d.pdf'], eventoIds: [],
    documentos: [{ id: 'd1', nome: 'anexo-0a1b2c3d.pdf', mime: 'application/pdf', tamanhoBytes: 10, enviadoEm: 1, enviadoPorNome: 'João' }],
  };

  it('encomendas: filas paginadas com status/atrasadas/cursor na query; resumo; entregar e autorizar pelas rotas de transição', async () => {
    const { api, adapter } = montar((c) => {
      if (c.url === '/encomendas' && c.method === 'get') return pagina([ENC], 'c2');
      if (c.url === '/encomendas/resumo') return { status: 200, data: { data: { aguardando: 3, atrasadas: 1, entregues: 9, diasAtraso: 7 } } };
      if (c.url === '/encomendas/e1/autorizacoes-retirada') return { status: 201, data: { data: { id: 'ar1', encomendaId: 'e1', pessoaAutorizadaId: 'p3', solicitantePessoaId: 'p2', registradaPorId: 'u-1', registradaEm: 5 } } };
      return { status: 200, data: { data: ENC } };
    });
    const p = await api.encomendas.listarPagina({ status: 'aguardando', atrasadasDias: 7, cursor: 'c1', limite: 20 });
    expect(p).toMatchObject({ cursor: 'c2', temMais: true, itens: [{ id: 'e1', codigo: 'K12' }] });
    expect(adapter.mock.calls[0]![0].params).toEqual({ status: 'aguardando', atrasadasDias: 7, cursor: 'c1', limite: 20 });
    expect(await api.encomendas.resumo()).toEqual({ aguardando: 3, atrasadas: 1, entregues: 9, diasAtraso: 7 });
    await api.encomendas.receber({ unidadeId: 'u-432', destinatario: 'Ana', transportadora: 'Correios', codigoRastreio: 'BR1', unidadeConfirmada: true });
    expect(adapter.mock.calls[2]![0]).toMatchObject({ method: 'post', url: '/encomendas' });
    expect(corpo(adapter.mock.calls[2]![0])).toEqual({ unidadeId: 'u-432', destinatario: 'Ana', transportadora: 'Correios', codigoRastreio: 'BR1', unidadeConfirmada: true });
    await api.encomendas.entregar({ id: 'e1', pessoaId: 'p2' });
    expect(adapter.mock.calls[3]![0]).toMatchObject({ method: 'post', url: '/encomendas/e1/retirada' });
    expect(corpo(adapter.mock.calls[3]![0])).toEqual({ pessoaId: 'p2' });
    expect(await api.encomendas.autorizarRetirada({ encomendaId: 'e1', pessoaId: 'p3', solicitadaPorPessoaId: 'p2' })).toMatchObject({ id: 'ar1' });
    expect(corpo(adapter.mock.calls[4]![0])).toEqual({ pessoaId: 'p3', solicitadaPorPessoaId: 'p2' });
    expect((await api.encomendas.obter('e1')).id).toBe('e1');
    expect(adapter.mock.calls[5]![0].url).toBe('/encomendas/e1');
  });

  it('encomendas: erro de regra chega com o código da API; 2xx fora do formato é RESPOSTA_INVALIDA', async () => {
    const { api } = montar((c) => (c.url === '/encomendas/e1/retirada'
      ? { status: 422, data: { code: 'PESSOA_SEM_VINCULO', message: 'Esta pessoa não tem vínculo com a T4-32' } }
      : { status: 200, data: { data: { id: 'e1' } } }));
    expect(await esperaErro(api.encomendas.entregar({ id: 'e1', pessoaId: 'p9' }))).toMatchObject({ status: 422, code: 'PESSOA_SEM_VINCULO' });
    expect((await esperaErro(api.encomendas.obter('e1'))).code).toBe('RESPOSTA_INVALIDA');
  });

  it('ocorrências: lista com status juntos e tipo; criar não manda nomes de anexo; status e eventos pelas rotas de transição', async () => {
    const { api, adapter } = montar((c) => (c.url === '/ocorrencias' && c.method === 'get' ? pagina([OC]) : { status: 200, data: { data: OC } }));
    const p = await api.ocorrencias.listarPagina({ status: ['aberta', 'em_andamento'], tipo: 'dano' });
    expect(p.itens[0]).toMatchObject({ id: 'o1', documentos: [{ id: 'd1' }] });
    expect(adapter.mock.calls[0]![0].params).toEqual({ status: 'aberta,em_andamento', tipo: 'dano', limite: 50 });
    await api.ocorrencias.criar({ tipo: 'outro', descricao: 'Portão', unidadeId: null, envolvidos: 'X', anexos: ['foto.png'], eventoIds: ['ev1'] });
    expect(corpo(adapter.mock.calls[1]![0])).toEqual({ tipo: 'outro', descricao: 'Portão', unidadeId: null, envolvidos: 'X', eventoIds: ['ev1'] });
    await api.ocorrencias.alterarStatus('o1', 'em_andamento');
    expect(adapter.mock.calls[2]![0]).toMatchObject({ method: 'post', url: '/ocorrencias/o1/status' });
    expect(corpo(adapter.mock.calls[2]![0])).toEqual({ status: 'em_andamento' });
    await api.ocorrencias.vincularEventos('o1', ['ev2']);
    expect(corpo(adapter.mock.calls[3]![0])).toEqual({ eventoIds: ['ev2'] });
  });

  it('anexar: multipart com o arquivo no campo "arquivo" (não vira JSON); baixar: blob com o nome do Content-Disposition', async () => {
    const pdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const { api, adapter } = montar((c) => (c.url?.endsWith('/anexos/d1')
      ? { status: 200, data: pdf, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="anexo-0a1b2c3d.pdf"' } }
      : { status: 201, data: { data: OC } }));
    const arquivo = new File(['%PDF-1.4'], 'boletim.pdf', { type: 'application/pdf' });
    await api.ocorrencias.anexar('o1', arquivo);
    const cfg = adapter.mock.calls[0]![0];
    expect(cfg).toMatchObject({ method: 'post', url: '/ocorrencias/o1/anexos' });
    expect(cfg.data).toBeInstanceOf(FormData);
    expect((cfg.data as FormData).get('arquivo')).toBeInstanceOf(File);
    const a = await api.ocorrencias.baixarAnexo('o1', 'd1');
    expect(adapter.mock.calls[1]![0]).toMatchObject({ url: '/ocorrencias/o1/anexos/d1', responseType: 'blob' });
    expect(a).toMatchObject({ nome: 'anexo-0a1b2c3d.pdf', mime: 'application/pdf' });
    expect(a.conteudo).toBe(pdf);
    expect(nomeDoAnexo('attachment; filename="../../etc/passwd"')).toBe('anexo'); // só o formato que a API gera
  });
});

describe('mock: encomendas, ocorrências e restrição (mesmo contrato da API)', () => {
  it('encomendas: listarPagina percorre sem repetir; resumo bate com as filas; obter', async () => {
    const api = novaApiMock();
    await entrarComo(api, 'joao.lima');
    const todos: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const p = await api.encomendas.listarPagina({ status: 'aguardando', limite: 2, cursor });
      todos.push(...p.itens.map((e) => e.id));
      if (!p.temMais) break;
      cursor = p.cursor;
    }
    expect(new Set(todos).size).toBe(todos.length);
    const r = await api.encomendas.resumo();
    expect(r.aguardando).toBe(todos.length);
    expect(r.atrasadas).toBe((await api.encomendas.listarPagina({ atrasadasDias: 7, limite: 100 })).itens.length);
    expect((await api.encomendas.obter(todos[0]!)).id).toBe(todos[0]);
  });

  it('ocorrências: anexar valida tipo, tamanho e dono; vincular eventos é aditivo; encerrada é final', async () => {
    const api = novaApiMock();
    await entrarComo(api, 'joao.lima');
    const o = await api.ocorrencias.criar({ tipo: 'outro', descricao: 'Portão', unidadeId: null, envolvidos: '' });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'portao.png', { type: 'image/png' });
    const v = await api.ocorrencias.anexar(o.id, png);
    expect(v.anexos).toHaveLength(1);
    expect(v.anexos[0]).toMatch(/^anexo-.+\.png$/);
    expect((await esperaErro(api.ocorrencias.anexar(o.id, new File(['x'], 'a.txt', { type: 'text/plain' })))).code).toBe('TIPO_NAO_PERMITIDO');
    expect((await esperaErro(api.ocorrencias.anexar(o.id, new File([], 'v.png', { type: 'image/png' })))).code).toBe('ARQUIVO_VAZIO');
    expect((await esperaErro(api.ocorrencias.anexar('OC-2026-046', png))).code).toBe('SO_PROPRIA_OCORRENCIA'); // aberta por outro
    const ev = (await api.eventos.listarPagina({ limite: 1 })).itens[0]!;
    expect((await api.ocorrencias.vincularEventos(o.id, [ev.id, ev.id])).eventoIds).toEqual([ev.id]);
    expect((await api.ocorrencias.vincularEventos(o.id, [ev.id])).eventoIds).toEqual([ev.id]);
    await api.ocorrencias.alterarStatus(o.id, 'em_andamento');
    await api.ocorrencias.alterarStatus(o.id, 'encerrada');
    expect((await esperaErro(api.ocorrencias.anexar(o.id, png))).code).toBe('OCORRENCIA_ENCERRADA');
    expect((await esperaErro(api.ocorrencias.vincularEventos(o.id, [ev.id]))).code).toBe('OCORRENCIA_ENCERRADA');
    const p = await api.ocorrencias.listarPagina({ status: ['encerrada'], limite: 100 });
    expect(p.itens.every((x) => x.status === 'encerrada')).toBe(true);
    expect(p.itens.map((x) => x.id)).toContain(o.id);
  });

  it('restrição em unidade desativada é UNIDADE_INATIVA (igual à API)', async () => {
    const api = novaApiMock();
    await entrarComo(api, 'paula.nogueira');
    await api.unidades.desativar(un('T4-32'));
    const e = await esperaErro(api.restricoes.criar({
      pessoaId: id.marcos, unidadeId: un('T4-32'), motivo: 'Morador não autoriza', validaAte: brt(2026, 12, 31), solicitadaPorPessoaId: id.ana,
    }));
    expect(e).toMatchObject({ status: 422, code: 'UNIDADE_INATIVA' });
    await api.unidades.reativar(un('T4-32'));
    expect((await api.restricoes.criar({
      pessoaId: id.marcos, unidadeId: un('T4-32'), motivo: 'Morador não autoriza', validaAte: brt(2026, 12, 31), solicitadaPorPessoaId: id.ana,
    })).unidadeId).toBe(un('T4-32'));
  });
});

describe('adaptador HTTP: LGPD (spec 9.3) e selo da cadeia (spec 4.6)', () => {
  const corpo = (c: InternalAxiosRequestConfig) => (c.data ? JSON.parse(c.data as string) : undefined);
  const RET = {
    visitantesPrestadores: 2, moradores: 1, registrosRedigidos: 5, pessoaIds: ['p1', 'p2', 'p3'], eventosDescartados: 40, eventosVencidosSemSelo: 0,
    trilhaDescartada: 12, fotosEliminadas: 0, anexosEliminados: 0, prazoAnexosDefinido: false, arquivosOrfaosRemovidos: 1, registrosSemArquivo: 0,
  };
  const SELO = {
    id: 's1', data: '2026-10-17', tipo: 'diario', ultimoSeq: 42, ultimoHash: 'c'.repeat(64), criadoEm: 1_760_000_000_000,
    enviadoPara: 'email:sindico@condominio.test', enviadoEm: 1_760_000_100_000,
  };

  it('exportar: GET da pessoa (id codificado) e devolve o pacote; anonimizar converte retidoAte para o início do dia BRT', async () => {
    const { api, adapter } = montar((c) => {
      if (c.url?.endsWith('/exportacao')) return { status: 200, data: { data: { nomeArquivo: 'lgpd-p1.json', conteudo: '{}', quantidade: 3 } } };
      return { status: 200, data: { data: { pessoaId: 'p 1', registrosRedigidos: 4, retido: ['Eventos'], eventosRetidos: 3, retidoAte: '2029-10-17', documentosEliminados: 1 } } };
    });
    expect(await api.lgpd.exportarPessoa('p 1')).toEqual({ nomeArquivo: 'lgpd-p1.json', conteudo: '{}', quantidade: 3 });
    expect(adapter.mock.calls[0]![0]).toMatchObject({ method: 'get', url: '/lgpd/pessoas/p%201/exportacao' });
    const r = await api.lgpd.anonimizar('p 1');
    expect(adapter.mock.calls[1]![0]).toMatchObject({ method: 'post', url: '/lgpd/pessoas/p%201/anonimizar' });
    expect(r).toEqual({ pessoaId: 'p 1', registrosRedigidos: 4, retido: ['Eventos'], eventosRetidos: 3, retidoAte: brt(2029, 10, 17), documentosEliminados: 1 });
  });

  it('anonimizar sem eventos retidos: retidoAte nulo continua nulo; erro 422 da regra chega como ApiError', async () => {
    const ok = montar(() => ({ status: 200, data: { data: { pessoaId: 'p1', registrosRedigidos: 0, retido: [], eventosRetidos: 0, retidoAte: null, documentosEliminados: 0 } } }));
    expect((await ok.api.lgpd.anonimizar('p1')).retidoAte).toBeNull();
    const regra = montar(() => ({ status: 422, data: { code: 'PESSOA_COM_VINCULO_VALIDO', message: 'A pessoa tem vínculo válido.' } }));
    expect(await esperaErro(regra.api.lgpd.anonimizar('p1'))).toMatchObject({ status: 422, code: 'PESSOA_COM_VINCULO_VALIDO' });
  });

  it('retenção: POST /lgpd/retencao sem corpo; última execução (ou null); resposta fora do contrato é RESPOSTA_INVALIDA', async () => {
    let ultima: unknown = { em: 1_760_000_000_000, porNome: 'Agendador', resultado: RET };
    const { api, adapter } = montar((c) => (c.method === 'post' ? { status: 200, data: { data: RET } } : { status: 200, data: { data: { ultima } } }));
    expect(await api.lgpd.aplicarRetencao()).toEqual(RET);
    expect(adapter.mock.calls[0]![0]).toMatchObject({ method: 'post', url: '/lgpd/retencao' });
    expect(await api.lgpd.ultimaRetencao()).toEqual({ em: 1_760_000_000_000, porNome: 'Agendador', resultado: RET });
    expect(adapter.mock.calls[1]![0]).toMatchObject({ method: 'get', url: '/lgpd/retencao' });
    ultima = null;
    expect(await api.lgpd.ultimaRetencao()).toBeNull();
    ultima = { em: 'ontem', porNome: 'x', resultado: RET };
    expect(await esperaErro(api.lgpd.ultimaRetencao())).toMatchObject({ code: 'RESPOSTA_INVALIDA' });
    const torto = montar(() => ({ status: 200, data: { data: { moradores: 1 } } }));
    expect(await esperaErro(torto.api.lgpd.aplicarRetencao())).toMatchObject({ code: 'RESPOSTA_INVALIDA' });
    const semUltima = montar(() => ({ status: 200, data: { data: {} } }));
    expect(await esperaErro(semUltima.api.lgpd.ultimaRetencao())).toMatchObject({ code: 'RESPOSTA_INVALIDA' });
  });

  it('selos: estado com a data do selo em ms (dia BRT); selar; conferir manda seq e hash normalizado no corpo', async () => {
    const { api, adapter } = montar((c) => {
      if (c.url === '/auditoria/selos' && c.method === 'get') return { status: 200, data: { data: { ultimo: SELO, pendentesEnvio: 0, destinos: ['email'], agendador: true } } };
      if (c.url === '/auditoria/selos') return { status: 200, data: { data: { selo: { ...SELO, tipo: 'manual', enviadoPara: null, enviadoEm: null }, novo: true, ancora: 'pendente' } } };
      return { status: 200, data: { data: { confere: false, motivo: 'hash_divergente', seq: 42, hashNoBanco: 'd'.repeat(64), seloRegistrado: true } } };
    });
    const e = await api.auditoria.selos();
    expect(e).toEqual({ ultimo: { ...SELO, data: brt(2026, 10, 17) }, pendentesEnvio: 0, destinos: ['email'], agendador: true });
    const r = await api.auditoria.selar();
    expect(adapter.mock.calls[1]![0]).toMatchObject({ method: 'post', url: '/auditoria/selos' });
    expect(r).toMatchObject({ novo: true, ancora: 'pendente', selo: { tipo: 'manual', data: brt(2026, 10, 17), enviadoEm: null } });
    const c = await api.auditoria.conferirAncora({ seq: 42, hash: `  ${'C'.repeat(64)} ` });
    expect(adapter.mock.calls[2]![0]).toMatchObject({ method: 'post', url: '/auditoria/selos/conferir' });
    expect(corpo(adapter.mock.calls[2]![0])).toEqual({ seq: 42, hash: 'c'.repeat(64) });
    expect(c).toMatchObject({ confere: false, motivo: 'hash_divergente' });
  });

  it('selos: sem selo ainda (ultimo nulo); âncora fora do contrato e selo sem hash são RESPOSTA_INVALIDA', async () => {
    const vazio = montar(() => ({ status: 200, data: { data: { ultimo: null, pendentesEnvio: 0, destinos: [], agendador: false } } }));
    expect(await vazio.api.auditoria.selos()).toEqual({ ultimo: null, pendentesEnvio: 0, destinos: [], agendador: false });
    const ancora = montar(() => ({ status: 200, data: { data: { selo: SELO, novo: true, ancora: 'talvez' } } }));
    expect(await esperaErro(ancora.api.auditoria.selar())).toMatchObject({ code: 'RESPOSTA_INVALIDA' });
    const semHash = montar(() => ({ status: 200, data: { data: { ultimo: { ...SELO, ultimoHash: undefined }, pendentesEnvio: 0, destinos: [], agendador: true } } }));
    expect(await esperaErro(semHash.api.auditoria.selos())).toMatchObject({ code: 'RESPOSTA_INVALIDA' });
    const conflito = montar(() => ({ status: 409, data: { code: 'SELO_EM_ANDAMENTO', message: 'Já há um selo em andamento.' } }));
    expect(await esperaErro(conflito.api.auditoria.selar())).toMatchObject({ status: 409, code: 'SELO_EM_ANDAMENTO' });
  });
});
