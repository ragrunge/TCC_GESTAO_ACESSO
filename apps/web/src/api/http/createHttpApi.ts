// Implementação HTTP da interface Api contra o backend NestJS (spec §5.1 e §6). Hoje cobre autenticação, sessão,
// usuários, unidades, catálogo, busca, pessoas, funcionários, veículos, vínculos, importação, registro de acesso
// (eventos, presentes, turno), autorizações prévias, restrições, auditoria (com selo e âncora externa), relatórios,
// encomendas, ocorrências (com anexos cifrados) e LGPD (exportação do titular, anonimização e retenção).
// Formatos que o adaptador converte para o domínio: data de calendário 'YYYY-MM-DD' (dia BRT) <-> número do início do
// dia BRT; placa 'ABC1D23' -> 'ABC-1D23' (como a tela exibe).
// Formato REST (skill rest-api): todo 2xx com corpo vem em { data }; listas paginadas em
// { data: [...], pagination: { cursor, hasNextPage } }; 204 sem corpo.
import type { AxiosRequestConfig } from 'axios';
import type {
  AutorizacaoPrevia, AutorizacaoRetirada, ConferenciaComprovante, EventoView, Funcionario, Pessoa, RegistroAlteracao, Restricao, Unidade, UsuarioSistema, Veiculo,
  VinculoUnidade,
} from '@portaria/domain/types';
import type { PermanenciaView } from '@portaria/domain/types';
import type { ResultadoIntegridade } from '@portaria/domain/hashChain';
import { codigoCondominioValido, normalizarCodigoCondominio } from '@portaria/domain/condominio';
import { brt, toInputDate } from '@portaria/domain/time';
import { AGRUPAMENTOS } from '@portaria/domain/units';
import type {
  Api, AutorizacaoView, Autorizador, Catalogo, ConferenciaAncora, EstadoSelos, ExecucaoRetencao, ResultadoAnonimizacao, ResultadoRetencao, ResultadoSelar,
  SeloCadeia, EncomendaView, FichaPessoa, FiltroEncomendas, FiltroOcorrencias, OcorrenciaView, ResumoEncomendas, FiltroAlteracoesPagina, FiltroEventos, FiltroEventosPagina, FiltroRelatorio, FuncionarioView,
  LinhaPlanilha, Pagina, PacoteExportacao, PessoaBusca, PessoaLista, RelatorioImportacao, RelatorioResumo, RestricaoView, ResultadoBuscaGlobal,
  ResultadoImportacao, ResultadoRestricao, ResumoTurno, UnidadeDetalhe, UnidadeResumo, UsuarioComSenhaTemporaria, UsuarioSessao, VinculoView, CondominioSessao,
} from '../types';
import { ApiError } from '../types';
import { criarCliente } from './cliente';

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
const unidadeDe = (u: Unidade): Unidade => ({ id: u.id, bloco: u.bloco, numero: u.numero, ativo: u.ativo });

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

// ----- Registro de acesso: filtros -> query (ids e datas) ou corpo (com o nome) -------------------------------------

/** Filtros de evento sem o texto do nome: vão na query string (só ids, instantes e marcações). */
function filtroQuery(f: FiltroEventosPagina): Record<string, string | number> {
  const q: Record<string, string | number> = {};
  if (f.eventoId) q.eventoId = f.eventoId;
  if (f.de !== undefined) q.de = Math.trunc(f.de);
  if (f.ate !== undefined) q.ate = Math.trunc(f.ate);
  if (f.unidadeId) q.unidadeId = f.unidadeId;
  if (f.pessoaId) q.pessoaId = f.pessoaId;
  if (f.operadorId) q.operadorId = f.operadorId;
  if (f.tipo) q.tipo = f.tipo;
  if (f.meio) q.meio = f.meio;
  if (f.somenteExcecoes) q.somenteExcecoes = 'true';
  if (f.somenteRetroativos) q.somenteRetroativos = 'true';
  if (f.excluirTipos?.length) q.excluirTipos = f.excluirTipos.join(',');
  if (f.limite !== undefined) q.limite = f.limite;
  if (f.cursor) q.cursor = f.cursor;
  return q;
}
/** Mesmos filtros como corpo (POST /eventos-acesso/busca e /auditoria/exportacoes): o nome pode identificar alguém. */
function filtroCorpo(f: FiltroEventos): Record<string, unknown> {
  return semIndefinidos({
    eventoId: f.eventoId, de: f.de !== undefined ? Math.trunc(f.de) : undefined, ate: f.ate !== undefined ? Math.trunc(f.ate) : undefined,
    unidadeId: f.unidadeId, pessoaId: f.pessoaId, pessoa: f.pessoa?.trim() || undefined, operadorId: f.operadorId, tipo: f.tipo, meio: f.meio,
    somenteExcecoes: f.somenteExcecoes || undefined, somenteRetroativos: f.somenteRetroativos || undefined,
    excluirTipos: f.excluirTipos?.length ? f.excluirTipos : undefined,
  });
}

/** O evento vem pronto da API (EventoView do domínio, instantes em epoch ms); aqui só se confere o formato. */
function eventoDe(e: EventoView): EventoView {
  if (!e || typeof e.id !== 'string' || typeof e.seq !== 'number' || typeof e.ocorridoEm !== 'number') throw respostaInvalida();
  return e;
}
const listaDe = <T>(corpo: unknown, f: (x: T) => T = (x) => x): T[] => {
  const d = dados<T[]>(corpo);
  if (!Array.isArray(d)) throw respostaInvalida();
  return d.map(f);
};

/** Filtro de relatório: instantes -> dias de calendário BRT. */
function filtroRelatorio(f?: number | FiltroRelatorio): Record<string, string> {
  if (typeof f === 'number') return { de: toInputDate(Date.now() - (f - 1) * 86_400_000) };
  const q: Record<string, string> = {};
  if (f?.de !== undefined) q.de = toInputDate(f.de);
  if (f?.ate !== undefined) q.ate = toInputDate(f.ate);
  if (f?.unidadeId) q.unidadeId = f.unidadeId;
  if (f?.categoria) q.categoria = f.categoria;
  if (f?.meio) q.meio = f.meio;
  return q;
}

/** A encomenda vem pronta da API (EncomendaView do domínio, instantes em epoch ms); aqui só se confere o formato. */
function encomendaDe(e: EncomendaView): EncomendaView {
  if (!e || typeof e.id !== 'string' || typeof e.recebidaEm !== 'number' || !Array.isArray(e.autorizacoes)) throw respostaInvalida();
  return e;
}
function ocorrenciaDe(o: OcorrenciaView): OcorrenciaView {
  if (!o || typeof o.id !== 'string' || typeof o.abertaEm !== 'number' || !Array.isArray(o.historicoStatus) || !Array.isArray(o.eventoIds)) throw respostaInvalida();
  return { ...o, anexos: Array.isArray(o.anexos) ? o.anexos : [], documentos: Array.isArray(o.documentos) ? o.documentos : [] };
}
/** `attachment; filename="anexo-1a2b3c4d.pdf"` -> o nome (só o formato que a API gera; o resto vira "anexo"). */
export function nomeDoAnexo(disposicao: unknown): string {
  const m = typeof disposicao === 'string' ? /filename="(anexo-[0-9a-f]{8}\.(?:jpg|png|pdf))"/.exec(disposicao) : null;
  return m?.[1] ?? 'anexo';
}

// ----- LGPD e selo (spec 4.6 e 9.3) -------------------------------------------------------------

type SeloApi = Omit<SeloCadeia, 'data'> & { data: string };
function seloDe(s: SeloApi | null | undefined): SeloCadeia {
  if (!s || typeof s.id !== 'string' || typeof s.ultimoSeq !== 'number' || typeof s.ultimoHash !== 'string') throw respostaInvalida();
  return { ...s, data: diaParaMs(s.data)!, enviadoPara: s.enviadoPara ?? null, enviadoEm: s.enviadoEm ?? null };
}
function retencaoDe(r: ResultadoRetencao | null | undefined): ResultadoRetencao {
  if (!r || typeof r.visitantesPrestadores !== 'number' || typeof r.moradores !== 'number' || !Array.isArray(r.pessoaIds)) throw respostaInvalida();
  return r;
}

function pacoteDe(corpo: unknown): PacoteExportacao {
  const p = dados<PacoteExportacao>(corpo);
  if (!p || typeof p.nomeArquivo !== 'string' || typeof p.conteudo !== 'string') throw respostaInvalida();
  return p;
}

/** `{ codigo, nome }` do condomínio da sessão; qualquer outra forma (ou código fora do formato) vira null. */
function condominioDe(c: unknown): CondominioSessao | null {
  if (!c || typeof c !== 'object') return null;
  const { codigo, nome } = c as { codigo?: unknown; nome?: unknown };
  if (typeof codigo !== 'string' || !codigoCondominioValido(codigo) || typeof nome !== 'string' || !nome.trim()) return null;
  return { codigo, nome };
}

/**
 * `{ usuario, condominio?, sessao }` de login/me e `{ usuario }` de trocar-senha (dentro de `data`) -> o usuário.
 * O condomínio só é lido de login/me (`comCondominio`): trocar-senha não o devolve e não pode apagá-lo do estado.
 */
function usuarioDe(corpo: unknown, comCondominio = false): UsuarioSessao {
  const d = dados<{ usuario?: UsuarioSessao; condominio?: unknown } | null>(corpo);
  const u = d?.usuario;
  if (!u || typeof u.id !== 'string') throw respostaInvalida();
  const { condominio: _ignorado, ...usuario } = u;
  return { ...usuario, deveTrocarSenha: u.deveTrocarSenha === true, ...(comCondominio ? { condominio: condominioDe(d?.condominio) } : {}) };
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

  /** Uma página de eventos. Com o nome (texto), pelo corpo de um POST; sem ele, GET com ids e datas na query. */
  async function eventosPagina(f: FiltroEventosPagina = {}): Promise<Pagina<EventoView>> {
    const base = { ...f, limite: f.limite ?? 50 };
    const corpo = f.pessoa?.trim()
      ? (await http.post('/eventos-acesso/busca', { ...filtroCorpo(f), limite: base.limite, ...(f.cursor ? { cursor: f.cursor } : {}) })).data
      : (await http.get('/eventos-acesso', { params: filtroQuery(base) })).data;
    const p = paginaDe<EventoView>(corpo);
    return { ...p, itens: p.itens.map(eventoDe) };
  }

  /** Linhas da planilha entre analisar e confirmar: só na memória desta aba (têm CPF em claro; a API não as guarda). */
  const linhasImportacao = new Map<string, LinhaPlanilha[]>();

  return {
    aoEventoSessao: (cb) => cliente.aoEvento(cb),
    auth: {
      async login(i) {
        // X-Condominio SÓ aqui (SAAS-03): nas demais rotas o condomínio vem do prefixo do cookie, e um cabeçalho
        // enviado junto teria precedência sobre ele. Vazio: sem cabeçalho (piloto, durante a transição).
        const codigo = normalizarCodigoCondominio(i.condominio ?? '');
        const { data } = await http.post('/auth/login', { login: i.login, senha: i.senha }, codigo ? { headers: { 'X-Condominio': codigo } } : undefined);
        const u = usuarioDe(data, true);
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
          const u = usuarioDe(data, true);
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
        const c = dados<Catalogo>((await http.get('/catalogo')).data);
        if (!c || !Array.isArray(c.unidades) || !Array.isArray(c.areasComuns) || !AGRUPAMENTOS.includes(c.agrupamento)) throw respostaInvalida();
        return { agrupamento: c.agrupamento, unidades: c.unidades.map(unidadeDe), areasComuns: c.areasComuns };
      },
    },
    unidades: {
      async listar() { return todasAsPaginas<UnidadeResumo>('/unidades'); },
      async listarPagina(f = {}) {
        const params: Record<string, string | number> = { limite: f.limite ?? 50 };
        if (f.bloco !== undefined) params.bloco = f.bloco;
        if (f.cursor) params.cursor = f.cursor;
        return paginaDe<UnidadeResumo>((await http.get('/unidades', { params })).data);
      },
      async detalhe(ref) {
        const d = dados<{ unidade: Unidade; veiculos: Veiculo[]; vinculos?: VinculoApi[] }>((await http.get(`/unidades/${id(ref)}`)).data);
        if (!d?.unidade || !Array.isArray(d.veiculos)) throw respostaInvalida();
        // As seções do registro de acesso vêm dos módulos próprios (a rota da unidade não depende deles).
        const uid = d.unidade.id;
        const [autorizacoes, restricoes, eventos] = await Promise.all([
          http.get('/autorizacoes-previas', { params: { unidadeId: uid } }).then((r) => listaDe<AutorizacaoView>(r.data)),
          http.get('/restricoes', { params: { unidadeId: uid } }).then((r) => listaDe<RestricaoView>(r.data)),
          http.get('/eventos-acesso', { params: { unidadeId: uid, excluirTipos: 'correcao', limite: 12 } }).then((r) => paginaDe<EventoView>(r.data).itens.map(eventoDe)),
        ]);
        const det: UnidadeDetalhe = {
          unidade: unidadeDe(d.unidade), veiculos: d.veiculos.map(veiculoDe),
          vinculos: Array.isArray(d.vinculos) ? d.vinculos.map(vinculoDe) : null, autorizacoes, restricoes, eventos,
        };
        return det;
      },
      async criar(i) { return unidadeDe(dados<Unidade>((await http.post('/unidades', { bloco: i.bloco, numero: i.numero })).data)); },
      async editar(i) { return unidadeDe(dados<Unidade>((await http.patch(`/unidades/${id(i.id)}`, { bloco: i.bloco, numero: i.numero })).data)); },
      async desativar(u) { return unidadeDe(dados<Unidade>((await http.post(`/unidades/${id(u)}/desativar`)).data)); },
      async reativar(u) { return unidadeDe(dados<Unidade>((await http.post(`/unidades/${id(u)}/reativar`)).data)); },
    },
    // Pessoas. Texto livre (pode ser CPF) só no CORPO de POST /pessoas/busca, nunca na URL.
    pessoas: {
      async buscar(q, o) {
        const r = dados<{ pessoas: PessoaBusca[] }>((await http.post('/pessoas/busca', { q, limite: o?.limite ?? 8, semMoradores: !!o?.semMoradores, ...(o?.incluirDesativadas ? { incluirDesativadas: true } : {}) })).data);
        if (!r || !Array.isArray(r.pessoas)) throw respostaInvalida();
        return r.pessoas.map(pessoaDe);
      },
      async listar() { return (await todasAsPaginas<PessoaLista>('/pessoas')).map(pessoaDe); },
      async listarPagina(f = {}) {
        const params: Record<string, string | number> = { limite: f.limite ?? 50 };
        if (f.categoria) params.categoria = f.categoria;
        if (f.incluirDesativadas) params.incluirDesativadas = 'true';
        if (f.cursor) params.cursor = f.cursor;
        const p = paginaDe<PessoaLista>((await http.get('/pessoas', { params })).data);
        return { ...p, itens: p.itens.map(pessoaDe) };
      },
      async ficha(pid) {
        const f = dados<{ pessoa: PessoaApi; funcionario: FuncionarioApi | null; vinculos: VinculoApi[]; eventos: unknown[] | null }>((await http.get(`/pessoas/${id(pid)}`)).data);
        if (!f?.pessoa || !Array.isArray(f.vinculos)) throw respostaInvalida();
        // Últimos 10 acessos (valores efetivos: inclui o que foi corrigido para esta pessoa), sem as correções
        const eventos = paginaDe<EventoView>((await http.get('/eventos-acesso', { params: { pessoaId: pid, excluirTipos: 'correcao', limite: 10 } })).data).itens.map(eventoDe);
        const ficha: FichaPessoa = {
          pessoa: pessoaDe(f.pessoa), vinculos: f.vinculos.map(vinculoDe),
          ...(f.funcionario ? { funcionario: funcionarioBase(f.funcionario) } : {}),
          eventos,
        };
        return ficha;
      },
      async criar(i) {
        const corpo = semIndefinidos({
          nome: i.nome, telefone: i.menorIdade && !i.telefone?.trim() ? undefined : i.telefone, categoria: i.categoria,
          documento: !i.semCpf && i.documento?.trim() ? i.documento : undefined,
          empresa: i.empresa?.trim() || undefined, servico: i.servico?.trim() || undefined,
          semCpf: i.semCpf ? true : undefined,
          menorIdade: i.menorIdade ? true : undefined,
        });
        return pessoaDe(dados<PessoaApi>((await http.post('/pessoas', corpo)).data));
      },
      async editar({ id: pid, ...resto }) {
        return pessoaDe(dados<PessoaApi>((await http.patch(`/pessoas/${id(pid)}`, semIndefinidos(resto))).data));
      },
      async desativar(pid, motivo) {
        return pessoaDe(dados<PessoaApi & { autorizacoesRevogadas: number }>((await http.post(`/pessoas/${id(pid)}/desativar`, { motivo })).data));
      },
      async reativar(pid) {
        return pessoaDe(dados<PessoaApi>((await http.post(`/pessoas/${id(pid)}/reativar`)).data));
      },
      // Tela de entrada: só a escala da pessoa sendo registrada (a lista de funcionários não é do porteiro).
      async funcionario(pid) {
        try {
          return funcionarioBase(dados<FuncionarioApi>((await http.get(`/funcionarios/${id(pid)}/escala`)).data));
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
    autorizacoes: {
      async criar(i) {
        return dados<AutorizacaoPrevia>((await http.post('/autorizacoes-previas', semIndefinidos({
          unidadeId: i.unidadeId, areaComumId: i.areaComumId ?? undefined, pessoaId: i.pessoaId,
          validaDe: i.validaDe !== undefined ? msParaDia(i.validaDe) : undefined, validaAte: msParaDia(i.validaAte),
          diasSemana: i.diasSemana, horaInicio: i.horaInicio, horaFim: i.horaFim, solicitadaPorPessoaId: i.solicitadaPorPessoaId,
          justificativa: i.justificativa ?? undefined,
        }))).data);
      },
      async revogar(aid) { await http.post(`/autorizacoes-previas/${id(aid)}/revogar`); },
      async vigentes(pessoaId, destinoId, o) {
        const params = o?.areaComum ? { pessoaId, areaComumId: destinoId } : { pessoaId, unidadeId: destinoId };
        return listaDe<AutorizacaoView>((await http.get('/autorizacoes-previas/vigentes', { params })).data);
      },
      async hoje() { return listaDe<AutorizacaoView>((await http.get('/autorizacoes-previas/hoje')).data); },
    },
    restricoes: {
      async verificar(pessoaId, unidadeId) {
        const r = dados<ResultadoRestricao>((await http.get('/restricoes/verificar', { params: unidadeId ? { pessoaId, unidadeId } : { pessoaId } })).data);
        if (!r || typeof r.restrita !== 'boolean' || !Array.isArray(r.alertas)) throw respostaInvalida();
        return r;
      },
      async criar(i) {
        return dados<Restricao>((await http.post('/restricoes', semIndefinidos({
          pessoaId: i.pessoaId, unidadeId: i.unidadeId, motivo: i.motivo, validaAte: msParaDia(i.validaAte),
          solicitadaPorPessoaId: i.solicitadaPorPessoaId, paraTodoCondominio: i.paraTodoCondominio || undefined,
        }))).data);
      },
      async aprovar(rid) { return dados<Restricao>((await http.post(`/restricoes/${id(rid)}/aprovar`)).data); },
      async revogar(rid) { await http.post(`/restricoes/${id(rid)}/revogar`); },
      async pendentes() { return listaDe<RestricaoView>((await http.get('/restricoes/pendentes')).data); },
    },
    eventos: {
      async criar(i) {
        return eventoDe(dados<EventoView>((await http.post('/eventos-acesso', semIndefinidos({
          pessoaId: i.pessoaId, unidadeDestinoId: i.unidadeDestinoId, areaComumId: i.areaComumId ?? undefined,
          autorizadoPorTipo: i.autorizadoPorTipo ?? null, autorizadoPorPessoaId: i.autorizadoPorPessoaId ?? undefined,
          autorizacaoPreviaId: i.autorizacaoPreviaId ?? undefined, justificativa: i.justificativa ?? undefined, retroativo: i.retroativo || undefined,
          ocorridoEm: i.retroativo && i.ocorridoEm ? Math.trunc(i.ocorridoEm) : undefined, observacao: i.observacao ?? undefined,
          formularioContingencia: i.retroativo ? i.formularioContingencia ?? undefined : undefined,
          tipoVisita: i.tipoVisita ?? undefined,
        }))).data));
      },
      async registrarRecusa(i) {
        return eventoDe(dados<EventoView>((await http.post('/eventos-acesso/recusas', semIndefinidos({
          pessoaId: i.pessoaId, unidadeDestinoId: i.unidadeDestinoId, meio: i.meio, moradorPessoaId: i.moradorPessoaId,
          observacao: i.observacao ?? undefined, retroativo: i.retroativo || undefined,
          ocorridoEm: i.retroativo && i.ocorridoEm ? Math.trunc(i.ocorridoEm) : undefined,
          formularioContingencia: i.retroativo ? i.formularioContingencia ?? undefined : undefined,
        }))).data));
      },
      async registrarSaida(entradaId, o = {}) {
        return eventoDe(dados<EventoView>((await http.post(`/eventos-acesso/${id(entradaId)}/saida`, semIndefinidos({
          observacao: o.observacao?.trim() || undefined, retroativo: o.retroativo || undefined,
          ocorridoEm: o.retroativo && o.ocorridoEm ? Math.trunc(o.ocorridoEm) : undefined,
          formularioContingencia: o.retroativo ? o.formularioContingencia ?? undefined : undefined,
        }))).data));
      },
      async corrigir(eid, i) {
        const v = i.valores;
        const valores = v ? semIndefinidos({
          unidadeDestinoId: v.unidadeDestinoId, ocorridoEm: v.ocorridoEm !== undefined ? Math.trunc(v.ocorridoEm) : undefined,
          pessoaId: v.pessoaId, autorizadoPorPessoaId: v.autorizadoPorPessoaId,
        }) : undefined;
        return eventoDe(dados<EventoView>((await http.post(`/eventos-acesso/${id(eid)}/correcoes`, semIndefinidos({
          justificativa: i.justificativa, observacao: i.observacao?.trim() || undefined, valores: valores && Object.keys(valores).length ? valores : undefined,
        }))).data));
      },
      listarPagina: eventosPagina,
      async listar(f = {}) {
        const itens: EventoView[] = [];
        let cursor: string | null = null;
        for (let i = 0; i < MAX_PAGINAS; i++) {
          const p = await eventosPagina({ ...f, limite: 100, cursor });
          itens.push(...p.itens);
          if (!p.temMais || !p.cursor) return itens;
          cursor = p.cursor;
        }
        throw new ApiError(502, 'PAGINACAO_EXCEDIDA', 'A listagem tem mais páginas do que esta tela consegue mostrar. Use filtros.');
      },
      async correcoesDe(eid) { return listaDe<EventoView>((await http.get(`/eventos-acesso/${id(eid)}/correcoes`)).data, eventoDe); },
      async obter(eid) { return eventoDe(dados<EventoView>((await http.get(`/eventos-acesso/${id(eid)}`)).data)); },
      // Todas as páginas; a ordem final é pela hora efetiva (a API pagina por seq).
      async presentes() {
        return (await todasAsPaginas<EventoView>('/acessos/presentes')).map(eventoDe).sort((a, b) => b.ocorridoEm - a.ocorridoEm);
      },
      async prorrogarPermanencia(entradaId) {
        const p = dados<PermanenciaView & { eventoId: string }>((await http.post(`/eventos-acesso/${id(entradaId)}/permanencia/prorrogacoes`)).data);
        if (!p || typeof p.prazoAte !== 'number' || typeof p.prorrogacoes !== 'number') throw respostaInvalida();
        return p;
      },
    },
    encomendas: {
      async listar(f) { return (await todasAsPaginas<EncomendaView>('/encomendas', f?.status ? { status: f.status } : {})).map(encomendaDe); },
      async listarPagina(f: FiltroEncomendas = {}) {
        const params: Record<string, string | number> = { limite: f.limite ?? 50 };
        if (f.status) params.status = f.status;
        if (f.unidadeId) params.unidadeId = f.unidadeId;
        if (f.atrasadasDias !== undefined) params.atrasadasDias = f.atrasadasDias;
        if (f.cursor) params.cursor = f.cursor;
        const p = paginaDe<EncomendaView>((await http.get('/encomendas', { params })).data);
        return { ...p, itens: p.itens.map(encomendaDe) };
      },
      async resumo(dias) {
        const r = dados<ResumoEncomendas>((await http.get('/encomendas/resumo', { params: dias !== undefined ? { dias } : {} })).data);
        if (typeof r?.aguardando !== 'number' || typeof r.atrasadas !== 'number') throw respostaInvalida();
        return r;
      },
      async obter(eid) { return encomendaDe(dados<EncomendaView>((await http.get(`/encomendas/${id(eid)}`)).data)); },
      async receber(i) {
        return encomendaDe(dados<EncomendaView>((await http.post('/encomendas', {
          unidadeId: i.unidadeId, destinatario: i.destinatario, transportadora: i.transportadora, codigoRastreio: i.codigoRastreio,
          unidadeConfirmada: i.unidadeConfirmada,
        })).data));
      },
      async entregar(i) {
        return encomendaDe(dados<EncomendaView>((await http.post(`/encomendas/${id(i.id)}/retirada`, { pessoaId: i.pessoaId })).data));
      },
      async autorizarRetirada(i) {
        const a = dados<AutorizacaoRetirada>((await http.post(`/encomendas/${id(i.encomendaId)}/autorizacoes-retirada`, {
          pessoaId: i.pessoaId, solicitadaPorPessoaId: i.solicitadaPorPessoaId,
        })).data);
        if (!a || typeof a.id !== 'string') throw respostaInvalida();
        return a;
      },
    },
    ocorrencias: {
      async listar() { return (await todasAsPaginas<OcorrenciaView>('/ocorrencias')).map(ocorrenciaDe); },
      async listarPagina(f: FiltroOcorrencias = {}) {
        const params: Record<string, string | number> = { limite: f.limite ?? 50 };
        if (f.status?.length) params.status = f.status.join(',');
        if (f.tipo) params.tipo = f.tipo;
        if (f.unidadeId) params.unidadeId = f.unidadeId;
        if (f.cursor) params.cursor = f.cursor;
        const p = paginaDe<OcorrenciaView>((await http.get('/ocorrencias', { params })).data);
        return { ...p, itens: p.itens.map(ocorrenciaDe) };
      },
      async obter(oid) { return ocorrenciaDe(dados<OcorrenciaView>((await http.get(`/ocorrencias/${id(oid)}`)).data)); },
      // Os anexos não vão aqui: a tela envia cada arquivo por `anexar` depois de criar.
      async criar(i) {
        return ocorrenciaDe(dados<OcorrenciaView>((await http.post('/ocorrencias', {
          tipo: i.tipo, descricao: i.descricao, unidadeId: i.unidadeId, envolvidos: i.envolvidos ?? '', eventoIds: i.eventoIds ?? [],
        })).data));
      },
      async alterarStatus(oid, status) {
        return ocorrenciaDe(dados<OcorrenciaView>((await http.post(`/ocorrencias/${id(oid)}/status`, { status })).data));
      },
      async vincularEventos(oid, eventoIds) {
        return ocorrenciaDe(dados<OcorrenciaView>((await http.post(`/ocorrencias/${id(oid)}/eventos`, { eventoIds })).data));
      },
      // multipart: o Content-Type explícito evita que o axios converta o FormData em JSON (o padrão do cliente é JSON);
      // no navegador, o próprio axios o remove para o browser pôr o boundary.
      async anexar(oid, arquivo) {
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        return ocorrenciaDe(dados<OcorrenciaView>((await http.post(`/ocorrencias/${id(oid)}/anexos`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60_000,
        })).data));
      },
      async baixarAnexo(oid, docId) {
        const r = await http.get(`/ocorrencias/${id(oid)}/anexos/${id(docId)}`, { responseType: 'blob' });
        const mime = typeof r.headers['content-type'] === 'string' ? r.headers['content-type'] : 'application/octet-stream';
        if (!(r.data instanceof Blob)) throw respostaInvalida();
        return { nome: nomeDoAnexo(r.headers['content-disposition']), mime, conteudo: r.data };
      },
    },
    turno: {
      async resumo() {
        const r = dados<ResumoTurno>((await http.get('/turnos/resumo')).data);
        if (typeof r?.pessoasDentro !== 'number') throw respostaInvalida();
        return r;
      },
    },
    relatorios: {
      async resumo(f) {
        const r = dados<RelatorioResumo>((await http.get('/relatorios/resumo', { params: filtroRelatorio(f) })).data);
        if (!r?.periodo || !Array.isArray(r.acessosPorDia)) throw respostaInvalida();
        return r;
      },
      async exportarCsv(f) { return pacoteDe((await http.get('/relatorios/resumo/csv', { params: filtroRelatorio(f) })).data); },
    },
    auditoria: {
      async verificarIntegridade() {
        const r = dados<ResultadoIntegridade>((await http.get('/auditoria/integridade')).data);
        if (typeof r?.valido !== 'boolean') throw respostaInvalida();
        return r;
      },
      async alteracoesPagina(f: FiltroAlteracoesPagina = {}) {
        const params: Record<string, string | number> = { limite: f.limite ?? 50 };
        if (f.de !== undefined) params.de = Math.trunc(f.de);
        if (f.ate !== undefined) params.ate = Math.trunc(f.ate);
        if (f.usuarioId) params.usuarioId = f.usuarioId;
        if (f.acao) params.acao = f.acao;
        if (f.entidade) params.entidade = f.entidade;
        if (f.cursor) params.cursor = f.cursor;
        return paginaDe<RegistroAlteracao>((await http.get('/auditoria/alteracoes', { params })).data);
      },
      async alteracoes(f = {}) {
        const extra: Record<string, string> = {};
        if (f.acao) extra.acao = f.acao;
        if (f.entidade) extra.entidade = f.entidade;
        if (f.usuarioId) extra.usuarioId = f.usuarioId;
        if (f.de !== undefined) extra.de = String(Math.trunc(f.de));
        if (f.ate !== undefined) extra.ate = String(Math.trunc(f.ate));
        return todasAsPaginas<RegistroAlteracao>('/auditoria/alteracoes', extra);
      },
      async exportar(f = {}) { return pacoteDe((await http.post('/auditoria/exportacoes', filtroCorpo(f))).data); },
      async selos() {
        const r = dados<Omit<EstadoSelos, 'ultimo'> & { ultimo: SeloApi | null }>((await http.get('/auditoria/selos')).data);
        if (!r || typeof r.pendentesEnvio !== 'number' || !Array.isArray(r.destinos)) throw respostaInvalida();
        return { ultimo: r.ultimo ? seloDe(r.ultimo) : null, pendentesEnvio: r.pendentesEnvio, destinos: r.destinos, agendador: r.agendador === true };
      },
      async selar() {
        const r = dados<Omit<ResultadoSelar, 'selo'> & { selo: SeloApi }>((await http.post('/auditoria/selos')).data);
        if (!r || typeof r.novo !== 'boolean' || !['enviada', 'pendente', 'sem_destino'].includes(r.ancora)) throw respostaInvalida();
        return { selo: seloDe(r.selo), novo: r.novo, ancora: r.ancora };
      },
      async conferirAncora({ seq, hash }) {
        const r = dados<ConferenciaAncora>((await http.post('/auditoria/selos/conferir', { seq, hash: hash.trim().toLowerCase() })).data);
        if (!r || typeof r.confere !== 'boolean' || typeof r.motivo !== 'string') throw respostaInvalida();
        return r;
      },
    },
    lgpd: {
      async exportarPessoa(pid) { return pacoteDe((await http.get(`/lgpd/pessoas/${id(pid)}/exportacao`)).data); },
      async anonimizar(pid) {
        const r = dados<Omit<ResultadoAnonimizacao, 'retidoAte'> & { retidoAte?: string | null }>((await http.post(`/lgpd/pessoas/${id(pid)}/anonimizar`)).data);
        if (!r || typeof r.pessoaId !== 'string' || typeof r.registrosRedigidos !== 'number' || !Array.isArray(r.retido)) throw respostaInvalida();
        return { ...r, retidoAte: diaParaMs(r.retidoAte ?? null) };
      },
      async aplicarRetencao() { return retencaoDe(dados<ResultadoRetencao>((await http.post('/lgpd/retencao')).data)); },
      async ultimaRetencao() {
        const r = dados<{ ultima?: ExecucaoRetencao | null } | null>((await http.get('/lgpd/retencao')).data);
        if (!r || !('ultima' in r)) throw respostaInvalida();
        const u = r.ultima;
        if (u === null || u === undefined) return null;
        if (typeof u.em !== 'number' || typeof u.porNome !== 'string') throw respostaInvalida();
        return { em: u.em, porNome: u.porNome, resultado: retencaoDe(u.resultado) };
      },
    },
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
