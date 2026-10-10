// Contrato da API. Os métodos espelham os endpoints da especificação técnica (seção 6).
// A UI só conhece esta interface; mock (em memória) e http (fetch) são trocáveis em src/api/index.ts.
import type {
  AutorizacaoPrevia, CategoriaPessoa, Encomenda, EventoView, MeioAutorizacao, Ocorrencia, Papel, Pessoa,
  Restricao, StatusOcorrencia, StatusVinculo, TipoDocumento, TipoOcorrencia, TipoVinculo, Unidade,
  UsuarioSistema, VinculoUnidade, Veiculo, DocumentoVinculo, Funcionario,
} from '../domain/types';
import type { EstadoAutorizacao } from '../domain/rules';
import type { ResultadoIntegridade } from '../domain/hashChain';

/** Erro de API no formato da spec: status HTTP + código estável + mensagem para o operador. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public detalhes?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}
export const ehApiError = (e: unknown): e is ApiError => e instanceof ApiError;

// ----- Entradas -------------------------------------------------------------------------------
export interface LoginInput { login: string; senha: string }
export interface LoginResultado { requer2fa: boolean; usuario?: UsuarioSistema }

export interface NovaPessoaInput {
  nome: string; documentoTipo: TipoDocumento; documento: string; telefone?: string;
  categoria: CategoriaPessoa; empresa?: string; servico?: string;
}

export interface NovoEventoInput {
  pessoaId: string;
  unidadeDestinoId: string | null;
  autorizadoPorTipo?: MeioAutorizacao | null;
  autorizadoPorPessoaId?: string | null;
  autorizadoPorNome?: string | null;
  autorizacaoPreviaId?: string | null;
  justificativa?: string | null;
  retroativo?: boolean;
  /** Obrigatório no retroativo: data/hora reais do acesso. O servidor define registradoEm. */
  ocorridoEm?: number | null;
  observacao?: string | null;
}

export interface FiltroEventos {
  de?: number; ate?: number; unidadeId?: string; pessoa?: string; operadorId?: string;
  tipo?: 'entrada' | 'saida' | 'negado' | 'correcao'; meio?: MeioAutorizacao; somenteExcecoes?: boolean; somenteRetroativos?: boolean;
}

export interface NovoVinculoInput {
  pessoaId: string; unidadeId: string; tipo: TipoVinculo; vigenciaInicio: number; vigenciaFim: number | null;
  documento: DocumentoVinculo; solicitadoPor: string;
}

export interface NovaAutorizacaoInput {
  unidadeId: string; pessoaId: string; validaAte: number | null; validaDe?: number;
  diasSemana: number[] | null; horaInicio: string | null; horaFim: string | null;
  solicitadaPorPessoaId: string | null;
}

export interface NovaRestricaoInput {
  pessoaId: string; unidadeId: string; motivo: string; validaAte: number | null;
  solicitadaPorNome: string; paraTodoCondominio?: boolean;
}

export interface NovaEncomendaInput {
  unidadeId: string; destinatario: string; transportadora: string; codigoRastreio: string; unidadeConfirmada: boolean;
}

export interface NovaOcorrenciaInput {
  tipo: TipoOcorrencia; descricao: string; unidadeId: string | null; envolvidos: string;
  anexos?: string[]; eventoIds?: string[];
}

export interface NovoUsuarioInput { nome: string; login: string; papel: Papel; totpAtivo?: boolean }

export interface LinhaPlanilha { linha: number; torre: string; unidade: string; nome: string; documento: string; telefone: string; tipo?: string }

// ----- Saídas ---------------------------------------------------------------------------------
export interface PessoaBusca extends Pessoa { ultimoAcesso: string; unidadesVinculadas: string[] }

export interface VinculoView extends VinculoUnidade { pessoaNome: string; pessoaDocumento: string }

export interface AutorizacaoView extends AutorizacaoPrevia {
  pessoaNome: string; estado: EstadoAutorizacao; unidadeRotulo: string; utilizadaEm: number | null;
}
export interface RestricaoView extends Restricao { pessoaNome: string; pendente: boolean }

export interface UnidadeResumo {
  unidade: Unidade; moradoresValidos: number; pendentes: number; restricoes: number; cadastroCompleto: boolean;
}
export interface UnidadeDetalhe {
  unidade: Unidade;
  vinculos: VinculoView[];
  veiculos: Veiculo[];
  autorizacoes: AutorizacaoView[];
  restricoes: RestricaoView[];
  eventos: EventoView[];
}
export interface Autorizador { pessoa: Pessoa; vinculo: VinculoUnidade }

export interface FichaPessoa { pessoa: Pessoa; funcionario?: Funcionario; vinculos: VinculoView[]; eventos: EventoView[] }

export interface ResumoTurno {
  pessoasDentro: number; encomendasPendentes: number; ocorrenciasAbertas: number; autorizacoesHoje: number;
  excecoesNoTurno: number; restricoesPendentes: number;
}

export interface ResultadoRestricao { restrita: boolean; alertas: RestricaoView[] }

export interface PacoteExportacao { nomeArquivo: string; conteudo: string; quantidade: number }

export interface RelatorioResumo {
  acessosPorDia: { dia: number; entradas: number }[];
  acessosPorMeio: { meio: MeioAutorizacao; total: number }[];
  excecoesPorPorteiro: { operador: string; total: number }[];
  encomendasPorIdade: { faixa: string; total: number }[];
  cadastroCompleto: { unidadesCompletas: number; total: number };
  totais: { entradas: number; negados: number; retroativos: number; excecoes: number };
}

export interface InconsistenciaImportacao { linha: number; codigo: string; mensagem: string; tipo: 'erro' | 'aviso' }
export interface RelatorioImportacao {
  id: string; arquivo: string; lidas: number; importaveis: number; rejeitadas: number; avisos: number;
  inconsistencias: InconsistenciaImportacao[]; amostra: LinhaPlanilha[]; prazoRegularizacao: number;
}
export interface ResultadoImportacao { importados: number; reaproveitados: number; prazoRegularizacao: number }

export interface Api {
  auth: {
    login(i: LoginInput): Promise<LoginResultado>;
    verificar2fa(codigo: string): Promise<UsuarioSistema>;
    logout(): Promise<void>;
    me(): Promise<UsuarioSistema | null>;
  };
  busca: { global(q: string): Promise<{ pessoas: PessoaBusca[]; unidades: { id: string; motivo: string }[] }> };
  pessoas: {
    buscar(q: string, opts?: { semMoradores?: boolean }): Promise<PessoaBusca[]>;
    listar(): Promise<PessoaBusca[]>;
    ficha(id: string): Promise<FichaPessoa>;
    criar(i: NovaPessoaInput): Promise<Pessoa>;
    funcionario(pessoaId: string): Promise<Funcionario | null>;
  };
  unidades: { listar(): Promise<UnidadeResumo[]>; detalhe(id: string): Promise<UnidadeDetalhe> };
  veiculos: { criar(i: { unidadeId: string; placa: string; modelo: string; cor: string }): Promise<Veiculo> };
  vinculos: {
    listar(f?: { status?: StatusVinculo }): Promise<VinculoView[]>;
    criar(i: NovoVinculoInput): Promise<VinculoUnidade>;
    decidir(i: { id: string; decisao: 'aprovar' | 'rejeitar'; justificativa?: string }): Promise<VinculoUnidade>;
    autorizadores(unidadeId: string): Promise<Autorizador[]>;
  };
  autorizacoes: {
    criar(i: NovaAutorizacaoInput): Promise<AutorizacaoPrevia>;
    revogar(id: string): Promise<void>;
    vigentes(pessoaId: string, unidadeId: string): Promise<AutorizacaoView[]>;
    hoje(): Promise<AutorizacaoView[]>;
  };
  restricoes: {
    verificar(pessoaId: string, unidadeId: string): Promise<ResultadoRestricao>;
    criar(i: NovaRestricaoInput): Promise<Restricao>;
    aprovar(id: string): Promise<Restricao>;
    revogar(id: string): Promise<void>;
    pendentes(): Promise<RestricaoView[]>;
  };
  eventos: {
    criar(i: NovoEventoInput): Promise<EventoView>;
    registrarSaida(entradaId: string, observacao?: string): Promise<EventoView>;
    corrigir(id: string, i: { justificativa: string; observacao?: string }): Promise<EventoView>;
    listar(f?: FiltroEventos): Promise<EventoView[]>;
    obter(id: string): Promise<EventoView>;
    presentes(): Promise<EventoView[]>;
  };
  encomendas: {
    listar(f?: { status?: 'aguardando' | 'entregue' }): Promise<Encomenda[]>;
    receber(i: NovaEncomendaInput): Promise<Encomenda>;
    entregar(i: { id: string; pessoaId: string }): Promise<Encomenda>;
  };
  ocorrencias: {
    listar(): Promise<Ocorrencia[]>;
    criar(i: NovaOcorrenciaInput): Promise<Ocorrencia>;
    alterarStatus(id: string, status: StatusOcorrencia): Promise<Ocorrencia>;
  };
  turno: { resumo(): Promise<ResumoTurno> };
  relatorios: { resumo(dias?: number): Promise<RelatorioResumo> };
  auditoria: {
    verificarIntegridade(): Promise<ResultadoIntegridade>;
    exportar(f?: FiltroEventos): Promise<PacoteExportacao>;
  };
  usuarios: {
    listar(): Promise<UsuarioSistema[]>;
    criar(i: NovoUsuarioInput): Promise<UsuarioSistema>;
    desativar(id: string): Promise<UsuarioSistema>;
    reativar(id: string): Promise<UsuarioSistema>;
    redefinirAcesso(id: string): Promise<UsuarioSistema>;
  };
  importacao: {
    analisar(i: { arquivo: string; linhas: LinhaPlanilha[] }): Promise<RelatorioImportacao>;
    confirmar(id: string): Promise<ResultadoImportacao>;
  };
  /** Disponível apenas no mock. */
  demo?: { restaurar(): Promise<void> };
}
