// Implementação HTTP da interface Api contra o backend NestJS (spec §5.1 e §6.1). Hoje cobre autenticação, sessão
// e usuários; os demais módulos lançam 501 até a API real tê-los (a UI mostra "disponível em breve").
// Formato REST (skill rest-api): todo 2xx com corpo vem em { data }; listas paginadas em
// { data: [...], pagination: { cursor, hasNextPage } }; 204 sem corpo.
import type { AxiosRequestConfig } from 'axios';
import type { UsuarioSistema } from '@portaria/domain/types';
import type { Rota } from '@portaria/domain/rbac';
import type { Api, UsuarioComSenhaTemporaria, UsuarioSessao } from '../types';
import { ApiError } from '../types';
import { criarCliente } from './cliente';

/** Rotas da UI com backend pronto. Atualizar a cada módulo novo implementado na API. */
export const ROTAS_HTTP: readonly Rota[] = ['usuarios'];

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
      const corpo = (await http.get<PaginaApi<T>>(caminho, { params })).data;
      if (!corpo || !Array.isArray(corpo.data) || !corpo.pagination) throw respostaInvalida();
      itens.push(...corpo.data);
      if (!corpo.pagination.hasNextPage || !corpo.pagination.cursor) return itens;
      cursor = corpo.pagination.cursor;
    }
    throw new ApiError(502, 'PAGINACAO_EXCEDIDA', 'A listagem tem mais páginas do que esta tela consegue mostrar.');
  }

  return {
    modo: 'http',
    rotasDisponiveis: ROTAS_HTTP,
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
    // Módulos ainda sem API real (spec §6): 501 local, sem ir à rede.
    busca: { global: n() },
    pessoas: { buscar: n(), listar: n(), ficha: n(), criar: n(), editar: n(), funcionario: n() },
    catalogo: { obter: n() },
    unidades: { listar: n(), detalhe: n(), criar: n(), editar: n(), desativar: n(), reativar: n() },
    funcionarios: { listar: n(), criar: n(), editar: n() },
    veiculos: { criar: n() },
    vinculos: { listar: n(), criar: n(), registrarConferencia: n(), decidir: n(), regularizar: n(), autorizadores: n() },
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
