// Mock (referência de comportamento) nas correções do lote de registro de acesso:
// - aprovar ou regularizar vínculo em unidade desativada barra com 422 UNIDADE_INATIVA (unidade inativa barra novos usos);
// - a lista de funcionários é de síndico, administração e auditor; o porteiro lê só a escala da pessoa na entrada;
// - listagens paginadas (eventos e trilha de alterações) com os mesmos filtros da API real.
import { esperaErro, entrarComo, id, novaApi, un } from './helpers';

describe('mock: unidade desativada barra a aprovação do vínculo', () => {
  it('aprovar 422 UNIDADE_INATIVA; rejeitar continua possível; reativada, aprova', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const p = await api.pessoas.criar({ nome: 'Teste Inativa', documento: '390.533.447-05', telefone: '11955550000', categoria: 'visitante' });
    const v = await api.vinculos.criar({ pessoaId: p.id, unidadeId: un('T1-11'), tipo: 'proprietario', vigenciaInicio: Date.now(), vigenciaFim: null, solicitadoPor: 'x' });
    await api.vinculos.registrarConferencia(v.id, { tipo: 'escritura' });
    await api.unidades.desativar(un('T1-11'));
    const e = await esperaErro(api.vinculos.decidir({ id: v.id, decisao: 'aprovar' }));
    expect(e).toMatchObject({ status: 422, code: 'UNIDADE_INATIVA' });
    expect((await api.vinculos.listar({ status: 'pendente' })).some((x) => x.id === v.id)).toBe(true);
    await api.unidades.reativar(un('T1-11'));
    expect((await api.vinculos.decidir({ id: v.id, decisao: 'aprovar' })).status).toBe('aprovado');
  });

  it('regularizar legado em unidade desativada: 422 UNIDADE_INATIVA', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const leg = (await api.vinculos.listar({ status: 'legado' })).find((x) => x.pessoaCadastroCompleto)!;
    await api.vinculos.registrarConferencia(leg.id, { tipo: 'escritura' });
    await api.unidades.desativar(leg.unidadeId);
    expect((await esperaErro(api.vinculos.regularizar(leg.id))).code).toBe('UNIDADE_INATIVA');
  });
});

describe('mock: funcionários (decisão do usuário)', () => {
  it('porteiro não lista funcionários (403); auditor lista; a escala da pessoa continua disponível na entrada', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.funcionarios.listar())).status).toBe(403);
    await entrarComo(api, 'luiza.campos');
    const lista = await api.funcionarios.listar();
    expect(lista.length).toBeGreaterThan(0);
    await entrarComo(api, 'joao.lima');
    expect(await api.pessoas.funcionario(lista[0]!.pessoaId)).toMatchObject({ pessoaId: lista[0]!.pessoaId, escala: expect.any(Object) });
  });
});

describe('mock: listagens paginadas com os filtros da API real', () => {
  it('eventos por cursor (seq decrescente, sem repetir), pessoaId e excluirTipos; correções do evento', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    const todos = await api.eventos.listar();
    const vistos: string[] = [];
    let cursor: string | null = null;
    do {
      const p = await api.eventos.listarPagina({ limite: 4, cursor });
      vistos.push(...p.itens.map((e) => e.id));
      cursor = p.cursor;
    } while (cursor);
    expect(vistos).toEqual(todos.map((e) => e.id));
    const semSaida = await api.eventos.listarPagina({ excluirTipos: ['saida'], limite: 100 });
    expect(semSaida.itens.some((e) => e.tipo === 'saida')).toBe(false);
    const daAna = await api.eventos.listarPagina({ pessoaId: id.ana, limite: 100 });
    expect(daAna.itens.every((e) => e.pessoaId === id.ana)).toBe(true);
    const corrigido = todos.find((e) => e.correcao);
    if (corrigido) expect((await api.eventos.correcoesDe(corrigido.id)).map((c) => c.corrigeEventoId)).toContain(corrigido.id);
  });

  it('trilha de alterações por cursor e por ação', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    await api.unidades.desativar(un('T1-11'));
    await api.unidades.reativar(un('T1-11'));
    const p = await api.auditoria.alteracoesPagina({ acao: 'unidade.reativar', limite: 1 });
    expect(p.itens).toHaveLength(1);
    expect(p.itens[0]!.acao).toBe('unidade.reativar');
    const tudo = await api.auditoria.alteracoesPagina({ limite: 2 });
    expect(tudo.temMais).toBe(true);
    const seguinte = await api.auditoria.alteracoesPagina({ limite: 2, cursor: tudo.cursor });
    expect(seguinte.itens[0]!.seq).toBeLessThan(tudo.itens[1]!.seq);
  });
});
