// Implementação em memória da API. As regras de negócio são aplicadas AQUI (o "servidor"),
// não apenas na UI: RN-01, RF-16, RF-17, RN-03, RN-07, RN-08, RN-04 e a matriz RBAC.
import type {
  Api, Autorizador, AutorizacaoView, FichaPessoa, FiltroEventos, InconsistenciaImportacao, LinhaPlanilha, LoginResultado,
  PessoaBusca, RelatorioImportacao, RelatorioResumo, RestricaoView, UnidadeDetalhe, UnidadeResumo, VinculoView,
} from '../types';
import { ApiError } from '../types';
import type {
  AutorizacaoPrevia, EventoAcesso, EventoView, Pessoa, Restricao, UsuarioSistema, VinculoUnidade, Encomenda, Ocorrencia,
} from '../../domain/types';
import { ROTULO_PAPEL } from '../../domain/types';
import { pode, exige2faNoLogin, exigeTotpNoCadastro, type Acao } from '../../domain/rbac';
import {
  DIAS_ENCOMENDA_ATRASADA, estadoAutorizacaoPrevia, justificativaValida, MIN_JUSTIFICATIVA, pessoaTemVinculoValido,
  podeEntregarEncomenda, restricoesVigentes, validarAutorizacaoEntrada, validarDecisaoVinculo, vinculoValido,
  vinculosValidosDaUnidade,
} from '../../domain/rules';
import { CAMPOS_CANONICOS, calcularHash, camposCanonicos, hashGenese, verificarCadeia } from '../../domain/hashChain';
import { DIA, agora, fimDoDia, fmtDataHora, fmtData, fmtHora, inicioDoDia, partes, relogio } from '../../domain/time';
import { rotuloUnidade, unidadeExiste } from '../../domain/units';
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

function mascararDocumento(tipo: string, doc: string): string {
  const d = so_digitos(doc);
  if (tipo === 'cpf' && d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  const t = doc.replace(/\s/g, '');
  return t.length <= 3 ? '***' : `***${t.slice(-3)}`;
}

function cpfValido(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

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
  let preSessao: UsuarioSistema | null = null;
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

  // ----- Índices e visões -----------------------------------------------------------------------
  function indices(d: DbData) {
    const pessoas = new Map(d.pessoas.map((p) => [p.id, p]));
    const usuarios = new Map(d.usuarios.map((u) => [u.id, u]));
    const saidas = new Map<string, EventoAcesso>();
    const porId = new Map(d.eventos.map((e) => [e.id, e]));
    for (const e of d.eventos) if (e.tipo === 'saida' && e.refereEventoId) saidas.set(e.refereEventoId, e);
    return { pessoas, usuarios, saidas, porId };
  }
  type Ix = ReturnType<typeof indices>;

  function view(ev: EventoAcesso, ix: Ix): EventoView {
    const saida = ev.tipo === 'entrada' ? ix.saidas.get(ev.id) ?? null : null;
    const entrada = ev.tipo === 'saida' && ev.refereEventoId ? ix.porId.get(ev.refereEventoId) : undefined;
    return {
      ...ev,
      pessoaNome: ix.pessoas.get(ev.pessoaId)?.nome ?? '(pessoa removida)',
      operadorNome: ix.usuarios.get(ev.operadorId)?.nome ?? '(operador)',
      unidadeRotulo: ev.unidadeDestinoId,
      saida: saida ? { id: saida.id, codigo: saida.codigo, em: saida.ocorridoEm } : null,
      dentro: ev.tipo === 'entrada' && !saida,
      entradaCodigo: entrada?.codigo ?? null,
    };
  }

  const vinculoView = (v: VinculoUnidade, ix: Ix): VinculoView => ({
    ...v, pessoaNome: ix.pessoas.get(v.pessoaId)?.nome ?? '?', pessoaDocumento: ix.pessoas.get(v.pessoaId)?.documentoMascarado ?? '',
  });
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

  function ultimoAcessoTexto(d: DbData, pessoaId: string): string {
    let ult: EventoAcesso | undefined;
    for (let i = d.eventos.length - 1; i >= 0; i--) {
      const e = d.eventos[i];
      if (e.pessoaId === pessoaId && e.tipo !== 'saida' && e.tipo !== 'correcao') { ult = e; break; }
    }
    if (!ult) return 'Sem acessos';
    const hoje = fmtData(agora()) === fmtData(ult.ocorridoEm);
    const quando = hoje ? `Hoje ${fmtHora(ult.ocorridoEm)}` : fmtData(ult.ocorridoEm).slice(0, 5);
    return `${quando}${ult.unidadeDestinoId ? ` · ${ult.unidadeDestinoId}` : ''}${ult.tipo === 'negado' ? ' (negado)' : ''}`;
  }
  function pessoaBusca(d: DbData, p: Pessoa): PessoaBusca {
    const n = agora();
    return {
      ...p, ultimoAcesso: ultimoAcessoTexto(d, p.id),
      unidadesVinculadas: d.vinculos.filter((v) => v.pessoaId === p.id && vinculoValido(v, n)).map((v) => v.unidadeId),
    };
  }

  /** Normaliza "t4-32", "4-32", "4 32", "T4 32" -> "T4-32" */
  function unidadeDeTexto(q: string): string | null {
    const m = /^t?\s*(\d)\s*[-\s.·]\s*(\d{2})$/i.exec(q.trim());
    return m ? `T${m[1]}-${m[2]}` : null;
  }

  // ----- Trilha: gravação com encadeamento -------------------------------------------------------
  async function gravarEvento(
    d: DbData, base: Omit<EventoAcesso, 'id' | 'seq' | 'codigo' | 'hash' | 'hashAnterior' | 'registradoEm' | 'pontoAcesso'> & { pontoAcesso?: string },
  ): Promise<EventoAcesso> {
    const ultimo = d.eventos[d.eventos.length - 1];
    const seq = (ultimo?.seq ?? 0) + 1;
    const semHash: Omit<EventoAcesso, 'hash' | 'hashAnterior'> = {
      ...base, pontoAcesso: base.pontoAcesso ?? 'Portaria social', id: uid('ev'), seq,
      codigo: `EV-2026-${String(4800 + seq).padStart(6, '0')}`,
      registradoEm: agora(), // sempre definido pelo servidor, nunca pelo cliente
    };
    const hashAnterior = ultimo?.hash ?? (await hashGenese());
    const hash = await calcularHash(hashAnterior, semHash);
    const ev: EventoAcesso = { ...semHash, hashAnterior, hash };
    d.eventos.push(ev); // append-only: nenhum código altera ou remove eventos existentes
    return ev;
  }

  function filtrarEventos(d: DbData, f: FiltroEventos = {}): EventoAcesso[] {
    const ix = indices(d);
    const q = f.pessoa ? norm(f.pessoa) : '';
    return d.eventos.filter((e) => {
      if (f.de !== undefined && e.ocorridoEm < f.de) return false;
      if (f.ate !== undefined && e.ocorridoEm > f.ate) return false;
      if (f.unidadeId && e.unidadeDestinoId !== f.unidadeId) return false;
      if (f.operadorId && e.operadorId !== f.operadorId) return false;
      if (f.tipo && e.tipo !== f.tipo) return false;
      if (f.meio && e.autorizadoPorTipo !== f.meio) return false;
      if (f.somenteExcecoes && e.autorizadoPorTipo !== 'excecao_porteiro') return false;
      if (f.somenteRetroativos && !e.retroativo) return false;
      if (q && !norm(ix.pessoas.get(e.pessoaId)?.nome ?? '').includes(q)) return false;
      return true;
    });
  }

  // ===========================================================================================
  const api: Api = {
    auth: {
      async login({ login, senha }) {
        await esperar();
        const d = await carregar();
        const u = d.usuarios.find((x) => x.login.toLowerCase() === login.trim().toLowerCase());
        if (!u || !u.ativo || senha.length === 0) {
          // mensagem única: não distingue usuário inexistente de senha errada (spec 5.1)
          throw new ApiError(401, 'CREDENCIAIS_INVALIDAS', 'Usuário ou senha inválidos.');
        }
        if (exige2faNoLogin(u.papel)) { preSessao = u; sessao = null; return { requer2fa: true } satisfies LoginResultado; }
        u.ultimoAcesso = agora(); salvar();
        sessao = u; preSessao = null; gravarSessao();
        return clone({ requer2fa: false, usuario: u });
      },
      async verificar2fa(codigo) {
        await esperar();
        const d = await carregar();
        if (!preSessao) throw new ApiError(401, 'SEM_PRE_SESSAO', 'Inicie o login novamente.');
        if (!/^\d{6}$/.test(codigo.trim())) throw new ApiError(401, 'CODIGO_INVALIDO', 'Informe o código de 6 dígitos.');
        const u = d.usuarios.find((x) => x.id === preSessao!.id)!;
        u.ultimoAcesso = agora(); salvar();
        sessao = u; preSessao = null; gravarSessao();
        return clone(u);
      },
      async logout() { await esperar(); sessao = null; preSessao = null; gravarSessao(); },
      async me() { await carregar(); return sessao ? clone(sessao) : null; },
    },

    busca: {
      async global(q) {
        exigeLogado();
        return ler((d) => {
          const consulta = q.trim();
          const pessoas = consulta.length >= 2 ? buscarPessoas(d, consulta, false).slice(0, 6) : [];
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
      async buscar(q, o) { exige('pessoa.ver'); return ler((d) => buscarPessoas(d, q, !!o?.semMoradores).slice(0, 8)); },
      async listar() { exige('pessoa.ver'); return ler((d) => d.pessoas.map((p) => pessoaBusca(d, p)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))); },
      async ficha(id) {
        exige('pessoa.ver');
        return ler((d): FichaPessoa => {
          const ix = indices(d);
          const pessoa = ix.pessoas.get(id);
          if (!pessoa) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          return {
            pessoa, funcionario: d.funcionarios.find((f) => f.pessoaId === id),
            vinculos: d.vinculos.filter((v) => v.pessoaId === id).map((v) => vinculoView(v, ix)),
            eventos: d.eventos.filter((e) => e.pessoaId === id).slice(-10).reverse().map((e) => view(e, ix)),
          };
        });
      },
      async criar(i) {
        const u = exige('pessoa.cadastrar_externo');
        if (i.categoria === 'morador' || i.categoria === 'funcionario') exige('pessoa.cadastrar_morador'); // porteiro: só visitante/prestador
        return escrever((d) => {
          if (!i.nome.trim()) throw new ApiError(422, 'NOME_OBRIGATORIO', 'Informe o nome.');
          if (!i.documento.trim()) throw new ApiError(422, 'DOCUMENTO_OBRIGATORIO', 'Informe o número do documento.');
          if (i.categoria === 'prestador' && !(i.empresa ?? '').trim()) throw new ApiError(422, 'EMPRESA_OBRIGATORIA', 'Prestador exige empresa (RF-36).');
          const mascara = mascararDocumento(i.documentoTipo, i.documento);
          const igual = d.pessoas.find((p) => norm(p.nome) === norm(i.nome) && p.documentoMascarado === mascara);
          if (igual) throw new ApiError(409, 'PESSOA_DUPLICADA', 'Já existe cadastro com este nome e documento.');
          const p: Pessoa = {
            id: uid('pe'), nome: i.nome.trim(), categoria: i.categoria, documentoTipo: i.documentoTipo, documentoMascarado: mascara,
            telefone: i.telefone?.trim() || undefined, empresa: i.empresa?.trim() || undefined, servico: i.servico?.trim() || undefined,
            criadoEm: agora(),
          };
          d.pessoas.push(p);
          void u;
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
            restricoes: d.restricoes.filter((r) => (r.unidadeId === id) && r.revogadaEm === null).map((r) => restricaoView(r, ix)),
            eventos: d.eventos.filter((e) => e.unidadeDestinoId === id && e.tipo !== 'correcao').slice(-12).reverse().map((e) => view(e, ix)),
          };
        });
      },
    },

    veiculos: {
      async criar(i) {
        exige('veiculo.cadastrar');
        return escrever((d) => {
          const placa = i.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw new ApiError(422, 'PLACA_INVALIDA', 'Placa fora do padrão antigo ou Mercosul.');
          if (!unidadeExiste(i.unidadeId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          const fmt = `${placa.slice(0, 3)}-${placa.slice(3)}`;
          if (d.veiculos.some((v) => v.placa === fmt)) throw new ApiError(409, 'PLACA_DUPLICADA', 'Placa já cadastrada.');
          const v = { id: uid('ve'), unidadeId: i.unidadeId, placa: fmt, modelo: i.modelo.trim(), cor: i.cor.trim() };
          d.veiculos.push(v);
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
          if (!i.documento?.titulo?.trim()) throw new ApiError(422, 'DOCUMENTO_OBRIGATORIO', 'Anexe o documento comprobatório (RF-05).');
          if (i.tipo === 'inquilino' && !i.vigenciaFim) throw new ApiError(422, 'VIGENCIA_OBRIGATORIA', 'Inquilino exige data de fim da vigência.');
          if (d.vinculos.some((v) => v.pessoaId === i.pessoaId && v.unidadeId === i.unidadeId && ['pendente', 'aprovado', 'legado'].includes(v.status))) {
            throw new ApiError(409, 'VINCULO_DUPLICADO', 'Já existe vínculo ativo ou pendente desta pessoa com a unidade.');
          }
          const v: VinculoUnidade = {
            id: uid('V'), pessoaId: i.pessoaId, unidadeId: i.unidadeId, tipo: i.tipo, status: 'pendente',
            vigenciaInicio: i.vigenciaInicio, vigenciaFim: i.vigenciaFim, prazoRegularizacao: null, documento: i.documento,
            conferencias: [], solicitadoPor: i.solicitadoPor?.trim() || quemRegistra(u), solicitadoEm: agora(),
          };
          if (p.categoria !== 'morador') p.categoria = 'morador';
          d.vinculos.push(v);
          return v;
        });
      },
      async decidir({ id, decisao, justificativa }) {
        const u = exige('vinculo.decidir');
        return escrever((d) => {
          const v = d.vinculos.find((x) => x.id === id);
          if (!v) throw new ApiError(404, 'VINCULO_NAO_ENCONTRADO', 'Vínculo não encontrado.');
          if (v.status !== 'pendente') throw new ApiError(409, 'VINCULO_JA_DECIDIDO', 'Este vínculo já foi decidido.');
          const erro = validarDecisaoVinculo(decisao, justificativa, v.conferencias);
          if (erro) throw new ApiError(erro.status, erro.code, erro.message);
          v.status = decisao === 'aprovar' ? 'aprovado' : 'rejeitado';
          v.decididoPorId = u.id; v.decididoPorNome = u.nome; v.decididoEm = agora();
          v.justificativa = (justificativa ?? '').trim() || undefined;
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
          if (!d.pessoas.some((p) => p.id === i.pessoaId)) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (!unidadeExiste(i.unidadeId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          if (!!i.horaInicio !== !!i.horaFim) throw new ApiError(422, 'JANELA_INCOMPLETA', 'Informe hora de início e de fim, ou nenhuma.');
          if (i.horaInicio && i.horaFim && i.horaFim <= i.horaInicio) throw new ApiError(422, 'JANELA_INVALIDA', 'A hora final deve ser posterior à inicial.');
          const solicitante = d.pessoas.find((p) => p.id === i.solicitadaPorPessoaId);
          const a: AutorizacaoPrevia = {
            id: uid('ap'), unidadeId: i.unidadeId, pessoaId: i.pessoaId, validaDe: i.validaDe ?? inicioDoDia(n), validaAte: fimDoDia(i.validaAte),
            diasSemana: i.diasSemana && i.diasSemana.length > 0 && i.diasSemana.length < 7 ? i.diasSemana : null,
            horaInicio: i.horaInicio, horaFim: i.horaFim, cadastradaPorNome: quemRegistra(u),
            solicitadaPorPessoaId: solicitante?.id ?? null, solicitadaPorNome: solicitante?.nome ?? '(não informado)', revogadaEm: null,
          };
          d.autorizacoes.push(a);
          return a;
        });
      },
      async revogar(id) {
        exige('autorizacao.criar');
        return escrever((d) => {
          const a = d.autorizacoes.find((x) => x.id === id);
          if (!a) throw new ApiError(404, 'AUTORIZACAO_NAO_ENCONTRADA', 'Autorização não encontrada.');
          a.revogadaEm = agora();
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
          if (!d.pessoas.some((p) => p.id === i.pessoaId)) throw new ApiError(404, 'PESSOA_NAO_ENCONTRADA', 'Pessoa não encontrada.');
          if (!unidadeExiste(i.unidadeId)) throw new ApiError(404, 'UNIDADE_NAO_ENCONTRADA', 'Unidade não encontrada.');
          const paraTodos = !!i.paraTodoCondominio;
          const r: Restricao = {
            id: uid('rs'), escopo: paraTodos ? 'condominio' : 'unidade', unidadeId: i.unidadeId, pessoaId: i.pessoaId, motivo: i.motivo.trim(),
            validaAte: fimDoDia(i.validaAte), cadastradaPorNome: quemRegistra(u), cadastradaEm: agora(),
            solicitadaPorNome: i.solicitadaPorNome.trim(),
            // RN-06: escopo condomínio nasce pendente; só o síndico aprova
            aprovadaPorNome: null, aprovadaEm: null, revogadaEm: null,
          };
          d.restricoes.push(r);
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
          r.aprovadaPorNome = u.nome; r.aprovadaEm = agora();
          return r;
        });
      },
      async revogar(id) {
        exige('unidade.editar');
        return escrever((d) => {
          const r = d.restricoes.find((x) => x.id === id);
          if (!r) throw new ApiError(404, 'RESTRICAO_NAO_ENCONTRADA', 'Restrição não encontrada.');
          r.revogadaEm = agora();
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

          // RNF-05: coerência entre ocorrido_em e registrado_em
          let quando = n;
          if (i.retroativo) {
            if (!i.ocorridoEm || i.ocorridoEm >= n) throw new ApiError(422, 'DATA_INCONSISTENTE', 'Lançamento retroativo exige data e hora reais anteriores ao momento atual.');
            quando = i.ocorridoEm;
          } else if (i.ocorridoEm && Math.abs(i.ocorridoEm - n) > 5 * 60000) {
            throw new ApiError(422, 'DATA_INCONSISTENTE', 'Registro que não é retroativo deve ter data e hora atuais.');
          }

          // RF-16: restrição vigente BLOQUEIA. A tentativa é gravada como evento "negado" na trilha.
          {
            const rs = restricoesVigentes(d.restricoes, pessoa.id, i.unidadeDestinoId ?? null, quando);
            if (rs.length > 0) {
              const negado = await gravarEvento(d, {
                tipo: 'negado', categoriaPessoa: pessoa.categoria, pessoaId: pessoa.id, unidadeDestinoId: i.unidadeDestinoId,
                autorizadoPorTipo: null, autorizadoPorPessoaId: null, autorizadoPorNome: null, autorizacaoPreviaId: null,
                justificativa: `Restrição: ${rs[0].motivo}`, restricaoId: rs[0].id, operadorId: u.id, ocorridoEm: quando,
                retroativo: !!i.retroativo, refereEventoId: null, corrigeEventoId: null, observacao: i.observacao ?? null,
              });
              throw new ApiError(422, 'PESSOA_EM_RESTRICAO', `Entrada não permitida ${i.unidadeDestinoId ? `para ${rotuloUnidade(i.unidadeDestinoId)}` : "no condomínio"}: ${rs[0].motivo}.`, {
                eventoId: negado.id, codigo: negado.codigo, restricoes: rs.map((r) => restricaoView(r, ix)),
              });
            }
          }

          // RN-02: categoria morador exige vínculo válido
          if (pessoa.categoria === 'morador' && !d.vinculos.some((v) => v.pessoaId === pessoa.id && (!i.unidadeDestinoId || v.unidadeId === i.unidadeDestinoId) && vinculoValido(v, quando))) {
            throw new ApiError(422, 'VINCULO_SEM_ACESSO', 'Pessoa sem vínculo aprovado (ou legado no prazo): não tem acesso de morador (RN-02).');
          }

          // RN-01, RF-17, RN-07, escala
          const ctx = {
            quando,
            moradoresValidosIds: new Set(i.unidadeDestinoId ? vinculosValidosDaUnidade(d.vinculos, i.unidadeDestinoId, quando).map((v) => v.pessoaId) : []),
            autorizacoes: d.autorizacoes.filter((a) => a.pessoaId === pessoa.id && a.unidadeId === i.unidadeDestinoId),
            funcionario: d.funcionarios.find((f) => f.pessoaId === pessoa.id),
          };
          const erro = validarAutorizacaoEntrada({ ...i, categoriaPessoa: pessoa.categoria }, ctx);
          if (erro) throw new ApiError(erro.status, erro.code, erro.message);

          if (!i.retroativo) {
            const dentro = d.eventos.some((e) => e.tipo === 'entrada' && e.pessoaId === pessoa.id && !ix.saidas.has(e.id));
            if (dentro) throw new ApiError(409, 'JA_ESTA_DENTRO', `${pessoa.nome} já consta como dentro do condomínio. Registre a saída antes.`);
          }

          let autPessoaId = i.autorizadoPorPessoaId ?? null;
          let autNome: string | null = null;
          if (i.autorizadoPorTipo === 'interfone' || i.autorizadoPorTipo === 'morador_presente') autNome = ix.pessoas.get(autPessoaId!)?.nome ?? null;
          if (i.autorizadoPorTipo === 'autorizacao_previa') {
            const ap = d.autorizacoes.find((a) => a.id === i.autorizacaoPreviaId)!;
            autPessoaId = ap.solicitadaPorPessoaId; autNome = ap.solicitadaPorNome;
          }
          if (i.autorizadoPorTipo === 'excecao_porteiro' || i.autorizadoPorTipo === 'escala') autPessoaId = null;

          const ev = await gravarEvento(d, {
            tipo: 'entrada', categoriaPessoa: pessoa.categoria, pessoaId: pessoa.id, unidadeDestinoId: i.unidadeDestinoId ?? null,
            autorizadoPorTipo: pessoa.categoria === 'morador' ? i.autorizadoPorTipo ?? null : i.autorizadoPorTipo ?? null,
            autorizadoPorPessoaId: autPessoaId, autorizadoPorNome: autNome,
            autorizacaoPreviaId: i.autorizadoPorTipo === 'autorizacao_previa' ? i.autorizacaoPreviaId ?? null : null,
            justificativa: i.autorizadoPorTipo === 'excecao_porteiro' ? (i.justificativa ?? '').trim() : null, restricaoId: null,
            operadorId: u.id, ocorridoEm: quando, retroativo: !!i.retroativo, refereEventoId: null, corrigeEventoId: null,
            observacao: i.observacao?.trim() || null,
          });
          return view(ev, indices(d));
        });
      },

      async registrarSaida(entradaId, observacao) {
        const u = exige('evento.registrar');
        return escrever(async (d) => {
          const ix = indices(d);
          const entrada = ix.porId.get(entradaId);
          if (!entrada || entrada.tipo !== 'entrada') throw new ApiError(404, 'ENTRADA_NAO_ENCONTRADA', 'Entrada não encontrada.');
          if (ix.saidas.has(entrada.id)) throw new ApiError(409, 'SAIDA_JA_REGISTRADA', 'A saída desta entrada já foi registrada.');
          // A entrada NÃO é alterada: a saída é um novo evento ligado a ela (RN-04).
          const ev = await gravarEvento(d, {
            tipo: 'saida', categoriaPessoa: entrada.categoriaPessoa, pessoaId: entrada.pessoaId, unidadeDestinoId: entrada.unidadeDestinoId,
            autorizadoPorTipo: null, autorizadoPorPessoaId: null, autorizadoPorNome: null, autorizacaoPreviaId: null, justificativa: null,
            restricaoId: null, operadorId: u.id, ocorridoEm: agora(), retroativo: false, refereEventoId: entrada.id, corrigeEventoId: null,
            observacao: observacao?.trim() || null,
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
          if (!justificativaValida(i.justificativa)) {
            throw new ApiError(422, 'JUSTIFICATIVA_OBRIGATORIA', `A correção exige justificativa de pelo menos ${MIN_JUSTIFICATIVA} caracteres (RN-04).`);
          }
          const ev = await gravarEvento(d, {
            tipo: 'correcao', categoriaPessoa: orig.categoriaPessoa, pessoaId: orig.pessoaId, unidadeDestinoId: orig.unidadeDestinoId,
            autorizadoPorTipo: null, autorizadoPorPessoaId: null, autorizadoPorNome: null, autorizacaoPreviaId: null,
            justificativa: i.justificativa.trim(), restricaoId: null, operadorId: u.id, ocorridoEm: agora(), retroativo: false,
            refereEventoId: null, corrigeEventoId: orig.id, observacao: i.observacao?.trim() || null,
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
          return d.eventos.filter((e) => e.tipo === 'entrada' && !ix.saidas.has(e.id)).sort((a, b) => b.ocorridoEm - a.ocorridoEm).map((e) => view(e, ix));
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
          e.retiradaEm = agora(); e.retiradaPorPessoaId = p.id;
          e.retiradaPorNome = `${p.nome} (${v.tipo === 'dependente' ? 'dependente' : v.tipo === 'inquilino' ? 'inquilino' : 'morador'})`;
          e.retiradaRegistradaPorNome = u.nome;
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
            abertaPorNome: u.nome, abertaEm: agora(), status: 'aberta', anexos: i.anexos ?? [], eventoIds: i.eventoIds ?? [],
          };
          d.ocorrencias.push(o);
          return o;
        });
      },
      async alterarStatus(id, status) {
        exige('ocorrencia.operar');
        return escrever((d) => {
          const o = d.ocorrencias.find((x) => x.id === id);
          if (!o) throw new ApiError(404, 'OCORRENCIA_NAO_ENCONTRADA', 'Ocorrência não encontrada.');
          o.status = status;
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
            excecoesNoTurno: d.eventos.filter((e) => e.autorizadoPorTipo === 'excecao_porteiro' && e.ocorridoEm >= inicioDoDia(n)).length,
            restricoesPendentes: d.restricoes.filter((r) => r.escopo === 'condominio' && r.aprovadaEm === null && r.revogadaEm === null).length,
          };
        });
      },
    },

    relatorios: {
      async resumo(dias = 30) {
        exige('relatorio.ver');
        return ler((d): RelatorioResumo => {
          const ix = indices(d);
          const n = agora();
          const hoje = inicioDoDia(n);
          const porDia = new Map<number, number>();
          for (let k = dias - 1; k >= 0; k--) porDia.set(hoje - k * DIA, 0);
          const meios = new Map<string, number>();
          const exc = new Map<string, number>();
          const tot = { entradas: 0, negados: 0, retroativos: 0, excecoes: 0 };
          for (const e of d.eventos) {
            if (e.ocorridoEm < hoje - (dias - 1) * DIA) continue;
            if (e.tipo === 'negado') tot.negados++;
            if (e.tipo !== 'entrada') continue;
            tot.entradas++;
            const dia = inicioDoDia(e.ocorridoEm);
            porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
            if (e.autorizadoPorTipo) meios.set(e.autorizadoPorTipo, (meios.get(e.autorizadoPorTipo) ?? 0) + 1);
            if (e.retroativo) tot.retroativos++;
            if (e.autorizadoPorTipo === 'excecao_porteiro') {
              tot.excecoes++;
              const nome = ix.usuarios.get(e.operadorId)?.nome ?? '?';
              exc.set(nome, (exc.get(nome) ?? 0) + 1);
            }
          }
          const faixas = [['0 a 2 dias', 0, 2], ['3 a 7 dias', 3, 7], ['8 a 14 dias', 8, 14], ['15 dias ou mais', 15, 9999]] as const;
          const pend = d.encomendas.filter((e) => e.retiradaEm === null);
          const completas = new Set(d.vinculos.filter((v) => v.status === 'aprovado' && vinculoValido(v, n)).map((v) => v.unidadeId));
          return {
            acessosPorDia: [...porDia].map(([dia, entradas]) => ({ dia, entradas })),
            acessosPorMeio: [...meios].map(([meio, total]) => ({ meio: meio as RelatorioResumo['acessosPorMeio'][number]['meio'], total })).sort((a, b) => b.total - a.total),
            excecoesPorPorteiro: [...exc].map(([operador, total]) => ({ operador, total })).sort((a, b) => b.total - a.total),
            encomendasPorIdade: faixas.map(([faixa, min, max]) => ({
              faixa, total: pend.filter((e) => { const dd = Math.floor((n - e.recebidaEm) / DIA); return dd >= min && dd <= max; }).length,
            })),
            cadastroCompleto: { unidadesCompletas: completas.size, total: d.unidades.length },
            totais: tot,
          };
        });
      },
    },

    auditoria: {
      async verificarIntegridade() {
        exige('auditoria.verificar');
        await esperar();
        const d = await carregar();
        return verificarCadeia(d.eventos);
      },
      async exportar(f) {
        const u = exige('auditoria.exportar');
        await esperar();
        const d = await carregar();
        const ix = indices(d);
        const evs = filtrarEventos(d, f).sort((a, b) => a.seq - b.seq);
        const g = await hashGenese();
        const manifesto = {
          tipo: 'manifesto', formato: 'portaria-parque/trilha-jsonl', versao: 1, sistema: 'Portaria Parque',
          condominio: 'Condomínio Residencial do Parque', geradoPor: u.nome, geradoEm: new Date(agora() + 3 * 3600 * 1000).toISOString().replace('Z', '-03:00 (horário simulado)'),
          quantidade: evs.length, filtros: f ?? {},
          algoritmo: 'hash = SHA-256( hashAnterior + JSON.stringify(campos) ), em hexadecimal minúsculo; JSON.stringify sem espaços, campos na ordem de ordemCampos.',
          ordemCampos: CAMPOS_CANONICOS, hashGenese: g, genese: 'SHA-256 da string "genesis"',
          instrucoesVerificacao: [
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
        return { nomeArquivo: `trilha-portaria-parque-${p}.jsonl`, conteudo: linhas.join('\n') + '\n', quantidade: evs.length };
      },
    },

    usuarios: {
      async listar() { exige('usuario.gerenciar'); return ler((d) => [...d.usuarios]); },
      async criar(i) {
        exige('usuario.gerenciar');
        return escrever((d) => {
          const login = i.login.trim().toLowerCase();
          if (!i.nome.trim() || !login) throw new ApiError(422, 'DADOS_OBRIGATORIOS', 'Informe nome e login.');
          if (d.usuarios.some((x) => x.login === login)) throw new ApiError(409, 'LOGIN_EXISTENTE', 'Já existe um usuário com este login.');
          // RN-05: login individual. Perfis diferentes de porteiro exigem segundo fator.
          const novo: UsuarioSistema = {
            id: uid('u'), nome: i.nome.trim(), login, papel: i.papel, ativo: true, ultimoAcesso: null,
            totpAtivo: exigeTotpNoCadastro(i.papel) ? true : !!i.totpAtivo,
          };
          d.usuarios.push(novo);
          return novo;
        });
      },
      async desativar(id) {
        const eu = exige('usuario.gerenciar');
        return escrever((d) => {
          const x = d.usuarios.find((u) => u.id === id);
          if (!x) throw new ApiError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
          if (x.id === eu.id) throw new ApiError(422, 'AUTO_DESATIVACAO', 'Você não pode desativar o próprio usuário.');
          x.ativo = false; // o histórico (eventos com operadorId) é mantido
          return x;
        });
      },
      async reativar(id) {
        exige('usuario.gerenciar');
        return escrever((d) => {
          const x = d.usuarios.find((u) => u.id === id);
          if (!x) throw new ApiError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
          x.ativo = true;
          return x;
        });
      },
      async redefinirAcesso(id) {
        exige('usuario.gerenciar');
        return ler((d) => {
          const x = d.usuarios.find((u) => u.id === id);
          if (!x) throw new ApiError(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
          return x; // no mock: apenas confirma; o servidor real geraria senha temporária e exigiria troca no próximo login
        });
      },
    },

    importacao: {
      async analisar({ arquivo, linhas }) {
        exige('importacao.executar');
        return ler((d) => {
          const inc: InconsistenciaImportacao[] = [];
          const validas: LinhaPlanilha[] = [];
          const vistos = new Set<string>();
          for (const l of linhas) {
            const uid_ = `T${l.torre.replace(/\D/g, '')}-${l.unidade.replace(/\D/g, '')}`;
            if (!unidadeExiste(uid_)) { inc.push({ linha: l.linha, codigo: 'UNIDADE_INEXISTENTE', mensagem: `Unidade ${l.torre}/${l.unidade} não existe no condomínio. Linha não importada.`, tipo: 'erro' }); continue; }
            if (!l.nome.trim()) { inc.push({ linha: l.linha, codigo: 'NOME_AUSENTE', mensagem: 'Nome ausente. Linha não importada.', tipo: 'erro' }); continue; }
            const chaveDup = `${norm(l.nome)}|${uid_}`;
            const docDigitos = so_digitos(l.documento);
            if (vistos.has(chaveDup)) { inc.push({ linha: l.linha, codigo: 'DUPLICIDADE_PLANILHA', mensagem: `${l.nome} aparece duas vezes na unidade ${uid_}. Consolidado.`, tipo: 'aviso' }); continue; }
            vistos.add(chaveDup);
            if (!docDigitos) inc.push({ linha: l.linha, codigo: 'DOC_AUSENTE', mensagem: `${l.nome}: documento ausente. Importado, pendente de completar.`, tipo: 'aviso' });
            else if (docDigitos.length === 11 && !cpfValido(docDigitos)) inc.push({ linha: l.linha, codigo: 'DOC_INVALIDO', mensagem: `${l.nome}: CPF com dígito verificador inválido. Marcado para correção.`, tipo: 'aviso' });
            if (so_digitos(l.telefone).length < 10 && l.telefone.trim()) inc.push({ linha: l.linha, codigo: 'TELEFONE_INVALIDO', mensagem: `${l.nome}: telefone com menos de 10 dígitos.`, tipo: 'aviso' });
            if (d.vinculos.some((v) => v.unidadeId === uid_ && norm(d.pessoas.find((p) => p.id === v.pessoaId)?.nome ?? '') === norm(l.nome))) {
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
        exige('importacao.executar');
        return escrever((d) => {
          const imp = importacoes.get(id);
          if (!imp) throw new ApiError(404, 'IMPORTACAO_NAO_ENCONTRADA', 'Análise de importação não encontrada. Envie o arquivo novamente.');
          let importados = 0, reaproveitados = 0;
          for (const l of imp.validas) {
            const unidade = `T${l.torre}-${l.unidade}`;
            const existente = d.pessoas.find((p) => norm(p.nome) === norm(l.nome) && d.vinculos.some((v) => v.pessoaId === p.id && v.unidadeId === unidade));
            if (existente) { reaproveitados++; continue; }
            const dig = so_digitos(l.documento);
            let p = dig ? d.pessoas.find((x) => norm(x.nome) === norm(l.nome)) : undefined;
            if (!p) {
              p = { id: uid('pe'), nome: l.nome.trim(), categoria: 'morador', documentoTipo: 'cpf', documentoMascarado: dig ? mascararDocumento('cpf', l.documento) : '(sem documento)', telefone: l.telefone || undefined, criadoEm: agora() };
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
        sessao = null; preSessao = null; gravarSessao();
        try { if (persistir) localStorage.removeItem(chave); } catch { /* ignora */ }
        salvar();
      },
    },
  };

  function exigeLogado() { usuario(); }

  function buscarPessoas(d: DbData, q: string, semMoradores: boolean): PessoaBusca[] {
    const nq = norm(q);
    const digitos = so_digitos(q);
    const un = unidadeDeTexto(q);
    const placa = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const idsPorUnidade = un ? new Set(d.vinculos.filter((v) => v.unidadeId === un && v.status !== 'rejeitado' && v.status !== 'encerrado').map((v) => v.pessoaId)) : null;
    const idsPorPlaca = placa.length >= 4 ? new Set(d.veiculos.filter((v) => v.placa.replace('-', '').includes(placa)).flatMap((v) => d.vinculos.filter((x) => x.unidadeId === v.unidadeId).map((x) => x.pessoaId))) : null;
    const achados = d.pessoas.filter((p) => {
      if (semMoradores && p.categoria === 'morador') return false;
      if (norm(p.nome).includes(nq)) return true;
      if (digitos.length >= 3 && so_digitos(p.documentoMascarado).includes(digitos)) return true;
      if (idsPorUnidade?.has(p.id)) return true;
      if (idsPorPlaca?.has(p.id)) return true;
      return false;
    });
    achados.sort((a, b) => Number(norm(b.nome).startsWith(nq)) - Number(norm(a.nome).startsWith(nq)) || a.nome.localeCompare(b.nome, 'pt-BR'));
    return achados.map((p) => pessoaBusca(d, p));
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
