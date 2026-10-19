import { brt } from '@portaria/domain/time';

/** PRNG determinístico (mulberry32) para gerar dados simulados reproduzíveis. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** "09/10/2026 10:22" ou "09/10/2026" -> epoch */
export function dt(s: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(s);
  if (!m) throw new Error(`data inválida no seed: ${s}`);
  return brt(+m[3], +m[2], +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

/** Documento mascarado determinístico a partir de uma semente: ***.456.789-** */
export function docMascarado(rand: () => number): string {
  const t = () => String(Math.floor(rand() * 900) + 100);
  return `***.${t()}.${t()}-**`;
}

export const PRIMEIROS = ['Alice', 'Bernardo', 'Camila', 'Davi', 'Elisa', 'Fábio', 'Giovana', 'Heitor', 'Isabela', 'Joaquim',
  'Kátia', 'Leandro', 'Marisa', 'Nelson', 'Olívia', 'Pedro', 'Queila', 'Rafaela', 'Sérgio', 'Tânia', 'Ulisses', 'Valéria',
  'Wagner', 'Yasmin', 'Zélia', 'Augusto', 'Beatriz', 'Caio', 'Débora', 'Eduardo', 'Flávia', 'Gabriel', 'Helena', 'Igor',
  'Jéssica', 'Kleber', 'Letícia', 'Mateus', 'Natália', 'Otávio'];
export const SOBRENOMES = ['Andrade', 'Barros', 'Cardoso', 'Dias', 'Esteves', 'Freitas', 'Guimarães', 'Henrique', 'Ibrahim',
  'Jardim', 'Klein', 'Lacerda', 'Monteiro', 'Nunes', 'Oliveira', 'Pacheco', 'Queiroz', 'Rezende', 'Siqueira', 'Tavares',
  'Uchoa', 'Vasconcelos', 'Werneck', 'Xavier', 'Yamamoto', 'Zanetti', 'Amaral', 'Bastos', 'Camargo', 'Duarte', 'Falcão',
  'Gouveia', 'Hashimoto', 'Ivo', 'Junqueira', 'Lopes', 'Matos', 'Neves', 'Ortiz', 'Prates'];

export const MARCAS = [
  ['Honda Fit', 'prata'], ['VW T-Cross', 'branco'], ['Fiat Argo', 'cinza'], ['Hyundai HB20', 'branco'], ['Chevrolet Onix', 'preto'],
  ['Toyota Corolla', 'preto'], ['Jeep Renegade', 'verde'], ['Renault Kwid', 'vermelho'], ['Fiat Mobi', 'azul'], ['Nissan Kicks', 'cinza'],
];

/**
 * CPF válido (dígitos verificadores corretos) e determinístico. `meio` fixa os dígitos 4–9 (os que a
 * máscara ***.XXX.YYY-** exibe), para manter no seed os números visíveis do protótipo.
 */
export function gerarCpf(rand: () => number, meio?: string): string {
  const d: number[] = [];
  for (let i = 0; i < 9; i++) d.push(meio && i >= 3 && i < 9 ? Number(meio[i - 3]) : Math.floor(rand() * 10));
  if (d.every((x) => x === d[0])) d[0] = (d[0] + 1) % 10;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += d[i] * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(9)); d.push(dv(10));
  return d.join('');
}

/** Telefone celular fictício, só dígitos (como no schema): "119XXXXXXXX". */
export function gerarTelefone(rand: () => number): string {
  const n = (k: number) => Array.from({ length: k }, () => Math.floor(rand() * 10)).join('');
  return `119${n(4)}${n(4)}`;
}

// ----- Ids determinísticos (formato uuid) para o seed: os testes e os links do protótipo continuam estáveis. ------
const hex12 = (n: string) => n.padStart(12, '0');
/** Unidade do seed: "00000000-0000-4000-8000-BBBBBBNNNNNN" (bloco em hex, 2 casas por caractere; número em 6). */
export const idUnidadeSeed = (bloco: string, numero: string) =>
  `00000000-0000-4000-8000-${hex12([...bloco].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padStart(6, '0') + numero.padStart(6, '0'))}`;
/** Área comum do seed (1, 2, ...). */
export const idAreaComumSeed = (n: number) => `00000000-0000-4000-a000-${hex12(String(n))}`;
/** Portaria social (único ponto de acesso do MVP). */
export const ID_PORTARIA_SOCIAL = '00000000-0000-4000-9000-000000000001';

/** Gera uuid v4 (crypto.randomUUID quando houver; senão, getRandomValues). */
export function novoUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
