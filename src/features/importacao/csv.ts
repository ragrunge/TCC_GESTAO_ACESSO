import type { LinhaPlanilha } from '../../api';

/** Divide uma linha CSV respeitando aspas. */
function dividir(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
    else if (c === sep && !aspas) { out.push(atual); atual = ''; }
    else atual += c;
  }
  out.push(atual);
  return out.map((s) => s.trim());
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const ALIAS: Record<keyof Omit<LinhaPlanilha, 'linha'>, string[]> = {
  torre: ['torre', 'bloco'], unidade: ['unidade', 'apto', 'apartamento', 'ap'], nome: ['nome', 'morador', 'nomecompleto'],
  documento: ['documento', 'cpf', 'rg', 'doc'], telefone: ['telefone', 'celular', 'fone'], tipo: ['tipo', 'vinculo', 'tipovinculo'],
};

/** Mapeia uma matriz (primeira linha = cabeçalho) para as linhas da planilha. Serve a CSV e a .xlsx (RF-11). */
export function mapearMatriz(matriz: string[][]): { linhas: LinhaPlanilha[]; faltando: string[] } {
  if (matriz.length === 0) return { linhas: [], faltando: ['cabeçalho'] };
  const cab = matriz[0].map(norm);
  const idx = {} as Record<string, number>;
  for (const [campo, aliases] of Object.entries(ALIAS)) idx[campo] = cab.findIndex((c) => aliases.includes(c));
  const faltando = ['torre', 'unidade', 'nome'].filter((c) => idx[c] < 0);
  const linhas = matriz.slice(1).map((c, i): LinhaPlanilha => {
    const v = (k: string) => (idx[k] >= 0 ? c[idx[k]] ?? '' : '');
    return { linha: i + 2, torre: v('torre'), unidade: v('unidade'), nome: v('nome'), documento: v('documento'), telefone: v('telefone'), tipo: v('tipo') };
  });
  return { linhas, faltando };
}

/** Lê um CSV (UTF-8, separador ; ou , detectado) e mapeia as colunas pelo cabeçalho. */
export function lerCsv(texto: string): { linhas: LinhaPlanilha[]; faltando: string[] } {
  const brutas = texto.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (brutas.length === 0) return { linhas: [], faltando: ['cabeçalho'] };
  const sep = (brutas[0].match(/;/g)?.length ?? 0) >= (brutas[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  return mapearMatriz(brutas.map((l) => dividir(l, sep)));
}

/** Células do Excel (texto, número, data, vazio) viram texto; linhas totalmente vazias são descartadas. */
export function matrizDeCelulas(celulas: readonly (readonly unknown[])[]): string[][] {
  const txt = (c: unknown) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim());
  return celulas.map((l) => l.map(txt)).filter((l) => l.some((c) => c !== ''));
}

/** Lê a primeira planilha de um .xlsx (biblioteca read-excel-file; não usa o pacote `xlsx`/SheetJS). */
export async function lerXlsx(arquivo: Blob): Promise<{ linhas: LinhaPlanilha[]; faltando: string[] }> {
  const { readSheet } = await import('read-excel-file/browser');
  return mapearMatriz(matrizDeCelulas(await readSheet(arquivo)));
}

function cpf(base: string): string {
  const d = base.split('').map(Number);
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  d.push(dv(9)); d.push(dv(10));
  return d.join('').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/** Planilha de exemplo, com inconsistências propositais (todos os dados são fictícios). */
export function csvExemplo(): string {
  const l = [
    'Torre;Unidade;Nome;CPF;Telefone;Tipo',
    `1;12;Ágata Mendonça Lopes;${cpf('123456780')};(11) 98877-1001;Proprietário`,
    `1;12;Davi Mendonça Lopes;${cpf('223456780')};(11) 98877-1002;Dependente`,
    `1;21;Elias Nogueira Tavares;${cpf('323456780')};(11) 98877-1003;Proprietário`,
    `2;33;Fabiana Quintela Reis;${cpf('423456780')};(11) 98877-1004;Inquilino`,
    `2;33;Gael Quintela Reis;${cpf('523456780')};(11) 98877-1005;Dependente`,
    `3;24;Heloísa Barcellos Dias;${cpf('623456780')};(11) 98877-1006;Proprietário`,
    `3;24;Heloísa Barcellos Dias;${cpf('623456780')};(11) 98877-1006;Proprietário`,
    `3;52;Ícaro Valadares Prado;;(11) 98877-1007;Proprietário`,
    `4;11;Júlia Albuquerque Neri;123.456.789-00;(11) 98877-1008;Inquilino`,
    `4;32;Ana Ribeiro;***.456.789-**;(11) 98877-1009;Proprietário`,
    `4;44;Kaique Sampaio Brito;${cpf('723456780')};98877;Proprietário`,
    `5;13;Larissa Cordeiro Maia;${cpf('823456780')};(11) 98877-1010;Proprietário`,
    `5;54;Murilo Espíndola Rocha;${cpf('923456780')};(11) 98877-1011;Proprietário`,
    `6;31;Nádia Tamandaré Goes;${cpf('113456780')};(11) 98877-1012;Inquilino`,
    `7;43;Otto Brandão Silveira;${cpf('213456780')};(11) 98877-1013;Proprietário`,
    `8;14;Priscila Furtado Leal;${cpf('313456780')};(11) 98877-1014;Proprietário`,
    `8;24;Quirino Alencar Pires;${cpf('413456780')};(11) 98877-1015;Proprietário`,
    `9;12;Regina Salgado Veiga;${cpf('513456780')};(11) 98877-1016;Proprietário`,
    `9;15;Saulo Madureira Costa;${cpf('613456780')};(11) 98877-1017;Proprietário`,
    `9;21;Tereza Pimentel Alves;${cpf('713456780')};(11) 98877-1018;Proprietário`,
    `10;11;Ulisses Carvalhal Neto;${cpf('813456780')};(11) 98877-1019;Proprietário`,
    `2;104;Valéria Sobral Mattos;${cpf('913456780')};(11) 98877-1020;Proprietário`,
  ];
  return l.join('\n') + '\n';
}
