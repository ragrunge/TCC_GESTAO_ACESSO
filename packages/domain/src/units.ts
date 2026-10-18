// Unidades (RF-01). A unidade tem id uuid; o código "T4-32" é derivado de torre e número e NÃO é chave.
// A lista real vem do banco (CRUD de unidades); aqui ficam só a estrutura inicial do condomínio (seed) e utilitários puros.
import type { Unidade } from './types';

export interface EstruturaUnidade { torre: number; numero: string }

/** "T4-32" */
export const codigoUnidade = (u: EstruturaUnidade) => `T${u.torre}-${u.numero}`;

/** "TORRE 4 · AP 32" */
export function rotuloUnidade(u: EstruturaUnidade, caixaAlta = true): string {
  return caixaAlta ? `TORRE ${u.torre} · AP ${u.numero}` : `Torre ${u.torre} · AP ${u.numero}`;
}

/** Aceita "T4-32", "t4-32", "4-32", "4 32", "T4 32", "4/32" e devolve { torre, numero } (sem checar existência). */
export function parseCodigoUnidade(texto: string): EstruturaUnidade | null {
  const m = /^t?\s*(\d{1,2})\s*[-\s.·/]\s*(\d{1,4})$/i.exec(texto.trim());
  return m ? { torre: Number(m[1]), numero: m[2] } : null;
}

/** Procura a unidade de um texto livre ("4-32") numa lista vinda do banco. */
export function acharUnidadePorTexto<U extends EstruturaUnidade>(unidades: readonly U[], texto: string): U | undefined {
  const p = parseCodigoUnidade(texto);
  return p ? unidades.find((u) => u.torre === p.torre && u.numero === p.numero) : undefined;
}

/** Andar do apartamento: "32" -> 3; "101" -> 1 (três ou mais dígitos: tudo menos os dois últimos). */
export const andarDoNumero = (n: string) => Number(n.length <= 2 ? n[0] : n.slice(0, -2));

/** Mesmas regras dos CHECKs de `unidade`: torre > 0 e número só com dígitos. */
export function validarEstruturaUnidade(torre: number, numero: string): string | null {
  if (!Number.isInteger(torre) || torre < 1 || torre > 99) return 'A torre deve ser um número inteiro entre 1 e 99.';
  if (!/^[0-9]{1,4}$/.test(numero)) return 'O número do apartamento deve ter só dígitos (até 4).';
  return null;
}

/** Ordena por torre e número (numérico). */
export const compararUnidades = (a: EstruturaUnidade, b: EstruturaUnidade) => a.torre - b.torre || Number(a.numero) - Number(b.numero);

/** Números de apartamento iniciais de uma torre: torres 1–8 têm 5 andares x 4 aptos; a torre 9 tem 11–15. */
export function numerosDaTorre(torre: number): string[] {
  if (torre === 9) return ['11', '12', '13', '14', '15'];
  const out: string[] = [];
  for (let andar = 1; andar <= 5; andar++) for (let apto = 1; apto <= 4; apto++) out.push(`${andar}${apto}`);
  return out;
}

/** Estrutura inicial: as 165 unidades do condomínio (160 nas torres 1–8 + 5 na torre 9). Usada pelos seeds. */
export function gerarUnidades(): EstruturaUnidade[] {
  const out: EstruturaUnidade[] = [];
  for (let torre = 1; torre <= 9; torre++) for (const numero of numerosDaTorre(torre)) out.push({ torre, numero });
  return out;
}

export const TOTAL_UNIDADES = 165;

/** Áreas comuns iniciais (RF-36), semeadas no mock e no banco. */
export const AREAS_COMUNS_INICIAIS = [
  'Salão de festas', 'Piscina', 'Quadra', 'Academia', 'Administração', 'Casa de máquinas', 'Jardins',
] as const;

/** Ponto de acesso único do MVP. */
export const PORTARIA_SOCIAL = 'Portaria social';

export type { Unidade };
