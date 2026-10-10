// Tipos de domínio. Espelham as tabelas da especificação técnica (seção 3).
// Convenção: nomes do domínio em português (EventoAcesso, VinculoUnidade...), campos em camelCase.
// Todos os instantes são epoch em milissegundos (UTC); a exibição usa o fuso de São Paulo.

export type Papel = 'sindico' | 'administracao' | 'porteiro' | 'auditor';
export const ROTULO_PAPEL: Record<Papel, string> = {
  sindico: 'Síndico', administracao: 'Administração', porteiro: 'Porteiro', auditor: 'Auditor',
};

export type CategoriaPessoa = 'morador' | 'visitante' | 'prestador' | 'funcionario';
export const ROTULO_CATEGORIA: Record<CategoriaPessoa, string> = {
  morador: 'Morador', visitante: 'Visitante', prestador: 'Prestador', funcionario: 'Funcionário',
};
export type TipoDocumento = 'cpf' | 'rg' | 'cnh' | 'passaporte' | 'outro';

export interface Unidade {
  id: string; // "T4-32"
  torre: number;
  numero: string;
  ativo: boolean;
}

export interface Pessoa {
  id: string;
  nome: string;
  documentoTipo: TipoDocumento;
  /** Sempre mascarado (ex.: ***.456.789-**). O mock nunca guarda número completo. */
  documentoMascarado: string;
  telefone?: string;
  categoria: CategoriaPessoa;
  empresa?: string;
  servico?: string;
  criadoEm: number;
}

export interface Funcionario {
  pessoaId: string;
  funcao: string;
  escala: { diasSemana: number[]; horaInicio: string; horaFim: string };
  ativo: boolean;
}

export type TipoVinculo = 'proprietario' | 'inquilino' | 'dependente';
export const ROTULO_VINCULO: Record<TipoVinculo, string> = {
  proprietario: 'Proprietário', inquilino: 'Inquilino', dependente: 'Dependente',
};
export type StatusVinculo = 'pendente' | 'aprovado' | 'rejeitado' | 'encerrado' | 'legado';
export const ROTULO_STATUS_VINCULO: Record<StatusVinculo, string> = {
  pendente: 'Pendente', aprovado: 'Aprovado', rejeitado: 'Rejeitado', encerrado: 'Encerrado', legado: 'Legado',
};

export interface Conferencia { ok: boolean; rotulo: string; detalhe: string }
export interface DocumentoVinculo { titulo: string; linhas: [string, string][] }

export interface VinculoUnidade {
  id: string;
  pessoaId: string;
  unidadeId: string;
  tipo: TipoVinculo;
  status: StatusVinculo;
  vigenciaInicio: number | null;
  vigenciaFim: number | null; // null = indeterminada
  prazoRegularizacao: number | null; // obrigatório se legado (RN-09)
  documento?: DocumentoVinculo;
  conferencias: Conferencia[];
  solicitadoPor: string;
  solicitadoEm: number;
  nota?: string;
  decididoPorId?: string;
  decididoPorNome?: string;
  decididoEm?: number;
  justificativa?: string;
}

export interface Veiculo { id: string; unidadeId: string; placa: string; modelo: string; cor: string }

export interface AutorizacaoPrevia {
  id: string;
  unidadeId: string;
  pessoaId: string;
  validaDe: number;
  validaAte: number; // obrigatória (RN-07)
  diasSemana: number[] | null; // 0 = domingo ... 6 = sábado; null = todos
  horaInicio: string | null; // "HH:MM"
  horaFim: string | null;
  cadastradaPorNome: string;
  solicitadaPorPessoaId: string | null; // morador que pediu
  solicitadaPorNome: string;
  revogadaEm: number | null;
}

export interface Restricao {
  id: string;
  escopo: 'unidade' | 'condominio';
  unidadeId: string | null; // unidade de origem do pedido (obrigatória se escopo = unidade)
  pessoaId: string;
  motivo: string;
  validaAte: number;
  cadastradaPorNome: string;
  cadastradaEm: number;
  solicitadaPorNome: string;
  aprovadaPorNome: string | null; // escopo condomínio exige síndico (RN-06)
  aprovadaEm: number | null;
  revogadaEm: number | null;
}

export type TipoEvento = 'entrada' | 'saida' | 'negado' | 'correcao';
export type MeioAutorizacao = 'interfone' | 'morador_presente' | 'autorizacao_previa' | 'excecao_porteiro' | 'escala';
export const ROTULO_MEIO: Record<MeioAutorizacao, string> = {
  interfone: 'Interfone',
  morador_presente: 'Morador presente na portaria',
  autorizacao_previa: 'Autorização prévia',
  excecao_porteiro: 'Exceção do porteiro',
  escala: 'Escala',
};
export const ROTULO_MEIO_CURTO: Record<MeioAutorizacao, string> = {
  interfone: 'Interfone', morador_presente: 'Morador presente', autorizacao_previa: 'Autorização prévia',
  excecao_porteiro: 'Exceção', escala: 'Escala',
};

/** Evento de acesso: APPEND-ONLY. Nunca é alterado; saída e correção são novos eventos. */
export interface EventoAcesso {
  id: string;
  seq: number;
  codigo: string; // EV-2026-00xxxx
  tipo: TipoEvento;
  categoriaPessoa: CategoriaPessoa;
  pessoaId: string;
  unidadeDestinoId: string | null;
  pontoAcesso: string;
  autorizadoPorTipo: MeioAutorizacao | null;
  autorizadoPorPessoaId: string | null;
  autorizadoPorNome: string | null;
  autorizacaoPreviaId: string | null;
  justificativa: string | null;
  restricaoId: string | null;
  operadorId: string;
  ocorridoEm: number;
  registradoEm: number;
  retroativo: boolean;
  /** Saída aponta para a entrada. */
  refereEventoId: string | null;
  /** Correção aponta para o evento corrigido (RN-04). */
  corrigeEventoId: string | null;
  observacao: string | null;
  hashAnterior: string;
  hash: string;
}

/** Evento com nomes resolvidos para exibição (a trilha guarda apenas IDs). */
export interface EventoView extends EventoAcesso {
  pessoaNome: string;
  operadorNome: string;
  unidadeRotulo: string | null;
  /** Para entradas: a saída vinculada, se houver. */
  saida: { id: string; codigo: string; em: number } | null;
  /** Para entradas sem saída ainda. */
  dentro: boolean;
  /** Para saídas: código da entrada. */
  entradaCodigo: string | null;
}

export interface Encomenda {
  id: string;
  codigo: string;
  unidadeId: string;
  destinatario: string;
  transportadora: string;
  codigoRastreio: string;
  recebidaPorNome: string;
  recebidaEm: number;
  unidadeConfirmada: boolean;
  retiradaEm: number | null;
  retiradaPorPessoaId: string | null;
  retiradaPorNome: string | null;
  retiradaRegistradaPorNome: string | null;
}

export type TipoOcorrencia = 'conflito' | 'tentativa_acesso_indevido' | 'dano' | 'encomenda' | 'outro';
export const ROTULO_TIPO_OCORRENCIA: Record<TipoOcorrencia, string> = {
  conflito: 'Conflito', tentativa_acesso_indevido: 'Tentativa de acesso indevido', dano: 'Dano',
  encomenda: 'Encomenda', outro: 'Outro',
};
export type StatusOcorrencia = 'aberta' | 'em_andamento' | 'encerrada';
export const ROTULO_STATUS_OCORRENCIA: Record<StatusOcorrencia, string> = {
  aberta: 'Aberta', em_andamento: 'Em análise', encerrada: 'Encerrada',
};

export interface Ocorrencia {
  id: string;
  codigo: string; // OC-2026-047
  tipo: TipoOcorrencia;
  descricao: string;
  unidadeId: string | null; // null = área comum
  envolvidos: string;
  abertaPorNome: string;
  abertaEm: number;
  status: StatusOcorrencia;
  anexos: string[];
  eventoIds: string[];
}

export interface UsuarioSistema {
  id: string;
  nome: string;
  login: string;
  papel: Papel;
  ativo: boolean;
  ultimoAcesso: number | null;
  totpAtivo: boolean;
}

