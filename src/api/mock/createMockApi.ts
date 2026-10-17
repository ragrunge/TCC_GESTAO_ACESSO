// Implementação em memória da API. As regras de negócio são aplicadas AQUI (o "servidor"),
// não apenas na UI: RN-01, RF-16, RF-17, RN-03, RN-07, RN-08, RN-04 e a matriz RBAC.
import type {
  Api, Autorizador, AutorizacaoView, FichaPessoa, FiltroEventos, FiltroRelatorio, InconsistenciaImportacao, LinhaPlanilha,
  PessoaBusca, RelatorioImportacao, RelatorioResumo, RestricaoView, UnidadeDetalhe, UnidadeResumo, VinculoView,
} from '../types';
import { ApiError } from '../types';
import type {
  AutorizacaoPrevia, CategoriaPessoa, EventoAcesso, EventoView, Pessoa, RegistroAlteracao, Restricao, StatusOcorrencia,
  UsuarioSistema, ValoresCorrecao, VinculoUnidade, Encomenda, Ocorrencia,
} from '@portaria/domain/types';
import { CAMPOS_CORRIGIVEIS, ROTULO_CATEGORIA, ROTULO_MEIO, ROTULO_PAPEL } from '@portaria/domain/types';
import { pode, type Acao } from '@portaria/domain/rbac';
import {
  DIAS_ENCOMENDA_ATRASADA, cpfValido, estadoAutorizacaoPrevia, justificativaValida, MIN_JUSTIFICATIVA, pessoaTemVinculoValido,
  podeEntregarEncomenda, restricoesVigentes, validarAutorizacaoEntrada, validarDecisaoVinculo, vinculoValido,
  vinculosValidosDaUnidade,
} from '@portaria/domain/rules';
import { CAMPOS_CANONICOS, calcularHash, camposCanonicos, hashGenese, sha256Hex, verificarCadeia } from '@portaria/domain/hashChain';
import { DIA, agora, fimDoDia, fmtDataHora, fmtData, fmtHora, inicioDoDia, partes, relogio } from '@portaria/domain/time';
import { rotuloUnidade, unidadeExiste } from '@portaria/domain/units';
import { VERSAO_DB, type DbData } from './dbTypes';
import { criarSeed } from './seed';
import { dt, slug } from './seedUtil';

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
const so_digitos = (s: string) => s.replace(/\D/g, '');

const mascararCpf = (d: string) => `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
const SEM_CPF = '(sem CPF)';
const telefoneValido = (t?: string | null) => so_digitos(t ?? '').length >= 10;

// ----- Trilha de alterações: snapshots sem dado pessoal em claro --------------------------------
const CPF_COMPLETO = /(\d{3})\.(\d{3})\.(\d{3})-(\d{2})/g;
function semPII(v: unknown, chave = ''): unknown {
  if (Array.isArray(v)) return v.map((x) => semPII(x, chave));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'documentoBusca') o[k] = semPII(x, k); // o hash do CPF também fica de fora
    return o;
  }
  if (typeof v !== 'string') return v;
  if (chave === 'telefone') { const d = so_digitos(v); return d.length >= 4 ? `(**) *****-${d.slice(-4)}` : '***'; }
  return v.replace(CPF_COMPLETO, (_m, _a, b, c) => `***.${b}.${c}-**`);
}
const snap = (v: unknown): Record<string, unknown> | null => (v === null || v === undefined ? null : (semPII(structuredClone(v)) as Record<string, unknown>));

let contadorId = 0;
const uid = (prefixo: string) => `${prefixo}-${Date.now().toString(36)}${(++contadorId).toString(36)}`;

export function createMockApi(opts: MockOptions = {}): Api {
  const latencia = opts.latencia ?? [100, 300];
  const temStorage = typeof localStorage !== 'undefined';
  const persistir = opts.persistir ?? temStorage;
  const chave = opts.chaveStorage ?? CHAVE_PADRAO;

  let db: DbData | null = null;
  let carregando: Promise<DbData> | null = null;
  let sessao: UsuarioSistema | null = null;
  const importacoes = new Map<string, { relatorio: RelatorioImportacao; validas: LinhaPlanilha[] }>();

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
  function exige(acao: Acao): UsuarioSistema {
    const u = usuario();
    if (!pode(u.papel, acao)) {
      throw new ApiError(403, 'SEM_PERMISSAO', `O perfil ${ROTULO_PAPEL[u.papel]} não tem permissão para esta ação (${acao}).`);
    }
    return u;
  }
  const quemRegistra = (u: UsuarioSistema) => `${u.nome} (${ROTULO_PAPEL[u.papel]})`;

  /** Trilha de alterações (append-only): todo registro grava quem, quando, o quê, antes e depois (sem PII em claro). */
  function registrar(
    d: DbData, u: Pick<UsuarioSistema, 'id' | 'nome' | 'papel'> | null, acao: string, entidade: string, registroId: string,
    antes: unknown, depois: unknown, nomeInformado = '(desconhecido)',
  ) {
    const reg: RegistroAlteracao = {
      id: uid('al'), seq: (d.auditLog[d.auditLog.length - 1]?.seq ?? 0) + 1, em: agora(),
      usuarioId: u?.id ?? null, usuarioNome: u?.nome ?? nomeInformado, usuarioPapel: u?.papel ?? null,
      acao, entidade, registroId, antes: snap(antes), depois: snap(depois),
    };
    d.auditLog.push(reg);
  }

  // ----- Índices e visões -----------------------------------------------------------------------
  function indices(d: DbData) {
    const pessoas = new Map(d.pessoas.map((p) => [p.id, p]));
    const usuarios = new Map(d.usuarios.map((u) => [u.id, u]));
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
      return c?.correcaoValores ? { ...e, ...(JSON.parse(c.correcaoValores) as Partial<ValoresCorrecao>) } : e;
    };
    const semSolicitante = new Set(d.autorizacoes.filter((a) => a.semSolicitante).map((a) => a.id));
    return { pessoas, usuarios, saidas, porId, correcoes, ef, semSolicitante };
  }
  type Ix = ReturnType<typeof indices>;

  function view(bruto: EventoAcesso, ix: Ix): EventoView {
    const ev = ix.ef(bruto);
    const saida = ev.tipo === 'entrada' ? ix.saidas.get(ev.id) ?? null : null;
    const entrada = ev.tipo === 'saida' && ev.refereEventoId ? ix.porId.get(ev.refereEventoId) : undefined;
    const c = ix.correcoes.get(bruto.id);
    const aplicados: Partial<ValoresCorrecao> = c?.correcaoValores ? JSON.parse(c.correcaoValores) : {};
    const valoresOriginais: Partial<ValoresCorrecao> = {};
    for (const k of CAMPOS_CORRIGIVEIS) if (k in aplicados) (valoresOriginais as Record<string, unknown>)[k] = bruto[k];
    return {
      ...ev,
      pessoaNome: ix.pessoas.get(ev.pessoaId)?.nome ?? '(pessoa removida)',
      operadorNome: ix.usuarios.get(ev.operadorId)?.nome ?? '(operador)',
      unidadeRotulo: ev.unidadeDestinoId,
      saida: saida ? { id: saida.id, codigo: saida.codigo, em: ix.ef(saida).ocorridoEm } : null,
      dentro: ev.tipo === 'entrada' && !saida,
      entradaCodigo: entrada?.codigo ?? null,
      valoresOriginais: Object.keys(valoresOriginais).length > 0 ? valoresOriginais : null,
      correcao: c ? {
        id: c.id, codigo: c.codigo, em: c.registradoEm, justificativa: c.justificativa, observacao: c.observacao,
        operadorNome: ix.usuarios.get(c.operadorId)?.nome ?? '(operador)',
      } : null,
      valoresCorrigidos: bruto.tipo === 'correcao' && bruto.correcaoValores ? JSON.parse(bruto.correcaoValores) : null,
      pessoaNomeOriginal: 'pessoaId' in aplicados ? ix.pessoas.get(bruto.pessoaId)?.nome ?? null : null,
      pessoaNomeCorrigida: bruto.tipo === 'correcao' && bruto.correcaoValores
        ? ix.pessoas.get((JSON.parse(bruto.correcaoValores) as Partial<ValoresCorrecao>).pessoaId ?? '')?.nome ?? null : null,
      autorizacaoSemSolicitante: !!ev.autorizacaoPreviaId && ix.semSolicitante.has(ev.autorizacaoPreviaId),
    };
  }

  const vinculoView = (v: VinculoUnidade, ix: Ix): VinculoView => ({
    ...v, pessoaNome: ix.pessoas.get(v.pessoaId)?.nome ?? '?', pessoaDocumento: ix.pessoas.get(v.pessoaId)?.documentoMascarado ?? '',
    pessoaCadastroCompleto: cadastroCompleto(ix.pessoas.get(v.pessoaId)),
  });
  /** CPF válido (não "sem CPF") e telefone: pré-requisito para aprovar vínculo. O mock só guarda o hash do CPF validado no cadastro. */
  const cadastroCompleto = (p?: Pessoa) => !!p && !p.semCpf && !!p.documentoBusca && telefoneValido(p.telefone);
  const restricaoView = (r: Restricao, ix: Ix): RestricaoView => ({
    ...r, pessoaNome: ix.pessoas.get(r.pessoaId)?.nome ?? '?', pendente: r.escopo === 'condominio' && r.aprovadaEm === null,
  });
  function autorizacaoView(a: AutorizacaoPrevia, d: DbData, ix: Ix, quando = agora()): AutorizacaoView {
    const uso = d.eventos.find((e) => e.autorizacaoPreviaId === a.id && e.tipo === 'entrada' && e.ocorridoEm >= inicioDoDia(quando) && e.ocorridoEm <= fimDoDia(quando));
    return {
      ...a, pessoaNome: ix.pessoas.get(a.pessoaId)?.nome ?? '?', estado: estadoAutorizacaoPrevia(a, quando),
      unidadeRotulo: a.unidadeId, utilizadaEm: uso?.ocorridoEm ?? null,
    };
  }

  function ultimoAcessoTexto(d: DbData, ix: Ix, pessoaId: string): string {
    let ult: EventoAcesso | undefined;
    for (let i = d.eventos.length - 1; i >= 0; i--) {
      const e = ix.ef(d.eventos[i]);
      if (e.pessoaId === pessoaId && e.tipo !== 'saida' && e.tipo !== 'correcao') { ult = e; break; }
    }
    if (!ult) return 'Sem acessos';
    const hoje = fmtData(agora()) === fmtData(ult.ocorridoEm);
    const quando = hoje ? `Hoje ${fmtHora(ult.ocorridoEm)}` : fmtData(ult.ocorridoEm).slice(0, 5);
    return `${quando}${ult.unidadeDestinoId ? ` · ${ult.unidadeDestinoId}` : ''}${ult.tipo === 'negado' ? ' (negado)' : ult.tipo === 'recusado' ? ' (recusado)' : ''}`;
  }
  function pessoaBusca(d: DbData, p: Pessoa, ix: Ix = indices(d)): PessoaBusca {
    const n = agora();
    return {
      ...p, ultimoAcesso: ultimoAcessoTexto(d, ix, p.id),
      unidadesVinculadas: d.vinculos.filter((v) => v.pessoaId === p.id && vinculoValido(v, n)).map((v) => v.unidadeId),
    };
  }

  /** Normaliza "t4-32", "4-32", "4 32", "T4 32" -> "T4-32" */
  function unidadeDeTexto(q: string): string | null {
    const m = /^t?\s*(\d)\s*[-\s.·]\s*(\d{2})$/i.exec(q.trim());
    return m ? `T${m[1]}-${m[2]}` : null;
  }

  // ----- Trilha: gravação com encadeamento -------------------------------------------------------
  type BaseEvento = Omit<EventoAcesso, 'id' | 'seq' | 'codigo' | 'hash' | 'hashAnterior' | 'registradoEm' | 'pontoAcesso' | 'operadorPapel' | 'formularioContingencia' | 'correcaoValores'>
    & { pontoAcesso?: string; formularioContingencia?: string | null; correcaoValores?: string | null };
  async function gravarEvento(d: DbData, base: BaseEvento): Promise<EventoAcesso> {
    const ultimo = d.eventos[d.eventos.length - 1];
    const seq = (ultimo?.seq ?? 0) + 1;
    const semHash: Omit<EventoAcesso, 'hash' | 'hashAnterior'> = {
      ...base, pontoAcesso: base.pontoAcesso ?? 'Portaria social', id: uid('ev'), seq,
      operadorPapel: usuario().papel, // papel do operador no momento do registro
      formularioContingencia: base.formularioContingencia ?? null, correcaoValores: base.correcaoValores ?? null,
      codigo: `EV-2026-${String(4800 + seq).padStart(6, '0')}`,
      registradoEm: agora(), // sempre definido pelo servidor, nunca pelo cliente
    };
    const hashAnterior = ultimo?.hash ?? (await hashGenese());
    const hash = await calcularHash(hashAnterior, semHash);
    const ev: EventoAcesso = { ...semHash, hashAnterior, hash };
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
      cadastroCompleto: { unidadesCompletas: completas.size, total: d.unidades.length },
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
   * Exceção = liberação do porteiro OU autorização prévia cadastrada sem solicitante. Devolve o usuário responsável
   * (operador da exceção; ou quem cadastrou a autorização sem solicitante), ou null se não for exceção.
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

  /** RNF-05: coerência entre ocorrido_em e registrado_em; retroativo exige formulário de papel (RF-xx contingência). */
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

  // ===========================================================================================
  const api: Api = {
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
        return clone(u);
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
      async me() { await carregar(); return sessao ? clone(sessao) : null; },
    },

    busca: {
      async global(q) {
        exigeLogado();
        return ler(async (d) => {
          const consulta = q.trim();
          const pessoas = consulta.length >= 2 ? (await buscarPessoas(d, consulta, false)).slice(0, 6) : [];
          const unidades: { id: string; motivo: string }[] = [];
          const u = unidadeDeTexto(consulta);
          if (u && unidadeExiste(u)) unidades.push({ id: u, motivo: 'Unidade' });
          if (consulta.length >= 3) {
            const nq = consulta.toUpperCase().replace(/[^A-Z0-9]/g, '');
            for (const v of d.veiculos) {
              if (v.placa.replace('-', '').includes(nq) && nq.length >= 3) unidades.push({ id: v.unidadeId, motivo: `Placa ${v.placa} · ${v.modelo}` });
              if (unidades.length > 6) break;
            }
          }
          return { pessoas, unidades };
        });
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
          if (!i.nome.trim()) throw new ApiError(422, 'NOME_OBRIGATORIO', 'Informe o nome.');
          // Telefone é obrigatório para todos (inclusive "sem CPF")
          if (!telefoneValido(i.telefone)) throw new ApiError(422, 'TELEFONE_INVALIDO', 'Informe o telefone com DDD (mínimo 10 dígitos).');
          if (i.categoria === 'prestador' && !(i.empresa ?? '').trim()) throw new ApiError(422, 'EMPRESA_OBRIGATORIA', 'Prestador exige empresa (RF-36).');
          let documentoMascarado = SEM_CPF;
          let documentoBusca: string | undefined;
          if (i.semCpf) {
            // Exceção: sem CPF não há chave de busca; evita duplicar por nome + telefone
            const igual = d.pessoas.find((p) => p.semCpf && norm(p.nome) === norm(i.nome) && so_digitos(p.telefone ?? '') === so_digitos(i.telefone));
            if (igual) throw new ApiError(409, 'PESSOA_DUPLICADA', 'Já existe cadastro sem CPF com este nome e telefone.');
          } else {
            const cpf = so_digitos(i.documento ?? '');
            if (!cpf) throw new ApiError(422, 'DOCUMENTO_OBRIGATORIO', 'Informe o CPF.');
            if (!cpfValido(cpf)) throw new ApiError(422, 'CPF_INVALIDO', 'CPF inválido (confira os dígitos).');
            documentoMascarado = mascararCpf(cpf);
            documentoBusca = await sha256Hex(cpf); // o CPF em claro nunca é guardado
            if (d.pessoas.some((p) => p.documentoBusca === documentoBusca)) throw new ApiError(409, 'PESSOA_DUPLICADA', 'Já existe cadastro com este CPF.');
          }
          const p: Pessoa = {
            id: uid('pe'), nome: i.nome.trim(), categoria: i.categoria, documentoTipo: 'cpf', documentoMascarado, documentoBusca,
            ...(i.semCpf ? { semCpf: true } : {}),
            telefone: i.telefone.trim(), empresa: i.empresa?.trim() || undefined, servico: i.servico?.trim() || undefined,
            criadoEm: agora(),
          };
          d.pessoas.push(p);
          registrar(d, u, 'pessoa.criar', 'pessoa', p.id, null, p);
          return p;
        });
      },
      async funcionario(pessoaId) { exige('pessoa.ver'); return ler((d) => d.funcionarios.find((f) => f.pessoaId === pessoaId) ?? null); },
    },

    unidades: {
      async listar() {
        exige('unidade.ver');
        return ler((d): UnidadeResumo[] => {
          const n = agora();
          return d.unidades.map((unidade) => {
            const vs = d.vinculos.filter((v) => v.unidadeId === unidade.id);
            return {
              unidade,
              moradoresValidos: vs.filter((v) => vinculoValido(v, n)).length,
              pendentes: vs.filter((v) => v.status === 'pendente').length,
              restricoes: d.restricoes.filter((r) => r.unidadeId === unidade.id && r.revogadaEm === null && n <= r.validaAte).length,
              cadastroCompleto: vs.some((v) => v.status === 'aprovado' && vinculoValido(v, n)),
            };
          });
        });
      },
      async detalhe(id) {
        exige('unidade.ver');
        return ler((d): UnidadeDetalhe => {
          const unidade = d.unidades.find((u) => u.id === id);
          if (!unidade) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          const ix = indices(d);
          return {
            unidade,
            vinculos: d.vinculos.filter((v) => v.unidadeId === id).map((v) => vinculoView(v, ix)),
            veiculos: d.veiculos.filter((v) => v.unidadeId === id),
            autorizacoes: d.autorizacoes.filter((a) => a.unidadeId === id && a.revogadaEm === null && agora() <= a.validaAte).map((a) => autorizacaoView(a, d, ix)),
            restricoes: d.restricoes.filter((r) => (r.unidadeId === id) && r.revogadaEm === null && agora() <= r.validaAte).map((r) => restricaoView(r, ix)),
            eventos: d.eventos.filter((e) => ix.ef(e).unidadeDestinoId === id && e.tipo !== 'correcao').slice(-12).reverse().map((e) => view(e, ix)),
          };
        });
      },
    },

    veiculos: {
      async criar(i) {
        const u = exige('veiculo.cadastrar');
        return escrever((d) => {
          const placa = i.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw new ApiError(422, 'PLACA_INVALIDA', 'Placa fora do padrão antigo ou Mercosul.');
          if (!unidadeExiste(i.unidadeId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
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
      async criar(i) {
        const u = exige('vinculo.criar'); // RN-03: porteiro recebe 403
        return escrever((d) => {
          const p = d.pessoas.find((x) => x.id === i.pessoaId);
          if (!p) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (!unidadeExiste(i.unidadeId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          if (i.tipo === 'inquilino' && !i.vigenciaFim) throw new ApiError(422, 'VIGENCIA_OBRIGATORIA', 'Inquilino exige data de fim da vigência.');
          if (d.vinculos.some((v) => v.pessoaId === i.pessoaId && v.unidadeId === i.unidadeId && ['pendente', 'aprovado', 'legado'].includes(v.status))) {
            throw new ApiError(409, 'VINCULO_DUPLICADO', 'Já existe vínculo ativo ou pendente desta pessoa com a unidade.');
          }
          const v: VinculoUnidade = {
            id: uid('V'), pessoaId: i.pessoaId, unidadeId: i.unidadeId, tipo: i.tipo, status: 'pendente',
            vigenciaInicio: i.vigenciaInicio, vigenciaFim: i.vigenciaFim, prazoRegularizacao: null, ...(i.documento ? { documento: i.documento } : {}),
            conferencias: [], solicitadoPor: i.solicitadoPor?.trim() || quemRegistra(u), solicitadoEm: agora(),
          };
          // Pedir vínculo NÃO muda a categoria: ela só vira 'morador' quando a administração aprova (RF-04).
          d.vinculos.push(v);
          registrar(d, u, 'vinculo.criar', 'vinculo', v.id, null, v);
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
          const erro = validarDecisaoVinculo(decisao, justificativa, v.conferencias);
          if (erro) throw new ApiError(erro.status, erro.code, erro.message);
          const antes = clone(v);
          v.status = decisao === 'aprovar' ? 'aprovado' : 'rejeitado';
          v.decididoPorId = u.id; v.decididoPorNome = u.nome; v.decididoEm = agora();
          v.justificativa = (justificativa ?? '').trim() || undefined;
          // A categoria de morador nasce aqui, na aprovação
          if (decisao === 'aprovar' && pessoa && pessoa.categoria !== 'morador') pessoa.categoria = 'morador';
          registrar(d, u, 'vinculo.decidir', 'vinculo', v.id, antes, v);
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
        return escrever((d) => {
          const n = agora();
          if (i.validaAte === null || i.validaAte === undefined) throw new ApiError(422, 'VALIDADE_OBRIGATORIA', 'Autorização prévia exige data de validade (RN-07).');
          if (i.validaAte < inicioDoDia(n)) throw new ApiError(422, 'VALIDADE_INVALIDA', 'A validade não pode estar no passado.');
          if (i.validaDe !== undefined && i.validaDe > fimDoDia(i.validaAte)) throw new ApiError(422, 'PERIODO_INVALIDO', 'O início da validade não pode ser posterior ao fim.');
          if (!d.pessoas.some((p) => p.id === i.pessoaId)) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (!unidadeExiste(i.unidadeId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          if (!!i.horaInicio !== !!i.horaFim) throw new ApiError(422, 'JANELA_INCOMPLETA', 'Informe hora de início e de fim, ou nenhuma.');
          if (i.horaInicio && i.horaFim && i.horaFim <= i.horaInicio) throw new ApiError(422, 'JANELA_INVALIDA', 'A hora final deve ser posterior à inicial.');
          // Solicitante: com ele, precisa ser morador com vínculo válido na unidade; sem ele, só com justificativa
          const semSolicitante = !i.solicitadaPorPessoaId;
          const solicitante = semSolicitante ? undefined : d.pessoas.find((p) => p.id === i.solicitadaPorPessoaId);
          if (!semSolicitante && (!solicitante || !pessoaTemVinculoValido(d.vinculos, solicitante.id, i.unidadeId, n))) {
            throw new ApiError(422, 'SOLICITANTE_SEM_VINCULO', 'O morador que pediu precisa ter vínculo válido (aprovado ou legado no prazo) com a unidade.');
          }
          if (semSolicitante && !justificativaValida(i.justificativa)) {
            throw new ApiError(422, 'SOLICITANTE_OU_JUSTIFICATIVA', `Informe o morador que pediu ou, sem ele, uma justificativa de pelo menos ${MIN_JUSTIFICATIVA} caracteres.`);
          }
          const a: AutorizacaoPrevia = {
            id: uid('ap'), unidadeId: i.unidadeId, pessoaId: i.pessoaId, validaDe: i.validaDe ?? inicioDoDia(n), validaAte: fimDoDia(i.validaAte),
            diasSemana: i.diasSemana && i.diasSemana.length > 0 && i.diasSemana.length < 7 ? i.diasSemana : null,
            horaInicio: i.horaInicio, horaFim: i.horaFim, cadastradaPorNome: quemRegistra(u), cadastradaPorId: u.id,
            solicitadaPorPessoaId: solicitante?.id ?? null, solicitadaPorNome: solicitante?.nome ?? null,
            semSolicitante, justificativa: semSolicitante ? i.justificativa!.trim() : null,
            revogadaEm: null, revogadaPorId: null, revogadaPorNome: null,
          };
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
          if (a.revogadaEm !== null) throw new ApiError(409, 'AUTORIZACAO_JA_REVOGADA', 'Esta autorização já foi revogada.');
          const antes = clone(a);
          a.revogadaEm = agora(); a.revogadaPorId = u.id; a.revogadaPorNome = u.nome;
          registrar(d, u, 'autorizacao.revogar', 'autorizacao', a.id, antes, a);
        });
      },
      async vigentes(pessoaId, unidadeId) {
        exige('autorizacao.criar');
        return ler((d) => {
          const ix = indices(d);
          return d.autorizacoes
            .filter((a) => a.pessoaId === pessoaId && a.unidadeId === unidadeId)
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
          if (!i.motivo.trim()) throw new ApiError(422, 'MOTIVO_OBRIGATORIO', 'Informe o motivo da restrição.');
          if (i.validaAte === null || i.validaAte === undefined) throw new ApiError(422, 'VALIDADE_OBRIGATORIA', 'Informe até quando a restrição vale.');
          if (!i.solicitadaPorNome.trim()) throw new ApiError(422, 'SOLICITANTE_OBRIGATORIO', 'Registre o morador que pediu a restrição.');
          if (i.validaAte < inicioDoDia(agora())) throw new ApiError(422, 'VALIDADE_INVALIDA', 'A validade da restrição não pode estar no passado.');
          if (!d.pessoas.some((p) => p.id === i.pessoaId)) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (!unidadeExiste(i.unidadeId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          const paraTodos = !!i.paraTodoCondominio;
          const r: Restricao = {
            id: uid('rs'), escopo: paraTodos ? 'condominio' : 'unidade', unidadeId: i.unidadeId, pessoaId: i.pessoaId, motivo: i.motivo.trim(),
            validaAte: fimDoDia(i.validaAte), cadastradaPorNome: quemRegistra(u), cadastradaEm: agora(),
            solicitadaPorNome: i.solicitadaPorNome.trim(),
            // RN-06: escopo condomínio nasce pendente; só o síndico aprova
            aprovadaPorNome: null, aprovadaEm: null, revogadaEm: null, revogadaPorId: null, revogadaPorNome: null,
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
          r.aprovadaPorNome = u.nome; r.aprovadaEm = agora();
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
          r.revogadaEm = agora(); r.revogadaPorId = u.id; r.revogadaPorNome = u.nome;
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
          if (i.unidadeDestinoId && !unidadeExiste(i.unidadeDestinoId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          const n = agora();
          const { quando, formulario } = resolverInstante(i, n);
          // RN-02: "morador" sem vínculo válido (aprovado ou legado no prazo) não tem acesso de morador: é tratado como visitante
          const categoria = categoriaEfetiva(d, pessoa, i.unidadeDestinoId, quando);

          // RF-16: restrição vigente BLOQUEIA. A tentativa é gravada como evento "negado" na trilha.
          {
            const rs = restricoesVigentes(d.restricoes, pessoa.id, i.unidadeDestinoId ?? null, quando);
            if (rs.length > 0) {
              const negado = await gravarEvento(d, {
                tipo: 'negado', categoriaPessoa: categoria, pessoaId: pessoa.id, unidadeDestinoId: i.unidadeDestinoId,
                autorizadoPorTipo: null, autorizadoPorPessoaId: null, autorizadoPorNome: null, autorizacaoPreviaId: null,
                justificativa: `Restrição: ${rs[0].motivo}`, restricaoId: rs[0].id, operadorId: u.id, ocorridoEm: quando,
                retroativo: !!i.retroativo, refereEventoId: null, corrigeEventoId: null, observacao: i.observacao ?? null,
                formularioContingencia: formulario,
              });
              throw new ApiError(422, 'PESSOA_EM_RESTRICAO', `Entrada não permitida ${i.unidadeDestinoId ? `para ${rotuloUnidade(i.unidadeDestinoId)}` : "no condomínio"}: ${rs[0].motivo}.`, {
                eventoId: negado.id, codigo: negado.codigo, restricoes: rs.map((r) => restricaoView(r, ix)),
              });
            }
          }

          // RN-01, RF-17, RN-07, escala
          const ctx = {
            quando,
            moradoresValidosIds: new Set(i.unidadeDestinoId ? vinculosValidosDaUnidade(d.vinculos, i.unidadeDestinoId, quando).map((v) => v.pessoaId) : []),
            autorizacoes: d.autorizacoes.filter((a) => a.pessoaId === pessoa.id && a.unidadeId === i.unidadeDestinoId),
            funcionario: d.funcionarios.find((f) => f.pessoaId === pessoa.id),
          };
          const erro = validarAutorizacaoEntrada({ ...i, categoriaPessoa: categoria, semCpf: !!pessoa.semCpf }, ctx);
          if (erro) throw new ApiError(erro.status, erro.code, erro.message);

          if (!i.retroativo) {
            const dentro = d.eventos.some((e) => e.tipo === 'entrada' && ix.ef(e).pessoaId === pessoa.id && !ix.saidas.has(e.id));
            if (dentro) throw new ApiError(409, 'JA_ESTA_DENTRO', `${pessoa.nome} já consta como dentro do condomínio. Registre a saída antes.`);
          }

          let autPessoaId = i.autorizadoPorPessoaId ?? null;
          let autNome: string | null = null;
          if (i.autorizadoPorTipo === 'interfone' || i.autorizadoPorTipo === 'morador_presente') autNome = ix.pessoas.get(autPessoaId!)?.nome ?? null;
          if (i.autorizadoPorTipo === 'autorizacao_previa') {
            const ap = d.autorizacoes.find((a) => a.id === i.autorizacaoPreviaId)!;
            autPessoaId = ap.solicitadaPorPessoaId;
            // Sem solicitante: o responsável é quem cadastrou a autorização (e não "não informado")
            autNome = ap.semSolicitante
              ? `Sem solicitante — cadastrada por ${ix.usuarios.get(ap.cadastradaPorId)?.nome ?? ap.cadastradaPorNome}`
              : ap.solicitadaPorNome;
          }
          if (i.autorizadoPorTipo === 'excecao_porteiro' || i.autorizadoPorTipo === 'escala') autPessoaId = null;

          const ev = await gravarEvento(d, {
            tipo: 'entrada', categoriaPessoa: categoria, pessoaId: pessoa.id, unidadeDestinoId: i.unidadeDestinoId ?? null,
            autorizadoPorTipo: i.autorizadoPorTipo ?? null,
            autorizadoPorPessoaId: autPessoaId, autorizadoPorNome: autNome,
            autorizacaoPreviaId: i.autorizadoPorTipo === 'autorizacao_previa' ? i.autorizacaoPreviaId ?? null : null,
            justificativa: i.autorizadoPorTipo === 'excecao_porteiro' ? (i.justificativa ?? '').trim() : null, restricaoId: null,
            operadorId: u.id, ocorridoEm: quando, retroativo: !!i.retroativo, refereEventoId: null, corrigeEventoId: null,
            observacao: i.observacao?.trim() || null, formularioContingencia: formulario,
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
          if (!unidadeExiste(i.unidadeDestinoId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          if (i.meio !== 'interfone' && i.meio !== 'morador_presente') throw new ApiError(422, 'MEIO_INVALIDO_PARA_TIPO', 'A recusa só se registra por interfone ou morador presente.');
          const { quando, formulario } = resolverInstante(i, agora());
          const morador = ix.pessoas.get(i.moradorPessoaId);
          if (!morador || !pessoaTemVinculoValido(d.vinculos, morador.id, i.unidadeDestinoId, quando)) {
            throw new ApiError(422, 'AUTORIZADOR_SEM_VINCULO', 'O morador que recusou não tem vínculo válido (aprovado ou legado no prazo) com a unidade.');
          }
          const ev = await gravarEvento(d, {
            tipo: 'recusado', categoriaPessoa: categoriaEfetiva(d, pessoa, i.unidadeDestinoId, quando), pessoaId: pessoa.id,
            unidadeDestinoId: i.unidadeDestinoId, autorizadoPorTipo: i.meio, autorizadoPorPessoaId: morador.id, autorizadoPorNome: morador.nome,
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
            autorizadoPorTipo: null, autorizadoPorPessoaId: null, autorizadoPorNome: null, autorizacaoPreviaId: null, justificativa: null,
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
            if (v.unidadeDestinoId === null ? atual.categoriaPessoa !== 'funcionario' : false) throw new ApiError(422, 'UNIDADE_OBRIGATORIA', 'Informe a unidade de destino.');
            if (v.unidadeDestinoId !== null && !unidadeExiste(v.unidadeDestinoId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
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
          if (v.autorizadoPorNome !== undefined) {
            const nome = (v.autorizadoPorNome ?? '').trim();
            if (!nome) throw new ApiError(422, 'AUTORIZADOR_OBRIGATORIO', 'Informe o nome de quem autorizou.');
            novos.autorizadoPorNome = nome;
          }
          // A última correção é a que vale; por isso ela carrega também os valores das anteriores (acumulado)
          const anterior: Partial<ValoresCorrecao> = ix.correcoes.get(orig.id)?.correcaoValores ? JSON.parse(ix.correcoes.get(orig.id)!.correcaoValores!) : {};
          const juntos = { ...anterior, ...novos } as Record<string, unknown>;
          const canonico: Record<string, unknown> = {};
          for (const k of CAMPOS_CORRIGIVEIS) if (k in juntos) canonico[k] = juntos[k];
          const ev = await gravarEvento(d, {
            tipo: 'correcao', categoriaPessoa: atual.categoriaPessoa, pessoaId: atual.pessoaId, unidadeDestinoId: atual.unidadeDestinoId,
            autorizadoPorTipo: null, autorizadoPorPessoaId: null, autorizadoPorNome: null, autorizacaoPreviaId: null,
            justificativa: i.justificativa.trim(), restricaoId: null, operadorId: u.id, ocorridoEm: agora(), retroativo: false,
            refereEventoId: null, corrigeEventoId: orig.id, observacao: i.observacao?.trim() || null,
            correcaoValores: Object.keys(canonico).length > 0 ? JSON.stringify(canonico) : null,
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
        return ler((d) => d.encomendas
          .filter((e) => !f?.status || (f.status === 'entregue') === (e.retiradaEm !== null))
          .sort((a, b) => b.recebidaEm - a.recebidaEm));
      },
      async receber(i) {
        const u = exige('encomenda.operar');
        return escrever((d) => {
          if (!i.unidadeConfirmada) throw new ApiError(422, 'UNIDADE_NAO_CONFIRMADA', 'Confirme a unidade de destino antes de salvar (RF-23).');
          if (!unidadeExiste(i.unidadeId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          if (!i.destinatario.trim()) throw new ApiError(422, 'DESTINATARIO_OBRIGATORIO', 'Informe o destinatário.');
          const max = d.encomendas.reduce((m, e) => Math.max(m, Number(e.codigo.replace(/\D/g, ''))), 0);
          const e: Encomenda = {
            id: `K${max + 1}`, codigo: `K${max + 1}`, unidadeId: i.unidadeId, destinatario: i.destinatario.trim(),
            transportadora: i.transportadora.trim(), codigoRastreio: i.codigoRastreio.trim(), recebidaPorNome: u.nome, recebidaEm: agora(),
            unidadeConfirmada: true, retiradaEm: null, retiradaPorPessoaId: null, retiradaPorNome: null, retiradaRegistradaPorNome: null,
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
          // RN-08: mesma regra de vínculo válido (aprovado ou legado no prazo) usada no interfone
          const r = podeEntregarEncomenda(d.vinculos, pessoaId, e.unidadeId, agora());
          if (!r.ok) throw new ApiError(422, 'PESSOA_SEM_VINCULO', r.motivo);
          const v = d.vinculos.find((x) => x.pessoaId === pessoaId && x.unidadeId === e.unidadeId && vinculoValido(x, agora()))!;
          const antes = clone(e);
          e.retiradaEm = agora(); e.retiradaPorPessoaId = p.id;
          e.retiradaPorNome = `${p.nome} (${v.tipo === 'dependente' ? 'dependente' : v.tipo === 'inquilino' ? 'inquilino' : 'morador'})`;
          e.retiradaRegistradaPorNome = u.nome;
          registrar(d, u, 'encomenda.entregar', 'encomenda', e.id, antes, e);
          return e;
        });
      },
    },

    ocorrencias: {
      async listar() { exige('ocorrencia.ver'); return ler((d) => [...d.ocorrencias].sort((a, b) => b.abertaEm - a.abertaEm)); },
      async criar(i) {
        const u = exige('ocorrencia.operar');
        return escrever((d) => {
          if (!i.descricao.trim()) throw new ApiError(422, 'DESCRICAO_OBRIGATORIA', 'Descreva a ocorrência.');
          if (i.unidadeId && !unidadeExiste(i.unidadeId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          const ids = new Set(d.eventos.map((e) => e.id));
          for (const eid of i.eventoIds ?? []) if (!ids.has(eid)) throw new ApiError(404, 'EVENTO_NAO_ENCONTRADO', 'Evento vinculado não encontrado.');
          const max = d.ocorrencias.reduce((m, o) => Math.max(m, Number(o.codigo.slice(-3))), 0);
          const codigo = `OC-2026-${String(max + 1).padStart(3, '0')}`;
          const o: Ocorrencia = {
            id: codigo, codigo, tipo: i.tipo, descricao: i.descricao.trim(), unidadeId: i.unidadeId, envolvidos: i.envolvidos.trim() || '—',
            abertaPorNome: u.nome, abertaPorId: u.id, abertaEm: agora(), status: 'aberta', historicoStatus: [],
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
            throw new ApiError(403, 'SO_PROPRIA_OCORRENCIA', 'O porteiro só altera ocorrências que ele mesmo abriu.');
          }
          // Encerrada é estado final
          if (o.status === 'encerrada') throw new ApiError(409, 'OCORRENCIA_ENCERRADA', 'Ocorrência encerrada não pode ser alterada.');
          // Fluxo único: aberta -> em andamento -> encerrada
          const proximo: Record<StatusOcorrencia, StatusOcorrencia | null> = { aberta: 'em_andamento', em_andamento: 'encerrada', encerrada: null };
          if (proximo[o.status] !== status) {
            throw new ApiError(422, 'TRANSICAO_INVALIDA', 'Transição de status inválida: o fluxo é aberta, em andamento e encerrada, nessa ordem.');
          }
          const antes = clone(o);
          o.historicoStatus.push({ de: o.status, para: status, porId: u.id, porNome: u.nome, em: agora() });
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
        const celula = (v: string | number) => {
          let t = String(v);
          if (/^[=+\-@]/.test(t)) t = `'${t}`; // evita interpretação como fórmula no Excel
          return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        };
        const linhas: (string | number)[][] = [['Seção', 'Item', 'Total']];
        linhas.push(['Período', `${fmtData(r.periodo.de)} a ${fmtData(r.periodo.ate)}`, '']);
        if (f?.unidadeId) linhas.push(['Filtro', 'Unidade', f.unidadeId]);
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
          conteudo: '\uFEFF' + linhas.map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n',
          quantidade: r.totais.entradas,
        };
      },
    },

    auditoria: {
      async verificarIntegridade() {
        exige('auditoria.verificar');
        await esperar();
        const d = await carregar();
        return verificarCadeia(d.eventos);
      },
      async alteracoes(f = {}) {
        exige('auditoria.verificar');
        return ler((d) => d.auditLog
          .filter((r) => (f.de === undefined || r.em >= f.de) && (f.ate === undefined || r.em <= f.ate)
            && (!f.usuarioId || r.usuarioId === f.usuarioId) && (!f.acao || r.acao === f.acao) && (!f.entidade || r.entidade === f.entidade))
          .sort((a, b) => b.seq - a.seq));
      },
      async exportar(f) {
        const u = exige('auditoria.exportar');
        await esperar();
        const d = await carregar();
        const ix = indices(d);
        const evs = filtrarEventos(d, f).sort((a, b) => a.seq - b.seq);
        // RF-32: exportação de um único evento (manifesto + evento + resumo)
        const isolado = !!f?.eventoId;
        if (isolado && evs.length === 0) throw new ApiError(404, 'EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.');
        const g = await hashGenese();
        const manifesto = {
          tipo: 'manifesto', formato: 'portaria-parque/trilha-jsonl', versao: 1, sistema: 'Portaria Parque',
          condominio: 'Condomínio Residencial do Parque', geradoPor: u.nome, geradoEm: new Date(agora() - 3 * 3600 * 1000).toISOString().replace('Z', '-03:00 (horário simulado)'),
          quantidade: evs.length, filtros: f ?? {},
          algoritmo: 'hash = SHA-256( hashAnterior + JSON.stringify(campos) ), em hexadecimal minúsculo; JSON.stringify sem espaços, campos na ordem de ordemCampos.',
          ordemCampos: CAMPOS_CANONICOS, hashGenese: g, genese: 'SHA-256 da string "genesis"',
          modo: isolado ? 'evento_isolado' : 'trilha',
          instrucoesVerificacao: isolado ? [
            '1. Calcule SHA-256(hashAnterior + JSON.stringify(campos)) da linha de tipo "evento" e compare com "hash": isto confere que o conteúdo deste evento não foi alterado.',
            '2. A verificação de um único evento confere apenas o hash dele. Ela não prova, sozinha, que o evento pertence à cadeia nem que nada foi removido antes ou depois.',
            '3. A ligação com a cadeia se confere pelo "hashAnterior": ele deve ser igual ao "hash" do evento de sequência anterior na trilha completa (ou ao hashGenese, se for o primeiro evento), ou ainda ser comparado com a âncora recebida por fonte externa independente.',
            'Qualquer divergência indica que o registro foi alterado depois de gravado.',
          ] : [
            '1. Para cada linha de tipo "evento", calcule SHA-256(hashAnterior + JSON.stringify(campos)) e compare com "hash".',
            '2. Para eventos consecutivos (seq, seq+1), confirme que "hashAnterior" do seguinte é igual ao "hash" do anterior.',
            '3. O primeiro evento da cadeia usa como hashAnterior o hashGenese acima.',
            '4. Compare o hash do último evento com a âncora recebida por fonte externa independente (e-mail ao síndico/conselho). Sem âncora externa o arquivo prova apenas consistência interna.',
            'Qualquer divergência indica que o registro (ou um anterior) foi alterado depois de gravado.',
          ],
          observacao: 'Arquivo de hashes para verificação. Este protótipo gera o arquivo no navegador; não há assinatura digital nem âncora externa.',
        };
        const linhas = [JSON.stringify(manifesto)];
        for (const e of evs) {
          const { hash, hashAnterior, ...resto } = e;
          linhas.push(JSON.stringify({
            tipo: 'evento', seq: e.seq, codigo: e.codigo, pessoa: ix.pessoas.get(e.pessoaId)?.nome, unidade: e.unidadeDestinoId,
            operador: ix.usuarios.get(e.operadorId)?.nome, campos: camposCanonicos(resto), hashAnterior, hash,
          }));
        }
        const ultimo = evs[evs.length - 1];
        linhas.push(JSON.stringify({ tipo: 'resumo', quantidade: evs.length, ultimoSeq: ultimo?.seq ?? null, ultimoHash: ultimo?.hash ?? null }));
        const p = new Date(agora() - 3 * 3600 * 1000).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
        const nomeArquivo = isolado ? `evento-${evs[0].codigo}-${p}.jsonl` : `trilha-portaria-parque-${p}.jsonl`;
        return { nomeArquivo, conteudo: linhas.join('\n') + '\n', quantidade: evs.length };
      },
    },

    usuarios: {
      async listar() { exige('usuario.gerenciar'); return ler((d) => [...d.usuarios]); },
      async criar(i) {
        const eu = exige('usuario.gerenciar');
        return escrever((d) => {
          const login = i.login.trim().toLowerCase();
          if (!i.nome.trim() || !login) throw new ApiError(422, 'DADOS_OBRIGATORIOS', 'Informe nome e login.');
          if (d.usuarios.some((x) => x.login === login)) throw new ApiError(409, 'LOGIN_EXISTENTE', 'Já existe um usuário com este login.');
          // RN-05: login individual
          const novo: UsuarioSistema = { id: uid('u'), nome: i.nome.trim(), login, papel: i.papel, ativo: true, ultimoAcesso: null };
          d.usuarios.push(novo);
          registrar(d, eu, 'usuario.criar', 'usuario', novo.id, null, novo);
          return novo;
        });
      },
      async desativar(id) {
        const eu = exige('usuario.gerenciar');
        return escrever((d) => {
          const x = d.usuarios.find((u) => u.id === id);
          if (!x) throw new ApiError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
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
          const x = d.usuarios.find((u) => u.id === id);
          if (!x) throw new ApiError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
          const antes = clone(x);
          x.ativo = true;
          registrar(d, eu, 'usuario.reativar', 'usuario', x.id, antes, x);
          return x;
        });
      },
      async redefinirAcesso(id) {
        const eu = exige('usuario.gerenciar');
        return escrever((d) => {
          const x = d.usuarios.find((u) => u.id === id);
          if (!x) throw new ApiError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
          // no mock: só registra o pedido; o servidor real geraria senha temporária e exigiria troca no próximo login
          registrar(d, eu, 'usuario.redefinirAcesso', 'usuario', x.id, null, { login: x.login });
          return x;
        });
      },
    },

    importacao: {
      async analisar({ arquivo, linhas }) {
        exige('importacao.executar');
        return ler(async (d) => {
          const inc: InconsistenciaImportacao[] = [];
          const validas: LinhaPlanilha[] = [];
          const vistos = new Set<string>();
          for (const l of linhas) {
            const uid_ = `T${l.torre.replace(/\D/g, '')}-${l.unidade.replace(/\D/g, '')}`;
            if (!unidadeExiste(uid_)) { inc.push({ linha: l.linha, codigo: 'UNIDADE_INEXISTENTE', mensagem: `Unidade ${l.torre}/${l.unidade} não existe no condomínio. Linha não importada.`, tipo: 'erro' }); continue; }
            if (!l.nome.trim()) { inc.push({ linha: l.linha, codigo: 'NOME_AUSENTE', mensagem: 'Nome ausente. Linha não importada.', tipo: 'erro' }); continue; }
            const docDigitos = so_digitos(l.documento);
            const cpfOk = cpfValido(docDigitos);
            // Duplicidade na planilha: pelo CPF (quando válido) ou, sem CPF, pelo nome na mesma unidade
            const chaveDup = cpfOk ? `cpf|${docDigitos}|${uid_}` : `${norm(l.nome)}|${uid_}`;
            if (vistos.has(chaveDup)) { inc.push({ linha: l.linha, codigo: 'DUPLICIDADE_PLANILHA', mensagem: `${l.nome} aparece duas vezes na unidade ${uid_}. Consolidado.`, tipo: 'aviso' }); continue; }
            vistos.add(chaveDup);
            if (!docDigitos) inc.push({ linha: l.linha, codigo: 'DOC_AUSENTE', mensagem: `${l.nome}: sem CPF. Importado como legado, pendente de regularização (RN-09).`, tipo: 'aviso' });
            else if (!cpfOk) inc.push({ linha: l.linha, codigo: 'DOC_INVALIDO', mensagem: `${l.nome}: CPF inválido. O número não será gravado; importado como legado, pendente de regularização (RN-09).`, tipo: 'aviso' });
            if (so_digitos(l.telefone).length < 10 && l.telefone.trim()) inc.push({ linha: l.linha, codigo: 'TELEFONE_INVALIDO', mensagem: `${l.nome}: telefone com menos de 10 dígitos.`, tipo: 'aviso' });
            const existente = await acharPessoaImportacao(d, l.nome, cpfOk ? docDigitos : '', uid_);
            if (existente && d.vinculos.some((v) => v.pessoaId === existente.id && v.unidadeId === uid_ && ['pendente', 'aprovado', 'legado'].includes(v.status))) {
              inc.push({ linha: l.linha, codigo: 'DUPLICIDADE_BANCO', mensagem: `${l.nome} já possui vínculo com ${uid_}. Reaproveitado, sem duplicar.`, tipo: 'aviso' });
            }
            validas.push({ ...l, torre: uid_.slice(1, 2), unidade: uid_.slice(3) });
          }
          const relatorio: RelatorioImportacao = {
            id: uid('imp'), arquivo, lidas: linhas.length, importaveis: validas.length, rejeitadas: linhas.length - validas.length - inc.filter((i2) => i2.codigo === 'DUPLICIDADE_PLANILHA').length,
            avisos: inc.filter((i2) => i2.tipo === 'aviso').length, inconsistencias: inc, amostra: linhas.slice(0, 8), prazoRegularizacao: PRAZO_LEGADO,
          };
          importacoes.set(relatorio.id, { relatorio, validas });
          return relatorio;
        });
      },
      async confirmar(id) {
        const u = exige('importacao.executar');
        return escrever(async (d) => {
          const imp = importacoes.get(id);
          if (!imp) throw new ApiError(404, 'IMPORTACAO_NAO_ENCONTRADA', 'Análise de importação não encontrada. Envie o arquivo novamente.');
          let importados = 0, reaproveitados = 0;
          for (const l of imp.validas) {
            const unidade = `T${l.torre}-${l.unidade}`;
            const dig = so_digitos(l.documento);
            const cpfOk = cpfValido(dig); // CPF inválido vira aviso e o número não é gravado
            // Nunca casa só por nome globalmente: CPF, ou nome NA MESMA unidade quando não há CPF
            const existente = await acharPessoaImportacao(d, l.nome, cpfOk ? dig : '', unidade);
            if (existente && d.vinculos.some((v) => v.pessoaId === existente.id && v.unidadeId === unidade && ['pendente', 'aprovado', 'legado'].includes(v.status))) {
              reaproveitados++; continue;
            }
            let p = existente;
            if (!p) {
              p = {
                id: uid('pe'), nome: l.nome.trim(), categoria: 'morador', documentoTipo: 'cpf',
                documentoMascarado: cpfOk ? mascararCpf(dig) : SEM_CPF, ...(cpfOk ? { documentoBusca: await sha256Hex(dig) } : { semCpf: true }),
                telefone: l.telefone || undefined, criadoEm: agora(),
              };
              d.pessoas.push(p);
            }
            const tipo = /inquil/i.test(l.tipo ?? '') ? 'inquilino' : /depend/i.test(l.tipo ?? '') ? 'dependente' : 'proprietario';
            d.vinculos.push({
              id: uid('V'), pessoaId: p.id, unidadeId: unidade, tipo, status: 'legado', vigenciaInicio: null, vigenciaFim: null,
              prazoRegularizacao: PRAZO_LEGADO, conferencias: [], solicitadoPor: `Importação da planilha ${imp.relatorio.arquivo}`, solicitadoEm: agora(),
            });
            importados++;
          }
          importacoes.delete(id);
          const r = imp.relatorio;
          registrar(d, u, 'importacao.confirmar', 'importacao', id, null, {
            arquivo: r.arquivo, lidas: r.lidas, importaveis: r.importaveis, rejeitadas: r.rejeitadas, avisos: r.avisos, importados, reaproveitados,
          });
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
        try { if (persistir) localStorage.removeItem(chave); } catch { /* ignora */ }
        salvar();
      },
    },
  };

  function exigeLogado() { usuario(); }

  /** Importação: casa por CPF (hash) quando houver; sem CPF, só pessoa com o mesmo nome JÁ vinculada à mesma unidade. */
  async function acharPessoaImportacao(d: DbData, nome: string, cpfDigitos: string, unidade: string): Promise<Pessoa | undefined> {
    if (cpfDigitos) {
      const busca = await sha256Hex(cpfDigitos);
      return d.pessoas.find((p) => p.documentoBusca === busca);
    }
    return d.pessoas.find((p) => norm(p.nome) === norm(nome) && d.vinculos.some((v) => v.pessoaId === p.id && v.unidadeId === unidade));
  }

  async function buscarPessoas(d: DbData, q: string, semMoradores: boolean): Promise<PessoaBusca[]> {
    const n = agora();
    const ix = indices(d);
    const nq = norm(q);
    const digitos = so_digitos(q);
    const un = unidadeDeTexto(q);
    const placa = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    // CPF completo (11 dígitos): igualdade exata pelo hash; senão, parcial nos dígitos visíveis do mascarado
    const busca = digitos.length === 11 ? await sha256Hex(digitos) : null;
    const validos = d.vinculos.filter((v) => vinculoValido(v, n));
    const comVinculoValido = new Set(validos.map((v) => v.pessoaId));
    const idsPorUnidade = un ? new Set(d.vinculos.filter((v) => v.unidadeId === un && v.status !== 'rejeitado' && v.status !== 'encerrado').map((v) => v.pessoaId)) : null;
    // Placa: pessoas com vínculo VÁLIDO na unidade do veículo (pendente/rejeitado/encerrado não contam)
    const idsPorPlaca = placa.length >= 4
      ? new Set(d.veiculos.filter((v) => v.placa.replace('-', '').includes(placa)).flatMap((v) => validos.filter((x) => x.unidadeId === v.unidadeId).map((x) => x.pessoaId)))
      : null;
    const achados = d.pessoas.filter((p) => {
      // Na portaria, quem tem vínculo válido em alguma unidade é morador (não depende da categoria gravada)
      if (semMoradores && comVinculoValido.has(p.id)) return false;
      if (norm(p.nome).includes(nq)) return true;
      if (busca ? p.documentoBusca === busca : digitos.length >= 3 && so_digitos(p.documentoMascarado).includes(digitos)) return true;
      if (idsPorUnidade?.has(p.id)) return true;
      if (idsPorPlaca?.has(p.id)) return true;
      return false;
    });
    // Ordenação: nome exato > começa com > contém > outros critérios (documento, unidade, placa); depois alfabética
    const rank = (p: Pessoa) => { const n = norm(p.nome); return n === nq ? 0 : n.startsWith(nq) ? 1 : n.includes(nq) ? 2 : 3; };
    achados.sort((a, b) => rank(a) - rank(b) || a.nome.localeCompare(b.nome, 'pt-BR'));
    return achados.map((p) => pessoaBusca(d, p, ix));
  }

  // ----- Ferramentas de desenvolvimento (demonstração da adulteração à banca) ---------------------
  if ((opts.ferramentasDev ?? typeof window !== 'undefined') && typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>;
    w.__adulterarEvento = async (ref: string | number) => {
      const d = await carregar();
      const e = d.eventos.find((x) => x.id === ref || x.codigo === ref || x.seq === Number(ref));
      if (!e) { console.error('Evento não encontrado:', ref); return; }
      // Altera um campo SEM recalcular o hash: é exatamente o que a verificação precisa detectar.
      if (e.autorizadoPorNome) e.autorizadoPorNome = `${e.autorizadoPorNome} (ADULTERADO)`; else e.justificativa = 'ADULTERADO FORA DO SISTEMA';
      salvar();
      console.warn(`Evento ${e.codigo} (seq ${e.seq}) adulterado sem recalcular o hash. Use "Verificar integridade" no Histórico de acessos.`);
    };
    w.__restaurarDemo = async () => { await api.demo!.restaurar(); location.reload(); };
  }

  void slug; void DIAS_ENCOMENDA_ATRASADA; void pessoaTemVinculoValido; void fmtDataHora;
  return api;
}
