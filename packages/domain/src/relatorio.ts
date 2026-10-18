// Relatórios (RF-30, RF-31): o CSV do resumo. FONTE ÚNICA do formato, usada pelo mock e pela API.
// UTF-8 com BOM, separador ";", CRLF, e proteção contra injeção de fórmula (célula que começa com = + - @).
import { fmtData } from './time';
import { ROTULO_CATEGORIA, ROTULO_MEIO, type CategoriaPessoa, type MeioAutorizacao } from './types';

/** Mesmo formato de `RelatorioResumo` (apps/web/src/api/types.ts). */
export interface ResumoRelatorio {
  periodo: { de: number; ate: number };
  acessosPorDia: { dia: number; entradas: number }[];
  acessosPorMeio: { meio: MeioAutorizacao; total: number }[];
  excecoesPorPorteiro: { operadorId: string; operador: string; total: number }[];
  encomendasPorIdade: { faixa: string; total: number }[];
  cadastroCompleto: { unidadesCompletas: number; total: number };
  totais: { entradas: number; negados: number; recusados: number; retroativos: number; excecoes: number };
}

/** Faixas de idade das encomendas pendentes, em dias inteiros desde o recebimento. */
export const FAIXAS_ENCOMENDA = [['0 a 2 dias', 0, 2], ['3 a 7 dias', 3, 7], ['8 a 14 dias', 8, 14], ['15 dias ou mais', 15, 9999]] as const;

/** Período máximo de um relatório (dias). */
export const PERIODO_MAX_RELATORIO_DIAS = 366;

function celula(v: string | number): string {
  let t = String(v);
  if (/^[=+\-@]/.test(t)) t = `'${t}`; // evita interpretação como fórmula no Excel
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * CSV do resumo (seção;item;total). `filtros` traz os rótulos já resolvidos (código da unidade). `hoje`: AAAA-MM-DD no
 * horário de São Paulo, para o nome do arquivo.
 */
export function csvRelatorio(
  r: ResumoRelatorio, filtros: { unidade?: string; categoria?: CategoriaPessoa; meio?: MeioAutorizacao }, hoje: string,
): { nomeArquivo: string; conteudo: string; quantidade: number } {
  const linhas: (string | number)[][] = [['Seção', 'Item', 'Total']];
  linhas.push(['Período', `${fmtData(r.periodo.de)} a ${fmtData(r.periodo.ate)}`, '']);
  if (filtros.unidade) linhas.push(['Filtro', 'Unidade', filtros.unidade]);
  if (filtros.categoria) linhas.push(['Filtro', 'Tipo de pessoa', ROTULO_CATEGORIA[filtros.categoria]]);
  if (filtros.meio) linhas.push(['Filtro', 'Meio de autorização', ROTULO_MEIO[filtros.meio]]);
  for (const [k, v] of Object.entries(r.totais)) linhas.push(['Totais', k, v]);
  for (const x of r.acessosPorDia) linhas.push(['Acessos por dia', fmtData(x.dia), x.entradas]);
  for (const x of r.acessosPorMeio) linhas.push(['Acessos por meio', ROTULO_MEIO[x.meio], x.total]);
  for (const x of r.excecoesPorPorteiro) linhas.push(['Exceções por responsável', x.operador, x.total]);
  for (const x of r.encomendasPorIdade) linhas.push(['Encomendas pendentes por idade', x.faixa, x.total]);
  return {
    nomeArquivo: `relatorio-portaria-parque-${hoje}.csv`,
    conteudo: '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n',
    quantidade: r.totais.entradas,
  };
}
