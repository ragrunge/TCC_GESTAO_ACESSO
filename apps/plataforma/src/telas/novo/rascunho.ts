// Estado do assistente "Novo condomínio" e as regras de cada passo (puras, testáveis sem tela). O rascunho inteiro
// fica num só estado do componente: voltar um passo não perde nada, e nada vai para storage.
import {
  CODIGO_CONDOMINIO, LOGIN_SINDICO, normalizarCodigoCondominio, sugerirCodigoCondominio, sugerirLoginSindico,
} from '@portaria/domain/condominio';
import {
  type Agrupamento, AREAS_COMUNS_INICIAIS, lerListaUnidades, LIMITE_UNIDADES, type ResultadoListaUnidades,
} from '@portaria/domain/units';
import type { NovoCondominio } from '../../api/plataforma';

export const PASSOS = ['Condomínio', 'Unidades', 'Síndico', 'Revisar e criar'] as const;
export type Fonte = 'lista' | 'planilha';

export interface Rascunho {
  nome: string;
  codigo: string;
  /** O Master mexeu no código: a sugestão a partir do nome para de sobrescrever. */
  codigoEditado: boolean;
  cidade: string;
  uf: string;
  agrupamento: Agrupamento;
  /** Aba ativa: as unidades vêm SÓ dela (a outra fica guardada, sem somar). */
  fonte: Fonte;
  textoLista: string;
  /** Planilha lida, já no formato da lista (uma linha por linha do arquivo). */
  textoPlanilha: string;
  arquivo: string | null;
  areas: string[];
  sindicoNome: string;
  sindicoLogin: string;
  loginEditado: boolean;
}

export const RASCUNHO_VAZIO: Rascunho = {
  nome: '', codigo: '', codigoEditado: false, cidade: '', uf: 'SP',
  agrupamento: 'Bloco', fonte: 'lista', textoLista: '', textoPlanilha: '', arquivo: null, areas: [...AREAS_COMUNS_INICIAIS],
  sindicoNome: '', sindicoLogin: '', loginEditado: false,
};

export const MAX_AREAS = 50;
export const MAX_AREA = 80;

export const comNome = (r: Rascunho, nome: string): Rascunho => ({ ...r, nome, codigo: r.codigoEditado ? r.codigo : sugerirCodigoCondominio(nome) });
/** Apagar o código todo devolve a sugestão automática. */
export const comCodigo = (r: Rascunho, codigo: string): Rascunho => {
  const c = normalizarCodigoCondominio(codigo);
  return c ? { ...r, codigo: c, codigoEditado: true } : { ...r, codigo: sugerirCodigoCondominio(r.nome), codigoEditado: false };
};
export const comSindicoNome = (r: Rascunho, nome: string): Rascunho => ({ ...r, sindicoNome: nome, sindicoLogin: r.loginEditado ? r.sindicoLogin : sugerirLoginSindico(nome) });
export const comSindicoLogin = (r: Rascunho, login: string): Rascunho => {
  const l = login.trim().toLowerCase();
  return l ? { ...r, sindicoLogin: l, loginEditado: true } : { ...r, sindicoLogin: sugerirLoginSindico(r.sindicoNome), loginEditado: false };
};

export const textoDaFonte = (r: Rascunho) => (r.fonte === 'lista' ? r.textoLista : r.textoPlanilha);
export const lerUnidades = (r: Rascunho) => lerListaUnidades(textoDaFonte(r), r.agrupamento);

/**
 * Tira a linha `n` (1 = primeira) do texto. Na lista colada a linha sai (o Master vê o texto mudar); na planilha ela
 * fica em branco, para as linhas seguintes continuarem com o número que têm no arquivo.
 */
export function semLinhas(r: Rascunho, ns: readonly number[]): Rascunho {
  const fora = new Set(ns);
  const linhas = textoDaFonte(r).split(/\r?\n/);
  if (r.fonte === 'lista') return { ...r, textoLista: linhas.filter((_, i) => !fora.has(i + 1)).join('\n') };
  return { ...r, textoPlanilha: linhas.map((l, i) => (fora.has(i + 1) ? '' : l)).join('\n') };
}

/** Área comum nova: o motivo da recusa, ou null. */
export function problemaArea(areas: readonly string[], nova: string): string | null {
  const t = nova.trim();
  if (!t) return 'Digite o nome da área comum.';
  if (t.length > MAX_AREA) return `No máximo ${MAX_AREA} caracteres.`;
  if (areas.some((a) => a.toLowerCase() === t.toLowerCase())) return `"${t}" já está na lista.`;
  if (areas.length >= MAX_AREAS) return `No máximo ${MAX_AREAS} áreas comuns.`;
  return null;
}

/** Erros do passo (chave = campo, como os `details` da API). Vazio = pode avançar. */
export function errosDoPasso(passo: number, r: Rascunho, u: ResultadoListaUnidades): Record<string, string> {
  const e: Record<string, string> = {};
  if (passo === 0) {
    if (!r.nome.trim()) e.nome = 'Informe o nome do condomínio.';
    else if (r.nome.trim().length > 200) e.nome = 'No máximo 200 caracteres.';
    if (!CODIGO_CONDOMINIO.test(r.codigo)) e.codigo = '3 a 31 caracteres: letras minúsculas, números e hífen, começando por letra.';
    if (!r.cidade.trim()) e.cidade = 'Informe a cidade.';
    else if (r.cidade.trim().length > 100) e.cidade = 'No máximo 100 caracteres.';
  }
  if (passo === 1) {
    const problemas = u.invalidas + u.duplicadas;
    if (problemas) e.unidades = `${problemas === 1 ? 'Há 1 linha' : `Há ${problemas} linhas`} com problema: corrija ou remova antes de avançar.`;
    else if (!u.unidades.length) e.unidades = r.fonte === 'lista' ? 'Cole ao menos uma unidade.' : 'Envie a planilha com as unidades.';
    else if (u.acimaDoLimite) e.unidades = `No máximo ${LIMITE_UNIDADES} unidades (a lista tem ${u.unidades.length}).`;
  }
  if (passo === 2) {
    const n = r.sindicoNome.trim();
    if (n.length < 3) e['sindico.nome'] = 'Informe o nome do síndico (3 caracteres ou mais).';
    else if (n.length > 120) e['sindico.nome'] = 'No máximo 120 caracteres.';
    if (!LOGIN_SINDICO.test(r.sindicoLogin)) e['sindico.login'] = '3 a 40 caracteres: letras minúsculas, números, ".", "-" ou "_", começando por letra.';
  }
  return e;
}

/** Em que passo o Master corrige o campo que a API recusou. */
export function passoDoCampo(campo: string): number {
  if (campo.startsWith('sindico')) return 2;
  if (campo.startsWith('unidades') || campo.startsWith('agrupamento') || campo.startsWith('areasComuns') || campo.startsWith('estrutura')) return 1;
  return 0;
}

/** Rascunho -> corpo de POST /plataforma/condominios (lista explícita; plano sempre o padrão). */
export function montarEntrada(r: Rascunho, u: ResultadoListaUnidades): NovoCondominio {
  return {
    codigo: normalizarCodigoCondominio(r.codigo), nome: r.nome.trim(), cidade: r.cidade.trim(), uf: r.uf, plano: 'padrao',
    agrupamento: r.agrupamento,
    unidades: u.unidades.map(({ bloco, numero }) => ({ bloco, numero })),
    areasComuns: r.areas.map((a) => a.trim()).filter(Boolean),
    sindico: { nome: r.sindicoNome.trim(), login: r.sindicoLogin.trim().toLowerCase() },
  };
}
