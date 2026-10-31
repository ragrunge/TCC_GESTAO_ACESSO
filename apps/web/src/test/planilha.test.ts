// Leitura da planilha de importação (RF-11) no navegador: .csv e .xlsx viram as mesmas linhas antes de ir para a API.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lerCsv, mapearMatriz, matrizDeCelulas } from '../features/importacao/csv';

describe('RF-11: planilha .xlsx', () => {
  it('mapearMatriz usa o cabeçalho (aliases) e reporta colunas faltando', () => {
    const r = mapearMatriz([['Bloco', 'Apto', 'Morador', 'CPF'], ['A', '12', 'Fulana', '529.982.247-25']]);
    expect(r.faltando).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ linha: 2, bloco: 'A', unidade: '12', nome: 'Fulana', documento: '529.982.247-25' });
    expect(mapearMatriz([['Nome']]).faltando).toEqual(['bloco', 'unidade']);
    expect(mapearMatriz([['Torre', 'Unidade', 'Nome'], ['4', '32', 'Ana']]).linhas[0]).toMatchObject({ bloco: '4', unidade: '32' }); // planilha antiga
  });

  it('células numéricas, vazias e datas viram texto; linhas vazias são descartadas', () => {
    expect(matrizDeCelulas([['Torre', 'Nome'], [1, null], [null, null], [2, 'Ana ']])).toEqual([['Torre', 'Nome'], ['1', ''], ['2', 'Ana']]);
  });

  it('lê o arquivo .xlsx de exemplo e produz as mesmas linhas que o CSV', async () => {
    const { readSheet } = await import('read-excel-file/node');
    const xlsx = mapearMatriz(matrizDeCelulas(await readSheet(fileURLToPath(new URL('../../e2e/fixtures/moradores.xlsx', import.meta.url)))));
    expect(xlsx.faltando).toEqual([]);
    expect(xlsx.linhas.length).toBe(3);
    expect(xlsx.linhas[0]).toMatchObject({ bloco: 'A', unidade: '12', nome: 'Ágata Mendonça Lopes', documento: '529.982.247-25' });
    const csv = lerCsv(readFileSync(new URL('../../e2e/fixtures/moradores.csv', import.meta.url), 'utf8'));
    // Mesmas linhas => a API analisa as duas planilhas igual (a análise em si é testada na API: importacao.test.ts).
    expect(xlsx.linhas).toEqual(csv.linhas);
  });
});
