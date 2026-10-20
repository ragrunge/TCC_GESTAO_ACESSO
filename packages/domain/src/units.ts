// Unidades (RF-01). A unidade tem id uuid; o código "A-32" é derivado de bloco e número e NÃO é chave.
// A lista real vem do banco (CRUD de unidades); aqui ficam a estrutura inicial do condomínio (seed, declarativa) e
// utilitários puros. O nome do agrupamento ("Bloco" ou "Torre") é configuração: muda só o rótulo, nunca o dado.
import type { Unidade } from './types';

export interface EstruturaUnidade { bloco: string; numero: string }

/** Como o condomínio chama o agrupamento de apartamentos. Muda o rótulo ("BLOCO A · AP 32"), não o código ("A-32"). */
export type Agrupamento = 'Bloco' | 'Torre';
export const AGRUPAMENTOS: readonly Agrupamento[] = ['Bloco', 'Torre'];
const FEMININO: Record<Agrupamento, boolean> = { Bloco: false, Torre: true };

/** Concordância nos textos da UI: "do bloco"/"da torre", "neste bloco"/"nesta torre", "O bloco"/"A torre". */
export const doAgrupamento = (a: Agrupamento) => `${FEMININO[a] ? 'da' : 'do'} ${a.toLowerCase()}`;
export const nesteAgrupamento = (a: Agrupamento) => `${FEMININO[a] ? 'nesta' : 'neste'} ${a.toLowerCase()}`;
export const oAgrupamento = (a: Agrupamento) => `${FEMININO[a] ? 'A' : 'O'} ${a.toLowerCase()}`;

/**
 * Estrutura inicial, declarativa (lida pelo seed da API). Número = andar * 10 + final, com 2 dígitos
 * ("03", "32"). `ausentes` tira da grade: "01" vale para todos os blocos; "A-01", só para aquele bloco.
 * Exceções que fogem da grade (cobertura, unidade desmembrada) entram pelo CRUD de unidades ou pela planilha.
 */
export interface ConfigEstrutura {
  agrupamento: Agrupamento;
  blocos: readonly string[];
  /** 0 = térreo; de 0 a 9 (o número tem 2 dígitos). */
  andares: readonly number[];
  /** Final do apartamento no andar, de 1 a 9. */
  finais: readonly number[];
  ausentes: readonly string[];
}

/** Condomínio Residencial do Parque: 9 blocos (A a I), térreo e 4 andares, 4 apartamentos por andar. */
export const ESTRUTURA_PADRAO: ConfigEstrutura = {
  agrupamento: 'Bloco',
  blocos: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
  andares: [0, 1, 2, 3, 4],
  finais: [1, 2, 3, 4],
  // PROVISÓRIO (falta o síndico confirmar): o térreo só teria 03 e 04. Se tiver 01 e 02, troque por [].
  ausentes: ['01', '02'],
};

/** Formato do bloco depois de normalizado (mesmo CHECK `unidade_bloco_ck` do banco). */
export const FORMATO_BLOCO = /^[A-Z0-9]{1,3}$/;
/** Número canônico: só dígitos, mínimo 2, sem zero à esquerda além do da casa da dezena ("03", "32", "101"). */
export const FORMATO_NUMERO = /^(0[1-9]|[1-9][0-9]{1,3})$/;

/** " a " -> "A". */
export const normalizarBloco = (b: string) => b.trim().toUpperCase();

/** "3" -> "03", "032" -> "32", "101" -> "101". Texto que não é só dígitos volta só sem espaços (a validação recusa). */
export function normalizarNumero(n: string): string {
  const t = n.trim();
  return /^[0-9]+$/.test(t) ? t.replace(/^0+(?=[0-9])/, '').padStart(2, '0') : t;
}

/** "A-32" */
export const codigoUnidade = (u: EstruturaUnidade) => `${u.bloco}-${u.numero}`;

/** "BLOCO A · AP 32" (ou "Bloco A · AP 32"). */
export function rotuloUnidade(u: EstruturaUnidade, agrupamento: Agrupamento, caixaAlta = true): string {
  const r = `${agrupamento} ${u.bloco} · AP ${u.numero}`;
  return caixaAlta ? r.toUpperCase() : r;
}

// Bloco e número com separador OBRIGATÓRIO ("A-32", "a 32", "A/32", "4.32", "Bloco A · AP 32"): sem separador,
// "432" seria 4-32 ou 43-2, e "A32" seria A-32 ou A3-2. Prefixo "Bloco"/"Torre" e "AP" opcionais (colar o rótulo).
const CODIGO = /^(?:(?:bloco|torre)\s+)?([a-z0-9]{1,3})(?:\s*[-./·]\s*|\s+)(?:ap(?:to)?\.?\s*)?([0-9]{1,4})$/i;

/**
 * Leituras possíveis de um código digitado, da mais literal para a de compatibilidade (sem checar existência):
 * "A-32" -> [A-32]; "T4-32" -> [T4-32, 4-32] (o "T" do código antigo de torre, se não houver bloco "T4").
 */
export function leiturasDoCodigo(texto: string): EstruturaUnidade[] {
  const m = CODIGO.exec(texto.trim());
  if (!m) return [];
  const bloco = normalizarBloco(m[1]!);
  const numero = normalizarNumero(m[2]!);
  if (!FORMATO_NUMERO.test(numero)) return [];
  const legado = /^T([0-9]{1,2})$/.exec(bloco);
  return legado ? [{ bloco, numero }, { bloco: legado[1]!, numero }] : [{ bloco, numero }];
}

/**
 * Célula de bloco da planilha de importação: "A", "bloco a", "Torre 4", "4" e o antigo "T4" -> blocos possíveis,
 * normalizados, o literal primeiro ("T4" -> ["T4", "4"]).
 */
export function leiturasDoBloco(celula: string): string[] {
  const b = normalizarBloco(celula.replace(/^\s*(?:bloco|torre)\b\s*/i, ''));
  const legado = /^T([0-9]{1,2})$/.exec(b);
  return legado ? [b, legado[1]!] : [b];
}

/** Primeira leitura de `leiturasDoCodigo` ({ bloco, numero } normalizados), ou null. */
export const parseCodigoUnidade = (texto: string): EstruturaUnidade | null => leiturasDoCodigo(texto)[0] ?? null;

/** Procura a unidade de um texto livre ("A-32", "a 32") numa lista vinda do banco. */
export function acharUnidadePorTexto<U extends EstruturaUnidade>(unidades: readonly U[], texto: string): U | undefined {
  for (const p of leiturasDoCodigo(texto)) {
    const u = unidades.find((x) => x.bloco === p.bloco && x.numero === p.numero);
    if (u) return u;
  }
  return undefined;
}

/** Andar do apartamento: "32" -> 3; "03" -> 0 (térreo); "101" -> 1 (três ou mais dígitos: tudo menos os dois últimos). */
export const andarDoNumero = (n: string) => Number(n.length <= 2 ? n[0] : n.slice(0, -2));

/**
 * Mesmas regras dos CHECKs de `unidade`, sobre os valores JÁ normalizados (`normalizarBloco`/`normalizarNumero`).
 * O banco aceita também "00" (para não quebrar dado antigo na migração); o cadastro novo, não.
 */
export function validarEstruturaUnidade(bloco: string, numero: string, agrupamento: Agrupamento = 'Bloco'): string | null {
  if (!FORMATO_BLOCO.test(bloco)) return `${oAgrupamento(agrupamento)} deve ter de 1 a 3 letras ou dígitos (ex.: A, 4, B2).`;
  if (!FORMATO_NUMERO.test(numero)) return 'O número do apartamento deve ter só dígitos (até 4) e ser maior que zero.';
  return null;
}

/**
 * Chave de ordenação natural do bloco: cada sequência de dígitos com 3 casas ("2" -> "002", "B10" -> "B010"), comparada
 * por código de caractere. Assim "2" vem antes de "10", "A" antes de "B", "B2" antes de "B10", e dígitos antes de letras.
 * A API ordena no SQL com a mesma chave (`chaveBlocoSql`, COLLATE "C").
 */
export const chaveBloco = (b: string) => b.replace(/[0-9]+/g, (d) => d.padStart(3, '0'));

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Ordena por bloco (natural) e número (numérico). */
export const compararUnidades = (a: EstruturaUnidade, b: EstruturaUnidade) =>
  comparar(chaveBloco(a.bloco), chaveBloco(b.bloco)) || Number(a.numero) - Number(b.numero) || comparar(a.numero, b.numero);

/** Ordena só os blocos (botões do seletor). */
export const compararBlocos = (a: string, b: string) => comparar(chaveBloco(a), chaveBloco(b));

/**
 * Estrutura inicial a partir da configuração, em ordem. Configuração incoerente (bloco fora do formato, andar ou final
 * fora da faixa, ausente que não existe na grade) é erro: um "ausente" digitado errado não pode sumir em silêncio.
 */
export function gerarUnidades(c: ConfigEstrutura = ESTRUTURA_PADRAO): EstruturaUnidade[] {
  const blocos = c.blocos.map(normalizarBloco);
  const ruim = blocos.find((b) => !FORMATO_BLOCO.test(b));
  if (ruim !== undefined) throw new Error(`estrutura: bloco "${ruim}" fora do formato (1 a 3 letras ou dígitos)`);
  if (new Set(blocos).size !== blocos.length) throw new Error('estrutura: bloco repetido');
  if (!c.andares.every((a) => Number.isInteger(a) && a >= 0 && a <= 9)) throw new Error('estrutura: andar deve ser inteiro de 0 a 9');
  if (!c.finais.every((f) => Number.isInteger(f) && f >= 1 && f <= 9)) throw new Error('estrutura: final deve ser inteiro de 1 a 9');
  if (!AGRUPAMENTOS.includes(c.agrupamento)) throw new Error(`estrutura: agrupamento deve ser ${AGRUPAMENTOS.join(' ou ')}`);

  const grade: EstruturaUnidade[] = [];
  for (const bloco of blocos) {
    for (const andar of c.andares) for (const final of c.finais) grade.push({ bloco, numero: String(andar * 10 + final).padStart(2, '0') });
  }
  const fora = new Set<string>();
  for (const a of c.ausentes) {
    const [b, n] = a.includes('-') ? a.split('-') : [null, a];
    const numero = normalizarNumero(n ?? '');
    const alvos = grade.filter((u) => u.numero === numero && (b === null || u.bloco === normalizarBloco(b)));
    if (!alvos.length) throw new Error(`estrutura: ausente "${a}" não existe na grade`);
    for (const u of alvos) fora.add(codigoUnidade(u));
  }
  const out = grade.filter((u) => !fora.has(codigoUnidade(u)));
  if (new Set(out.map(codigoUnidade)).size !== out.length) throw new Error('estrutura: unidade repetida');
  return out.sort(compararUnidades);
}

/** Áreas comuns iniciais (RF-36), semeadas no banco. */
export const AREAS_COMUNS_INICIAIS = [
  'Salão de festas', 'Piscina', 'Quadra', 'Academia', 'Administração', 'Casa de máquinas', 'Jardins',
] as const;

/** Ponto de acesso único do MVP. */
export const PORTARIA_SOCIAL = 'Portaria social';

export type { Unidade };
