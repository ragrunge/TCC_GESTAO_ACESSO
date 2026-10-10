import { brt } from '../../domain/time';

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
