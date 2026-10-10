// Matriz RBAC (spec seção 5.2). É aplicada no "servidor" (mock/HTTP); a UI apenas oculta o que o papel não pode.
import type { Papel } from './types';

export type Acao =
  | 'unidade.ver' | 'unidade.editar'
  | 'pessoa.ver' | 'pessoa.cadastrar_externo' | 'pessoa.cadastrar_morador'
  | 'vinculo.ver' | 'vinculo.criar' | 'vinculo.decidir'
  | 'importacao.executar'
  | 'autorizacao.criar' | 'restricao.criar' | 'restricao.aprovar'
  | 'evento.registrar' | 'evento.retroativo' | 'evento.corrigir' | 'evento.ver'
  | 'encomenda.ver' | 'encomenda.operar'
  | 'ocorrencia.ver' | 'ocorrencia.operar'
  | 'relatorio.ver' | 'turno.ver'
  | 'auditoria.verificar' | 'auditoria.exportar'
  | 'usuario.gerenciar'
  | 'veiculo.cadastrar';

const SI: Papel = 'sindico', AD: Papel = 'administracao', PO: Papel = 'porteiro', AU: Papel = 'auditor';

export const MATRIZ: Record<Acao, Papel[]> = {
  'unidade.ver': [SI, AD, PO, AU],
  'unidade.editar': [SI, AD],
  'pessoa.ver': [SI, AD, PO, AU],
  'pessoa.cadastrar_externo': [SI, AD, PO],
  'pessoa.cadastrar_morador': [SI, AD],
  'vinculo.ver': [SI, AD, AU],
  'vinculo.criar': [SI, AD], // RN-03: porteiro não cria vínculo
  'vinculo.decidir': [SI, AD], // RN-03
  'importacao.executar': [SI, AD],
  'autorizacao.criar': [SI, AD, PO],
  'restricao.criar': [SI, AD, PO],
  'restricao.aprovar': [SI], // RN-06: só o síndico
  'evento.registrar': [SI, AD, PO],
  'evento.retroativo': [SI, AD, PO],
  'evento.corrigir': [SI, AD],
  'evento.ver': [SI, AD, PO, AU],
  'encomenda.ver': [SI, AD, PO, AU],
  'encomenda.operar': [SI, AD, PO],
  'ocorrencia.ver': [SI, AD, PO, AU],
  'ocorrencia.operar': [SI, AD, PO],
  'relatorio.ver': [SI, AD, AU],
  'turno.ver': [SI, AD, PO],
  'auditoria.verificar': [SI, AD, AU],
  'auditoria.exportar': [SI, AD, AU],
  'usuario.gerenciar': [SI], // decisão do produto: somente síndico
  'veiculo.cadastrar': [SI, AD],
};

export const pode = (papel: Papel | undefined, acao: Acao): boolean => !!papel && MATRIZ[acao].includes(papel);

/** Papéis que exigem segundo fator no login de demonstração. */
export const exige2faNoLogin = (papel: Papel) => papel === 'sindico' || papel === 'administracao';
/** Perfis diferentes de porteiro devem ter 2FA ativo no cadastro. */
export const exigeTotpNoCadastro = (papel: Papel) => papel !== 'porteiro';

export type Rota =
  | 'painel' | 'entrada' | 'pessoas' | 'encomendas' | 'ocorrencias'
  | 'unidades' | 'vinculos' | 'cadastro' | 'importar'
  | 'historico' | 'relatorios' | 'usuarios';

/** Quais papéis acessam cada rota. */
export const ROTAS: Record<Rota, Papel[]> = {
  painel: [SI, AD, PO],
  entrada: [SI, AD, PO],
  pessoas: [SI, AD, PO, AU],
  encomendas: [SI, AD, PO, AU],
  ocorrencias: [SI, AD, PO, AU],
  unidades: [SI, AD, PO, AU],
  vinculos: [SI, AD],
  cadastro: [SI, AD, AU],
  importar: [SI, AD],
  historico: [SI, AD, PO, AU],
  relatorios: [SI, AD, AU],
  usuarios: [SI],
};

export const rotaInicial = (papel: Papel): Rota =>
  papel === 'auditor' ? 'historico' : papel === 'administracao' ? 'vinculos' : 'painel';
