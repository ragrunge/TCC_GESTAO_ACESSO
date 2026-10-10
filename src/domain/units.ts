import type { Unidade } from './types';

export const unidadeId = (torre: number, numero: number | string) => `T${torre}-${numero}`;

export function parseUnidadeId(id: string): { torre: number; numero: string } | null {
  const m = /^T(\d)-(\d{2})$/.exec(id);
  return m ? { torre: Number(m[1]), numero: m[2] } : null;
}

/** "T4-32" -> "TORRE 4 · AP 32" */
export function rotuloUnidade(id: string, caixaAlta = true): string {
  const p = parseUnidadeId(id);
  if (!p) return id;
  const t = caixaAlta ? `TORRE ${p.torre} · AP ${p.numero}` : `Torre ${p.torre} · AP ${p.numero}`;
  return t;
}

/** Números de apartamento de uma torre: torres 1–8 têm 5 andares x 4 aptos; a torre 9 tem 11–15. */
export function numerosDaTorre(torre: number): string[] {
  if (torre === 9) return ['11', '12', '13', '14', '15'];
  const out: string[] = [];
  for (let andar = 1; andar <= 5; andar++) for (let apto = 1; apto <= 4; apto++) out.push(`${andar}${apto}`);
  return out;
}

/** Gera as 165 unidades do condomínio (160 nas torres 1–8 + 5 na torre 9). */
export function gerarUnidades(): Unidade[] {
  const out: Unidade[] = [];
  for (let torre = 1; torre <= 9; torre++) {
    for (const numero of numerosDaTorre(torre)) {
      out.push({ id: unidadeId(torre, numero), torre, numero, ativo: true });
    }
  }
  return out;
}

export const TOTAL_UNIDADES = 165;
export const unidadeExiste = (id: string) => {
  const p = parseUnidadeId(id);
  return !!p && p.torre >= 1 && p.torre <= 9 && numerosDaTorre(p.torre).includes(p.numero);
};

/** Aceita "t4-32", "4-32", "4 32", "T4 32" e devolve "T4-32" (ou null se não for uma unidade existente). */
export function normalizarUnidade(texto: string): string | null {
  const m = /^t?\s*(\d)\s*[-\s.·]\s*(\d{2})$/i.exec(texto.trim());
  if (!m) return null;
  const id = `T${m[1]}-${m[2]}`;
  return unidadeExiste(id) ? id : null;
}
