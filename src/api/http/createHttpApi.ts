// Esqueleto da implementação HTTP: mostra o ponto de troca do mock pela API real (NestJS, spec seção 6).
// Cada método deve virar uma chamada fetch ao endpoint indicado; aqui apenas lançamos "não implementado".
import type { Api } from '../types';
import { ApiError } from '../types';

/** Chamada de exemplo já pronta: mapeia o formato de erro da spec ({ codigo, mensagem }) para ApiError. */
export async function requisitar<T>(base: string, caminho: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${base}${caminho}`, {
    ...init,
    credentials: 'include', // sessão por cookie HttpOnly (spec 5.1)
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!resp.ok) {
    const corpo = (await resp.json().catch(() => ({}))) as { codigo?: string; mensagem?: string; detalhes?: unknown };
    throw new ApiError(resp.status, corpo.codigo ?? 'ERRO_DESCONHECIDO', corpo.mensagem ?? 'Erro na requisição.', corpo.detalhes);
  }
  return (await resp.json()) as T;
}

const naoImplementado = (nome: string) => async (): Promise<never> => {
  throw new ApiError(501, 'NAO_IMPLEMENTADO', `Cliente HTTP ainda não implementado: ${nome}. Use VITE_API_MODE=mock.`);
};

export function createHttpApi(base: string): Api {
  void base;
  const n = naoImplementado;
  return {
    // POST /auth/login, POST /auth/totp/verificar, POST /auth/logout, GET /auth/me
    auth: { login: n('auth.login'), verificar2fa: n('auth.verificar2fa'), logout: n('auth.logout'), me: async () => null },
    busca: { global: n('busca.global') },
    // GET /pessoas?busca=, POST /pessoas
    pessoas: { buscar: n('pessoas.buscar'), listar: n('pessoas.listar'), ficha: n('pessoas.ficha'), criar: n('pessoas.criar'), funcionario: n('pessoas.funcionario') },
    // GET /unidades
    unidades: { listar: n('unidades.listar'), detalhe: n('unidades.detalhe') },
    veiculos: { criar: n('veiculos.criar') },
    // GET /vinculos, POST /vinculos, POST /vinculos/:id/aprovar|rejeitar
    vinculos: { listar: n('vinculos.listar'), criar: n('vinculos.criar'), decidir: n('vinculos.decidir'), autorizadores: n('vinculos.autorizadores') },
    // GET/POST /autorizacoes-previas, GET /autorizacoes-previas/vigentes
    autorizacoes: { criar: n('autorizacoes.criar'), revogar: n('autorizacoes.revogar'), vigentes: n('autorizacoes.vigentes'), hoje: n('autorizacoes.hoje') },
    // GET /restricoes/verificar, GET/POST /restricoes, POST /restricoes/:id/aprovar
    restricoes: { verificar: n('restricoes.verificar'), criar: n('restricoes.criar'), aprovar: n('restricoes.aprovar'), revogar: n('restricoes.revogar'), pendentes: n('restricoes.pendentes') },
    // POST /eventos-acesso, GET /eventos-acesso, POST /eventos-acesso/:id/correcoes, GET /acessos/presentes
    eventos: { criar: n('eventos.criar'), registrarSaida: n('eventos.registrarSaida'), corrigir: n('eventos.corrigir'), listar: n('eventos.listar'), obter: n('eventos.obter'), presentes: n('eventos.presentes') },
    // POST /encomendas, GET /encomendas, POST /encomendas/:id/retirada
    encomendas: { listar: n('encomendas.listar'), receber: n('encomendas.receber'), entregar: n('encomendas.entregar') },
    // POST /ocorrencias, GET /ocorrencias, PATCH /ocorrencias/:id
    ocorrencias: { listar: n('ocorrencias.listar'), criar: n('ocorrencias.criar'), alterarStatus: n('ocorrencias.alterarStatus') },
    turno: { resumo: n('turno.resumo') },
    relatorios: { resumo: n('relatorios.resumo') },
    // GET /auditoria/integridade, POST /auditoria/exportacoes
    auditoria: { verificarIntegridade: n('auditoria.verificarIntegridade'), exportar: n('auditoria.exportar') },
    usuarios: { listar: n('usuarios.listar'), criar: n('usuarios.criar'), desativar: n('usuarios.desativar'), reativar: n('usuarios.reativar'), redefinirAcesso: n('usuarios.redefinirAcesso') },
    // POST /importacoes/planilha, POST /importacoes/:id/confirmar
    importacao: { analisar: n('importacao.analisar'), confirmar: n('importacao.confirmar') },
  };
}
