// Implementação em memória da API. As regras de negócio são aplicadas AQUI (o "servidor"),
// não apenas na UI: RN-01, RF-16, RF-17, RN-03, RN-07, RN-08, RN-04 e a matriz RBAC.
// Alinhado ao schema do banco (apps/api/src/db/schema.ts): unidade com id uuid, entidades com ids de usuário
// (nomes só nas views), hash da trilha com a serialização canônica v1 do domain (a mesma do trigger do banco).
import type {
  Api, Autorizador, AutorizacaoView, Catalogo, EncomendaView, FichaPessoa, FiltroEventos, FiltroRelatorio, FuncionarioView,
  InconsistenciaImportacao, LinhaPlanilha, NovaPessoaInput, OcorrenciaView, PessoaBusca, RelatorioImportacao, RelatorioResumo,
  RestricaoView, UnidadeDetalhe, UnidadeResumo, VinculoView,
} from '../types';
import { ApiError } from '../types';
import type {
  AutorizacaoPrevia, CategoriaPessoa, Encomenda, EventoAcesso, EventoView, Importacao, Ocorrencia, Pessoa,
  RegistroAlteracao, Restricao, StatusOcorrencia, Unidade, UsuarioSistema, ValoresCorrecao, VinculoUnidade,
} from '@portaria/domain/types';
import { CAMPOS_CORRIGIVEIS, ROTULO_CATEGORIA, ROTULO_MEIO, ROTULO_PAPEL } from '@portaria/domain/types';
import { pode, type Acao } from '@portaria/domain/rbac';
import {
  cadastroCompleto, cpfValido, elegivelRetencao, escalaVigente, estadoAutorizacaoPrevia, justificativaValida, legadoVencido,
  MIN_JUSTIFICATIVA, pessoaTemVinculoValido, podeEntregarEncomenda, restricoesVigentes, validarAutorizacaoEntrada,
  validarConferencia, validarDecisaoVinculo, validarEscala, vinculoValido, vinculosValidosDaUnidade,
} from '@portaria/domain/rules';
import {
  CAMPOS_CANONICOS_V1, CHAVES_CORRECAO_V1, FORMATO_HASH, calcularHash, codigoEvento, hashGenese, paraExportado, sha256Hex,
  verificarCadeiaEventos,
} from '@portaria/domain/hashChain';
import { CHAVE_HMAC_DEMO, documentoBuscaCpf, mascararCpf, soDigitos } from '@portaria/domain/cpf';
import { DIA, agora, fimDoDia, fmtData, fmtHora, inicioDoDia, partes, relogio } from '@portaria/domain/time';
import {
  acharUnidadePorTexto, codigoUnidade, compararUnidades, PORTARIA_SOCIAL, rotuloUnidade, validarEstruturaUnidade,
} from '@portaria/domain/units';
import { VERSAO_DB, type DbData } from './dbTypes';
import { criarSeed } from './seed';
import { dt, ID_PORTARIA_SOCIAL, novoUuid, slug } from './seedUtil';

export interface MockOptions {
  /** [min, max] em ms, ou 0 para desligar (testes). Padrão: [100, 300]. */
  latencia?: [number, number] | 0;
  /** Persistir em localStorage (padrão: true no navegador). */
  persistir?: boolean;
  chaveStorage?: string;
  /** Registra window.__adulterarEvento etc. (padrão: true quando há window). */
  ferramentasDev?: boolean;
}

const CHAVE_PADRAO = 'portaria-parque:db:v1';
const CHAVE_SESSAO = 'portaria-parque:sessao:v1';
const PRAZO_LEGADO = dt('31/03/2027');

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const SEM_CPF = '(sem CPF)';
const ANONIMIZADO = '(anonimizado)';
const NOME_ANONIMIZADO = 'Pessoa anonimizada';
const telefoneValido = (t?: string | null) => /^\d{10,11}$/.test(soDigitos(t ?? ''));
const mascararTelefone = (t?: string | null) => { const d = soDigitos(t ?? ''); return d.length >= 4 ? `(**) *****-${d.slice(-4)}` : null; };
/** Campos de pessoa removidos dos snapshots na redação LGPD (iguais a `lgpd_redigir_audit_pessoa`). */
const CAMPOS_REDIGIDOS = ['nome', 'telefone', 'documentoMascarado', 'empresa', 'servico'];

// ----- Trilha de alterações: snapshots sem dado pessoal em claro --------------------------------
const CPF_COMPLETO = /(\d{3})\.(\d{3})\.(\d{3})-(\d{2})/g;
function semPII(v: unknown, chave = ''): unknown {
  if (Array.isArray(v)) return v.map((x) => semPII(x, chave));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'documentoBusca') o[k] = semPII(x, k); // o HMAC do CPF também fica de fora
    return o;
  }
  if (typeof v !== 'string') return v;
  if (chave === 'telefone') return mascararTelefone(v) ?? '***';
  return v.replace(CPF_COMPLETO, (_m, _a, b, c) => `***.${b}.${c}-**`);
}
const snap = (v: unknown): Record<string, unknown> | null => (v === null || v === undefined ? null : (semPII(structuredClone(v)) as Record<string, unknown>));

let contadorId = 0;
const uid = (prefixo: string) => `${prefixo}-${Date.now().toString(36)}${(++contadorId).toString(36)}`;
const isoSP = (ts: number) => new Date(ts - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00');

export function createMockApi(opts: MockOptions = {}): Api {
  const latencia = opts.latencia ?? [100, 300];
  const temStorage = typeof localStorage !== 'undefined';
  const persistir = opts.persistir ?? temStorage;
  const chave = opts.chaveStorage ?? CHAVE_PADRAO;

  let db: DbData | null = null;
  let carregando: Promise<DbData> | null = null;
  let sessao: UsuarioSistema | null = null;
  /** Linhas válidas da planilha entre "analisar" e "confirmar" (não persistem: contêm CPF em claro). */
  const linhasImportacao = new Map<string, LinhaPlanilha[]>();

  // ----- Persistência (opcional, nunca derruba o app) --------------------------------------------
  function lerStorage(): DbData | null {
    if (!persistir) return null;
    try {
      const bruto = localStorage.getItem(chave);
      if (!bruto) return null;
      const d = JSON.parse(bruto) as DbData;
      return d.versao === VERSAO_DB ? d : null;
    } catch { return null; }
  }
  function salvar() {
    if (!persistir || !db) return;
    try {
      db.salvoEm = agora();
      localStorage.setItem(chave, JSON.stringify(db));
    } catch { /* quota cheia ou storage bloqueado: segue só em memória */ }
  }
  function carregar(): Promise<DbData> {
    if (db) return Promise.resolve(db);
    carregando ??= (async () => {
      const salvo = lerStorage();
      if (salvo) {
        db = salvo;
        relogio.definir(salvo.salvoEm); // o relógio retoma de onde parou
      } else {
        db = await criarSeed();
        salvar();
      }
      restaurarSessao();
      return db;
    })();
    return carregando;
  }
  function restaurarSessao() {
    if (!persistir || !db) return;
    try {
      const id = sessionStorage.getItem(CHAVE_SESSAO);
      sessao = id ? db.usuarios.find((u) => u.id === id && u.ativo) ?? null : null;
    } catch { sessao = null; }
  }
  function gravarSessao() {
    try {
      if (sessao) sessionStorage.setItem(CHAVE_SESSAO, sessao.id); else sessionStorage.removeItem(CHAVE_SESSAO);
    } catch { /* ignora */ }
  }

  const esperar = () => {
    if (latencia === 0) return Promise.resolve();
    const [min, max] = latencia;
    return new Promise<void>((r) => setTimeout(r, min + Math.random() * (max - min)));
  };
  const clone = <T>(v: T): T => structuredClone(v);

  /** Leitura: não persiste. */
  async function ler<T>(fn: (d: DbData) => T | Promise<T>): Promise<T> {
    await esperar();
    const d = await carregar();
    return clone(await fn(d));
  }
  /** Escrita: persiste mesmo quando a regra lança erro (ex.: evento "negado" gravado antes do 422). */
  async function escrever<T>(fn: (d: DbData) => T | Promise<T>): Promise<T> {
    await esperar();
    const d = await carregar();
    try { return clone(await fn(d)); } finally { salvar(); }
  }

  // ----- Autorização (RBAC) ---------------------------------------------------------------------
  function usuario(): UsuarioSistema {
    if (!sessao) throw new ApiError(401, 'NAO_AUTENTICADO', 'Sessão expirada. Entre novamente.');
    return sessao;
  }
  /**
   * Todo 403 grava `acesso.negado` na trilha, com a ação tentada (spec 5.2: "a API rejeita com 403 e grava a tentativa").
   * Roda fora de `escrever`: grava direto no db carregado e salva. Sem db carregado ainda, só nega.
   */
  function negar(u: UsuarioSistema, acao: string, mensagem: string, code = 'SEM_PERMISSAO'): never {
    if (db) {
      registrar(db, u, 'acesso.negado', 'acao', '-', null, { acao });
      salvar();
    }
    throw new ApiError(403, code, mensagem);
  }
  function exige(acao: Acao): UsuarioSistema {
    const u = usuario();
    if (!pode(u.papel, acao)) negar(u, acao, `O perfil ${ROTULO_PAPEL[u.papel]} não tem permissão para esta ação (${acao}).`);
    return u;
  }
  function exigeLogado() { usuario(); }

  /** Trilha de alterações (append-only): todo registro grava quem, quando, o quê, antes e depois (sem PII em claro). */
  function registrar(
    d: DbData, u: Pick<UsuarioSistema, 'id' | 'nome' | 'papel'> | null, acao: string, entidade: string, registroId: string,
    antes: unknown, depois: unknown, nomeInformado = '(desconhecido)',
  ) {
    const reg: RegistroAlteracao = {
      id: uid('al'), seq: (d.auditLog[d.auditLog.length - 1]?.seq ?? 0) + 1, em: agora(),
      usuarioId: u?.id ?? null, usuarioNome: u?.nome ?? nomeInformado, usuarioPapel: u?.papel ?? null,
      acao, entidade, registroId, antes: snap(antes), depois: snap(depois), redigidoEm: null,
    };
    d.auditLog.push(reg);
  }

  // ----- Índices e visões -----------------------------------------------------------------------
  function indices(d: DbData) {
    const pessoas = new Map(d.pessoas.map((p) => [p.id, p]));
    const usuarios = new Map(d.usuarios.map((u) => [u.id, u]));
    const unidades = new Map(d.unidades.map((u) => [u.id, u]));
    const areas = new Map(d.areasComuns.map((a) => [a.id, a]));
    const pontos = new Map(d.pontosAcesso.map((p) => [p.id, p]));
    const autorizacoes = new Map(d.autorizacoes.map((a) => [a.id, a]));
    const saidas = new Map<string, EventoAcesso>();
    const porId = new Map(d.eventos.map((e) => [e.id, e]));
    // Última correção de cada evento (os eventos já estão em ordem de seq)
    const correcoes = new Map<string, EventoAcesso>();
    for (const e of d.eventos) {
      if (e.tipo === 'saida' && e.refereEventoId) saidas.set(e.refereEventoId, e);
      if (e.tipo === 'correcao' && e.corrigeEventoId) correcoes.set(e.corrigeEventoId, e);
    }
    /** Valores EFETIVOS = original + última correção (spec 4.4). O registro gravado nunca muda. */
    const ef = (e: EventoAcesso): EventoAcesso => {
      const c = correcoes.get(e.id);
      return c?.correcaoValores ? { ...e, ...c.correcaoValores } : e;
    };
    const semSolicitante = new Set(d.autorizacoes.filter((a) => a.semSolicitante).map((a) => a.id));
    const nomeUsuario = (id: string | null | undefined) => (id ? usuarios.get(id)?.nome ?? '(usuário)' : null);
    const nomePessoa = (id: string | null | undefined) => (id ? pessoas.get(id)?.nome ?? '(pessoa)' : null);
    const comPapel = (id: string) => { const u = usuarios.get(id); return u ? `${u.nome} (${ROTULO_PAPEL[u.papel]})` : '(usuário)'; };
    const codigoUn = (id: string | null | undefined) => { if (!id) return null; const u = unidades.get(id); return u ? codigoUnidade(u) : '(unidade)'; };
    return {
      pessoas, usuarios, unidades, areas, pontos, autorizacoes, saidas, porId, correcoes, ef, semSolicitante,
      nomeUsuario, nomePessoa, comPapel, codigoUn,
    };
  }
  type Ix = ReturnType<typeof indices>;

  /** Quem autorizou, resolvido pelo id; autorização sem solicitante/área comum: quem cadastrou. */
  function nomeAutorizador(ev: Pick<EventoAcesso, 'autorizadoPorPessoaId' | 'autorizadoPorTipo' | 'autorizacaoPreviaId'>, ix: Ix): string | null {
    if (ev.autorizadoPorPessoaId) return ix.nomePessoa(ev.autorizadoPorPessoaId);
    if (ev.autorizadoPorTipo === 'autorizacao_previa' && ev.autorizacaoPreviaId) {
      const ap = ix.autorizacoes.get(ev.autorizacaoPreviaId);
      if (ap?.areaComumId) return `Área comum — cadastrada por ${ix.nomeUsuario(ap.cadastradaPorId)}`;
      if (ap?.semSolicitante) return `Sem solicitante — cadastrada por ${ix.nomeUsuario(ap.cadastradaPorId)}`;
    }
    return null;
  }

  function view(bruto: EventoAcesso, ix: Ix): EventoView {
    const ev = ix.ef(bruto);
    const saida = ev.tipo === 'entrada' ? ix.saidas.get(ev.id) ?? null : null;
    const entrada = ev.tipo === 'saida' && ev.refereEventoId ? ix.porId.get(ev.refereEventoId) : undefined;
    const c = ix.correcoes.get(bruto.id);
    const aplicados: Partial<ValoresCorrecao> = c?.correcaoValores ?? {};
    const valoresOriginais: Partial<ValoresCorrecao> = {};
    for (const k of CAMPOS_CORRIGIVEIS) if (k in aplicados) (valoresOriginais as Record<string, unknown>)[k] = bruto[k];
    const corrigidos = bruto.tipo === 'correcao' ? bruto.correcaoValores : null;
    return {
      ...ev,
      codigo: codigoEvento(bruto.seq),
      pessoaNome: ix.pessoas.get(ev.pessoaId)?.nome ?? '(pessoa removida)',
      operadorNome: ix.usuarios.get(ev.operadorId)?.nome ?? '(operador)',
      unidadeRotulo: ev.unidadeDestinoId ? ix.codigoUn(ev.unidadeDestinoId) : ev.areaComumId ? ix.areas.get(ev.areaComumId)?.nome ?? '(área comum)' : null,
      areaComumNome: ev.areaComumId ? ix.areas.get(ev.areaComumId)?.nome ?? '(área comum)' : null,
      pontoAcessoNome: ix.pontos.get(ev.pontoAcessoId)?.nome ?? PORTARIA_SOCIAL,
      autorizadoPorNome: nomeAutorizador(ev, ix),
      saida: saida ? { id: saida.id, codigo: codigoEvento(saida.seq), em: ix.ef(saida).ocorridoEm } : null,
      dentro: ev.tipo === 'entrada' && !saida,
      entradaCodigo: entrada ? codigoEvento(entrada.seq) : null,
      valoresOriginais: Object.keys(valoresOriginais).length > 0 ? valoresOriginais : null,
      correcao: c ? {
        id: c.id, codigo: codigoEvento(c.seq), em: c.registradoEm, justificativa: c.justificativa, observacao: c.observacao,
        operadorNome: ix.usuarios.get(c.operadorId)?.nome ?? '(operador)',
      } : null,
      valoresCorrigidos: corrigidos,
      pessoaNomeOriginal: 'pessoaId' in aplicados ? ix.pessoas.get(bruto.pessoaId)?.nome ?? null : null,
      pessoaNomeCorrigida: corrigidos?.pessoaId ? ix.pessoas.get(corrigidos.pessoaId)?.nome ?? null : null,
      autorizadoPorNomeOriginal: 'autorizadoPorPessoaId' in aplicados ? nomeAutorizador(bruto, ix) : null,
      autorizadoPorNomeCorrigido: corrigidos && 'autorizadoPorPessoaId' in corrigidos ? ix.nomePessoa(corrigidos.autorizadoPorPessoaId) : null,
      autorizacaoSemSolicitante: !!ev.autorizacaoPreviaId && ix.semSolicitante.has(ev.autorizacaoPreviaId),
    };
  }

  const vinculoView = (v: VinculoUnidade, ix: Ix): VinculoView => ({
    ...v, pessoaNome: ix.pessoas.get(v.pessoaId)?.nome ?? '?', pessoaDocumento: ix.pessoas.get(v.pessoaId)?.documentoMascarado ?? '',
    pessoaCadastroCompleto: cadastroCompleto(ix.pessoas.get(v.pessoaId)),
    unidadeCodigo: ix.codigoUn(v.unidadeId) ?? '?', decididoPorNome: ix.nomeUsuario(v.decididoPorId),
    registradoPorNome: ix.nomeUsuario(v.registradoPorId), conferidoPorNome: ix.nomeUsuario(v.conferencia?.conferidoPorId),
    legadoVencido: legadoVencido(v, agora()),
  });
  const restricaoView = (r: Restricao, ix: Ix): RestricaoView => ({
    ...r, pessoaNome: ix.pessoas.get(r.pessoaId)?.nome ?? '?', pendente: r.escopo === 'condominio' && r.aprovadaEm === null,
    unidadeCodigo: ix.codigoUn(r.unidadeId), cadastradaPorNome: ix.comPapel(r.cadastradaPorId),
    solicitadaPorNome: ix.nomePessoa(r.solicitadaPorPessoaId), aprovadaPorNome: ix.nomeUsuario(r.aprovadaPorId),
    revogadaPorNome: ix.nomeUsuario(r.revogadaPorId),
  });
  function autorizacaoView(a: AutorizacaoPrevia, d: DbData, ix: Ix, quando = agora()): AutorizacaoView {
    const uso = d.eventos.find((e) => e.autorizacaoPreviaId === a.id && e.tipo === 'entrada' && e.ocorridoEm >= inicioDoDia(quando) && e.ocorridoEm <= fimDoDia(quando));
    return {
      ...a, pessoaNome: ix.pessoas.get(a.pessoaId)?.nome ?? '?', estado: estadoAutorizacaoPrevia(a, quando),
      unidadeRotulo: a.unidadeId ? ix.codigoUn(a.unidadeId) ?? '?' : ix.areas.get(a.areaComumId ?? '')?.nome ?? '(área comum)',
      utilizadaEm: uso?.ocorridoEm ?? null, cadastradaPorNome: ix.comPapel(a.cadastradaPorId),
      solicitadaPorNome: ix.nomePessoa(a.solicitadaPorPessoaId), revogadaPorNome: ix.nomeUsuario(a.revogadaPorId),
    };
  }
  function encomendaView(e: Encomenda, d: DbData, ix: Ix): EncomendaView {
    let retiradaPorNome: string | null = null;
    if (e.retiradaPorPessoaId) {
      const nome = ix.nomePessoa(e.retiradaPorPessoaId);
      const aut = e.retiradaAutorizacaoId ? d.autorizacoesRetirada.find((a) => a.id === e.retiradaAutorizacaoId) : undefined;
      const v = d.vinculos.find((x) => x.pessoaId === e.retiradaPorPessoaId && x.unidadeId === e.unidadeId);
      retiradaPorNome = aut
        ? `${nome} (autorizado por ${ix.nomePessoa(aut.solicitantePessoaId)})`
        : `${nome} (${v?.tipo === 'dependente' ? 'dependente' : v?.tipo === 'inquilino' ? 'inquilino' : 'morador'})`;
    }
    return {
      ...e, unidadeCodigo: ix.codigoUn(e.unidadeId) ?? '?', recebidaPorNome: ix.nomeUsuario(e.recebidaPorId) ?? '?',
      retiradaPorNome, retiradaRegistradaPorNome: ix.nomeUsuario(e.retiradaRegistradaPorId),
      autorizacoes: d.autorizacoesRetirada.filter((a) => a.encomendaId === e.id).map((a) => ({
        ...a, pessoaNome: ix.nomePessoa(a.pessoaAutorizadaId) ?? '?', solicitanteNome: ix.nomePessoa(a.solicitantePessoaId) ?? '?',
      })),
    };
  }
  const ocorrenciaView = (o: Ocorrencia, ix: Ix): OcorrenciaView => ({
    ...o, abertaPorNome: ix.nomeUsuario(o.abertaPorId) ?? '?',
    historicoStatus: o.historicoStatus.map((h) => ({ ...h, porNome: ix.nomeUsuario(h.porId) ?? '?' })),
  });

  /** Último acesso (valores efetivos), sem saída e correção. */
  function ultimoAcesso(d: DbData, ix: Ix, pessoaId: string): EventoAcesso | undefined {
    for (let i = d.eventos.length - 1; i >= 0; i--) {
      const e = ix.ef(d.eventos[i]);
      if (e.pessoaId === pessoaId && e.tipo !== 'saida' && e.tipo !== 'correcao') return e;
    }
    return undefined;
  }
  function ultimoAcessoTexto(d: DbData, ix: Ix, pessoaId: string): string {
    const ult = ultimoAcesso(d, ix, pessoaId);
    if (!ult) return 'Sem acessos';
    const hoje = fmtData(agora()) === fmtData(ult.ocorridoEm);
    const quando = hoje ? `Hoje ${fmtHora(ult.ocorridoEm)}` : fmtData(ult.ocorridoEm).slice(0, 5);
    const destino = ult.unidadeDestinoId ? ix.codigoUn(ult.unidadeDestinoId) : ult.areaComumId ? ix.areas.get(ult.areaComumId)?.nome : null;
    return `${quando}${destino ? ` · ${destino}` : ''}${ult.tipo === 'negado' ? ' (negado)' : ult.tipo === 'recusado' ? ' (recusado)' : ''}`;
  }
  function pessoaBusca(d: DbData, p: Pessoa, ix: Ix = indices(d)): PessoaBusca {
    const n = agora();
    const ids = d.vinculos.filter((v) => v.pessoaId === p.id && vinculoValido(v, n)).map((v) => v.unidadeId);
    return { ...p, ultimoAcesso: ultimoAcessoTexto(d, ix, p.id), unidadesVinculadas: ids, unidadesVinculadasCodigos: ids.map((id) => ix.codigoUn(id) ?? '?') };
  }

  // ----- Unidades e áreas comuns (RF-01, RF-36) ---------------------------------------------------
  /** Unidade pelo id; `paraNovo`: nova entrada, encomenda, vínculo etc. não aceitam unidade inativa. */
  function unidadeOu404(d: DbData, id: string, paraNovo = false): Unidade {
    const u = d.unidades.find((x) => x.id === id);
    if (!u) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
    if (paraNovo && !u.ativo) throw new ApiError(422, 'UNIDADE_INATIVA', `A unidade ${codigoUnidade(u)} está desativada.`);
    return u;
  }
  function areaOu404(d: DbData, id: string, paraNovo = false) {
    const a = d.areasComuns.find((x) => x.id === id);
    if (!a) throw new ApiError(404, 'AREA_COMUM_NAO_ENCONTRADA', 'Área comum não encontrada.');
    if (paraNovo && !a.ativo) throw new ApiError(422, 'AREA_COMUM_INATIVA', `A área comum ${a.nome} está desativada.`);
    return a;
  }
  /** Resumo de cada unidade (lista e página de Unidades), na ordem recebida. */
  function resumosUnidades(d: DbData, us: readonly Unidade[]): UnidadeResumo[] {
    const n = agora();
    return [...us].sort(compararUnidades).map((unidade) => {
      const vs = d.vinculos.filter((v) => v.unidadeId === unidade.id);
      return {
        unidade,
        moradoresValidos: vs.filter((v) => vinculoValido(v, n)).length,
        pendentes: vs.filter((v) => v.status === 'pendente').length,
        restricoes: d.restricoes.filter((r) => r.unidadeId === unidade.id && r.revogadaEm === null && n <= r.validaAte).length,
        cadastroCompleto: vs.some((v) => v.status === 'aprovado' && vinculoValido(v, n)),
      };
    });
  }
  /** Unidade referenciada por qualquer registro (não muda de número; e nunca é excluída). */
  const unidadeReferenciada = (d: DbData, id: string) =>
    d.vinculos.some((v) => v.unidadeId === id) || d.veiculos.some((v) => v.unidadeId === id)
    || d.autorizacoes.some((a) => a.unidadeId === id) || d.restricoes.some((r) => r.unidadeId === id)
    || d.encomendas.some((e) => e.unidadeId === id) || d.ocorrencias.some((o) => o.unidadeId === id)
    || d.eventos.some((e) => e.unidadeDestinoId === id || e.correcaoValores?.unidadeDestinoId === id);

  // ----- Trilha: gravação com encadeamento -------------------------------------------------------
  type BaseEvento = Omit<EventoAcesso, 'id' | 'seq' | 'hash' | 'hashAnterior' | 'registradoEm' | 'operadorPapel' | 'formatoHash'
    | 'pontoAcessoId' | 'areaComumId' | 'formularioContingencia' | 'correcaoValores' | 'empresa' | 'servico'>
    & { pontoAcessoId?: string; areaComumId?: string | null; formularioContingencia?: string | null; correcaoValores?: Partial<ValoresCorrecao> | null; empresa?: string | null; servico?: string | null };
  /**
   * Faz o papel do trigger `evento_acesso_antes_inserir`: numera (seq), carimba registradoEm (monotônico em seq),
   * iguala ocorridoEm a registradoEm fora da contingência e calcula o hash com a serialização canônica v1.
   */
  async function gravarEvento(d: DbData, base: BaseEvento): Promise<EventoAcesso> {
    const ultimo = d.eventos[d.eventos.length - 1];
    const registradoEm = Math.max(agora(), ultimo?.registradoEm ?? 0); // sempre o relógio do servidor
    const semHash: Omit<EventoAcesso, 'hash'> = {
      ...base, id: uid('ev'), seq: (ultimo?.seq ?? 0) + 1, formatoHash: FORMATO_HASH,
      pontoAcessoId: base.pontoAcessoId ?? ID_PORTARIA_SOCIAL, areaComumId: base.areaComumId ?? null,
      operadorPapel: usuario().papel, // papel do operador no momento do registro
      formularioContingencia: base.retroativo ? base.formularioContingencia ?? null : null,
      correcaoValores: base.correcaoValores ?? null, empresa: base.empresa ?? null, servico: base.servico ?? null,
      registradoEm, ocorridoEm: base.retroativo ? base.ocorridoEm : registradoEm,
      hashAnterior: ultimo?.hash ?? (await hashGenese()),
    };
    const ev: EventoAcesso = { ...semHash, hash: await calcularHash(semHash) };
    d.eventos.push(ev); // append-only: nenhum código altera ou remove eventos existentes
    return ev;
  }

  /** Resumo dos relatórios com filtros (RF-30/RF-31). Todos os filtros valem para eventos; unidade vale também para encomendas. */
  function calcularResumo(d: DbData, f: number | FiltroRelatorio = {}): RelatorioResumo {
    const filtro: FiltroRelatorio = typeof f === 'number' ? { de: inicioDoDia(agora() - (f - 1) * DIA) } : f;
    const n = agora();
    const ate = fimDoDia(filtro.ate ?? n);
    const de = inicioDoDia(filtro.de ?? n - 29 * DIA);
    if (de > ate) throw new ApiError(422, 'PERIODO_INVALIDO', 'A data inicial não pode ser posterior à final.');
    if ((ate - de) / DIA > 366) throw new ApiError(422, 'PERIODO_LONGO', 'O período máximo do relatório é de 366 dias.');
    const ix = indices(d);
    const porDia = new Map<number, number>();
    for (let t = de; t <= ate; t += DIA) porDia.set(inicioDoDia(t), 0);
    const meios = new Map<string, number>();
    const exc = new Map<string, number>(); // por operadorId
    const tot = { entradas: 0, negados: 0, recusados: 0, retroativos: 0, excecoes: 0 };
    for (const bruto of d.eventos) {
      const e = ix.ef(bruto); // valores efetivos (original + última correção)
      if (e.ocorridoEm < de || e.ocorridoEm > ate) continue;
      if (filtro.unidadeId && e.unidadeDestinoId !== filtro.unidadeId) continue;
      if (filtro.categoria && e.categoriaPessoa !== filtro.categoria) continue;
      if (filtro.meio && e.autorizadoPorTipo !== filtro.meio) continue;
      if (e.tipo === 'negado') tot.negados++;
      if (e.tipo === 'recusado') tot.recusados++;
      if (e.tipo !== 'entrada') continue;
      tot.entradas++;
      const dia = inicioDoDia(e.ocorridoEm);
      porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
      if (e.autorizadoPorTipo) meios.set(e.autorizadoPorTipo, (meios.get(e.autorizadoPorTipo) ?? 0) + 1);
      if (e.retroativo) tot.retroativos++;
      const resp = responsavelExcecao(d, e);
      if (resp) {
        tot.excecoes++;
        exc.set(resp, (exc.get(resp) ?? 0) + 1);
      }
    }
    const faixas = [['0 a 2 dias', 0, 2], ['3 a 7 dias', 3, 7], ['8 a 14 dias', 8, 14], ['15 dias ou mais', 15, 9999]] as const;
    const pend = d.encomendas.filter((e) => e.retiradaEm === null && (!filtro.unidadeId || e.unidadeId === filtro.unidadeId));
    const completas = new Set(d.vinculos.filter((v) => v.status === 'aprovado' && vinculoValido(v, n)).map((v) => v.unidadeId));
    return {
      periodo: { de, ate },
      acessosPorDia: [...porDia].map(([dia, entradas]) => ({ dia, entradas })),
      acessosPorMeio: [...meios].map(([meio, total]) => ({ meio: meio as RelatorioResumo['acessosPorMeio'][number]['meio'], total })).sort((a, b) => b.total - a.total),
      excecoesPorPorteiro: [...exc].map(([operadorId, total]) => ({ operadorId, operador: ix.usuarios.get(operadorId)?.nome ?? '?', total })).sort((a, b) => b.total - a.total),
      encomendasPorIdade: faixas.map(([faixa, min, max]) => ({
        faixa, total: pend.filter((e) => { const dd = Math.floor((n - e.recebidaEm) / DIA); return dd >= min && dd <= max; }).length,
      })),
      cadastroCompleto: { unidadesCompletas: d.unidades.filter((u) => u.ativo && completas.has(u.id)).length, total: d.unidades.filter((u) => u.ativo).length },
      totais: tot,
    };
  }

  function filtrarEventos(d: DbData, f: FiltroEventos = {}): EventoAcesso[] {
    const ix = indices(d);
    const q = f.pessoa ? norm(f.pessoa) : '';
    // Filtra pelos valores efetivos (com correção), mas devolve o registro gravado
    return d.eventos.filter((bruto) => {
      const e = ix.ef(bruto);
      if (f.eventoId && bruto.id !== f.eventoId) return false;
      if (f.de !== undefined && e.ocorridoEm < f.de) return false;
      if (f.ate !== undefined && e.ocorridoEm > f.ate) return false;
      if (f.unidadeId && e.unidadeDestinoId !== f.unidadeId) return false;
      if (f.operadorId && e.operadorId !== f.operadorId) return false;
      if (f.tipo && e.tipo !== f.tipo) return false;
      if (f.meio && e.autorizadoPorTipo !== f.meio) return false;
      if (f.somenteExcecoes && !responsavelExcecao(d, e)) return false;
      if (f.somenteRetroativos && !e.retroativo) return false;
      if (q && !norm(ix.pessoas.get(e.pessoaId)?.nome ?? '').includes(q)) return false;
      return true;
    });
  }

  /**
   * Exceção = liberação do porteiro OU autorização prévia de unidade cadastrada sem solicitante. Devolve o usuário
   * responsável (operador da exceção; ou quem cadastrou a autorização sem solicitante), ou null se não for exceção.
   * A autorização de área comum (RF-36) é da administração e não conta como exceção.
   */
  function responsavelExcecao(d: DbData, e: EventoAcesso): string | null {
    if (e.tipo !== 'entrada') return null;
    if (e.autorizadoPorTipo === 'excecao_porteiro') return e.operadorId;
    if (e.autorizadoPorTipo === 'autorizacao_previa') {
      const a = d.autorizacoes.find((x) => x.id === e.autorizacaoPreviaId);
      if (a?.semSolicitante) return a.cadastradaPorId;
    }
    return null;
  }

  /** Categoria usada na regra de entrada: "morador" sem vínculo válido (na unidade de destino) é tratado como visitante (RN-01/RN-02). */
  function categoriaEfetiva(d: DbData, p: Pessoa, unidade: string | null | undefined, quando: number): CategoriaPessoa {
    if (p.categoria !== 'morador') return p.categoria;
    const tem = d.vinculos.some((v) => v.pessoaId === p.id && (!unidade || v.unidadeId === unidade) && vinculoValido(v, quando));
    return tem ? 'morador' : 'visitante';
  }

  /** RNF-05: coerência entre ocorrido_em e registrado_em; retroativo exige formulário de papel. */
  function resolverInstante(
    i: { retroativo?: boolean; ocorridoEm?: number | null; formularioContingencia?: string | null }, n: number, minimo?: number,
  ): { quando: number; formulario: string | null } {
    let quando = n;
    if (i.retroativo) {
      if (!i.ocorridoEm || i.ocorridoEm >= n) throw new ApiError(422, 'DATA_INCONSISTENTE', 'Lançamento retroativo exige data e hora reais anteriores ao momento atual.');
      if (minimo !== undefined && i.ocorridoEm < minimo) throw new ApiError(422, 'DATA_INCONSISTENTE', 'A saída retroativa não pode ser anterior à entrada.');
      quando = i.ocorridoEm;
    } else if (i.ocorridoEm && Math.abs(i.ocorridoEm - n) > 5 * 60000) {
      throw new ApiError(422, 'DATA_INCONSISTENTE', 'Registro que não é retroativo deve ter data e hora atuais.');
    }
    const formulario = i.formularioContingencia?.trim() || null;
    if (i.retroativo && !formulario) throw new ApiError(422, 'FORMULARIO_OBRIGATORIO', 'Registro retroativo exige o número do formulário de contingência.');
    return { quando, formulario: i.retroativo ? formulario : null };
  }

  // ----- Pessoa: validação comum (pessoas.criar e funcionarios.criar) ----------------------------
  async function validarNovaPessoa(d: DbData, i: NovaPessoaInput): Promise<Pessoa> {
    if (!i.nome.trim()) throw new ApiError(422, 'NOME_OBRIGATORIO', 'Informe o nome.');
    // Telefone é obrigatório para todos (inclusive "sem CPF"); guardado só com dígitos
    if (!telefoneValido(i.telefone)) throw new ApiError(422, 'TELEFONE_INVALIDO', 'Informe o telefone com DDD (10 ou 11 dígitos).');
    if (i.categoria === 'prestador' && !(i.empresa ?? '').trim()) throw new ApiError(422, 'EMPRESA_OBRIGATORIA', 'Prestador exige empresa (RF-36).');
    const telefone = soDigitos(i.telefone);
    let documentoMascarado = SEM_CPF;
    let documentoBusca: string | undefined;
    if (i.semCpf) {
      // Exceção: sem CPF não há chave de busca; evita duplicar por nome + telefone
      const igual = d.pessoas.find((p) => p.semCpf && norm(p.nome) === norm(i.nome) && soDigitos(p.telefone ?? '') === telefone);
      if (igual) throw new ApiError(409, 'PESSOA_DUPLICADA', 'Já existe cadastro sem CPF com este nome e telefone.');
    } else {
      const cpf = soDigitos(i.documento ?? '');
      if (!cpf) throw new ApiError(422, 'DOCUMENTO_OBRIGATORIO', 'Informe o CPF.');
      if (!cpfValido(cpf)) throw new ApiError(422, 'CPF_INVALIDO', 'CPF inválido (confira os dígitos).');
      documentoMascarado = mascararCpf(cpf);
      documentoBusca = await documentoBuscaCpf(cpf, CHAVE_HMAC_DEMO); // HMAC com a chave de demonstração; o CPF em claro nunca é guardado
      if (d.pessoas.some((p) => p.documentoBusca === documentoBusca)) throw new ApiError(409, 'PESSOA_DUPLICADA', 'Já existe cadastro com este CPF.');
    }
    return {
      id: uid('pe'), nome: i.nome.trim(), categoria: i.categoria, documentoTipo: 'cpf', documentoMascarado, documentoBusca,
      ...(i.semCpf ? { semCpf: true } : {}),
      telefone, empresa: i.empresa?.trim() || undefined, servico: i.servico?.trim() || undefined,
      anonimizadaEm: null, criadoEm: agora(),
    };
  }

  const funcionarioView = (d: DbData, pessoaId: string): FuncionarioView => {
    const f = d.funcionarios.find((x) => x.pessoaId === pessoaId)!;
    return { ...f, pessoa: d.pessoas.find((p) => p.id === pessoaId)!, emEscalaAgora: escalaVigente(f, agora()) };
  };

  // ----- LGPD: anonimização e redação da trilha de alterações ------------------------------------
  /** Redige os snapshots de `pessoa` na trilha de alterações (mesma regra de `lgpd_redigir_audit_pessoa`). */
  function redigirTrilhaPessoa(d: DbData, pessoaId: string): number {
    let n = 0;
    const tira = (o: Record<string, unknown> | null) => {
      if (!o) return o;
      const c = { ...o };
      for (const k of CAMPOS_REDIGIDOS) delete c[k];
      return c;
    };
    for (const r of d.auditLog) {
      if (r.entidade !== 'pessoa' || r.registroId !== pessoaId || r.redigidoEm) continue;
      r.antes = tira(r.antes); r.depois = tira(r.depois); r.redigidoEm = agora(); // única alteração permitida na trilha
      n++;
    }
    return n;
  }
  /** Anonimiza a pessoa (CHECK pessoa_anonimizada_sem_pii_ck) e redige a trilha dela. Não toca nos eventos. */
  function anonimizarPessoa(d: DbData, u: UsuarioSistema, p: Pessoa, motivo: 'pedido' | 'retencao'): number {
    p.nome = NOME_ANONIMIZADO;
    p.documentoMascarado = ANONIMIZADO;
    delete p.documentoBusca; delete p.telefone; delete p.empresa; delete p.servico;
    p.anonimizadaEm = agora();
    const n = redigirTrilhaPessoa(d, p.id);
    // Registrado depois da redação: o próprio registro não tem dado pessoal (só o motivo e os campos removidos)
    registrar(d, u, 'lgpd.anonimizar', 'pessoa', p.id, null, { motivo, anonimizadaEm: p.anonimizadaEm, campos: CAMPOS_REDIGIDOS, registrosRedigidos: n });
    return n;
  }
  const RETIDO = [
    'Eventos de acesso em que a pessoa aparece (só pelo id, sem o nome), até completar 3 anos de cada evento: exercício regular de direitos (LGPD art. 16, I, e art. 7º, VI).',
    'Texto livre já gravado nesses eventos (justificativa, observação, formulário), que entra no hash e sai junto com o evento.',
    'Vínculos encerrados, autorizações e encomendas ligados à pessoa só pelo id.',
  ];

  // ===========================================================================================
  /** No mock nenhuma senha é guardada: a temporária só exercita a mesma tela da API real. */
  const ALFABETO_TEMP = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const senhaTemporariaDemo = () => {
    const b = new Uint32Array(16);
    globalThis.crypto.getRandomValues(b);
    return Array.from(b, (n) => ALFABETO_TEMP[n % ALFABETO_TEMP.length]).join('');
  };
  // O mock nunca exige troca de senha: a demonstração entra com qualquer senha.
  const comSessao = (u: UsuarioSistema) => ({ ...clone(u), deveTrocarSenha: false });

  const api: Api = {
    modo: 'mock',
    auth: {
      // 2FA fica para a fase de segurança (pós-MVP): login é só usuário + senha para todos os papéis.
      async login({ login, senha }) {
        await esperar();
        const d = await carregar();
        const u = d.usuarios.find((x) => x.login.toLowerCase() === login.trim().toLowerCase());
        if (!u || !u.ativo || senha.length === 0) {
          // Falha registrada com o login informado (nunca a senha)
          registrar(d, u ?? null, 'auth.login_falha', 'sessao', u?.id ?? '-', null, { login: login.trim() }, login.trim() || '(vazio)');
          salvar();
          // mensagem única: não distingue usuário inexistente de senha errada (spec 5.1)
          throw new ApiError(401, 'CREDENCIAIS_INVALIDAS', 'Usuário ou senha inválidos.');
        }
        u.ultimoAcesso = agora();
        registrar(d, u, 'auth.login', 'sessao', u.id, null, { login: u.login });
        salvar();
        sessao = u; gravarSessao();
        return comSessao(u);
      },
      async logout() {
        await esperar();
        if (sessao) {
          const d = await carregar();
          registrar(d, sessao, 'auth.logout', 'sessao', sessao.id, null, { login: sessao.login });
          salvar();
        }
        sessao = null; gravarSessao();
      },
      async me() { await carregar(); return sessao ? comSessao(sessao) : null; },
      async trocarSenha({ senhaAtual, novaSenha }) {
        const eu = usuario();
        // Mesma política mínima da API (12+), para a tela de troca se comportar igual nos dois modos.
        if (!senhaAtual) throw new ApiError(422, 'SENHA_ATUAL_INCORRETA', 'A senha atual não confere.');
        if (novaSenha.length < 12) throw new ApiError(422, 'SENHA_FRACA', 'A senha precisa ter pelo menos 12 caracteres.');
        if (novaSenha === senhaAtual) throw new ApiError(422, 'SENHA_FRACA', 'A nova senha precisa ser diferente da atual.');
        await escrever((d) => { registrar(d, eu, 'auth.trocar_senha', 'usuario', eu.id, null, { login: eu.login }); });
        return comSessao(eu);
      },
    },

    busca: {
      async global(q) {
        exigeLogado();
        return ler(async (d) => {
          const consulta = q.trim();
          const todas = consulta.length >= 2 ? await buscarPessoas(d, consulta, false) : [];
          const pessoas = todas.slice(0, 6);
          const unidades: { id: string; motivo: string }[] = [];
          const u = acharUnidadePorTexto(d.unidades, consulta);
          if (u) unidades.push({ id: u.id, motivo: u.ativo ? 'Unidade' : 'Unidade (desativada)' });
          if (consulta.length >= 3) {
            const nq = consulta.toUpperCase().replace(/[^A-Z0-9]/g, '');
            for (const v of d.veiculos) {
              if (v.placa.replace('-', '').includes(nq) && nq.length >= 3) unidades.push({ id: v.unidadeId, motivo: `Placa ${v.placa} · ${v.modelo}` });
              if (unidades.length > 6) break;
            }
          }
          return { pessoas, unidades, temMaisPessoas: todas.length > pessoas.length };
        });
      },
    },

    catalogo: {
      async obter() {
        exigeLogado();
        return ler((d): Catalogo => ({ unidades: [...d.unidades].sort(compararUnidades), areasComuns: d.areasComuns }));
      },
    },

    pessoas: {
      async buscar(q, o) { exige('pessoa.ver'); return ler(async (d) => (await buscarPessoas(d, q, !!o?.semMoradores)).slice(0, o?.limite ?? 8)); },
      async listar() { exige('pessoa.ver'); return ler((d) => { const ix = indices(d); return d.pessoas.map((p) => pessoaBusca(d, p, ix)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')); }); },
      async ficha(id) {
        exige('pessoa.ver');
        return ler((d): FichaPessoa => {
          const ix = indices(d);
          const pessoa = ix.pessoas.get(id);
          if (!pessoa) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          return {
            pessoa, funcionario: d.funcionarios.find((f) => f.pessoaId === id),
            vinculos: d.vinculos.filter((v) => v.pessoaId === id).map((v) => vinculoView(v, ix)),
            eventos: d.eventos.filter((e) => ix.ef(e).pessoaId === id).slice(-10).reverse().map((e) => view(e, ix)),
          };
        });
      },
      async criar(i) {
        const u = exige('pessoa.cadastrar_externo');
        if (i.categoria === 'morador' || i.categoria === 'funcionario') exige('pessoa.cadastrar_morador'); // porteiro: só visitante/prestador
        return escrever(async (d) => {
          const p = await validarNovaPessoa(d, i);
          d.pessoas.push(p);
          registrar(d, u, 'pessoa.criar', 'pessoa', p.id, null, p);
          return p;
        });
      },
      // RN-09 e LGPD art. 18 (correção): completa ou corrige o cadastro, com antes e depois na trilha.
      async editar(i) {
        const u = exige('pessoa.editar');
        return escrever(async (d) => {
          const p = d.pessoas.find((x) => x.id === i.id);
          if (!p) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (p.anonimizadaEm) throw new ApiError(409, 'PESSOA_ANONIMIZADA', 'Cadastro anonimizado não pode ser editado.');
          const antes = clone(p);
          const novo = clone(p);
          if (i.nome !== undefined) {
            if (!i.nome.trim()) throw new ApiError(422, 'NOME_OBRIGATORIO', 'Informe o nome.');
            novo.nome = i.nome.trim();
          }
          if (i.telefone !== undefined) {
            if (!telefoneValido(i.telefone)) throw new ApiError(422, 'TELEFONE_INVALIDO', 'Informe o telefone com DDD (10 ou 11 dígitos).');
            novo.telefone = soDigitos(i.telefone);
          }
          if (i.documento !== undefined && soDigitos(i.documento) !== '') {
            const cpf = soDigitos(i.documento);
            if (!cpfValido(cpf)) throw new ApiError(422, 'CPF_INVALIDO', 'CPF inválido (confira os dígitos).');
            const busca = await documentoBuscaCpf(cpf, CHAVE_HMAC_DEMO);
            if (d.pessoas.some((x) => x.id !== p.id && x.documentoBusca === busca)) throw new ApiError(409, 'PESSOA_DUPLICADA', 'Já existe cadastro com este CPF.');
            novo.documentoMascarado = mascararCpf(cpf);
            novo.documentoBusca = busca;
            delete novo.semCpf; // informar o CPF tira a pessoa da exceção "sem CPF"
          }
          if (i.empresa !== undefined) novo.empresa = i.empresa?.trim() || undefined;
          if (i.servico !== undefined) novo.servico = i.servico?.trim() || undefined;
          if (novo.categoria === 'prestador' && !(novo.empresa ?? '').trim()) throw new ApiError(422, 'EMPRESA_OBRIGATORIA', 'Prestador exige empresa (RF-36).');
          if (JSON.stringify(novo) === JSON.stringify(antes)) return p;
          Object.assign(p, novo);
          if (!novo.empresa) delete p.empresa;
          if (!novo.servico) delete p.servico;
          if (!novo.semCpf) delete p.semCpf;
          registrar(d, u, 'pessoa.editar', 'pessoa', p.id, antes, p);
          return p;
        });
      },
      async funcionario(pessoaId) { exige('pessoa.ver'); return ler((d) => d.funcionarios.find((f) => f.pessoaId === pessoaId) ?? null); },
    },

    unidades: {
      async listar() {
        exige('unidade.ver');
        return ler((d) => resumosUnidades(d, d.unidades));
      },
      // Mesmo contrato da API real: keyset por (torre, número), cursor opaco, `torre` filtra.
      async listarPagina(f = {}) {
        exige('unidade.ver');
        const limite = f.limite ?? 50;
        let depois: { t: number; n: string } | null = null;
        if (f.cursor) {
          try { depois = JSON.parse(atob(f.cursor)) as { t: number; n: string }; } catch { depois = null; }
          if (!depois || typeof depois.t !== 'number' || typeof depois.n !== 'string') throw new ApiError(400, 'CURSOR_INVALIDO', 'Cursor de paginação inválido.');
        }
        return ler((d) => {
          const dep = depois;
          const candidatas = [...d.unidades].sort(compararUnidades)
            .filter((u) => f.torre === undefined || u.torre === f.torre)
            .filter((u) => !dep || compararUnidades(u, { torre: dep.t, numero: dep.n }) > 0 || (compararUnidades(u, { torre: dep.t, numero: dep.n }) === 0 && u.numero > dep.n));
          const pagina = candidatas.slice(0, limite);
          const ultimo = pagina[pagina.length - 1];
          const temMais = candidatas.length > limite;
          return { itens: resumosUnidades(d, pagina), temMais, cursor: temMais && ultimo ? btoa(JSON.stringify({ t: ultimo.torre, n: ultimo.numero })) : null };
        });
      },
      async detalhe(id) {
        exige('unidade.ver');
        return ler((d): UnidadeDetalhe => {
          // Aceita o uuid ou o código "T4-32" (links legíveis)
          const unidade = d.unidades.find((u) => u.id === id) ?? acharUnidadePorTexto(d.unidades, id);
          if (!unidade) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          const uid_ = unidade.id;
          const ix = indices(d);
          return {
            unidade,
            vinculos: d.vinculos.filter((v) => v.unidadeId === uid_).map((v) => vinculoView(v, ix)),
            veiculos: d.veiculos.filter((v) => v.unidadeId === uid_),
            autorizacoes: d.autorizacoes.filter((a) => a.unidadeId === uid_ && a.revogadaEm === null && agora() <= a.validaAte).map((a) => autorizacaoView(a, d, ix)),
            restricoes: d.restricoes.filter((r) => (r.unidadeId === uid_) && r.revogadaEm === null && agora() <= r.validaAte).map((r) => restricaoView(r, ix)),
            eventos: d.eventos.filter((e) => ix.ef(e).unidadeDestinoId === uid_ && e.tipo !== 'correcao').slice(-12).reverse().map((e) => view(e, ix)),
          };
        });
      },
      async criar({ torre, numero }) {
        const u = exige('unidade.editar');
        return escrever((d) => {
          const n = String(numero ?? '').trim();
          const erro = validarEstruturaUnidade(Number(torre), n);
          if (erro) throw new ApiError(422, 'UNIDADE_INVALIDA', erro);
          if (d.unidades.some((x) => x.torre === Number(torre) && x.numero === n)) {
            throw new ApiError(409, 'UNIDADE_DUPLICADA', `Já existe a unidade T${torre}-${n} (ativa ou desativada).`);
          }
          const nova: Unidade = { id: novoUuid(), torre: Number(torre), numero: n, ativo: true };
          d.unidades.push(nova);
          registrar(d, u, 'unidade.criar', 'unidade', nova.id, null, nova);
          return nova;
        });
      },
      async editar({ id, torre, numero }) {
        const u = exige('unidade.editar');
        return escrever((d) => {
          const x = unidadeOu404(d, id);
          const n = String(numero ?? '').trim();
          const erro = validarEstruturaUnidade(Number(torre), n);
          if (erro) throw new ApiError(422, 'UNIDADE_INVALIDA', erro);
          if (x.torre === Number(torre) && x.numero === n) return x;
          if (d.unidades.some((o) => o.id !== id && o.torre === Number(torre) && o.numero === n)) {
            throw new ApiError(409, 'UNIDADE_DUPLICADA', `Já existe a unidade T${torre}-${n} (ativa ou desativada).`);
          }
          // Renumerar unidade com histórico mudaria o sentido do que já foi registrado nela
          if (unidadeReferenciada(d, id)) {
            throw new ApiError(422, 'UNIDADE_REFERENCIADA', `A ${codigoUnidade(x)} já tem registros (vínculos, acessos, encomendas...). Desative-a e cadastre a unidade correta.`);
          }
          const antes = clone(x);
          x.torre = Number(torre); x.numero = n;
          registrar(d, u, 'unidade.editar', 'unidade', x.id, antes, x);
          return x;
        });
      },
      async desativar(id) {
        const u = exige('unidade.editar');
        return escrever((d) => {
          const x = unidadeOu404(d, id);
          if (!x.ativo) throw new ApiError(409, 'UNIDADE_JA_INATIVA', 'A unidade já está desativada.');
          const antes = clone(x);
          x.ativo = false; // nunca é excluída: continua no histórico
          registrar(d, u, 'unidade.desativar', 'unidade', x.id, antes, x);
          return x;
        });
      },
      async reativar(id) {
        const u = exige('unidade.editar');
        return escrever((d) => {
          const x = unidadeOu404(d, id);
          if (x.ativo) throw new ApiError(409, 'UNIDADE_JA_ATIVA', 'A unidade já está ativa.');
          const antes = clone(x);
          x.ativo = true;
          registrar(d, u, 'unidade.reativar', 'unidade', x.id, antes, x);
          return x;
        });
      },
    },

    funcionarios: {
      async listar() {
        exige('pessoa.ver');
        return ler((d) => d.funcionarios.map((f) => funcionarioView(d, f.pessoaId)).sort((a, b) => a.pessoa.nome.localeCompare(b.pessoa.nome, 'pt-BR')));
      },
      async criar(i) {
        const u = exige('funcionario.gerenciar');
        return escrever(async (d) => {
          if (!(i.funcao ?? '').trim()) throw new ApiError(422, 'FUNCAO_OBRIGATORIA', 'Informe a função.');
          const erroEscala = validarEscala(i.escala);
          if (erroEscala) throw new ApiError(422, 'ESCALA_INVALIDA', erroEscala);
          const p = await validarNovaPessoa(d, { nome: i.nome, documento: i.documento, telefone: i.telefone, categoria: 'funcionario' });
          const f = { pessoaId: p.id, funcao: i.funcao.trim(), escala: { ...i.escala, diasSemana: [...i.escala.diasSemana].sort() }, ativo: i.ativo ?? true };
          d.pessoas.push(p);
          d.funcionarios.push(f);
          registrar(d, u, 'pessoa.criar', 'pessoa', p.id, null, p);
          registrar(d, u, 'funcionario.criar', 'funcionario', p.id, null, f);
          return funcionarioView(d, p.id);
        });
      },
      async editar(i) {
        const u = exige('funcionario.gerenciar');
        return escrever((d) => {
          const f = d.funcionarios.find((x) => x.pessoaId === i.pessoaId);
          if (!f) throw new ApiError(404, 'FUNCIONARIO_NAO_ENCONTRADO', 'Funcionário não encontrado.');
          const antes = clone(f);
          if (i.funcao !== undefined) {
            if (!i.funcao.trim()) throw new ApiError(422, 'FUNCAO_OBRIGATORIA', 'Informe a função.');
            f.funcao = i.funcao.trim();
          }
          if (i.escala !== undefined) {
            const erro = validarEscala(i.escala);
            if (erro) throw new ApiError(422, 'ESCALA_INVALIDA', erro);
            f.escala = { ...i.escala, diasSemana: [...i.escala.diasSemana].sort() };
          }
          if (i.ativo !== undefined) f.ativo = i.ativo;
          registrar(d, u, 'funcionario.editar', 'funcionario', f.pessoaId, antes, f);
          return funcionarioView(d, f.pessoaId);
        });
      },
    },

    veiculos: {
      async criar(i) {
        const u = exige('veiculo.cadastrar');
        return escrever((d) => {
          const placa = i.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw new ApiError(422, 'PLACA_INVALIDA', 'Placa fora do padrão antigo ou Mercosul.');
          unidadeOu404(d, i.unidadeId, true);
          const fmt = `${placa.slice(0, 3)}-${placa.slice(3)}`;
          if (d.veiculos.some((v) => v.placa === fmt)) throw new ApiError(409, 'PLACA_DUPLICADA', 'Placa já cadastrada.');
          const v = { id: uid('ve'), unidadeId: i.unidadeId, placa: fmt, modelo: i.modelo.trim(), cor: i.cor.trim() };
          d.veiculos.push(v);
          registrar(d, u, 'veiculo.criar', 'veiculo', v.id, null, v);
          return v;
        });
      },
    },

    vinculos: {
      async listar(f) {
        exige('vinculo.ver');
        return ler((d) => {
          const ix = indices(d);
          return d.vinculos.filter((v) => !f?.status || v.status === f.status).sort((a, b) => b.solicitadoEm - a.solicitadoEm).map((v) => vinculoView(v, ix));
        });
      },
      async contar(status) {
        exige('vinculo.ver');
        return ler((d) => d.vinculos.filter((v) => v.status === status).length);
      },
      async criar(i) {
        const u = exige('vinculo.criar'); // RN-03: porteiro recebe 403
        return escrever((d) => {
          const p = d.pessoas.find((x) => x.id === i.pessoaId);
          if (!p) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (p.anonimizadaEm) throw new ApiError(422, 'PESSOA_ANONIMIZADA', 'Cadastro anonimizado não recebe vínculo.');
          unidadeOu404(d, i.unidadeId, true);
          if (i.tipo === 'inquilino' && !i.vigenciaFim) throw new ApiError(422, 'VIGENCIA_OBRIGATORIA', 'Inquilino exige data de fim da vigência.');
          if (d.vinculos.some((v) => v.pessoaId === i.pessoaId && v.unidadeId === i.unidadeId && ['pendente', 'aprovado', 'legado'].includes(v.status))) {
            throw new ApiError(409, 'VINCULO_DUPLICADO', 'Já existe vínculo ativo ou pendente desta pessoa com a unidade.');
          }
          const v: VinculoUnidade = {
            id: uid('V'), pessoaId: i.pessoaId, unidadeId: i.unidadeId, tipo: i.tipo, status: 'pendente',
            vigenciaInicio: i.vigenciaInicio, vigenciaFim: i.vigenciaFim, prazoRegularizacao: null,
            conferencia: null, solicitadoPor: i.solicitadoPor?.trim() || 'Administração', solicitadoEm: agora(),
            registradoPorId: u.id, encerradoEm: null,
          };
          // Pedir vínculo NÃO muda a categoria: ela só vira 'morador' quando a administração aprova (RF-04).
          d.vinculos.push(v);
          registrar(d, u, 'vinculo.criar', 'vinculo', v.id, null, v);
          return v;
        });
      },
      // RF-05: registra a conferência do comprovante (tipo, data, quem conferiu). Não recebe nem guarda arquivo.
      async registrarConferencia(id, i) {
        const u = exige('vinculo.decidir');
        return escrever((d) => {
          const v = d.vinculos.find((x) => x.id === id);
          if (!v) throw new ApiError(404, 'VINCULO_NAO_ENCONTRADO', 'Vínculo não encontrado.');
          // Trigger vinculo_unidade_transicao: depois da aprovação (ou em estado final) a conferência é imutável
          if (v.status !== 'pendente' && v.status !== 'legado') {
            throw new ApiError(409, 'CONFERENCIA_IMUTAVEL', 'A conferência só pode ser registrada em vínculo pendente ou legado.');
          }
          const data = i.data ?? inicioDoDia(agora());
          const erro = validarConferencia({ ...i, data }, agora());
          if (erro) throw new ApiError(erro.status, erro.code, erro.message);
          const antes = clone(v);
          const descricao = i.tipo === 'outro' ? i.descricao?.trim() : undefined;
          const observacao = i.observacao?.trim() || undefined;
          v.conferencia = {
            tipoDocumento: i.tipo, data: inicioDoDia(data), conferidoPorId: u.id,
            ...(descricao ? { descricao } : {}), ...(observacao ? { observacao } : {}),
          };
          registrar(d, u, 'vinculo.conferir', 'vinculo', v.id, antes, v);
          return v;
        });
      },
      async decidir({ id, decisao, justificativa }) {
        const u = exige('vinculo.decidir');
        return escrever((d) => {
          const v = d.vinculos.find((x) => x.id === id);
          if (!v) throw new ApiError(404, 'VINCULO_NAO_ENCONTRADO', 'Vínculo não encontrado.');
          if (v.status !== 'pendente') throw new ApiError(409, 'VINCULO_JA_DECIDIDO', 'Este vínculo já foi decidido.');
          const pessoa = d.pessoas.find((x) => x.id === v.pessoaId);
          // Aprovar exige cadastro completo: CPF válido (não "sem CPF") e telefone
          if (decisao === 'aprovar' && !cadastroCompleto(pessoa)) {
            throw new ApiError(422, 'CADASTRO_INCOMPLETO', 'Para aprovar o vínculo a pessoa precisa ter CPF válido (não “sem CPF”) e telefone cadastrados.');
          }
          const erro = validarDecisaoVinculo(decisao, justificativa, v.conferencia);
          if (erro) throw new ApiError(erro.status, erro.code, erro.message);
          const antes = clone(v);
          v.status = decisao === 'aprovar' ? 'aprovado' : 'rejeitado';
          v.decididoPorId = u.id; v.decididoEm = agora();
          v.justificativa = (justificativa ?? '').trim() || undefined;
          // A categoria de morador nasce aqui, na aprovação
          if (decisao === 'aprovar' && pessoa && pessoa.categoria !== 'morador') pessoa.categoria = 'morador';
          registrar(d, u, 'vinculo.decidir', 'vinculo', v.id, antes, v);
          return v;
        });
      },
      // RN-09: regularização do legado (transição legado -> aprovado do trigger vinculo_unidade_transicao)
      async regularizar(id, opcoes) {
        const u = exige('vinculo.decidir');
        return escrever((d) => {
          const v = d.vinculos.find((x) => x.id === id);
          if (!v) throw new ApiError(404, 'VINCULO_NAO_ENCONTRADO', 'Vínculo não encontrado.');
          if (v.status !== 'legado') throw new ApiError(409, 'VINCULO_NAO_LEGADO', 'Só vínculo legado (importado da planilha) é regularizado.');
          const pessoa = d.pessoas.find((x) => x.id === v.pessoaId);
          if (!cadastroCompleto(pessoa)) {
            throw new ApiError(422, 'CADASTRO_INCOMPLETO', 'Para regularizar, complete o cadastro (CPF válido e telefone) pela ficha da pessoa.');
          }
          // RN-09 + RN-02: regularizar também exige o comprovante conferido (CHECK vinculo_aprovado_conferido_ck)
          if (!v.conferencia) throw new ApiError(422, 'CONFERENCIA_OBRIGATORIA', 'Registre a conferência do comprovante (RF-05) antes de regularizar.');
          const vigenciaFim = opcoes?.vigenciaFim !== undefined ? opcoes.vigenciaFim : v.vigenciaFim;
          // CHECK vinculo_inquilino_fim_ck: inquilino aprovado precisa de fim de vigência
          if (v.tipo === 'inquilino' && !vigenciaFim) throw new ApiError(422, 'VIGENCIA_OBRIGATORIA', 'Inquilino exige data de fim da vigência para ser regularizado.');
          const antes = clone(v);
          v.status = 'aprovado';
          v.vigenciaFim = vigenciaFim ?? null;
          v.decididoPorId = u.id; v.decididoEm = agora();
          if (pessoa && pessoa.categoria !== 'morador') pessoa.categoria = 'morador';
          registrar(d, u, 'vinculo.regularizar', 'vinculo', v.id, antes, v);
          return v;
        });
      },
      async autorizadores(unidadeId) {
        exige('unidade.ver');
        return ler((d): Autorizador[] => {
          const ix = indices(d);
          return vinculosValidosDaUnidade(d.vinculos, unidadeId, agora()).map((vinculo) => ({ pessoa: ix.pessoas.get(vinculo.pessoaId)!, vinculo }));
        });
      },
    },

    autorizacoes: {
      async criar(i) {
        const u = exige('autorizacao.criar');
        if (i.areaComumId) exige('autorizacao.area_comum'); // RF-36: área comum é autorizada pela administração
        return escrever((d) => {
          const n = agora();
          if (i.validaAte === null || i.validaAte === undefined) throw new ApiError(422, 'VALIDADE_OBRIGATORIA', 'Autorização prévia exige data de validade (RN-07).');
          if (i.validaAte < inicioDoDia(n)) throw new ApiError(422, 'VALIDADE_INVALIDA', 'A validade não pode estar no passado.');
          if (i.validaDe !== undefined && i.validaDe > fimDoDia(i.validaAte)) throw new ApiError(422, 'PERIODO_INVALIDO', 'O início da validade não pode ser posterior ao fim.');
          const pessoa = d.pessoas.find((p) => p.id === i.pessoaId);
          if (!pessoa) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (i.unidadeId && i.areaComumId) throw new ApiError(422, 'DESTINO_DUPLO', 'Informe a unidade OU a área comum, não as duas.');
          if (!i.unidadeId && !i.areaComumId) throw new ApiError(422, 'UNIDADE_OBRIGATORIA', 'Informe a unidade de destino.');
          if (!!i.horaInicio !== !!i.horaFim) throw new ApiError(422, 'JANELA_INCOMPLETA', 'Informe hora de início e de fim, ou nenhuma.');
          if (i.horaInicio && i.horaFim && i.horaFim <= i.horaInicio) throw new ApiError(422, 'JANELA_INVALIDA', 'A hora final deve ser posterior à inicial.');
          const base = {
            id: uid('ap'), pessoaId: i.pessoaId, validaDe: i.validaDe ?? inicioDoDia(n), validaAte: fimDoDia(i.validaAte),
            diasSemana: i.diasSemana && i.diasSemana.length > 0 && i.diasSemana.length < 7 ? i.diasSemana : null,
            horaInicio: i.horaInicio, horaFim: i.horaFim, cadastradaPorId: u.id, cadastradaEm: n,
            revogadaEm: null, revogadaPorId: null,
          };
          let a: AutorizacaoPrevia;
          if (i.areaComumId) {
            // Área comum: sem morador solicitante (a administração é a solicitante) e não conta como exceção
            areaOu404(d, i.areaComumId, true);
            if (pessoa.categoria !== 'prestador') throw new ApiError(422, 'AREA_COMUM_SO_PRESTADOR', 'Área comum só é destino de prestador de serviço (RF-36).');
            if (i.solicitadaPorPessoaId) throw new ApiError(422, 'AREA_COMUM_SEM_SOLICITANTE', 'Autorização de área comum não tem morador solicitante.');
            a = { ...base, unidadeId: null, areaComumId: i.areaComumId, solicitadaPorPessoaId: null, semSolicitante: false, justificativa: i.justificativa?.trim() || null };
          } else {
            unidadeOu404(d, i.unidadeId!, true);
            // Solicitante: com ele, precisa ser morador com vínculo válido na unidade; sem ele, só com justificativa
            const semSolicitante = !i.solicitadaPorPessoaId;
            const solicitante = semSolicitante ? undefined : d.pessoas.find((p) => p.id === i.solicitadaPorPessoaId);
            if (!semSolicitante && (!solicitante || !pessoaTemVinculoValido(d.vinculos, solicitante.id, i.unidadeId!, n))) {
              throw new ApiError(422, 'SOLICITANTE_SEM_VINCULO', 'O morador que pediu precisa ter vínculo válido (aprovado ou legado no prazo) com a unidade.');
            }
            if (semSolicitante && !justificativaValida(i.justificativa)) {
              throw new ApiError(422, 'SOLICITANTE_OU_JUSTIFICATIVA', `Informe o morador que pediu ou, sem ele, uma justificativa de pelo menos ${MIN_JUSTIFICATIVA} caracteres.`);
            }
            a = {
              ...base, unidadeId: i.unidadeId!, areaComumId: null, solicitadaPorPessoaId: solicitante?.id ?? null,
              semSolicitante, justificativa: semSolicitante ? i.justificativa!.trim() : null,
            };
          }
          d.autorizacoes.push(a);
          registrar(d, u, 'autorizacao.criar', 'autorizacao', a.id, null, a);
          return a;
        });
      },
      async revogar(id) {
        const u = exige('autorizacao.criar');
        return escrever((d) => {
          const a = d.autorizacoes.find((x) => x.id === id);
          if (!a) throw new ApiError(404, 'AUTORIZACAO_NAO_ENCONTRADA', 'Autorização não encontrada.');
          if (a.areaComumId && !pode(u.papel, 'autorizacao.area_comum')) negar(u, 'autorizacao.area_comum', 'Só síndico ou administração revogam autorização de área comum.');
          if (a.revogadaEm !== null) throw new ApiError(409, 'AUTORIZACAO_JA_REVOGADA', 'Esta autorização já foi revogada.');
          const antes = clone(a);
          a.revogadaEm = agora(); a.revogadaPorId = u.id;
          registrar(d, u, 'autorizacao.revogar', 'autorizacao', a.id, antes, a);
        });
      },
      async vigentes(pessoaId, destinoId, opcoes) {
        exige('autorizacao.criar');
        return ler((d) => {
          const ix = indices(d);
          return d.autorizacoes
            .filter((a) => a.pessoaId === pessoaId && (opcoes?.areaComum ? a.areaComumId === destinoId : a.unidadeId === destinoId))
            .map((a) => autorizacaoView(a, d, ix))
            .filter((a) => a.estado === 'valida' || a.estado === 'fora_da_janela');
        });
      },
      async hoje() {
        exige('unidade.ver');
        return ler((d) => {
          const ix = indices(d);
          const n = agora();
          const dow = partes(n).dow;
          return d.autorizacoes
            .filter((a) => a.revogadaEm === null && a.validaDe <= fimDoDia(n) && a.validaAte >= inicioDoDia(n) && (!a.diasSemana || a.diasSemana.includes(dow)))
            .map((a) => autorizacaoView(a, d, ix))
            .sort((a, b) => (a.horaInicio ?? '').localeCompare(b.horaInicio ?? ''));
        });
      },
    },

    restricoes: {
      async verificar(pessoaId, unidadeId) {
        exige('unidade.ver');
        return ler((d) => {
          const ix = indices(d);
          const alertas = restricoesVigentes(d.restricoes, pessoaId, unidadeId, agora()).map((r) => restricaoView(r, ix));
          return { restrita: alertas.length > 0, alertas };
        });
      },
      async criar(i) {
        const u = exige('restricao.criar');
        return escrever((d) => {
          const paraTodos = !!i.paraTodoCondominio;
          if (!i.motivo.trim()) throw new ApiError(422, 'MOTIVO_OBRIGATORIO', 'Informe o motivo da restrição.');
          if (i.validaAte === null || i.validaAte === undefined) throw new ApiError(422, 'VALIDADE_OBRIGATORIA', 'Informe até quando a restrição vale.');
          if (i.validaAte < inicioDoDia(agora())) throw new ApiError(422, 'VALIDADE_INVALIDA', 'A validade da restrição não pode estar no passado.');
          if (!d.pessoas.some((p) => p.id === i.pessoaId)) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (!paraTodos && !i.unidadeId) throw new ApiError(422, 'UNIDADE_OBRIGATORIA', 'Restrição de unidade exige a unidade.');
          if (i.unidadeId) unidadeOu404(d, i.unidadeId);
          // CHECK restricao_escopo_unidade_ck: no escopo unidade o solicitante é obrigatório (morador com vínculo válido)
          if (!paraTodos && !i.solicitadaPorPessoaId) throw new ApiError(422, 'SOLICITANTE_OBRIGATORIO', 'Registre o morador que pediu a restrição.');
          if (i.solicitadaPorPessoaId) {
            if (!d.pessoas.some((p) => p.id === i.solicitadaPorPessoaId)) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Solicitante não encontrado.');
            if (!paraTodos && !pessoaTemVinculoValido(d.vinculos, i.solicitadaPorPessoaId, i.unidadeId!, agora())) {
              throw new ApiError(422, 'SOLICITANTE_SEM_VINCULO', 'Quem pediu a restrição precisa ter vínculo válido (aprovado ou legado no prazo) com a unidade.');
            }
          }
          const r: Restricao = {
            id: uid('rs'), escopo: paraTodos ? 'condominio' : 'unidade', unidadeId: i.unidadeId ?? null, pessoaId: i.pessoaId, motivo: i.motivo.trim(),
            validaAte: fimDoDia(i.validaAte), cadastradaPorId: u.id, cadastradaEm: agora(),
            solicitadaPorPessoaId: i.solicitadaPorPessoaId ?? null,
            // RN-06: escopo condomínio nasce pendente; só o síndico aprova
            aprovadaPorId: null, aprovadaEm: null, revogadaEm: null, revogadaPorId: null,
          };
          d.restricoes.push(r);
          registrar(d, u, 'restricao.criar', 'restricao', r.id, null, r);
          return r;
        });
      },
      async aprovar(id) {
        const u = exige('restricao.aprovar');
        return escrever((d) => {
          const r = d.restricoes.find((x) => x.id === id);
          if (!r) throw new ApiError(404, 'RESTRICAO_NAO_ENCONTRADA', 'Restrição não encontrada.');
          if (r.escopo !== 'condominio') throw new ApiError(422, 'RESTRICAO_NAO_PENDENTE', 'Somente restrições para todo o condomínio exigem aprovação.');
          if (r.aprovadaEm !== null) throw new ApiError(409, 'RESTRICAO_JA_APROVADA', 'Restrição já aprovada.');
          const antes = clone(r);
          r.aprovadaPorId = u.id; r.aprovadaEm = agora();
          registrar(d, u, 'restricao.aprovar', 'restricao', r.id, antes, r);
          return r;
        });
      },
      async revogar(id) {
        const u = exige('unidade.editar');
        return escrever((d) => {
          const r = d.restricoes.find((x) => x.id === id);
          if (!r) throw new ApiError(404, 'RESTRICAO_NAO_ENCONTRADA', 'Restrição não encontrada.');
          if (r.revogadaEm !== null) throw new ApiError(409, 'RESTRICAO_JA_REVOGADA', 'Esta restrição já foi revogada.');
          const antes = clone(r);
          r.revogadaEm = agora(); r.revogadaPorId = u.id;
          registrar(d, u, 'restricao.revogar', 'restricao', r.id, antes, r);
        });
      },
      async pendentes() {
        exige('unidade.ver');
        return ler((d) => {
          const ix = indices(d);
          return d.restricoes.filter((r) => r.escopo === 'condominio' && r.aprovadaEm === null && r.revogadaEm === null).map((r) => restricaoView(r, ix));
        });
      },
    },

    eventos: {
      async criar(i) {
        const u = exige('evento.registrar');
        if (i.retroativo) exige('evento.retroativo');
        return escrever(async (d) => {
          const ix = indices(d);
          const pessoa = ix.pessoas.get(i.pessoaId);
          if (!pessoa) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (pessoa.anonimizadaEm) throw new ApiError(422, 'PESSOA_ANONIMIZADA', 'Cadastro anonimizado: faça um novo cadastro.');
          const unidade = i.unidadeDestinoId ? unidadeOu404(d, i.unidadeDestinoId, true) : null;
          const area = i.areaComumId ? areaOu404(d, i.areaComumId, true) : null;
          const n = agora();
          const { quando, formulario } = resolverInstante(i, n);
          // RN-02: "morador" sem vínculo válido (aprovado ou legado no prazo) não tem acesso de morador: é tratado como visitante
          const categoria = categoriaEfetiva(d, pessoa, i.unidadeDestinoId, quando);
          const ehPrestador = categoria === 'prestador';
          // RF-36: o evento guarda empresa e serviço do cadastro (só prestador)
          const prestacao = { empresa: ehPrestador ? pessoa.empresa ?? null : null, servico: ehPrestador ? pessoa.servico ?? null : null };
          if (area && !ehPrestador) throw new ApiError(422, 'AREA_COMUM_SO_PRESTADOR', 'Área comum só é destino de prestador de serviço (RF-36).');

          // RF-16: restrição vigente BLOQUEIA. A tentativa é gravada como evento "negado" na trilha.
          {
            const rs = restricoesVigentes(d.restricoes, pessoa.id, i.unidadeDestinoId ?? null, quando);
            if (rs.length > 0) {
              const negado = await gravarEvento(d, {
                tipo: 'negado', categoriaPessoa: categoria, pessoaId: pessoa.id, unidadeDestinoId: unidade?.id ?? null, areaComumId: area?.id ?? null,
                autorizadoPorTipo: null, autorizadoPorPessoaId: null, autorizacaoPreviaId: null,
                justificativa: null, restricaoId: rs[0].id, operadorId: u.id, ocorridoEm: quando, // o motivo fica na restrição
                retroativo: !!i.retroativo, refereEventoId: null, corrigeEventoId: null, observacao: i.observacao ?? null,
                formularioContingencia: formulario,
              });
              throw new ApiError(422, 'PESSOA_EM_RESTRICAO', `Entrada não permitida ${unidade ? `para ${rotuloUnidade(unidade)}` : 'no condomínio'}: ${rs[0].motivo}.`, {
                eventoId: negado.id, codigo: codigoEvento(negado.seq), restricoes: rs.map((r) => restricaoView(r, ix)),
              });
            }
          }

          // RN-01, RF-17, RN-07, escala, RF-36
          const ctx = {
            quando,
            moradoresValidosIds: new Set(unidade ? vinculosValidosDaUnidade(d.vinculos, unidade.id, quando).map((v) => v.pessoaId) : []),
            autorizacoes: d.autorizacoes.filter((a) => a.pessoaId === pessoa.id && (area ? a.areaComumId === area.id : a.unidadeId === i.unidadeDestinoId)),
            funcionario: d.funcionarios.find((f) => f.pessoaId === pessoa.id),
          };
          const erro = validarAutorizacaoEntrada({ ...i, categoriaPessoa: categoria, semCpf: !!pessoa.semCpf }, ctx);
          if (erro) throw new ApiError(erro.status, erro.code, erro.message);

          if (!i.retroativo) {
            const dentro = d.eventos.some((e) => e.tipo === 'entrada' && ix.ef(e).pessoaId === pessoa.id && !ix.saidas.has(e.id));
            if (dentro) throw new ApiError(409, 'JA_ESTA_DENTRO', `${pessoa.nome} já consta como dentro do condomínio. Registre a saída antes.`);
          }

          let autPessoaId = i.autorizadoPorPessoaId ?? null;
          // Autorização prévia: o autorizador é o morador que pediu (nulo se sem solicitante ou área comum)
          if (i.autorizadoPorTipo === 'autorizacao_previa') autPessoaId = ix.autorizacoes.get(i.autorizacaoPreviaId!)?.solicitadaPorPessoaId ?? null;
          if (i.autorizadoPorTipo === 'excecao_porteiro' || i.autorizadoPorTipo === 'escala') autPessoaId = null;
          if (categoria === 'morador' && !i.autorizadoPorTipo) autPessoaId = null;

          const ev = await gravarEvento(d, {
            tipo: 'entrada', categoriaPessoa: categoria, pessoaId: pessoa.id, unidadeDestinoId: unidade?.id ?? null, areaComumId: area?.id ?? null,
            autorizadoPorTipo: i.autorizadoPorTipo ?? null, autorizadoPorPessoaId: autPessoaId,
            autorizacaoPreviaId: i.autorizadoPorTipo === 'autorizacao_previa' ? i.autorizacaoPreviaId ?? null : null,
            justificativa: i.autorizadoPorTipo === 'excecao_porteiro' ? (i.justificativa ?? '').trim() : null, restricaoId: null,
            operadorId: u.id, ocorridoEm: quando, retroativo: !!i.retroativo, refereEventoId: null, corrigeEventoId: null,
            observacao: i.observacao?.trim() || null, formularioContingencia: formulario, ...prestacao,
          });
          return view(ev, indices(d));
        });
      },

      // UC02 A4: o morador recusou a visita. Fica na trilha como evento "recusado", sem entrada.
      async registrarRecusa(i) {
        const u = exige('evento.registrar');
        if (i.retroativo) exige('evento.retroativo');
        return escrever(async (d) => {
          const ix = indices(d);
          const pessoa = ix.pessoas.get(i.pessoaId);
          if (!pessoa) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          unidadeOu404(d, i.unidadeDestinoId, true);
          if (i.meio !== 'interfone' && i.meio !== 'morador_presente') throw new ApiError(422, 'MEIO_INVALIDO_PARA_TIPO', 'A recusa só se registra por interfone ou morador presente.');
          const { quando, formulario } = resolverInstante(i, agora());
          const morador = ix.pessoas.get(i.moradorPessoaId);
          if (!morador || !pessoaTemVinculoValido(d.vinculos, morador.id, i.unidadeDestinoId, quando)) {
            throw new ApiError(422, 'AUTORIZADOR_SEM_VINCULO', 'O morador que recusou não tem vínculo válido (aprovado ou legado no prazo) com a unidade.');
          }
          const ev = await gravarEvento(d, {
            tipo: 'recusado', categoriaPessoa: categoriaEfetiva(d, pessoa, i.unidadeDestinoId, quando), pessoaId: pessoa.id,
            unidadeDestinoId: i.unidadeDestinoId, autorizadoPorTipo: i.meio, autorizadoPorPessoaId: morador.id,
            autorizacaoPreviaId: null, justificativa: null, restricaoId: null, operadorId: u.id, ocorridoEm: quando,
            retroativo: !!i.retroativo, refereEventoId: null, corrigeEventoId: null, observacao: i.observacao?.trim() || null,
            formularioContingencia: formulario,
          });
          return view(ev, indices(d));
        });
      },

      async registrarSaida(entradaId, opcoes = {}) {
        const u = exige('evento.registrar');
        if (opcoes.retroativo) exige('evento.retroativo');
        return escrever(async (d) => {
          const ix = indices(d);
          const entrada = ix.porId.get(entradaId);
          if (!entrada || entrada.tipo !== 'entrada') throw new ApiError(404, 'ENTRADA_NAO_ENCONTRADA', 'Entrada não encontrada.');
          if (ix.saidas.has(entrada.id)) throw new ApiError(409, 'SAIDA_JA_REGISTRADA', 'A saída desta entrada já foi registrada.');
          const base = ix.ef(entrada);
          // Saída retroativa: hora real ≥ entrada e < agora, com o nº do formulário de papel
          const { quando, formulario } = resolverInstante(opcoes, agora(), base.ocorridoEm);
          // A entrada NÃO é alterada: a saída é um novo evento ligado a ela (RN-04).
          const ev = await gravarEvento(d, {
            tipo: 'saida', categoriaPessoa: entrada.categoriaPessoa, pessoaId: base.pessoaId, unidadeDestinoId: base.unidadeDestinoId,
            areaComumId: base.areaComumId, autorizadoPorTipo: null, autorizadoPorPessoaId: null, autorizacaoPreviaId: null, justificativa: null,
            restricaoId: null, operadorId: u.id, ocorridoEm: quando, retroativo: !!opcoes.retroativo, refereEventoId: entrada.id, corrigeEventoId: null,
            observacao: opcoes.observacao?.trim() || null, formularioContingencia: formulario,
          });
          return view(ev, indices(d));
        });
      },

      async corrigir(id, i) {
        const u = exige('evento.corrigir');
        return escrever(async (d) => {
          const ix = indices(d);
          const orig = ix.porId.get(id);
          if (!orig) throw new ApiError(404, 'EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.');
          // Correção de correção não existe: corrige-se o original (a última correção prevalece)
          if (orig.tipo === 'correcao') throw new ApiError(422, 'CORRECAO_DE_CORRECAO', 'Não é possível corrigir uma correção: corrija o evento original.');
          if (!justificativaValida(i.justificativa)) {
            throw new ApiError(422, 'JUSTIFICATIVA_OBRIGATORIA', `A correção exige justificativa de pelo menos ${MIN_JUSTIFICATIVA} caracteres (RN-04).`);
          }
          const atual = ix.ef(orig);
          const v = i.valores ?? {};
          const novos: Partial<ValoresCorrecao> = {};
          if (v.unidadeDestinoId !== undefined) {
            if (atual.areaComumId) throw new ApiError(422, 'DESTINO_AREA_COMUM', 'Evento em área comum não tem unidade de destino para corrigir.');
            if (v.unidadeDestinoId === null && atual.categoriaPessoa !== 'funcionario') throw new ApiError(422, 'UNIDADE_OBRIGATORIA', 'Informe a unidade de destino.');
            if (v.unidadeDestinoId !== null) unidadeOu404(d, v.unidadeDestinoId);
            novos.unidadeDestinoId = v.unidadeDestinoId;
          }
          if (v.ocorridoEm !== undefined) {
            if (!Number.isFinite(v.ocorridoEm) || v.ocorridoEm >= agora()) throw new ApiError(422, 'DATA_INCONSISTENTE', 'A data e hora corrigidas devem ser anteriores ao momento atual.');
            novos.ocorridoEm = v.ocorridoEm;
          }
          if (v.pessoaId !== undefined) {
            if (!ix.pessoas.has(v.pessoaId)) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
            novos.pessoaId = v.pessoaId;
          }
          if (v.autorizadoPorPessoaId !== undefined) {
            // Autorizador é pessoa (id), nunca nome livre (spec 4.4)
            if (v.autorizadoPorPessoaId !== null && !ix.pessoas.has(v.autorizadoPorPessoaId)) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Autorizador não encontrado.');
            if (v.autorizadoPorPessoaId === null && (atual.autorizadoPorTipo === 'interfone' || atual.autorizadoPorTipo === 'morador_presente')) {
              throw new ApiError(422, 'AUTORIZADOR_OBRIGATORIO', 'Informe o morador que autorizou.');
            }
            novos.autorizadoPorPessoaId = v.autorizadoPorPessoaId;
          }
          // A última correção é a que vale; por isso ela carrega também os valores das anteriores (acumulado)
          const juntos: Partial<ValoresCorrecao> = { ...(ix.correcoes.get(orig.id)?.correcaoValores ?? {}), ...novos };
          const canonico: Record<string, unknown> = {};
          for (const k of CAMPOS_CORRIGIVEIS) if (k in juntos) canonico[k] = juntos[k];
          const ev = await gravarEvento(d, {
            tipo: 'correcao', categoriaPessoa: atual.categoriaPessoa, pessoaId: atual.pessoaId, unidadeDestinoId: atual.unidadeDestinoId,
            areaComumId: atual.areaComumId, autorizadoPorTipo: null, autorizadoPorPessoaId: null, autorizacaoPreviaId: null,
            justificativa: i.justificativa.trim(), restricaoId: null, operadorId: u.id, ocorridoEm: agora(), retroativo: false,
            refereEventoId: null, corrigeEventoId: orig.id, observacao: i.observacao?.trim() || null,
            correcaoValores: Object.keys(canonico).length > 0 ? canonico as Partial<ValoresCorrecao> : null,
          });
          return view(ev, indices(d));
        });
      },

      async listar(f) {
        exige('evento.ver');
        return ler((d) => {
          const ix = indices(d);
          return filtrarEventos(d, f).sort((a, b) => b.seq - a.seq).map((e) => view(e, ix));
        });
      },
      async obter(id) {
        exige('evento.ver');
        return ler((d) => {
          const ix = indices(d);
          const e = ix.porId.get(id);
          if (!e) throw new ApiError(404, 'EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.');
          return view(e, ix);
        });
      },
      async presentes() {
        exige('evento.ver');
        return ler((d) => {
          const ix = indices(d);
          return d.eventos.filter((e) => e.tipo === 'entrada' && !ix.saidas.has(e.id)).sort((a, b) => ix.ef(b).ocorridoEm - ix.ef(a).ocorridoEm).map((e) => view(e, ix));
        });
      },
    },

    encomendas: {
      async listar(f) {
        exige('encomenda.ver');
        return ler((d) => {
          const ix = indices(d);
          return d.encomendas
            .filter((e) => !f?.status || (f.status === 'entregue') === (e.retiradaEm !== null))
            .sort((a, b) => b.recebidaEm - a.recebidaEm)
            .map((e) => encomendaView(e, d, ix));
        });
      },
      async receber(i) {
        const u = exige('encomenda.operar');
        return escrever((d) => {
          if (!i.unidadeConfirmada) throw new ApiError(422, 'UNIDADE_NAO_CONFIRMADA', 'Confirme a unidade de destino antes de salvar (RF-23).');
          unidadeOu404(d, i.unidadeId, true);
          if (!i.destinatario.trim()) throw new ApiError(422, 'DESTINATARIO_OBRIGATORIO', 'Informe o destinatário.');
          const max = d.encomendas.reduce((m, e) => Math.max(m, Number(e.codigo.replace(/\D/g, ''))), 0);
          const e: Encomenda = {
            id: `K${max + 1}`, codigo: `K${max + 1}`, unidadeId: i.unidadeId, destinatario: i.destinatario.trim(),
            transportadora: i.transportadora.trim(), codigoRastreio: i.codigoRastreio.trim(), recebidaPorId: u.id, recebidaEm: agora(),
            unidadeConfirmada: true, retiradaEm: null, retiradaPorPessoaId: null, retiradaRegistradaPorId: null, retiradaAutorizacaoId: null,
          };
          d.encomendas.push(e);
          registrar(d, u, 'encomenda.receber', 'encomenda', e.id, null, e);
          return e;
        });
      },
      async entregar({ id, pessoaId }) {
        const u = exige('encomenda.operar');
        return escrever((d) => {
          const e = d.encomendas.find((x) => x.id === id);
          if (!e) throw new ApiError(404, 'ENCOMENDA_NAO_ENCONTRADA', 'Encomenda não encontrada.');
          if (e.retiradaEm !== null) throw new ApiError(409, 'ENCOMENDA_JA_ENTREGUE', 'Esta encomenda já foi retirada.');
          const p = d.pessoas.find((x) => x.id === pessoaId);
          if (!p) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          // RN-08: vínculo válido (aprovado ou legado no prazo, a mesma regra do interfone) ou autorização de retirada
          const aut = d.autorizacoesRetirada.find((a) => a.encomendaId === e.id && a.pessoaAutorizadaId === p.id);
          const ix = indices(d);
          const r = podeEntregarEncomenda(d.vinculos, pessoaId, e.unidadeId, agora(), !!aut, ix.codigoUn(e.unidadeId) ?? 'unidade');
          if (!r.ok) throw new ApiError(422, 'PESSOA_SEM_VINCULO', r.motivo);
          const antes = clone(e);
          e.retiradaEm = agora(); e.retiradaPorPessoaId = p.id; e.retiradaRegistradaPorId = u.id;
          // FK composta do schema: a autorização usada é desta encomenda e desta pessoa
          e.retiradaAutorizacaoId = r.por === 'autorizacao' ? aut!.id : null;
          registrar(d, u, 'encomenda.entregar', 'encomenda', e.id, antes, e);
          return e;
        });
      },
      // RN-08: "ou a pessoa autorizada por ela" — o morador com vínculo válido autoriza alguém a retirar
      async autorizarRetirada({ encomendaId, pessoaId, solicitadaPorPessoaId }) {
        const u = exige('encomenda.autorizar_retirada');
        return escrever((d) => {
          const e = d.encomendas.find((x) => x.id === encomendaId);
          if (!e) throw new ApiError(404, 'ENCOMENDA_NAO_ENCONTRADA', 'Encomenda não encontrada.');
          if (e.retiradaEm !== null) throw new ApiError(409, 'ENCOMENDA_JA_ENTREGUE', 'Esta encomenda já foi retirada.');
          const p = d.pessoas.find((x) => x.id === pessoaId);
          if (!p) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (p.anonimizadaEm || p.semCpf || !p.documentoBusca) {
            throw new ApiError(422, 'CPF_OBRIGATORIO', 'Quem vai retirar precisa estar cadastrado com CPF.');
          }
          if (!pessoaTemVinculoValido(d.vinculos, solicitadaPorPessoaId, e.unidadeId, agora())) {
            throw new ApiError(422, 'SOLICITANTE_SEM_VINCULO', 'Quem autoriza precisa ter vínculo válido (aprovado ou legado no prazo) com a unidade da encomenda.');
          }
          if (pessoaId === solicitadaPorPessoaId) throw new ApiError(422, 'AUTORIZACAO_PROPRIA', 'O morador com vínculo já pode retirar: não precisa se autorizar.');
          if (d.autorizacoesRetirada.some((a) => a.encomendaId === e.id && a.pessoaAutorizadaId === p.id)) {
            throw new ApiError(409, 'AUTORIZACAO_DUPLICADA', 'Esta pessoa já está autorizada a retirar esta encomenda.');
          }
          const a = { id: uid('ar'), encomendaId: e.id, pessoaAutorizadaId: p.id, solicitantePessoaId: solicitadaPorPessoaId, registradaPorId: u.id, registradaEm: agora() };
          d.autorizacoesRetirada.push(a);
          registrar(d, u, 'encomenda.autorizarRetirada', 'encomenda', e.id, null, a);
          return a;
        });
      },
    },

    ocorrencias: {
      async listar() {
        exige('ocorrencia.ver');
        return ler((d) => { const ix = indices(d); return [...d.ocorrencias].sort((a, b) => b.abertaEm - a.abertaEm).map((o) => ocorrenciaView(o, ix)); });
      },
      async criar(i) {
        const u = exige('ocorrencia.operar');
        return escrever((d) => {
          if (!i.descricao.trim()) throw new ApiError(422, 'DESCRICAO_OBRIGATORIA', 'Descreva a ocorrência.');
          if (i.unidadeId) unidadeOu404(d, i.unidadeId);
          const ids = new Set(d.eventos.map((e) => e.id));
          for (const eid of i.eventoIds ?? []) if (!ids.has(eid)) throw new ApiError(404, 'EVENTO_NAO_ENCONTRADO', 'Evento vinculado não encontrado.');
          const max = d.ocorrencias.reduce((m, o) => Math.max(m, Number(o.codigo.slice(-3))), 0);
          const codigo = `OC-2026-${String(max + 1).padStart(3, '0')}`;
          const o: Ocorrencia = {
            id: codigo, codigo, tipo: i.tipo, descricao: i.descricao.trim(), unidadeId: i.unidadeId, envolvidos: i.envolvidos.trim() || '—',
            abertaPorId: u.id, abertaEm: agora(), status: 'aberta', historicoStatus: [],
            anexos: i.anexos ?? [], eventoIds: i.eventoIds ?? [],
          };
          d.ocorrencias.push(o);
          registrar(d, u, 'ocorrencia.criar', 'ocorrencia', o.id, null, o);
          return o;
        });
      },
      async alterarStatus(id, status) {
        const u = exige('ocorrencia.operar');
        return escrever((d) => {
          const o = d.ocorrencias.find((x) => x.id === id);
          if (!o) throw new ApiError(404, 'OCORRENCIA_NAO_ENCONTRADA', 'Ocorrência não encontrada.');
          // Porteiro só mexe na ocorrência que ele mesmo abriu
          if (u.papel === 'porteiro' && o.abertaPorId !== u.id) {
            negar(u, 'ocorrencia.operar', 'O porteiro só altera ocorrências que ele mesmo abriu.', 'SO_PROPRIA_OCORRENCIA');
          }
          // Encerrada é estado final
          if (o.status === 'encerrada') throw new ApiError(409, 'OCORRENCIA_ENCERRADA', 'Ocorrência encerrada não pode ser alterada.');
          // Fluxo único: aberta -> em andamento -> encerrada
          const proximo: Record<StatusOcorrencia, StatusOcorrencia | null> = { aberta: 'em_andamento', em_andamento: 'encerrada', encerrada: null };
          if (proximo[o.status] !== status) {
            throw new ApiError(422, 'TRANSICAO_INVALIDA', 'Transição de status inválida: o fluxo é aberta, em andamento e encerrada, nessa ordem.');
          }
          const antes = clone(o);
          o.historicoStatus.push({ de: o.status, para: status, porId: u.id, em: agora() });
          o.status = status;
          registrar(d, u, 'ocorrencia.alterarStatus', 'ocorrencia', o.id, antes, o);
          return o;
        });
      },
    },

    turno: {
      async resumo() {
        exige('turno.ver');
        return ler((d) => {
          const ix = indices(d);
          const n = agora();
          const dow = partes(n).dow;
          return {
            pessoasDentro: d.eventos.filter((e) => e.tipo === 'entrada' && !ix.saidas.has(e.id)).length,
            encomendasPendentes: d.encomendas.filter((e) => e.retiradaEm === null).length,
            ocorrenciasAbertas: d.ocorrencias.filter((o) => o.status !== 'encerrada').length,
            autorizacoesHoje: d.autorizacoes.filter((a) => a.revogadaEm === null && a.validaDe <= fimDoDia(n) && a.validaAte >= inicioDoDia(n) && (!a.diasSemana || a.diasSemana.includes(dow))).length,
            excecoesHoje: d.eventos.filter((e) => responsavelExcecao(d, ix.ef(e)) !== null && ix.ef(e).ocorridoEm >= inicioDoDia(n)).length,
            restricoesPendentes: d.restricoes.filter((r) => r.escopo === 'condominio' && r.aprovadaEm === null && r.revogadaEm === null).length,
          };
        });
      },
    },

    relatorios: {
      async resumo(f) {
        exige('relatorio.ver');
        return ler((d) => calcularResumo(d, f));
      },
      // RF-30/RF-31: o mesmo resumo em CSV (seção;item;total), respeitando os filtros
      async exportarCsv(f) {
        exige('relatorio.ver');
        const r = await ler((d) => calcularResumo(d, f));
        const d = await carregar();
        const celula = (v: string | number) => {
          let t = String(v);
          if (/^[=+\-@]/.test(t)) t = `'${t}`; // evita interpretação como fórmula no Excel
          return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        };
        const linhas: (string | number)[][] = [['Seção', 'Item', 'Total']];
        linhas.push(['Período', `${fmtData(r.periodo.de)} a ${fmtData(r.periodo.ate)}`, '']);
        if (f?.unidadeId) { const un = d.unidades.find((x) => x.id === f.unidadeId); linhas.push(['Filtro', 'Unidade', un ? codigoUnidade(un) : f.unidadeId]); }
        if (f?.categoria) linhas.push(['Filtro', 'Tipo de pessoa', ROTULO_CATEGORIA[f.categoria]]);
        if (f?.meio) linhas.push(['Filtro', 'Meio de autorização', ROTULO_MEIO[f.meio]]);
        for (const [k, v] of Object.entries(r.totais)) linhas.push(['Totais', k, v]);
        for (const x of r.acessosPorDia) linhas.push(['Acessos por dia', fmtData(x.dia), x.entradas]);
        for (const x of r.acessosPorMeio) linhas.push(['Acessos por meio', ROTULO_MEIO[x.meio], x.total]);
        for (const x of r.excecoesPorPorteiro) linhas.push(['Exceções por responsável', x.operador, x.total]);
        for (const x of r.encomendasPorIdade) linhas.push(['Encomendas pendentes por idade', x.faixa, x.total]);
        const stamp = new Date(agora() - 3 * 3600 * 1000).toISOString().slice(0, 10);
        return {
          nomeArquivo: `relatorio-portaria-parque-${stamp}.csv`,
          conteudo: '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n',
          quantidade: r.totais.entradas,
        };
      },
    },

    auditoria: {
      // RF-37 / spec 4.5: recalcula a cadeia com a serialização canônica v1 (a mesma do banco)
      async verificarIntegridade() {
        exige('auditoria.verificar');
        await esperar();
        const d = await carregar();
        return verificarCadeiaEventos(d.eventos);
      },
      async alteracoes(f = {}) {
        exige('auditoria.verificar');
        return ler((d) => d.auditLog
          .filter((r) => (f.de === undefined || r.em >= f.de) && (f.ate === undefined || r.em <= f.ate)
            && (!f.usuarioId || r.usuarioId === f.usuarioId) && (!f.acao || r.acao === f.acao) && (!f.entidade || r.entidade === f.entidade))
          .sort((a, b) => b.seq - a.seq));
      },
      // RF-32 / spec 4.7: JSONL com manifesto, cada evento no formato canônico (snake_case, ISO, v, hash_anterior, hash)
      // e os nomes resolvidos à parte ("exibicao"), que não entram no hash.
      async exportar(f) {
        const u = exige('auditoria.exportar');
        await esperar();
        const d = await carregar();
        const ix = indices(d);
        const evs = filtrarEventos(d, f).sort((a, b) => a.seq - b.seq);
        const isolado = !!f?.eventoId;
        if (isolado && evs.length === 0) throw new ApiError(404, 'EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.');
        const g = await hashGenese();
        const primeiro = evs[0];
        // Âncora de início: seq e hash do evento imediatamente anterior ao primeiro exportado (gênese se for o seq 1)
        const ancora = primeiro ? { seq: primeiro.seq - 1, hash: primeiro.hashAnterior } : { seq: 0, hash: g };
        const consecutivos = evs.every((e, k) => k === 0 || e.seq === evs[k - 1].seq + 1);
        const manifesto = {
          tipo: 'manifesto', formato: 'portaria-parque/trilha-jsonl', versao: 2, formatoHash: FORMATO_HASH, sistema: 'Portaria Parque',
          condominio: 'Condomínio Residencial do Parque', geradoPor: u.nome, geradoEm: `${isoSP(agora())} (horário simulado)`,
          quantidade: evs.length, filtros: f ?? {}, modo: isolado ? 'evento_isolado' : 'trilha', consecutivos,
          algoritmo: 'hash = hex(SHA-256(UTF-8(hash_anterior + canonico))). canonico = JSON compacto (sem espaços) de {"v":1, ...campos na ordem de ordemCampos}, com null explícito, instantes em ISO 8601 UTC com milissegundos (Date.toISOString) e correcao_valores como objeto só com as chaves presentes, na ordem de chavesCorrecao. É a mesma serialização do banco (evento_acesso_canonico).',
          ordemCampos: ['v', ...CAMPOS_CANONICOS_V1], chavesCorrecao: CHAVES_CORRECAO_V1,
          hashGenese: g, genese: 'SHA-256 da string "genesis"', ancora,
          instrucoesVerificacao: isolado ? [
            '1. Monte o JSON canônico da linha de tipo "evento" (campo "evento", sem hash_anterior e hash, na ordem de ordemCampos), calcule SHA-256(hash_anterior + canonico) e compare com "hash": isto confere que o conteúdo deste evento não foi alterado.',
            '2. A verificação de um único evento confere apenas o hash dele. Ela não prova, sozinha, que o evento pertence à cadeia nem que nada foi removido antes ou depois.',
            '3. A ligação com a cadeia se confere pelo "hash_anterior": ele deve ser igual ao "hash" do evento de seq anterior na trilha completa (ou ao hashGenese, se for o seq 1), ou ser comparado com a âncora recebida por fonte externa independente.',
            'Qualquer divergência indica que o registro foi alterado depois de gravado.',
          ] : [
            '1. Para cada linha de tipo "evento", calcule SHA-256(hash_anterior + canonico) e compare com "hash".',
            '2. Para eventos consecutivos (seq, seq+1), confirme que "hash_anterior" do seguinte é igual ao "hash" do anterior; o primeiro deve ter hash_anterior igual a ancora.hash.',
            '3. Exportação filtrada (consecutivos = false) só permite conferir cada evento isoladamente (passo 1).',
            '4. Compare o hash do último evento com a âncora recebida por fonte externa independente (e-mail ao síndico/conselho). Sem âncora externa o arquivo prova apenas consistência interna.',
            'Qualquer divergência indica que o registro (ou um anterior) foi alterado depois de gravado.',
          ],
          observacao: 'Arquivo de hashes para verificação. Este protótipo gera o arquivo no navegador; não há assinatura digital nem âncora externa.',
        };
        const linhas = [JSON.stringify(manifesto)];
        for (const e of evs) {
          linhas.push(JSON.stringify({
            tipo: 'evento', seq: e.seq, evento: paraExportado(e),
            exibicao: {
              codigo: codigoEvento(e.seq), pessoa: ix.pessoas.get(e.pessoaId)?.nome ?? null,
              unidade: ix.codigoUn(e.unidadeDestinoId), areaComum: e.areaComumId ? ix.areas.get(e.areaComumId)?.nome ?? null : null,
              operador: ix.usuarios.get(e.operadorId)?.nome ?? null,
            },
          }));
        }
        const ultimo = evs[evs.length - 1];
        linhas.push(JSON.stringify({ tipo: 'resumo', quantidade: evs.length, ultimoSeq: ultimo?.seq ?? null, ultimoHash: ultimo?.hash ?? null }));
        const p = new Date(agora() - 3 * 3600 * 1000).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
        const nomeArquivo = isolado ? `evento-${codigoEvento(evs[0].seq)}-${p}.jsonl` : `trilha-portaria-parque-${p}.jsonl`;
        return { nomeArquivo, conteudo: linhas.join('\n') + '\n', quantidade: evs.length };
      },
    },

    usuarios: {
      async listar() { exige('usuario.gerenciar'); return ler((d) => [...d.usuarios]); },
      async criar(i) {
        const eu = exige('usuario.gerenciar');
        if (i.papel === 'sindico') exige('usuario.gerenciar_sindico'); // administração não cria síndico (spec 5.2)
        return escrever((d) => {
          const login = i.login.trim().toLowerCase();
          if (!i.nome.trim() || !login) throw new ApiError(422, 'DADOS_OBRIGATORIOS', 'Informe nome e login.');
          if (d.usuarios.some((x) => x.login === login)) throw new ApiError(409, 'LOGIN_EXISTENTE', 'Já existe um usuário com este login.');
          // RN-05: login individual
          const novo: UsuarioSistema = { id: uid('u'), nome: i.nome.trim(), login, papel: i.papel, ativo: true, ultimoAcesso: null };
          d.usuarios.push(novo);
          registrar(d, eu, 'usuario.criar', 'usuario', novo.id, null, novo);
          return { usuario: novo, senhaTemporaria: senhaTemporariaDemo() };
        });
      },
      async desativar(id) {
        const eu = exige('usuario.gerenciar');
        return escrever((d) => {
          const x = alvoUsuario(d, eu, id);
          if (x.id === eu.id) throw new ApiError(422, 'AUTO_DESATIVACAO', 'Você não pode desativar o próprio usuário.');
          const antes = clone(x);
          x.ativo = false; // o histórico (eventos com operadorId) é mantido
          registrar(d, eu, 'usuario.desativar', 'usuario', x.id, antes, x);
          return x;
        });
      },
      async reativar(id) {
        const eu = exige('usuario.gerenciar');
        return escrever((d) => {
          const x = alvoUsuario(d, eu, id);
          const antes = clone(x);
          x.ativo = true;
          registrar(d, eu, 'usuario.reativar', 'usuario', x.id, antes, x);
          return x;
        });
      },
      async redefinirAcesso(id) {
        const eu = exige('usuario.gerenciar');
        return escrever((d) => {
          const x = alvoUsuario(d, eu, id);
          // no mock: só registra o pedido; o servidor real geraria senha temporária e exigiria troca no próximo login
          registrar(d, eu, 'usuario.redefinirAcesso', 'usuario', x.id, null, { login: x.login });
          return { usuario: x, senhaTemporaria: senhaTemporariaDemo() };
        });
      },
      async alterarPapel(id, papel) {
        const eu = exige('usuario.gerenciar');
        return escrever((d) => {
          const x = d.usuarios.find((u) => u.id === id);
          if (!x) throw new ApiError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
          if (x.id === eu.id) throw new ApiError(422, 'AUTO_ALTERACAO_PAPEL', 'Ninguém altera o próprio papel.');
          // Tirar alguém de síndico ou promover a síndico: só o síndico (usuario.gerenciar_sindico)
          if ((x.papel === 'sindico' || papel === 'sindico') && !pode(eu.papel, 'usuario.gerenciar_sindico')) {
            negar(eu, 'usuario.gerenciar_sindico', `O perfil ${ROTULO_PAPEL[eu.papel]} não pode atribuir nem retirar o papel de síndico.`);
          }
          if (x.papel === papel) return x;
          const antes = clone(x);
          x.papel = papel;
          registrar(d, eu, 'usuario.alterarPapel', 'usuario', x.id, antes, x);
          return x;
        });
      },
    },

    lgpd: {
      // spec 9.3 (art. 18, acesso): cadastro mascarado, vínculos, veículos, eventos e encomendas
      async exportarPessoa(pessoaId) {
        const u = exige('lgpd.exportar');
        return escrever((d) => {
          const ix = indices(d);
          const p = ix.pessoas.get(pessoaId);
          if (!p) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          const vinculos = d.vinculos.filter((v) => v.pessoaId === p.id);
          const unidadesValidas = new Set(vinculos.filter((v) => vinculoValido(v, agora())).map((v) => v.unidadeId));
          const iso = (t: number | null | undefined) => (t === null || t === undefined ? null : isoSP(t));
          const eventos = d.eventos.map((e) => ix.ef(e)).filter((e) => e.pessoaId === p.id && e.tipo !== 'correcao');
          const conteudo = {
            tipo: 'portaria-parque/lgpd-exportacao', versao: 1, geradoEm: `${isoSP(agora())} (horário simulado)`, geradoPor: u.nome,
            titular: {
              id: p.id, nome: p.nome, categoria: ROTULO_CATEGORIA[p.categoria], cpf: p.documentoMascarado, semCpf: !!p.semCpf,
              telefone: mascararTelefone(p.telefone), empresa: p.empresa ?? null, servico: p.servico ?? null,
              cadastradoEm: iso(p.criadoEm), anonimizadaEm: iso(p.anonimizadaEm),
            },
            vinculos: vinculos.map((v) => ({
              unidade: ix.codigoUn(v.unidadeId), tipo: v.tipo, status: v.status, vigenciaInicio: iso(v.vigenciaInicio), vigenciaFim: iso(v.vigenciaFim),
              prazoRegularizacao: iso(v.prazoRegularizacao), decididoEm: iso(v.decididoEm), encerradoEm: iso(v.encerradoEm),
              comprovanteConferido: v.conferencia ? { tipo: v.conferencia.tipoDocumento, data: iso(v.conferencia.data) } : null,
            })),
            veiculos: d.veiculos.filter((v) => unidadesValidas.has(v.unidadeId)).map((v) => ({ unidade: ix.codigoUn(v.unidadeId), placa: v.placa, modelo: v.modelo, cor: v.cor })),
            eventos: eventos.map((e) => ({
              codigo: codigoEvento(e.seq), tipo: e.tipo, ocorridoEm: iso(e.ocorridoEm), pontoAcesso: ix.pontos.get(e.pontoAcessoId)?.nome ?? PORTARIA_SOCIAL,
              unidade: ix.codigoUn(e.unidadeDestinoId), areaComum: e.areaComumId ? ix.areas.get(e.areaComumId)?.nome ?? null : null,
              meio: e.autorizadoPorTipo ? ROTULO_MEIO[e.autorizadoPorTipo] : null, retroativo: e.retroativo,
            })),
            encomendasRetiradas: d.encomendas.filter((e) => e.retiradaPorPessoaId === p.id).map((e) => ({
              codigo: e.codigo, unidade: ix.codigoUn(e.unidadeId), recebidaEm: iso(e.recebidaEm), retiradaEm: iso(e.retiradaEm),
            })),
            documentos: [],
            observacoes: [
              'O número do CPF não é armazenado (só a máscara e um código de busca irreversível).',
              'Telefone exibido mascarado; o titular o conhece e pode corrigi-lo pela administração.',
            ],
          };
          registrar(d, u, 'lgpd.exportar', 'pessoa', p.id, null, { vinculos: vinculos.length, eventos: eventos.length });
          const stamp = new Date(agora() - 3 * 3600 * 1000).toISOString().slice(0, 10);
          return { nomeArquivo: `lgpd-${slug(p.id)}-${stamp}.json`, conteudo: JSON.stringify(conteudo, null, 2) + '\n', quantidade: eventos.length };
        });
      },
      // art. 18, VI: elimina o que pode ser eliminado e informa o que fica retido (spec 9.3)
      async anonimizar(pessoaId) {
        const u = exige('lgpd.anonimizar');
        return escrever((d) => {
          const p = d.pessoas.find((x) => x.id === pessoaId);
          if (!p) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (p.anonimizadaEm) throw new ApiError(409, 'PESSOA_JA_ANONIMIZADA', 'Esta pessoa já foi anonimizada.');
          if (d.vinculos.some((v) => v.pessoaId === p.id && vinculoValido(v, agora()))) {
            throw new ApiError(422, 'PESSOA_COM_VINCULO_VALIDO', 'A pessoa tem vínculo válido com uma unidade: encerre o vínculo antes de anonimizar.');
          }
          const registrosRedigidos = anonimizarPessoa(d, u, p, 'pedido');
          return { pessoaId: p.id, registrosRedigidos, retido: RETIDO };
        });
      },
      // RNF-09 / spec 9.1: anonimiza quem passou do prazo de 3 anos. Os eventos não são apagados no mock.
      async aplicarRetencao() {
        const u = exige('lgpd.retencao');
        return escrever((d) => {
          const ix = indices(d);
          const n = agora();
          let visitantesPrestadores = 0, moradores = 0, registrosRedigidos = 0;
          const pessoaIds: string[] = [];
          for (const p of d.pessoas) {
            const ult = ultimoAcesso(d, ix, p.id)?.ocorridoEm ?? null;
            if (!elegivelRetencao(p, d.vinculos.filter((v) => v.pessoaId === p.id), ult, n)) continue;
            if (p.categoria === 'morador') moradores++; else visitantesPrestadores++;
            pessoaIds.push(p.id);
            registrosRedigidos += anonimizarPessoa(d, u, p, 'retencao');
          }
          // retencao_execucao do schema: só contagens e ids, sem dado pessoal
          registrar(d, u, 'lgpd.retencao', 'retencao', '-', null, { visitantesPrestadores, moradores, registrosRedigidos, pessoaIds });
          return { visitantesPrestadores, moradores, registrosRedigidos, pessoaIds };
        });
      },
    },

    importacao: {
      async analisar({ arquivo, linhas }) {
        const u = exige('importacao.executar');
        return escrever(async (d) => {
          const inc: InconsistenciaImportacao[] = [];
          const validas: LinhaPlanilha[] = [];
          const vistos = new Set<string>();
          for (const l of linhas) {
            const torre = Number(l.torre.replace(/\D/g, ''));
            const numero = l.unidade.replace(/\D/g, '');
            const un = d.unidades.find((x) => x.ativo && x.torre === torre && x.numero === numero);
            const cod = `T${torre}-${numero}`;
            if (!un) { inc.push({ linha: l.linha, codigo: 'UNIDADE_INEXISTENTE', mensagem: `Unidade ${l.torre}/${l.unidade} não existe no condomínio (ou está desativada). Linha não importada.`, tipo: 'erro' }); continue; }
            if (!l.nome.trim()) { inc.push({ linha: l.linha, codigo: 'NOME_AUSENTE', mensagem: 'Nome ausente. Linha não importada.', tipo: 'erro' }); continue; }
            const docDigitos = soDigitos(l.documento);
            const cpfOk = cpfValido(docDigitos);
            // Duplicidade na planilha: pelo CPF (quando válido) ou, sem CPF, pelo nome na mesma unidade
            const chaveDup = cpfOk ? `cpf|${docDigitos}|${un.id}` : `${norm(l.nome)}|${un.id}`;
            if (vistos.has(chaveDup)) { inc.push({ linha: l.linha, codigo: 'DUPLICIDADE_PLANILHA', mensagem: `${l.nome} aparece duas vezes na unidade ${cod}. Consolidado.`, tipo: 'aviso' }); continue; }
            vistos.add(chaveDup);
            if (!docDigitos) inc.push({ linha: l.linha, codigo: 'DOC_AUSENTE', mensagem: `${l.nome}: sem CPF. Importado como legado, pendente de regularização (RN-09).`, tipo: 'aviso' });
            else if (!cpfOk) inc.push({ linha: l.linha, codigo: 'DOC_INVALIDO', mensagem: `${l.nome}: CPF inválido. O número não será gravado; importado como legado, pendente de regularização (RN-09).`, tipo: 'aviso' });
            if (soDigitos(l.telefone).length < 10 && l.telefone.trim()) inc.push({ linha: l.linha, codigo: 'TELEFONE_INVALIDO', mensagem: `${l.nome}: telefone com menos de 10 dígitos.`, tipo: 'aviso' });
            const existente = await acharPessoaImportacao(d, l.nome, cpfOk ? docDigitos : '', un.id);
            if (existente && d.vinculos.some((v) => v.pessoaId === existente.id && v.unidadeId === un.id && ['pendente', 'aprovado', 'legado'].includes(v.status))) {
              inc.push({ linha: l.linha, codigo: 'DUPLICIDADE_BANCO', mensagem: `${l.nome} já possui vínculo com ${cod}. Reaproveitado, sem duplicar.`, tipo: 'aviso' });
            }
            validas.push({ ...l, torre: String(torre), unidade: numero });
          }
          const rejeitadas = linhas.length - validas.length - inc.filter((i2) => i2.codigo === 'DUPLICIDADE_PLANILHA').length;
          // Estado "analisada" persistido (como no schema); as linhas, com CPF em claro, ficam só em memória
          const imp: Importacao = {
            id: uid('imp'), arquivoNome: arquivo, arquivoSha256: await sha256Hex(JSON.stringify(linhas)), status: 'analisada',
            lidas: linhas.length, importaveis: validas.length, rejeitadas, avisos: inc.filter((i2) => i2.tipo === 'aviso').length,
            importados: null, reaproveitados: null, prazoRegularizacao: PRAZO_LEGADO, executadaPorId: u.id, analisadaEm: agora(), confirmadaEm: null,
          };
          d.importacoes.push(imp);
          linhasImportacao.set(imp.id, validas);
          registrar(d, u, 'importacao.analisar', 'importacao', imp.id, null, imp);
          const relatorio: RelatorioImportacao = {
            id: imp.id, arquivo, status: 'analisada', lidas: imp.lidas, importaveis: imp.importaveis, rejeitadas, avisos: imp.avisos,
            inconsistencias: inc, amostra: linhas.slice(0, 8), prazoRegularizacao: PRAZO_LEGADO,
          };
          return relatorio;
        });
      },
      async confirmar(id) {
        const u = exige('importacao.executar');
        return escrever(async (d) => {
          const imp = d.importacoes.find((x) => x.id === id);
          const validas = linhasImportacao.get(id);
          if (!imp || !validas) throw new ApiError(404, 'IMPORTACAO_NAO_ENCONTRADA', 'Análise de importação não encontrada. Envie o arquivo novamente.');
          if (imp.status !== 'analisada') throw new ApiError(409, 'IMPORTACAO_JA_CONFIRMADA', 'Esta importação já foi confirmada ou cancelada.');
          let importados = 0, reaproveitados = 0;
          for (const l of validas) {
            const un = d.unidades.find((x) => x.torre === Number(l.torre) && x.numero === l.unidade)!;
            const dig = soDigitos(l.documento);
            const cpfOk = cpfValido(dig); // CPF inválido vira aviso e o número não é gravado
            // Nunca casa só por nome globalmente: CPF, ou nome NA MESMA unidade quando não há CPF
            const existente = await acharPessoaImportacao(d, l.nome, cpfOk ? dig : '', un.id);
            if (existente && d.vinculos.some((v) => v.pessoaId === existente.id && v.unidadeId === un.id && ['pendente', 'aprovado', 'legado'].includes(v.status))) {
              reaproveitados++; continue;
            }
            let p = existente;
            if (!p) {
              const tel = soDigitos(l.telefone);
              p = {
                id: uid('pe'), nome: l.nome.trim(), categoria: 'morador', documentoTipo: 'cpf',
                documentoMascarado: cpfOk ? mascararCpf(dig) : SEM_CPF, ...(cpfOk ? { documentoBusca: await documentoBuscaCpf(dig, CHAVE_HMAC_DEMO) } : { semCpf: true }),
                telefone: tel.length >= 10 ? tel : undefined, importacaoId: imp.id, anonimizadaEm: null, criadoEm: agora(),
              };
              d.pessoas.push(p);
            }
            const tipo = /inquil/i.test(l.tipo ?? '') ? 'inquilino' : /depend/i.test(l.tipo ?? '') ? 'dependente' : 'proprietario';
            d.vinculos.push({
              id: uid('V'), pessoaId: p.id, unidadeId: un.id, tipo, status: 'legado', vigenciaInicio: null, vigenciaFim: null,
              prazoRegularizacao: PRAZO_LEGADO, conferencia: null, solicitadoPor: `Importação da planilha ${imp.arquivoNome}`, solicitadoEm: agora(),
              registradoPorId: u.id, importacaoId: imp.id, encerradoEm: null,
            });
            importados++;
          }
          linhasImportacao.delete(id);
          const antes = clone(imp);
          imp.status = 'confirmada'; imp.importados = importados; imp.reaproveitados = reaproveitados; imp.confirmadaEm = agora();
          registrar(d, u, 'importacao.confirmar', 'importacao', id, antes, imp);
          return { importados, reaproveitados, prazoRegularizacao: PRAZO_LEGADO };
        });
      },
    },

    demo: {
      async restaurar() {
        await esperar();
        db = await criarSeed();
        carregando = Promise.resolve(db);
        relogio.reiniciar();
        sessao = null; gravarSessao();
        linhasImportacao.clear();
        try { if (persistir) localStorage.removeItem(chave); } catch { /* ignora */ }
        salvar();
      },
    },
  };

  /** Usuário alvo de gestão; se ele for síndico, exige também usuario.gerenciar_sindico (RNF-04). */
  function alvoUsuario(d: DbData, eu: UsuarioSistema, id: string): UsuarioSistema {
    const x = d.usuarios.find((u) => u.id === id);
    if (!x) throw new ApiError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
    if (x.papel === 'sindico' && !pode(eu.papel, 'usuario.gerenciar_sindico')) {
      negar(eu, 'usuario.gerenciar_sindico', `O perfil ${ROTULO_PAPEL[eu.papel]} não gerencia o usuário do síndico.`);
    }
    return x;
  }

  /** Importação: casa por CPF (HMAC) quando houver; sem CPF, só pessoa com o mesmo nome JÁ vinculada à mesma unidade. */
  async function acharPessoaImportacao(d: DbData, nome: string, cpfDigitos: string, unidadeId: string): Promise<Pessoa | undefined> {
    if (cpfDigitos) {
      const busca = await documentoBuscaCpf(cpfDigitos, CHAVE_HMAC_DEMO);
      return d.pessoas.find((p) => p.documentoBusca === busca);
    }
    return d.pessoas.find((p) => norm(p.nome) === norm(nome) && d.vinculos.some((v) => v.pessoaId === p.id && v.unidadeId === unidadeId));
  }

  async function buscarPessoas(d: DbData, q: string, semMoradores: boolean): Promise<PessoaBusca[]> {
    const n = agora();
    const ix = indices(d);
    const nq = norm(q);
    const digitos = soDigitos(q);
    const un = acharUnidadePorTexto(d.unidades, q);
    const placa = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    // CPF completo (11 dígitos): igualdade exata pelo HMAC; senão, parcial nos dígitos visíveis do mascarado
    const busca = digitos.length === 11 ? await documentoBuscaCpf(digitos, CHAVE_HMAC_DEMO) : null;
    const validos = d.vinculos.filter((v) => vinculoValido(v, n));
    const comVinculoValido = new Set(validos.map((v) => v.pessoaId));
    const idsPorUnidade = un ? new Set(d.vinculos.filter((v) => v.unidadeId === un.id && v.status !== 'rejeitado' && v.status !== 'encerrado').map((v) => v.pessoaId)) : null;
    // Placa: pessoas com vínculo VÁLIDO na unidade do veículo (pendente/rejeitado/encerrado não contam)
    const idsPorPlaca = placa.length >= 4
      ? new Set(d.veiculos.filter((v) => v.placa.replace('-', '').includes(placa)).flatMap((v) => validos.filter((x) => x.unidadeId === v.unidadeId).map((x) => x.pessoaId)))
      : null;
    const achados = d.pessoas.filter((p) => {
      if (p.anonimizadaEm) return false; // cadastro anonimizado não aparece na busca
      // Na portaria, quem tem vínculo válido em alguma unidade é morador (não depende da categoria gravada)
      if (semMoradores && comVinculoValido.has(p.id)) return false;
      if (norm(p.nome).includes(nq)) return true;
      if (busca ? p.documentoBusca === busca : digitos.length >= 3 && soDigitos(p.documentoMascarado).includes(digitos)) return true;
      if (idsPorUnidade?.has(p.id)) return true;
      if (idsPorPlaca?.has(p.id)) return true;
      return false;
    });
    // Ordenação: nome exato > começa com > contém > outros critérios (documento, unidade, placa); depois alfabética
    const rank = (p: Pessoa) => { const nn = norm(p.nome); return nn === nq ? 0 : nn.startsWith(nq) ? 1 : nn.includes(nq) ? 2 : 3; };
    achados.sort((a, b) => rank(a) - rank(b) || a.nome.localeCompare(b.nome, 'pt-BR'));
    return achados.map((p) => pessoaBusca(d, p, ix));
  }

  // ----- Ferramentas de desenvolvimento (demonstração da adulteração à banca) ---------------------
  if ((opts.ferramentasDev ?? typeof window !== 'undefined') && typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>;
    w.__adulterarEvento = async (ref: string | number) => {
      const d = await carregar();
      const e = d.eventos.find((x) => x.id === ref || codigoEvento(x.seq) === ref || x.seq === Number(ref));
      if (!e) { console.error('Evento não encontrado:', ref); return; }
      // Altera um campo SEM recalcular o hash: é exatamente o que a verificação precisa detectar.
      e.observacao = `${e.observacao ?? ''} (ADULTERADO FORA DO SISTEMA)`.trim();
      salvar();
      console.warn(`Evento ${codigoEvento(e.seq)} (seq ${e.seq}) adulterado sem recalcular o hash. Use "Verificar integridade" no Histórico de acessos.`);
    };
    w.__restaurarDemo = async () => { await api.demo!.restaurar(); location.reload(); };
  }

  return api;
}
