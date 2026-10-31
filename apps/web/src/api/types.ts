// Contrato da API. Os métodos espelham os endpoints da especificação técnica (seção 6).
// A UI só conhece esta interface; a implementação é o cliente HTTP (src/api/http), criado em src/api/index.tsx.
import type {
  AreaComum, AutorizacaoPrevia, AutorizacaoRetirada, CategoriaPessoa, Encomenda, Escala, EventoView, MeioAutorizacao, Ocorrencia,
  Papel, Pessoa, RegistroAlteracao, Restricao, StatusOcorrencia, StatusVinculo, TipoEvento, TipoOcorrencia, TipoVinculo, Unidade,
  UsuarioSistema, ValoresCorrecao, VinculoUnidade, Veiculo, TipoComprovante, Funcionario, MudancaStatusOcorrencia,
} from '@portaria/domain/types';
import type { PermanenciaView, TipoVisita, VeiculoAcesso } from '@portaria/domain/types';
import type { EstadoAutorizacao, MeioComMorador } from '@portaria/domain/rules';
import type { ResultadoIntegridade } from '@portaria/domain/hashChain';
import type { Agrupamento } from '@portaria/domain/units';

/** Erro de API no formato da spec: status HTTP + código estável + mensagem para o operador. */
export class ApiError extends Error {
  /** 429: segundos até poder tentar de novo (cabeçalho Retry-After), quando a API informa. */
  public retryAfterSegundos?: number;
  constructor(public status: number, public code: string, message: string, public detalhes?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}
export const ehApiError = (e: unknown): e is ApiError => e instanceof ApiError;

// ----- Entradas -------------------------------------------------------------------------------
export interface LoginInput {
  login: string;
  senha: string;
  /** "Manter conectado neste computador" (sessão longa). A API ignora para o porteiro. */
  manterConectado?: boolean;
}
export interface TrocarSenhaInput { senhaAtual: string; novaSenha: string }

export interface NovaPessoaInput {
  nome: string;
  /** CPF (só ele é aceito). Dispensado quando `semCpf` ou `menorIdade`. */
  documento?: string;
  /** Obrigatório, salvo `menorIdade`. */
  telefone: string;
  categoria: CategoriaPessoa; empresa?: string; servico?: string;
  /** Exceção "sem CPF": a pessoa só entra por exceção do porteiro. */
  semCpf?: boolean;
  /** Dependente menor de idade (LGPD art. 14): CPF e telefone opcionais; só morador. */
  menorIdade?: boolean;
}

/** RN-09/art. 18: completar ou corrigir o cadastro. Campos ausentes não mudam. CPF informado tira a pessoa de "sem CPF". */
export interface EditarPessoaInput {
  id: string; nome?: string; telefone?: string; documento?: string; empresa?: string | null; servico?: string | null;
  /** false: deixou de ser menor (a API exige CPF e telefone). */
  menorIdade?: boolean;
}

export interface NovoEventoInput {
  pessoaId: string;
  /** Destino: unidade OU área comum (área comum só para prestador, RF-36). */
  unidadeDestinoId: string | null;
  areaComumId?: string | null;
  autorizadoPorTipo?: MeioAutorizacao | null;
  autorizadoPorPessoaId?: string | null;
  autorizacaoPreviaId?: string | null;
  justificativa?: string | null;
  retroativo?: boolean;
  /** Obrigatório no retroativo: data/hora reais do acesso. O servidor define registradoEm. */
  ocorridoEm?: number | null;
  observacao?: string | null;
  /** Nº do formulário de papel: obrigatório quando `retroativo`. */
  formularioContingencia?: string | null;
  /** Prazo de permanência: só visitante/prestador (padrão no servidor: visita / serviço). */
  tipoVisita?: TipoVisita | null;
  /** Veículo com que a pessoa chegou (nulo/ausente = a pé). Placa obrigatória; modelo e cor opcionais. */
  veiculo?: { placa: string; modelo?: string | null; cor?: string | null } | null;
}

/** UC02 A4: o morador recusou a visita (interfone, celular ou morador presente). */
export interface NovaRecusaInput {
  pessoaId: string;
  unidadeDestinoId: string;
  meio: MeioComMorador;
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
/** Uma página da trilha de alterações (mais recentes primeiro). */
export interface FiltroAlteracoesPagina extends FiltroAlteracoes { cursor?: string | null; limite?: number }

export interface FiltroEventos {
  /** RF-32: restringe a um único evento (exportação isolada). */
  eventoId?: string;
  de?: number; ate?: number; unidadeId?: string;
  /** Texto do nome (sem acento, parcial). Pode identificar alguém: na API real vai no corpo de um POST, nunca na URL. */
  pessoa?: string;
  /** Placa parcial (≥3 caracteres; a API ignora menos). Dado pessoal: só no corpo de POST, nunca na URL. */
  placa?: string;
  /** Pessoa exata (ficha), pelos valores efetivos (com correção). */
  pessoaId?: string;
  operadorId?: string;
  tipo?: TipoEvento; meio?: MeioAutorizacao; somenteExcecoes?: boolean; somenteRetroativos?: boolean;
  /** Tipos a deixar de fora (painel: sem saídas; unidade: sem correções). */
  excluirTipos?: TipoEvento[];
}
/** Uma página de eventos (mais recentes primeiro, por seq). */
export interface FiltroEventosPagina extends FiltroEventos { cursor?: string | null; limite?: number }

export interface NovoVinculoInput {
  pessoaId: string; unidadeId: string; tipo: TipoVinculo; vigenciaInicio: number; vigenciaFim: number | null;
  /** O comprovante não é anexado: a administração registra a conferência depois (RF-05, `vinculos.registrarConferencia`). */
  solicitadoPor: string;
}

/** RF-05: o conferente é o usuário autenticado; `data` (início do dia BRT) é hoje se omitida. Sem arquivo. */
export interface ConferenciaInput { tipo: TipoComprovante; descricao?: string; observacao?: string; data?: number }

export interface NovaAutorizacaoInput {
  /** Destino: unidade OU área comum. Área comum só síndico/administração (autorizacao.area_comum), sem solicitante. */
  unidadeId: string | null; areaComumId?: string | null;
  pessoaId: string; validaAte: number | null; validaDe?: number;
  diasSemana: number[] | null; horaInicio: string | null; horaFim: string | null;
  /** Morador que pediu. Sem ele, `justificativa` (≥ 15 caracteres) é obrigatória. */
  solicitadaPorPessoaId: string | null;
  justificativa?: string | null;
}

export interface NovaRestricaoInput {
  pessoaId: string; unidadeId: string | null; motivo: string; validaAte: number | null;
  /** Morador que pediu: obrigatório (com vínculo válido) no escopo unidade; opcional no condomínio. */
  solicitadaPorPessoaId: string | null; paraTodoCondominio?: boolean;
}

export interface NovaEncomendaInput {
  unidadeId: string; destinatario: string; transportadora: string; codigoRastreio: string; unidadeConfirmada: boolean;
}

export interface NovaOcorrenciaInput {
  tipo: TipoOcorrencia; descricao: string; unidadeId: string | null; envolvidos: string;
  anexos?: string[]; eventoIds?: string[];
}

export interface NovoUsuarioInput { nome: string; login: string; papel: Papel }

/** Bloco e número como digitados: a API normaliza ("a" -> "A", "3" -> "03") e validam. */
export interface NovaUnidadeInput { bloco: string; numero: string }

/** RF-09: funcionário do condomínio = pessoa (mesmas regras de CPF e telefone) + função e escala. */
export interface NovoFuncionarioInput { nome: string; documento: string; telefone: string; funcao: string; escala: Escala; ativo?: boolean }
export interface EditarFuncionarioInput { pessoaId: string; funcao?: string; escala?: Escala; ativo?: boolean }
export interface FuncionarioView extends Funcionario { pessoa: Pessoa; emEscalaAgora: boolean }

export interface AutorizarRetiradaInput { encomendaId: string; pessoaId: string; solicitadaPorPessoaId: string }

export interface LinhaPlanilha { linha: number; bloco: string; unidade: string; nome: string; documento: string; telefone: string; tipo?: string }

// ----- Saídas ---------------------------------------------------------------------------------
/** Usuário da sessão: o de sistema + a marca de troca obrigatória (senha temporária). */
/** Condomínio da sessão, como login e /auth/me devolvem: só o nome (cabeçalho e exportações). */
export interface CondominioSessao { nome: string }

/** `condominio` ausente ou null: resposta sem o nome (o layout cai no nome padrão). */
export interface UsuarioSessao extends UsuarioSistema {
  deveTrocarSenha: boolean;
  condominio?: CondominioSessao | null;
}

/**
 * Criação e redefinição devolvem a senha temporária UMA vez. Quem recebe mostra e descarta: não vai para estado
 * global, cache do React Query nem storage.
 */
export interface UsuarioComSenhaTemporaria { usuario: UsuarioSistema; senhaTemporaria: string }

/** Avisos de sessão que a camada HTTP emite para o AuthContext. */
export type EventoSessao = 'expirada' | 'troca_obrigatoria';

export interface PessoaBusca extends Pessoa {
  ultimoAcesso: string;
  /** Ids das unidades com vínculo válido, e os códigos correspondentes ("D-32") na mesma ordem. */
  unidadesVinculadas: string[]; unidadesVinculadasCodigos: string[];
  /** Selo de restrição (lista e busca do Cadastro; a busca global do topo não traz); ausente para quem não vê restrições. */
  restricao?: RestricaoResumo | null;
}

export interface VinculoView extends VinculoUnidade {
  pessoaNome: string; pessoaDocumento: string;
  /** Pessoa tem CPF e telefone (pré-requisito para aprovar o vínculo). */
  pessoaCadastroCompleto: boolean;
  unidadeCodigo: string;
  decididoPorNome: string | null;
  registradoPorNome: string | null;
  conferidoPorNome: string | null;
  /** Legado com prazo de regularização vencido (RN-09). */
  legadoVencido: boolean;
}

export interface AutorizacaoView extends AutorizacaoPrevia {
  pessoaNome: string; estado: EstadoAutorizacao;
  /** Código da unidade ou nome da área comum. */
  unidadeRotulo: string; utilizadaEm: number | null;
  /** "Paula Nogueira (Administração)". */
  cadastradaPorNome: string;
  solicitadaPorNome: string | null;
  revogadaPorNome: string | null;
}
/** Visita prevista (autorização prévia que vale agora ou nas próximas horas, pessoa fora do condomínio). Sem CPF/telefone. */
export interface PrevistoView {
  autorizacaoId: string; pessoaId: string; nome: string; categoria: CategoriaPessoa;
  destino: { tipo: 'unidade' | 'area_comum'; id: string; rotulo: string };
  /** Limites da próxima janela (epoch ms). `inicio` no passado = a janela já está em curso. */
  inicio: number; fim: number;
}
export interface RestricaoView extends Restricao {
  pessoaNome: string; pendente: boolean; unidadeCodigo: string | null;
  cadastradaPorNome: string; solicitadaPorNome: string | null; aprovadaPorNome: string | null; revogadaPorNome: string | null;
}

export interface EncomendaView extends Encomenda {
  unidadeCodigo: string;
  recebidaPorNome: string;
  /** "Lúcia Ribeiro (dependente)" ou "Fulano (autorizado por Ana Ribeiro)". */
  retiradaPorNome: string | null;
  retiradaRegistradaPorNome: string | null;
  autorizacoes: (AutorizacaoRetirada & { pessoaNome: string; solicitanteNome: string })[];
}

export interface OcorrenciaView extends Ocorrencia {
  abertaPorNome: string;
  historicoStatus: (MudancaStatusOcorrencia & { porNome: string })[];
  /**
   * Anexos com conteúdo guardado (API real: cifrado, spec §9.2). Opcional no tipo (`anexos` traz só os nomes).
   * O nome é gerado ("anexo-1a2b3c4d.pdf"): o original não é guardado.
   */
  documentos?: AnexoOcorrencia[];
}
export interface AnexoOcorrencia { id: string; nome: string; mime: string; tamanhoBytes: number; enviadoEm: number; enviadoPorNome: string }
/** Conteúdo de um anexo para download (só síndico e administração: `documento.ver`). */
export interface ArquivoBaixado { nome: string; mime: string; conteudo: Blob }

/** Filas de encomendas (RF-26), paginadas. `atrasadasDias`: só as aguardando há mais de N dias. */
export interface FiltroEncomendas { status?: 'aguardando' | 'entregue'; unidadeId?: string; atrasadasDias?: number; cursor?: string | null; limite?: number }
/** Contagens das abas e do painel sem carregar as listas. */
export interface ResumoEncomendas { aguardando: number; atrasadas: number; entregues: number; diasAtraso: number }
export interface FiltroOcorrencias { status?: StatusOcorrencia[]; tipo?: TipoOcorrencia; unidadeId?: string; cursor?: string | null; limite?: number }

/** Catálogo leve para a UI: todas as unidades (inclusive inativas, para o histórico) e áreas comuns. */
/** `agrupamento`: como o condomínio chama o bloco ("Bloco"/"Torre"), configurado na API; só muda os rótulos. */
export interface Catalogo { agrupamento: Agrupamento; unidades: Unidade[]; areasComuns: AreaComum[] }

/** Página de uma listagem por cursor (o envelope REST `{ data, pagination }` já desembrulhado). */
export interface Pagina<T> { itens: T[]; cursor: string | null; temMais: boolean }
export interface FiltroUnidades { bloco?: string; cursor?: string | null; limite?: number }

/** Busca do topo: pessoas (até 6) e unidades pelo código ou pela placa. */
export interface ResultadoBuscaGlobal {
  pessoas: PessoaBusca[]; unidades: { id: string; motivo: string }[];
  /** Há mais pessoas além das mostradas (refinar a busca). */
  temMaisPessoas?: boolean;
}

/** LGPD art. 18 (spec 9.3). */
export interface ResultadoAnonimizacao {
  pessoaId: string; registrosRedigidos: number; retido: string[];
  /** API real: o que a anonimização limpou (contagens) e se o nome foi procurado no texto livre. */
  limpeza?: { textoLivre: 'substituido' | 'nome_curto' | 'homonimo'; eventosComTexto: number };
  /** API real: eventos da pessoa que ficam retidos (só pelo id) e até quando (início do dia BRT, ms). */
  eventosRetidos?: number; retidoAte?: number | null;
  /** API real: arquivos da pessoa (foto) eliminados do storage. */
  documentosEliminados?: number;
}
export interface ResultadoRetencao {
  visitantesPrestadores: number; moradores: number; registrosRedigidos: number; pessoaIds: string[];
  // Além das pessoas, a retenção conta eventos, trilha e arquivos descartados:
  /** Eventos do prefixo da cadeia descartados (com selo no seq de corte). */
  eventosDescartados?: number;
  /** Eventos com mais de 3 anos que ficaram por falta de selo no ponto de corte. */
  eventosVencidosSemSelo?: number;
  /** Registros da trilha de alterações com mais de 3 anos descartados. */
  trilhaDescartada?: number;
  fotosEliminadas?: number;
  anexosEliminados?: number;
  /** false: o prazo dos anexos de ocorrência não foi definido (decisão em aberto) e nenhum anexo foi eliminado. */
  prazoAnexosDefinido?: boolean;
  arquivosOrfaosRemovidos?: number;
  /** Registros de documento cujo arquivo não está no volume (só registrado em log; nada é alterado). */
  registrosSemArquivo?: number;
  /** Veículos desativados há mais de 3 anos apagados. */
  veiculosEliminados?: number;
  /** Operadores desativados há mais de 3 anos com nome e login genéricos. */
  operadoresAnonimizados?: number;
  /** Sessões sem uso há mais de 90 dias com IP e navegador apagados. */
  sessoesLimpas?: number;
  /** Anonimizações refeitas depois de um restore (registro fora do banco). */
  anonimizacoesReaplicadas?: number;
  reaplicadasComVinculoValido?: string[];
  /** 'falhou': o registro das anonimizações fora do banco do condomínio não respondeu (fica para a próxima execução). */
  registroExterno?: 'ok' | 'falhou';
}
/** Última execução da retenção (agendador ou sob demanda). */
export interface ExecucaoRetencao { em: number; porNome: string; resultado: ResultadoRetencao }

/** Selo da cadeia de hashes (spec 4.6). `data` = início do dia BRT (ms). */
export interface SeloCadeia {
  id: string; data: number; tipo: 'diario' | 'manual'; ultimoSeq: number; ultimoHash: string; criadoEm: number;
  /** Destino da âncora externa; nulo enquanto o envio estiver pendente. */
  enviadoPara: string | null; enviadoEm: number | null;
}
export interface EstadoSelos {
  ultimo: SeloCadeia | null; pendentesEnvio: number;
  /** Destinos configurados para a âncora (vazio = sem destino). */
  destinos: string[];
  /** O agendador diário está ligado nesta API. */
  agendador: boolean;
}
export interface ResultadoSelar { selo: SeloCadeia; novo: boolean; ancora: 'enviada' | 'pendente' | 'sem_destino' }
export interface ConferenciaAncora {
  confere: boolean; motivo: 'confere' | 'hash_divergente' | 'seq_descartado' | 'seq_inexistente'; seq: number;
  hashNoBanco: string | null; seloRegistrado: boolean;
}

export interface UnidadeResumo {
  unidade: Unidade; moradoresValidos: number; pendentes: number; restricoes: number; cadastroCompleto: boolean;
}
/** Seção `null`: o módulo ainda não existe na API real (a tela mostra "disponível em breve" só nela). */
export interface UnidadeDetalhe {
  unidade: Unidade;
  vinculos: VinculoView[] | null;
  veiculos: Veiculo[];
  autorizacoes: AutorizacaoView[] | null;
  restricoes: RestricaoView[] | null;
  eventos: EventoView[] | null;
}
export interface Autorizador { pessoa: Pessoa; vinculo: VinculoUnidade }

/** `eventos` null: o módulo de eventos ainda não existe na API real (a ficha mostra "disponível em breve"). */
export interface FichaPessoa { pessoa: Pessoa; funcionario?: Funcionario; vinculos: VinculoView[]; eventos: EventoView[] | null }

/** Linha da tela Cadastro: a pessoa e o vínculo que melhor a representa (aprovado > legado > pendente > rejeitado > encerrado). */
export interface PessoaLista extends PessoaBusca {
  vinculoPrincipal: { id: string; unidadeId: string; unidadeCodigo: string; tipo: TipoVinculo; status: StatusVinculo } | null;
}
/**
 * Resumo da restrição para o selo da lista e da busca do Cadastro, sem motivo. `ativa`: vigente (de unidade, ou de condomínio aprovada), e
 * prevalece sobre `pendente` (de condomínio aguardando o síndico). `unidadeCodigo` null: todo o condomínio.
 */
export interface RestricaoResumo { estado: 'ativa' | 'pendente'; unidadeCodigo: string | null; total: number }
export interface FiltroPessoas { categoria?: CategoriaPessoa; cursor?: string | null; limite?: number; incluirDesativadas?: boolean }
/** recentes: solicitação mais nova primeiro; decisao: decisão/encerramento mais novo; prazo: prazo de regularização (vencidos primeiro). */
export type OrdemVinculos = 'recentes' | 'decisao' | 'prazo';
export interface FiltroVinculos { status?: StatusVinculo[]; unidadeId?: string; pessoaId?: string; ordem?: OrdemVinculos; cursor?: string | null; limite?: number }
/** RF-07: encerramento manual. `data` (início do dia BRT): padrão hoje, ou o fim da vigência se ele já passou. */
export interface EncerrarVinculoInput { motivo: string; data?: number }
export interface EditarVeiculoInput { id: string; placa?: string; modelo?: string; cor?: string; ativo?: boolean }

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
  id: string; arquivo: string; status: 'analisada' | 'confirmada' | 'cancelada'; lidas: number; importaveis: number; rejeitadas: number; avisos: number;
  inconsistencias: InconsistenciaImportacao[]; amostra: LinhaPlanilha[]; prazoRegularizacao: number;
}
export interface ResultadoImportacao { importados: number; reaproveitados: number; prazoRegularizacao: number }

export interface Api {
  /** Assina avisos de sessão (401 fora do login, 403 TROCA_DE_SENHA_OBRIGATORIA). Devolve o cancelamento. */
  aoEventoSessao?(cb: (e: EventoSessao) => void): () => void;
  auth: {
    // 2FA fica para a fase de segurança (pós-MVP).
    login(i: LoginInput): Promise<UsuarioSessao>;
    logout(): Promise<void>;
    me(): Promise<UsuarioSessao | null>;
    /** Troca a própria senha (mínimo de 12). Libera quem estava com troca obrigatória. */
    trocarSenha(i: TrocarSenhaInput): Promise<UsuarioSessao>;
  };
  busca: { global(q: string): Promise<ResultadoBuscaGlobal> };
  pessoas: {
    /** `limite`: máximo de resultados (padrão 8). A portaria pede 9 para saber se há mais que 8. */
    /** `incluirDesativadas`: só a tela Cadastro ("mostrar desativados"); a portaria e os seletores nunca. */
    buscar(q: string, opts?: { semMoradores?: boolean; limite?: number; incluirDesativadas?: boolean }): Promise<PessoaBusca[]>;
    listar(): Promise<PessoaBusca[]>;
    /** Uma página (cursor), em ordem alfabética; `categoria` filtra no servidor. Texto livre vai por `buscar` (pode ser CPF). */
    listarPagina(f?: FiltroPessoas): Promise<Pagina<PessoaLista>>;
    ficha(id: string): Promise<FichaPessoa>;
    criar(i: NovaPessoaInput): Promise<Pessoa>;
    /** pessoa.editar (SI/AD): completa ou corrige o cadastro, com antes/depois na trilha. */
    editar(i: EditarPessoaInput): Promise<Pessoa>;
    funcionario(pessoaId: string): Promise<Funcionario | null>;
    /** RF-02, pessoa.desativar (SI/AD): não exclui; revoga junto as autorizações prévias vigentes. */
    desativar(id: string, motivo: string): Promise<Pessoa & { autorizacoesRevogadas: number }>;
    reativar(id: string): Promise<Pessoa>;
  };
  catalogo: { obter(): Promise<Catalogo> };
  unidades: {
    /** Todas as unidades com resumo (percorre as páginas). A tela usa `listarPagina`. */
    listar(): Promise<UnidadeResumo[]>;
    /** Uma página (cursor), na ordem bloco/número; `bloco` filtra. Padrão de 50 por página. */
    listarPagina(f?: FiltroUnidades): Promise<Pagina<UnidadeResumo>>;
    /** `id` aceita o uuid ou o código "D-32". */
    detalhe(id: string): Promise<UnidadeDetalhe>;
    criar(i: NovaUnidadeInput): Promise<Unidade>;
    /** Só bloco/número; unidade já referenciada (vínculo, evento etc.) não muda de número (422 UNIDADE_REFERENCIADA). */
    editar(i: NovaUnidadeInput & { id: string }): Promise<Unidade>;
    desativar(id: string): Promise<Unidade>;
    reativar(id: string): Promise<Unidade>;
  };
  funcionarios: {
    listar(): Promise<FuncionarioView[]>;
    criar(i: NovoFuncionarioInput): Promise<FuncionarioView>;
    editar(i: EditarFuncionarioInput): Promise<FuncionarioView>;
  };
  veiculos: {
    criar(i: { unidadeId: string; placa: string; modelo: string; cor: string }): Promise<Veiculo>;
    /** RF-08: corrige placa/modelo/cor ou desativa (`ativo: false`, some do detalhe). Placa ativa é única. */
    editar(i: EditarVeiculoInput): Promise<Veiculo>;
  };
  vinculos: {
    listar(f?: { status?: StatusVinculo }): Promise<VinculoView[]>;
    /** Uma página (cursor). `status` aceita vários (aba Decididos). */
    listarPagina(f?: FiltroVinculos): Promise<Pagina<VinculoView>>;
    /** Quantos vínculos há no status (badge "Vínculos pendentes" do menu). */
    contar(status: StatusVinculo): Promise<number>;
    criar(i: NovoVinculoInput): Promise<VinculoUnidade>;
    /** RF-05: registra (ou refaz, enquanto pendente/legado) a conferência do comprovante. Só síndico/administração. */
    registrarConferencia(id: string, i: ConferenciaInput): Promise<VinculoUnidade>;
    /** Aprovar exige conferência registrada (422 CONFERENCIA_OBRIGATORIA) e cadastro completo (422 CADASTRO_INCOMPLETO). */
    decidir(i: { id: string; decisao: 'aprovar' | 'rejeitar'; justificativa?: string }): Promise<VinculoUnidade>;
    /** RN-09: legado -> aprovado, com conferência registrada e cadastro completo. */
    regularizar(id: string, opcoes?: { vigenciaFim?: number | null }): Promise<VinculoUnidade>;
    /** RF-07: aprovado ou legado -> encerrado, com motivo (>= 15 caracteres). */
    encerrar(id: string, i: EncerrarVinculoInput): Promise<VinculoUnidade>;
    autorizadores(unidadeId: string): Promise<Autorizador[]>;
  };
  autorizacoes: {
    criar(i: NovaAutorizacaoInput): Promise<AutorizacaoPrevia>;
    revogar(id: string): Promise<void>;
    /** Destino: id da unidade ou, com `areaComum`, id da área comum. */
    vigentes(pessoaId: string, destinoId: string, opcoes?: { areaComum?: boolean }): Promise<AutorizacaoView[]>;
    hoje(): Promise<AutorizacaoView[]>;
    /** Quem tem autorização que vale nas próximas `horas` h (1 a 24) e não está dentro. */
    previstas(horas: number): Promise<PrevistoView[]>;
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
    /** Lista inteira (percorre as páginas, com teto). As telas usam `listarPagina`. */
    listar(f?: FiltroEventos): Promise<EventoView[]>;
    /** Uma página (cursor), mais recentes primeiro (seq decrescente). Padrão de 50. */
    listarPagina(f?: FiltroEventosPagina): Promise<Pagina<EventoView>>;
    /** Correções registradas para o evento (linha do tempo da gaveta), da mais antiga para a mais nova. */
    correcoesDe(id: string): Promise<EventoView[]>;
    obter(id: string): Promise<EventoView>;
    presentes(): Promise<EventoView[]>;
    /** "+1h" no prazo de permanência (tabela à parte; o evento não muda). */
    prorrogarPermanencia(entradaId: string): Promise<PermanenciaView & { eventoId: string }>;
    /** Veículo da última entrada com veículo da pessoa ("mesmo veículo da última visita"); null se não houver. */
    ultimoVeiculo(pessoaId: string): Promise<VeiculoAcesso | null>;
  };
  encomendas: {
    /** Lista inteira (percorre as páginas). As telas usam `listarPagina`. */
    listar(f?: { status?: 'aguardando' | 'entregue' }): Promise<EncomendaView[]>;
    /** Uma página, mais recentes primeiro (recebimento). Padrão de 50. */
    listarPagina(f?: FiltroEncomendas): Promise<Pagina<EncomendaView>>;
    /** Aguardando, atrasadas (há mais de `dias`, padrão 7) e entregues. */
    resumo(dias?: number): Promise<ResumoEncomendas>;
    obter(id: string): Promise<EncomendaView>;
    receber(i: NovaEncomendaInput): Promise<Encomenda>;
    /** RN-08: quem tem vínculo válido na unidade, ou quem foi autorizado (autorizarRetirada). */
    entregar(i: { id: string; pessoaId: string }): Promise<Encomenda>;
    autorizarRetirada(i: AutorizarRetiradaInput): Promise<AutorizacaoRetirada>;
  };
  ocorrencias: {
    listar(): Promise<OcorrenciaView[]>;
    /** Uma página, mais recentes primeiro (abertura). Padrão de 50. */
    listarPagina(f?: FiltroOcorrencias): Promise<Pagina<OcorrenciaView>>;
    obter(id: string): Promise<OcorrenciaView>;
    criar(i: NovaOcorrenciaInput): Promise<Ocorrencia>;
    alterarStatus(id: string, status: StatusOcorrencia): Promise<Ocorrencia>;
    /** RF-28: acrescenta eventos (repetidos são ignorados). Encerrada não muda. */
    vincularEventos(id: string, eventoIds: string[]): Promise<OcorrenciaView>;
    /** Anexo (JPEG, PNG ou PDF, até 4 MiB, até 5). Porteiro só na que abriu; encerrada não recebe. */
    anexar(id: string, arquivo: File): Promise<OcorrenciaView>;
    baixarAnexo(id: string, documentoId: string): Promise<ArquivoBaixado>;
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
    /** Uma página da trilha de alterações (cursor). Padrão de 50. */
    alteracoesPagina(f?: FiltroAlteracoesPagina): Promise<Pagina<RegistroAlteracao>>;
    exportar(f?: FiltroEventos): Promise<PacoteExportacao>;
    /** Último selo da cadeia e estado da âncora externa (spec 4.6). Só na API real. */
    selos(): Promise<EstadoSelos>;
    /** Sela a cabeça da cadeia agora e envia a âncora (SI/AU). */
    selar(): Promise<ResultadoSelar>;
    /** Confere seq + hash recebidos por fora (e-mail da âncora) contra o banco. */
    conferirAncora(i: { seq: number; hash: string }): Promise<ConferenciaAncora>;
  };
  usuarios: {
    listar(): Promise<UsuarioSistema[]>;
    criar(i: NovoUsuarioInput): Promise<UsuarioComSenhaTemporaria>;
    desativar(id: string): Promise<UsuarioSistema>;
    reativar(id: string): Promise<UsuarioSistema>;
    /** Gera senha temporária, derruba as sessões do alvo e exige troca no próximo login. */
    redefinirAcesso(id: string): Promise<UsuarioComSenhaTemporaria>;
    /** Ninguém altera o próprio papel; envolver síndico exige usuario.gerenciar_sindico. */
    alterarPapel(id: string, papel: Papel): Promise<UsuarioSistema>;
  };
  lgpd: {
    /** spec 9.3: JSON com cadastro mascarado, vínculos, veículos, eventos e encomendas. SI/AD. */
    exportarPessoa(pessoaId: string): Promise<PacoteExportacao>;
    /** Eliminação a pedido (SI): só sem vínculo válido; informa o que fica retido. */
    anonimizar(pessoaId: string): Promise<ResultadoAnonimizacao>;
    /** RNF-09 (SI): anonimiza quem passou do prazo de 3 anos. Na API real também descarta eventos selados e arquivos vencidos. */
    aplicarRetencao(): Promise<ResultadoRetencao>;
    /** Última execução da retenção, ou null se nunca rodou. SI. */
    ultimaRetencao(): Promise<ExecucaoRetencao | null>;
  };
  importacao: {
    analisar(i: { arquivo: string; linhas: LinhaPlanilha[] }): Promise<RelatorioImportacao>;
    confirmar(id: string): Promise<ResultadoImportacao>;
  };
}
