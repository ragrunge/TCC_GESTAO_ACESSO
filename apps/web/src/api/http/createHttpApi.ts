// Implementação HTTP da interface Api contra o backend NestJS (spec §5.1 e §6). Hoje cobre autenticação, sessão,
// usuários, unidades, catálogo, busca, pessoas, funcionários, veículos, vínculos e importação; os demais módulos lançam
// 501 até a API real tê-los (a UI mostra "disponível em breve").
// Formatos que o adaptador converte para o domínio: data de calendário 'YYYY-MM-DD' (dia BRT) <-> número do início do
// dia BRT; placa 'ABC1D23' -> 'ABC-1D23' (como o mock exibe).
// Formato REST (skill rest-api): todo 2xx com corpo vem em { data }; listas paginadas em
// { data: [...], pagination: { cursor, hasNextPage } }; 204 sem corpo.
import type { AxiosRequestConfig } from 'axios';
import type { AreaComum, ConferenciaComprovante, Funcionario, Pessoa, Unidade, UsuarioSistema, Veiculo, VinculoUnidade } from '@portaria/domain/types';
import type { Rota } from '@portaria/domain/rbac';
import { brt, toInputDate } from '@portaria/domain/time';
import type {
  Api, Autorizador, FichaPessoa, FuncionarioView, LinhaPlanilha, Pagina, PessoaBusca, PessoaLista, RelatorioImportacao, ResultadoBuscaGlobal,
  ResultadoImportacao, UnidadeDetalhe, UnidadeResumo, UsuarioComSenhaTemporaria, UsuarioSessao, VinculoView,
} from '../types';
import { ApiError } from '../types';
import { criarCliente } from './cliente';

/** Rotas da UI com backend pronto. Atualizar a cada módulo novo implementado na API. */
export const ROTAS_HTTP: readonly Rota[] = ['usuarios', 'unidades', 'cadastro', 'vinculos', 'funcionarios', 'importar'];

/** Operações com backend pronto, para a UI esconder as ações que dariam 501 (`api.suporta`). */
export const OPERACOES_HTTP: ReadonlySet<string> = new Set([
  'auth.login', 'auth.logout', 'auth.me', 'auth.trocarSenha',
  'usuarios.listar', 'usuarios.criar', 'usuarios.desativar', 'usuarios.reativar', 'usuarios.redefinirAcesso', 'usuarios.alterarPapel',
  'busca.global', 'pessoas.buscar', 'catalogo.obter', 'vinculos.contar',
  'pessoas.listar', 'pessoas.listarPagina', 'pessoas.ficha', 'pessoas.criar', 'pessoas.editar', 'pessoas.funcionario',
  'funcionarios.listar', 'funcionarios.criar', 'funcionarios.editar', 'veiculos.criar', 'veiculos.editar',
  'vinculos.listar', 'vinculos.listarPagina', 'vinculos.criar', 'vinculos.registrarConferencia', 'vinculos.decidir',
  'vinculos.regularizar', 'vinculos.encerrar', 'vinculos.autorizadores', 'importacao.analisar', 'importacao.confirmar',
  'unidades.listar', 'unidades.listarPagina', 'unidades.detalhe', 'unidades.criar', 'unidades.editar', 'unidades.desativar', 'unidades.reativar',
]);

export const MENSAGEM_MODULO_INDISPONIVEL = 'Módulo ainda não disponível na API real';

const indisponivel = () => async (): Promise<never> => {
  throw new ApiError(501, 'MODULO_INDISPONIVEL', MENSAGEM_MODULO_INDISPONIVEL);
};

const respostaInvalida = () => new ApiError(502, 'RESPOSTA_INVALIDA', 'Resposta inesperada do servidor.');

/** Tira o envelope `{ data }`. Sem ele, a resposta está fora do contrato. */
function dados<T>(corpo: unknown): T {
  if (!corpo || typeof corpo !== 'object' || !('data' in corpo)) throw respostaInvalida();
  return (corpo as { data: T }).data;
}

interface PaginaApi<T> { data: T[]; pagination: { cursor: string | null; hasNextPage: boolean } }

function paginaDe<T>(corpo: unknown): Pagina<T> {
  const c = corpo as Partial<PaginaApi<T>> | null;
  if (!c || !Array.isArray(c.data) || !c.pagination || typeof c.pagination.hasNextPage !== 'boolean') throw respostaInvalida();
  return { itens: c.data, cursor: c.pagination.cursor ?? null, temMais: c.pagination.hasNextPage };
}

/** A API manda campos a mais no catálogo (código e rótulo); a interface usa só os da Unidade. */
const unidadeDe = (u: Unidade): Unidade => ({ id: u.id, torre: u.torre, numero: u.numero, ativo: u.ativo });

// ----- Conversões (formato da API -> domínio) ---------------------------------------------------

/** 'YYYY-MM-DD' (dia BRT) -> início do dia BRT em ms. */
export function diaParaMs(dia: string | null | undefined): number | null {
  if (!dia) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) throw respostaInvalida();
  return brt(Number(m[1]), Number(m[2]), Number(m[3]));
}
/** Início do dia BRT (ms) -> 'YYYY-MM-DD'. */
export const msParaDia = (ms: number | null | undefined): string | null => (ms === null || ms === undefined ? null : toInputDate(ms));

/** 'ABC1D23' -> 'ABC-1D23'. */
export const formatarPlaca = (p: string) => (/^[A-Z0-9]{7}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p);

type PessoaApi = Omit<Pessoa, 'telefoneMascarado'> & { telefoneMascarado?: string | null };
function pessoaDe<T extends PessoaApi>(p: T): T & Pessoa {
  const { telefoneMascarado, ...resto } = p;
  return { ...resto, documentoTipo: 'cpf', ...(telefoneMascarado ? { telefoneMascarado } : {}) } as T & Pessoa;
}

type ConferenciaApi = Omit<ConferenciaComprovante, 'data'> & { data: string };
type VinculoApi = Omit<VinculoView, 'vigenciaInicio' | 'vigenciaFim' | 'prazoRegularizacao' | 'conferencia'> & {
  vigenciaInicio: string | null; vigenciaFim: string | null; prazoRegularizacao: string | null; conferencia: ConferenciaApi | null;
};
function vinculoDe(v: VinculoApi): VinculoView {
  if (!v || typeof v.id !== 'string') throw respostaInvalida();
  return {
    ...v,
    vigenciaInicio: diaParaMs(v.vigenciaInicio), vigenciaFim: diaParaMs(v.vigenciaFim), prazoRegularizacao: diaParaMs(v.prazoRegularizacao),
    conferencia: v.conferencia ? { ...v.conferencia, data: diaParaMs(v.conferencia.data)! } : null,
  };
}

const veiculoDe = (v: Veiculo): Veiculo => ({ ...v, placa: formatarPlaca(v.placa) });

type FuncionarioApi = Funcionario & { pessoa?: PessoaApi; emEscalaAgora?: boolean };
const funcionarioBase = (f: FuncionarioApi): Funcionario => ({ pessoaId: f.pessoaId, funcao: f.funcao, escala: f.escala, ativo: f.ativo });
function funcionarioDe(f: FuncionarioApi): FuncionarioView {
  if (!f?.pessoa) throw respostaInvalida();
  return { ...funcionarioBase(f), pessoa: pessoaDe(f.pessoa), emEscalaAgora: f.emEscalaAgora === true };
}

type RelatorioApi = Omit<RelatorioImportacao, 'prazoRegularizacao'> & { prazoRegularizacao: string };
type ResultadoImportacaoApi = Omit<ResultadoImportacao, 'prazoRegularizacao'> & { prazoRegularizacao: string };

/** Corpo sem as chaves `undefined` (os DTOs da API são estritos e o PATCH só muda o que veio). */
const semIndefinidos = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Limite de páginas por listagem completa: a UI de usuários ainda não pagina; isto só impede laço infinito. */
const MAX_PAGINAS = 20;

/** `{ usuario, sessao }` de login/me e `{ usuario }` de trocar-senha (dentro de `data`) -> o usuário. */
function usuarioDe(corpo: unknown): UsuarioSessao {
  const u = dados<{ usuario?: UsuarioSessao } | null>(corpo)?.usuario;
  if (!u || typeof u.id !== 'string') throw respostaInvalida();
  return { ...u, deveTrocarSenha: u.deveTrocarSenha === true };
}

function comSenhaTemporaria(corpo: unknown): UsuarioComSenhaTemporaria {
  const c = dados<Partial<UsuarioComSenhaTemporaria> | null>(corpo);
  if (!c?.usuario || typeof c.senhaTemporaria !== 'string') throw respostaInvalida();
  return { usuario: c.usuario, senhaTemporaria: c.senhaTemporaria };
}

export function createHttpApi(base: string, opcoes: { adapter?: AxiosRequestConfig['adapter'] } = {}): Api {
  const cliente = criarCliente(base, opcoes);
  const { http } = cliente;
  const id = (v: string) => encodeURIComponent(v);
  const n = indisponivel;

  /** Percorre a listagem por cursor até `hasNextPage` falso (a interface Api devolve a lista inteira). */
  async function todasAsPaginas<T>(caminho: string, extra: Record<string, string> = {}): Promise<T[]> {
    const itens: T[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const params: Record<string, string | number> = cursor ? { ...extra, limite: 100, cursor } : { ...extra, limite: 100 };
      const p = paginaDe<T>((await http.get(caminho, { params })).data);
      itens.push(...p.itens);
      if (!p.temMais || !p.cursor) return itens;
      cursor = p.cursor;
    }
    throw new ApiError(502, 'PAGINACAO_EXCEDIDA', 'A listagem tem mais páginas do que esta tela consegue mostrar.');
  }

  /** Linhas da planilha entre analisar e confirmar: só na memória desta aba (têm CPF em claro; a API não as guarda). */
  const linhasImportacao = new Map<string, LinhaPlanilha[]>();

  return {
    modo: 'http',
    rotasDisponiveis: ROTAS_HTTP,
    suporta: (op) => OPERACOES_HTTP.has(op),
    aoEventoSessao: (cb) => cliente.aoEvento(cb),
    auth: {
      async login(i) {
        const { data } = await http.post('/auth/login', { login: i.login, senha: i.senha });
        const u = usuarioDe(data);
        cliente.sessaoAtiva();
        return u;
      },
      async logout() {
        cliente.sessaoEncerrada(); // antes da chamada: 401 de requisições em voo não viram "sessão expirada"
        try {
          await http.post('/auth/logout');
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 401)) throw e; // sem sessão: já está deslogado
        }
      },
      async me() {
        try {
          const { data } = await http.get('/auth/me');
          const u = usuarioDe(data);
          cliente.sessaoAtiva();
          return u;
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) return null; // sem sessão (ou expirada): tela de login
          throw e;
        }
      },
      async trocarSenha(i) {
        const { data } = await http.post('/auth/trocar-senha', { senhaAtual: i.senhaAtual, novaSenha: i.novaSenha });
        const u = usuarioDe(data);
        cliente.sessaoAtiva();
        return u;
      },
    },
    usuarios: {
      async listar() { return todasAsPaginas<UsuarioSistema>('/usuarios'); },
      async criar(i) { return comSenhaTemporaria((await http.post('/usuarios', { nome: i.nome, login: i.login, papel: i.papel })).data); },
      async desativar(u) { return dados<UsuarioSistema>((await http.post(`/usuarios/${id(u)}/desativar`)).data); },
      async reativar(u) { return dados<UsuarioSistema>((await http.post(`/usuarios/${id(u)}/reativar`)).data); },
      async redefinirAcesso(u) { return comSenhaTemporaria((await http.post(`/usuarios/${id(u)}/redefinir-senha`)).data); },
      async alterarPapel(u, papel) { return dados<UsuarioSistema>((await http.patch(`/usuarios/${id(u)}`, { papel })).data); },
    },
    // Busca: POST com o termo no corpo (pode ser CPF; a URL fica em logs de proxy fora do controle da API).
    busca: {
      async global(q) {
        const r = dados<ResultadoBuscaGlobal>((await http.post('/busca', { q })).data);
        if (!r || !Array.isArray(r.pessoas) || !Array.isArray(r.unidades)) throw respostaInvalida();
        return r;
      },
    },
    catalogo: {
      async obter() {
        const c = dados<{ unidades: Unidade[]; areasComuns: AreaComum[] }>((await http.get('/catalogo')).data);
        if (!c || !Array.isArray(c.unidades) || !Array.isArray(c.areasComuns)) throw respostaInvalida();
        return { unidades: c.unidades.map(unidadeDe), areasComuns: c.areasComuns };
      },
    },
    unidades: {
      async listar() { return todasAsPaginas<UnidadeResumo>('/unidades'); },
      async listarPagina(f = {}) {
        const params: Record<string, string | number> = { limite: f.limite ?? 50 };
        if (f.torre !== undefined) params.torre = f.torre;
        if (f.cursor) params.cursor = f.cursor;
        return paginaDe<UnidadeResumo>((await http.get('/unidades', { params })).data);
      },
      async detalhe(ref) {
        const d = dados<{ unidade: Unidade; veiculos: Veiculo[]; vinculos?: VinculoApi[] }>((await http.get(`/unidades/${id(ref)}`)).data);
        if (!d?.unidade || !Array.isArray(d.veiculos)) throw respostaInvalida();
        // Autorizações, restrições e eventos ainda não têm módulo na API: seção indisponível.
        const det: UnidadeDetalhe = {
          unidade: unidadeDe(d.unidade), veiculos: d.veiculos.map(veiculoDe),
          vinculos: Array.isArray(d.vinculos) ? d.vinculos.map(vinculoDe) : null, autorizacoes: null, restricoes: null, eventos: null,
        };
        return det;
      },
      async criar(i) { return unidadeDe(dados<Unidade>((await http.post('/unidades', { torre: i.torre, numero: i.numero })).data)); },
      async editar(i) { return unidadeDe(dados<Unidade>((await http.patch(`/unidades/${id(i.id)}`, { torre: i.torre, numero: i.numero })).data)); },
      async desativar(u) { return unidadeDe(dados<Unidade>((await http.post(`/unidades/${id(u)}/desativar`)).data)); },
      async reativar(u) { return unidadeDe(dados<Unidade>((await http.post(`/unidades/${id(u)}/reativar`)).data)); },
    },
    // Pessoas. Texto livre (pode ser CPF) só no CORPO de POST /pessoas/busca, nunca na URL.
    pessoas: {
      async buscar(q, o) {
        const r = dados<{ pessoas: PessoaBusca[] }>((await http.post('/pessoas/busca', { q, limite: o?.limite ?? 8, semMoradores: !!o?.semMoradores })).data);
        if (!r || !Array.isArray(r.pessoas)) throw respostaInvalida();
        return r.pessoas.map(pessoaDe);
      },
      async listar() { return (await todasAsPaginas<PessoaLista>('/pessoas')).map(pessoaDe); },
      async listarPagina(f = {}) {
        const params: Record<string, string | number> = { limite: f.limite ?? 50 };
        if (f.categoria) params.categoria = f.categoria;
        if (f.cursor) params.cursor = f.cursor;
        const p = paginaDe<PessoaLista>((await http.get('/pessoas', { params })).data);
        return { ...p, itens: p.itens.map(pessoaDe) };
      },
      async ficha(pid) {
        const f = dados<{ pessoa: PessoaApi; funcionario: FuncionarioApi | null; vinculos: VinculoApi[]; eventos: unknown[] | null }>((await http.get(`/pessoas/${id(pid)}`)).data);
        if (!f?.pessoa || !Array.isArray(f.vinculos)) throw respostaInvalida();
        const ficha: FichaPessoa = {
          pessoa: pessoaDe(f.pessoa), vinculos: f.vinculos.map(vinculoDe),
          ...(f.funcionario ? { funcionario: funcionarioBase(f.funcionario) } : {}),
          eventos: null, // módulo de eventos ainda não existe na API: a ficha mostra "disponível em breve"
        };
        return ficha;
      },
      async criar(i) {
        const corpo = semIndefinidos({
          nome: i.nome, telefone: i.telefone, categoria: i.categoria,
          documento: !i.semCpf && i.documento?.trim() ? i.documento : undefined,
          empresa: i.empresa?.trim() || undefined, servico: i.servico?.trim() || undefined,
          semCpf: i.semCpf ? true : undefined,
        });
        return pessoaDe(dados<PessoaApi>((await http.post('/pessoas', corpo)).data));
      },
      async editar({ id: pid, ...resto }) {
        return pessoaDe(dados<PessoaApi>((await http.patch(`/pessoas/${id(pid)}`, semIndefinidos(resto))).data));
      },
      async funcionario(pid) {
        try {
          return funcionarioBase(dados<FuncionarioApi>((await http.get(`/funcionarios/${id(pid)}`)).data));
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return null; // não é funcionário
          throw e;
        }
      },
    },
    funcionarios: {
      async listar() { return (await todasAsPaginas<FuncionarioApi>('/funcionarios')).map(funcionarioDe); },
      async criar(i) {
        return funcionarioDe(dados<FuncionarioApi>((await http.post('/funcionarios', semIndefinidos({
          nome: i.nome, documento: i.documento, telefone: i.telefone, funcao: i.funcao, escala: i.escala, ativo: i.ativo,
        }))).data));
      },
      async editar({ pessoaId, ...resto }) {
        return funcionarioDe(dados<FuncionarioApi>((await http.patch(`/funcionarios/${id(pessoaId)}`, semIndefinidos(resto))).data));
      },
    },
    veiculos: {
      async criar(i) {
        return veiculoDe(dados<Veiculo>((await http.post('/veiculos', { unidadeId: i.unidadeId, placa: i.placa, modelo: i.modelo, cor: i.cor })).data));
      },
      async editar({ id: vid, ...resto }) {
        return veiculoDe(dados<Veiculo>((await http.patch(`/veiculos/${id(vid)}`, semIndefinidos(resto))).data));
      },
    },
    vinculos: {
      async contar(status) {
        const r = dados<{ total: number }>((await http.get('/vinculos/contagem', { params: { status } })).data);
        if (typeof r?.total !== 'number') throw respostaInvalida();
        return r.total;
      },
      async listar(f) {
        return (await todasAsPaginas<VinculoApi>('/vinculos', f?.status ? { status: f.status } : {})).map(vinculoDe);
      },
      async listarPagina(f = {}) {
        const params: Record<string, string | number> = { limite: f.limite ?? 50 };
        if (f.status?.length) params.status = f.status.join(',');
        if (f.unidadeId) params.unidadeId = f.unidadeId;
        if (f.pessoaId) params.pessoaId = f.pessoaId;
        if (f.ordem) params.ordem = f.ordem;
        if (f.cursor) params.cursor = f.cursor;
        const p = paginaDe<VinculoApi>((await http.get('/vinculos', { params })).data);
        return { ...p, itens: p.itens.map(vinculoDe) };
      },
      async criar(i) {
        return vinculoDe(dados<VinculoApi>((await http.post('/vinculos', {
          pessoaId: i.pessoaId, unidadeId: i.unidadeId, tipo: i.tipo, vigenciaInicio: msParaDia(i.vigenciaInicio), vigenciaFim: msParaDia(i.vigenciaFim),
        })).data));
      },
      async registrarConferencia(vid, i) {
        return vinculoDe(dados<VinculoApi>((await http.post(`/vinculos/${id(vid)}/conferencias`, semIndefinidos({
          tipo: i.tipo, descricao: i.descricao, observacao: i.observacao, data: i.data !== undefined ? msParaDia(i.data) : undefined,
        }))).data));
      },
      async decidir({ id: vid, decisao, justificativa }) {
        const corpo = decisao === 'aprovar' ? {} : { justificativa: justificativa ?? '' };
        return vinculoDe(dados<VinculoApi>((await http.post(`/vinculos/${id(vid)}/${decisao === 'aprovar' ? 'aprovar' : 'rejeitar'}`, corpo)).data));
      },
      async regularizar(vid, opcoes) {
        const corpo = opcoes?.vigenciaFim !== undefined ? { vigenciaFim: msParaDia(opcoes.vigenciaFim) } : {};
        return vinculoDe(dados<VinculoApi>((await http.post(`/vinculos/${id(vid)}/regularizar`, corpo)).data));
      },
      async encerrar(vid, i) {
        return vinculoDe(dados<VinculoApi>((await http.post(`/vinculos/${id(vid)}/encerrar`, semIndefinidos({
          motivo: i.motivo, data: i.data !== undefined ? msParaDia(i.data) : undefined,
        }))).data));
      },
      async autorizadores(uid) {
        const r = dados<{ pessoa: PessoaApi; vinculo: VinculoApi }[]>((await http.get(`/unidades/${id(uid)}/autorizadores`)).data);
        if (!Array.isArray(r)) throw respostaInvalida();
        return r.map((a): Autorizador => ({ pessoa: pessoaDe(a.pessoa), vinculo: vinculoDe(a.vinculo) as VinculoUnidade }));
      },
    },
    autorizacoes: { criar: n(), revogar: n(), vigentes: n(), hoje: n() },
    restricoes: { verificar: n(), criar: n(), aprovar: n(), revogar: n(), pendentes: n() },
    eventos: { criar: n(), registrarRecusa: n(), registrarSaida: n(), corrigir: n(), listar: n(), obter: n(), presentes: n() },
    encomendas: { listar: n(), receber: n(), entregar: n(), autorizarRetirada: n() },
    ocorrencias: { listar: n(), criar: n(), alterarStatus: n() },
    turno: { resumo: n() },
    relatorios: { resumo: n(), exportarCsv: n() },
    auditoria: { verificarIntegridade: n(), alteracoes: n(), exportar: n() },
    lgpd: { exportarPessoa: n(), anonimizar: n(), aplicarRetencao: n() },
    importacao: {
      async analisar({ arquivo, linhas }) {
        const r = dados<RelatorioApi>((await http.post('/importacoes', { arquivo, linhas })).data);
        if (!r || typeof r.id !== 'string' || !Array.isArray(r.inconsistencias)) throw respostaInvalida();
        linhasImportacao.set(r.id, linhas);
        return { ...r, amostra: Array.isArray(r.amostra) ? r.amostra : [], prazoRegularizacao: diaParaMs(r.prazoRegularizacao)! };
      },
      async confirmar(iid) {
        const linhas = linhasImportacao.get(iid);
        if (!linhas) throw new ApiError(404, 'IMPORTACAO_NAO_ENCONTRADA', 'Análise de importação não encontrada. Envie o arquivo novamente.');
        const r = dados<ResultadoImportacaoApi>((await http.post(`/importacoes/${id(iid)}/confirmar`, { linhas })).data);
        if (typeof r?.importados !== 'number') throw respostaInvalida();
        linhasImportacao.delete(iid);
        return { ...r, prazoRegularizacao: diaParaMs(r.prazoRegularizacao)! };
      },
    },
  };
}
