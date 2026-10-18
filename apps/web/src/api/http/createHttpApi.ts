// Implementação HTTP da interface Api contra o backend NestJS (spec §5.1 e §6). Hoje cobre autenticação, sessão,
// usuários, unidades, catálogo, busca de pessoas e a contagem de vínculos; os demais módulos lançam 501 até a API
// real tê-los (a UI mostra "disponível em breve").
// Formato REST (skill rest-api): todo 2xx com corpo vem em { data }; listas paginadas em
// { data: [...], pagination: { cursor, hasNextPage } }; 204 sem corpo.
import type { AxiosRequestConfig } from 'axios';
import type { AreaComum, Unidade, UsuarioSistema, Veiculo } from '@portaria/domain/types';
import type { Rota } from '@portaria/domain/rbac';
import type { Api, Pagina, PessoaBusca, ResultadoBuscaGlobal, UnidadeDetalhe, UnidadeResumo, UsuarioComSenhaTemporaria, UsuarioSessao } from '../types';
import { ApiError } from '../types';
import { criarCliente } from './cliente';

/** Rotas da UI com backend pronto. Atualizar a cada módulo novo implementado na API. */
export const ROTAS_HTTP: readonly Rota[] = ['usuarios', 'unidades'];

/** Operações com backend pronto, para a UI esconder as ações que dariam 501 (`api.suporta`). */
export const OPERACOES_HTTP: ReadonlySet<string> = new Set([
  'auth.login', 'auth.logout', 'auth.me', 'auth.trocarSenha',
  'usuarios.listar', 'usuarios.criar', 'usuarios.desativar', 'usuarios.reativar', 'usuarios.redefinirAcesso', 'usuarios.alterarPapel',
  'busca.global', 'pessoas.buscar', 'catalogo.obter', 'vinculos.contar',
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
  async function todasAsPaginas<T>(caminho: string): Promise<T[]> {
    const itens: T[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const params: Record<string, string | number> = cursor ? { limite: 100, cursor } : { limite: 100 };
      const p = paginaDe<T>((await http.get(caminho, { params })).data);
      itens.push(...p.itens);
      if (!p.temMais || !p.cursor) return itens;
      cursor = p.cursor;
    }
    throw new ApiError(502, 'PAGINACAO_EXCEDIDA', 'A listagem tem mais páginas do que esta tela consegue mostrar.');
  }

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
        const d = dados<{ unidade: Unidade; veiculos: Veiculo[] }>((await http.get(`/unidades/${id(ref)}`)).data);
        if (!d?.unidade || !Array.isArray(d.veiculos)) throw respostaInvalida();
        // Vínculos completos, autorizações, restrições e eventos ainda não têm módulo na API: seção indisponível.
        const det: UnidadeDetalhe = { unidade: unidadeDe(d.unidade), veiculos: d.veiculos, vinculos: null, autorizacoes: null, restricoes: null, eventos: null };
        return det;
      },
      async criar(i) { return unidadeDe(dados<Unidade>((await http.post('/unidades', { torre: i.torre, numero: i.numero })).data)); },
      async editar(i) { return unidadeDe(dados<Unidade>((await http.patch(`/unidades/${id(i.id)}`, { torre: i.torre, numero: i.numero })).data)); },
      async desativar(u) { return unidadeDe(dados<Unidade>((await http.post(`/unidades/${id(u)}/desativar`)).data)); },
      async reativar(u) { return unidadeDe(dados<Unidade>((await http.post(`/unidades/${id(u)}/reativar`)).data)); },
    },
    // Pessoas: só a busca (leitura). O cadastro chega no próximo lote.
    pessoas: {
      async buscar(q, o) {
        const r = dados<{ pessoas: PessoaBusca[] }>((await http.post('/pessoas/busca', { q, limite: o?.limite ?? 8, semMoradores: !!o?.semMoradores })).data);
        if (!r || !Array.isArray(r.pessoas)) throw respostaInvalida();
        return r.pessoas;
      },
      listar: n(), ficha: n(), criar: n(), editar: n(), funcionario: n(),
    },
    // Módulos ainda sem API real (spec §6): 501 local, sem ir à rede.
    funcionarios: { listar: n(), criar: n(), editar: n() },
    veiculos: { criar: n() },
    vinculos: {
      async contar(status) {
        const r = dados<{ total: number }>((await http.get('/vinculos/contagem', { params: { status } })).data);
        if (typeof r?.total !== 'number') throw respostaInvalida();
        return r.total;
      },
      listar: n(), criar: n(), registrarConferencia: n(), decidir: n(), regularizar: n(), autorizadores: n(),
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
    importacao: { analisar: n(), confirmar: n() },
  };
}
