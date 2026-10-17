// Testes das lacunas do MVP: relatórios com filtros/CSV (RF-30/31), evento isolado (RF-32), xlsx (RF-11), busca da portaria.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { entrarComo, esperaErro, id, novaApi } from './helpers';
import { brt } from '@portaria/domain/time';
import { CAMPOS_CANONICOS, calcularHash, hashGenese } from '@portaria/domain/hashChain';
import { lerCsv, mapearMatriz, matrizDeCelulas } from '../features/importacao/csv';

const HOJE = brt(2026, 10, 9);

describe('RF-30/RF-31: relatórios com filtros', () => {
  it('padrão são os últimos 30 dias; período explícito vale também para exceções por porteiro', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    const padrao = await api.relatorios.resumo();
    expect(padrao.acessosPorDia.length).toBe(30);
    expect(padrao.periodo.ate).toBe(brt(2026, 10, 10) - 1);
    const hoje = await api.relatorios.resumo({ de: HOJE, ate: HOJE });
    expect(hoje.acessosPorDia.length).toBe(1);
    const evs = await api.eventos.listar({ de: HOJE, ate: HOJE + 86_400_000 - 1 });
    expect(hoje.totais.entradas).toBe(evs.filter((e) => e.tipo === 'entrada').length);
    expect(hoje.excecoesPorPorteiro.reduce((s, e) => s + e.total, 0)).toBe(hoje.totais.excecoes);
    expect(hoje.totais.excecoes).toBeLessThanOrEqual(padrao.totais.excecoes);
  });

  it('filtra por unidade, tipo de pessoa e meio de autorização', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    const todos = await api.relatorios.resumo();
    const porUn = await api.relatorios.resumo({ unidadeId: 'T4-32' });
    const esperadoUn = (await api.eventos.listar({ unidadeId: 'T4-32', de: porUn.periodo.de, ate: porUn.periodo.ate })).filter((e) => e.tipo === 'entrada').length;
    expect(porUn.totais.entradas).toBe(esperadoUn);
    expect(porUn.totais.entradas).toBeLessThan(todos.totais.entradas);

    const prest = await api.relatorios.resumo({ categoria: 'prestador' });
    const visit = await api.relatorios.resumo({ categoria: 'visitante' });
    expect(prest.totais.entradas).toBeGreaterThan(0);
    expect(prest.totais.entradas + visit.totais.entradas).toBeLessThanOrEqual(todos.totais.entradas);

    const meio = await api.relatorios.resumo({ meio: 'interfone' });
    expect(meio.acessosPorMeio.every((m) => m.meio === 'interfone')).toBe(true);
    expect(meio.totais.entradas).toBe(todos.acessosPorMeio.find((m) => m.meio === 'interfone')!.total);
    expect(meio.totais.excecoes).toBe(0);
  });

  it('período invertido é rejeitado', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    expect((await esperaErro(api.relatorios.resumo({ de: HOJE, ate: HOJE - 3 * 86_400_000 }))).code).toBe('PERIODO_INVALIDO');
  });

  it('exporta CSV com filtros aplicados e sem permissão não exporta', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    const p = await api.relatorios.exportarCsv({ categoria: 'prestador', meio: 'interfone' });
    expect(p.nomeArquivo).toMatch(/^relatorio-portaria-parque-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(p.conteudo.startsWith('﻿Seção;Item;Total')).toBe(true);
    expect(p.conteudo).toContain('Filtro;Tipo de pessoa;Prestador');
    expect(p.conteudo).toContain('Totais;entradas;');
    expect(p.conteudo).toContain('Acessos por dia;');
    await entrarComo(api, 'joao.lima'); // porteiro não vê relatórios
    expect((await esperaErro(api.relatorios.exportarCsv())).status).toBe(403);
  });
});

describe('RF-32: exportar evento isolado', () => {
  it('gera manifesto + o evento + resumo, com hash verificável', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const pacote = await api.auditoria.exportar({ eventoId: 'e4814' });
    expect(pacote.quantidade).toBe(1);
    expect(pacote.nomeArquivo).toMatch(/^evento-EV-.*\.jsonl$/);
    const linhas = pacote.conteudo.trim().split('\n').map((l) => JSON.parse(l));
    expect(linhas.map((l) => l.tipo)).toEqual(['manifesto', 'evento', 'resumo']);
    const [man, ev, res] = linhas;
    expect(man.modo).toBe('evento_isolado');
    expect(man.quantidade).toBe(1);
    expect(man.instrucoesVerificacao.join(' ')).toContain('hashAnterior');
    expect(man.instrucoesVerificacao.join(' ')).toContain('apenas o hash dele');
    expect(res.ultimoHash).toBe(ev.hash);
    // O verificador externo confere o hash do evento a partir de hashAnterior + campos
    expect(Object.keys(ev.campos)).toEqual([...CAMPOS_CANONICOS]);
    const g = await hashGenese();
    expect(man.hashGenese).toBe(g);
    const recalculado = await calcularHash(ev.hashAnterior, ev.campos);
    expect(recalculado).toBe(ev.hash);
    // A ligação com a cadeia: hashAnterior igual ao hash do evento anterior na trilha completa
    const completa = (await api.auditoria.exportar()).conteudo.trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.tipo === 'evento');
    const anterior = completa.find((l) => l.seq === ev.seq - 1);
    expect(anterior ? anterior.hash : g).toBe(ev.hashAnterior);
  });

  it('evento inexistente devolve 404 e o filtro não vaza outros eventos', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    expect((await esperaErro(api.auditoria.exportar({ eventoId: 'nao-existe' }))).status).toBe(404);
    expect((await api.auditoria.exportar({ eventoId: 'e4814' })).conteudo).not.toContain('"seq":4813');
  });
});

describe('RF-11: planilha .xlsx', () => {
  it('mapearMatriz usa o cabeçalho (aliases) e reporta colunas faltando', () => {
    const r = mapearMatriz([['Bloco', 'Apto', 'Morador', 'CPF'], ['1', '12', 'Fulana', '529.982.247-25']]);
    expect(r.faltando).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ linha: 2, torre: '1', unidade: '12', nome: 'Fulana', documento: '529.982.247-25' });
    expect(mapearMatriz([['Nome']]).faltando).toEqual(['torre', 'unidade']);
  });

  it('células numéricas, vazias e datas viram texto; linhas vazias são descartadas', () => {
    expect(matrizDeCelulas([['Torre', 'Nome'], [1, null], [null, null], [2, 'Ana ']])).toEqual([['Torre', 'Nome'], ['1', ''], ['2', 'Ana']]);
  });

  it('lê o arquivo .xlsx de exemplo e produz o mesmo relatório de inconsistências que o CSV', async () => {
    const { readSheet } = await import('read-excel-file/node');
    const xlsx = mapearMatriz(matrizDeCelulas(await readSheet(fileURLToPath(new URL('../../e2e/fixtures/moradores.xlsx', import.meta.url)))));
    expect(xlsx.faltando).toEqual([]);
    expect(xlsx.linhas.length).toBe(3);
    expect(xlsx.linhas[0]).toMatchObject({ torre: '1', unidade: '12', nome: 'Ágata Mendonça Lopes', documento: '529.982.247-25' });
    const csv = lerCsv(readFileSync(new URL('../../e2e/fixtures/moradores.csv', import.meta.url), 'utf8'));
    expect(xlsx.linhas).toEqual(csv.linhas);

    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const [rx, rc] = [await api.importacao.analisar({ arquivo: 'm.xlsx', linhas: xlsx.linhas }), await api.importacao.analisar({ arquivo: 'm.csv', linhas: csv.linhas })];
    expect(rx.inconsistencias.map((i) => [i.linha, i.codigo])).toEqual(rc.inconsistencias.map((i) => [i.linha, i.codigo]));
    expect(rx.rejeitadas).toBe(1); // T2-104 não existe
  });
});

describe('busca da portaria', () => {
  it('quem tem vínculo válido aparece (com unidadesVinculadas) mesmo para visitar outra unidade', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const r = await api.pessoas.buscar('Ana Ribeiro');
    const ana = r.find((p) => p.id === id.ana)!;
    expect(ana.unidadesVinculadas.length).toBeGreaterThan(0);
    // Morador da T4-32 visitando a T1-12: o servidor trata como visitante (RN-01/RN-02)
    const ev = await api.eventos.criar({ pessoaId: id.ana, unidadeDestinoId: 'T1-12', autorizadoPorTipo: 'excecao_porteiro', justificativa: 'Moradora de outra torre sem ninguém atendendo o interfone.' });
    expect(ev.categoriaPessoa).toBe('visitante');
  });

  it('ordena nome exato > começa com > contém e respeita o limite pedido', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const novo = (nome: string, cpf: string) => api.pessoas.criar({ nome, documento: cpf, telefone: '(11) 91234-5678', categoria: 'visitante' });
    await novo('Silva', '529.982.247-25');
    await novo('Silvana Prado', '111.444.777-35');
    await novo('Joana da Silva', '390.533.447-05');
    const r = await api.pessoas.buscar('silva');
    const nomes = r.map((p) => p.nome);
    expect(nomes.indexOf('Silva')).toBeLessThan(nomes.indexOf('Silvana Prado'));
    expect(nomes.indexOf('Silvana Prado')).toBeLessThan(nomes.indexOf('Joana da Silva'));
    expect(nomes[0]).toBe('Silva');
    expect((await api.pessoas.buscar('a', { limite: 3 })).length).toBeLessThanOrEqual(3);
    expect((await api.pessoas.buscar('a')).length).toBeLessThanOrEqual(8);
    expect((await api.pessoas.buscar('a', { limite: 9 })).length).toBe(9);
  });
});
