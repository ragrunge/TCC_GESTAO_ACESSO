// Contrato da API. Os métodos espelham os endpoints da especificação técnica (seção 6).
// A UI só conhece esta interface; mock (em memória) e http (fetch) são trocáveis em src/api/index.ts.
import type {
  AutorizacaoPrevia, CategoriaPessoa, Encomenda, EventoView, MeioAutorizacao, Ocorrencia, Papel, Pessoa,
  RegistroAlteracao, Restricao, StatusOcorrencia, StatusVinculo, TipoEvento, TipoOcorrencia, TipoVinculo, Unidade,
  UsuarioSistema, ValoresCorrecao, VinculoUnidade, Veiculo, DocumentoVinculo, Funcionario,
} from '@portaria/domain/types';
import type { EstadoAutorizacao } from '@portaria/domain/rules';
import type { ResultadoIntegridade } from '@portaria/domain/hashChain';

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

export interface NovaPessoaInput {
  nome: string;
  /** CPF (só ele é aceito). Dispensado quando `semCpf`. */
  documento?: string;
  telefone: string;
  categoria: CategoriaPessoa; empresa?: string; servico?: string;
  /** Exceção "sem CPF": a pessoa só entra por exceção do porteiro. */
  semCpf?: boolean;
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
  /** Nº do formulário de papel: obrigatório quando `retroativo`. */
  formularioContingencia?: string | null;
}

/** UC02 A4: o morador recusou a visita (interfone ou morador presente). */
export interface NovaRecusaInput {
  pessoaId: string;
  unidadeDestinoId: string;
  meio: 'interfone' | 'morador_presente';
  moradorPessoaId: string;
  observacao?: string | null;
  retroativo?: boolean;
  ocorridoEm?: number | null;
  formularioContingencia?: string | null;
}

export interface OpcoesSaida {
  observacao?: string;
  retroativo?: boolean;
  /** Retroativo: hora real da saída (≥ entrada e < agora). */
  ocorridoEm?: number | null;
  formularioContingencia?: string | null;
}

export interface FiltroAlteracoes { de?: number; ate?: number; usuarioId?: string; acao?: string; entidade?: string }

export interface FiltroEventos {
  /** RF-32: restringe a um único evento (exportação isolada). */
  eventoId?: string;
  de?: number; ate?: number; unidadeId?: string; pessoa?: string; operadorId?: string;
  tipo?: TipoEvento; meio?: MeioAutorizacao; somenteExcecoes?: boolean; somenteRetroativos?: boolean;
}

export interface NovoVinculoInput {
  pessoaId: string; unidadeId: string; tipo: TipoVinculo; vigenciaInicio: number; vigenciaFim: number | null;
  /** Opcional: o vínculo não exige documento anexado (decisão de produto); a aprovação da administração continua obrigatória (RF-04). */
  documento?: DocumentoVinculo; solicitadoPor: string;
}

export interface NovaAutorizacaoInput {
  unidadeId: string; pessoaId: string; validaAte: number | null; validaDe?: number;
  diasSemana: number[] | null; horaInicio: string | null; horaFim: string | null;
  /** Morador que pediu. Sem ele, `justificativa` (≥ 15 caracteres) é obrigatória. */
  solicitadaPorPessoaId: string | null;
  justificativa?: string | null;
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

export interface NovoUsuarioInput { nome: string; login: string; papel: Papel }

export interface LinhaPlanilha { linha: number; torre: string; unidade: string; nome: string; documento: string; telefone: string; tipo?: string }

// ----- Saídas ---------------------------------------------------------------------------------
export interface PessoaBusca extends Pessoa { ultimoAcesso: string; unidadesVinculadas: string[] }

export interface VinculoView extends VinculoUnidade {
  pessoaNome: string; pessoaDocumento: string;
  /** Pessoa tem CPF e telefone (pré-requisito para aprovar o vínculo). */
  pessoaCadastroCompleto: boolean;
}

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
  excecoesHoje: number; restricoesPendentes: number;
}

export interface ResultadoRestricao { restrita: boolean; alertas: RestricaoView[] }

export interface PacoteExportacao { nomeArquivo: string; conteudo: string; quantidade: number }

/** Filtros dos relatórios (RF-30/RF-31). Sem `de`/`ate`: últimos 30 dias até hoje. `de`/`ate` são instantes; o servidor usa o dia inteiro. */
export interface FiltroRelatorio { de?: number; ate?: number; unidadeId?: string; categoria?: CategoriaPessoa; meio?: MeioAutorizacao }

export interface RelatorioResumo {
  /** Período efetivamente aplicado (início do primeiro dia, fim do último). */
  periodo: { de: number; ate: number };
  acessosPorDia: { dia: number; entradas: number }[];
  acessosPorMeio: { meio: MeioAutorizacao; total: number }[];
  /** Agrupado por operadorId (autorização sem solicitante conta para quem a cadastrou). */
  excecoesPorPorteiro: { operadorId: string; operador: string; total: number }[];
  encomendasPorIdade: { faixa: string; total: number }[];
  cadastroCompleto: { unidadesCompletas: number; total: number };
  totais: { entradas: number; negados: number; recusados: number; retroativos: number; excecoes: number };
}

export interface InconsistenciaImportacao { linha: number; codigo: string; mensagem: string; tipo: 'erro' | 'aviso' }
export interface RelatorioImportacao {
  id: string; arquivo: string; lidas: number; importaveis: number; rejeitadas: number; avisos: number;
  inconsistencias: InconsistenciaImportacao[]; amostra: LinhaPlanilha[]; prazoRegularizacao: number;
}
export interface ResultadoImportacao { importados: number; reaproveitados: number; prazoRegularizacao: number }

export interface Api {
  auth: {
    // 2FA fica para a fase de segurança (pós-MVP).
    login(i: LoginInput): Promise<UsuarioSistema>;
    logout(): Promise<void>;
    me(): Promise<UsuarioSistema | null>;
  };
  busca: { global(q: string): Promise<{ pessoas: PessoaBusca[]; unidades: { id: string; motivo: string }[] }> };
  pessoas: {
    /** `limite`: máximo de resultados (padrão 8). A portaria pede 9 para saber se há mais que 8. */
    buscar(q: string, opts?: { semMoradores?: boolean; limite?: number }): Promise<PessoaBusca[]>;
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
    /** `unidadeId` null: só restrições de escopo condomínio (funcionário sem unidade de destino). */
    verificar(pessoaId: string, unidadeId: string | null): Promise<ResultadoRestricao>;
    criar(i: NovaRestricaoInput): Promise<Restricao>;
    aprovar(id: string): Promise<Restricao>;
    revogar(id: string): Promise<void>;
    pendentes(): Promise<RestricaoView[]>;
  };
  eventos: {
    criar(i: NovoEventoInput): Promise<EventoView>;
    registrarRecusa(i: NovaRecusaInput): Promise<EventoView>;
    registrarSaida(entradaId: string, opcoes?: OpcoesSaida): Promise<EventoView>;
    corrigir(id: string, i: { justificativa: string; observacao?: string; valores?: Partial<ValoresCorrecao> }): Promise<EventoView>;
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
  relatorios: {
    /** Número = últimos N dias (atalho); objeto = filtros completos. */
    resumo(f?: number | FiltroRelatorio): Promise<RelatorioResumo>;
    /** Mesmo conteúdo do resumo, em CSV (UTF-8 com BOM, separador ;). */
    exportarCsv(f?: FiltroRelatorio): Promise<PacoteExportacao>;
  };
  auditoria: {
    verificarIntegridade(): Promise<ResultadoIntegridade>;
    /** Trilha de alterações do sistema (mais recentes primeiro). */
    alteracoes(f?: FiltroAlteracoes): Promise<RegistroAlteracao[]>;
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
