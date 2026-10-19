// Testes dos itens 1 a 13 da rodada de correções (cada um falharia antes da mudança).
import { describe, expect, it } from 'vitest';
import { entrarComo, esperaErro, id, novaApi, un } from './helpers';
import { brt, relogio } from '@portaria/domain/time';
import { CAMPOS_CANONICOS_V1, verificarCadeiaEventos } from '@portaria/domain/hashChain';
import { CHAVE_HMAC_DEMO, documentoBuscaCpf } from '@portaria/domain/cpf';
import type { EventoAcesso } from '@portaria/domain/types';
import * as rbac from '@portaria/domain/rbac';
import { garantirNegado } from '../features/portaria/negado';

const CPF_OK = '529.982.247-25'; // CPF válido de exemplo
const CPF_OK_2 = '111.444.777-35'; // outro CPF válido
const HOJE = brt(2026, 10, 9);
const nova = (extra: Record<string, unknown> = {}) => ({ nome: 'Fulano de Tal', documento: CPF_OK, telefone: '(11) 91234-5678', categoria: 'visitante' as const, ...extra });
const prevBase = { unidadeId: un('D-32'), pessoaId: id.marcos, validaAte: HOJE, diasSemana: null, horaInicio: null, horaFim: null };

describe('item 1: autorização prévia sem solicitante', () => {
  it('solicitante informado precisa ter vínculo válido na unidade', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    // Marcos é visitante; Rodrigo só tem vínculo pendente; Ana é moradora válida da D-32
    expect((await esperaErro(api.autorizacoes.criar({ ...prevBase, solicitadaPorPessoaId: id.marcia }))).code).toBe('SOLICITANTE_SEM_VINCULO');
    expect((await esperaErro(api.autorizacoes.criar({ ...prevBase, solicitadaPorPessoaId: id.rodrigo }))).code).toBe('SOLICITANTE_SEM_VINCULO');
    expect((await esperaErro(api.autorizacoes.criar({ ...prevBase, solicitadaPorPessoaId: 'pe-inexistente' }))).code).toBe('SOLICITANTE_SEM_VINCULO');
    expect((await api.autorizacoes.criar({ ...prevBase, solicitadaPorPessoaId: id.ana })).semSolicitante).toBe(false);
  });

  it('sem solicitante só com justificativa válida; grava semSolicitante, justificativa e quem cadastrou', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const base = { ...prevBase, solicitadaPorPessoaId: null };
    expect((await esperaErro(api.autorizacoes.criar(base))).code).toBe('SOLICITANTE_OU_JUSTIFICATIVA');
    expect((await esperaErro(api.autorizacoes.criar({ ...base, justificativa: 'curta' }))).code).toBe('SOLICITANTE_OU_JUSTIFICATIVA');
    const a = await api.autorizacoes.criar({ ...base, justificativa: 'Morador viajou e avisou a administração por telefone.' });
    expect(a.semSolicitante).toBe(true);
    expect(a.justificativa).toBe('Morador viajou e avisou a administração por telefone.');
    expect(a.cadastradaPorId).toBe('u4');
    expect(a.solicitadaPorPessoaId).toBeNull(); // nunca mais "(não informado)"
    expect((await api.autorizacoes.vigentes(id.marcos, un('D-32'))).find((x) => x.id === a.id)?.cadastradaPorNome).toContain('Paula Nogueira');
    expect(JSON.stringify(a)).not.toContain('não informado');
  });

  it('a entrada usa o texto "Sem solicitante" e conta como exceção de quem cadastrou a autorização', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    const antes = await api.relatorios.resumo(30);
    await entrarComo(api, 'paula.nogueira');
    const a = await api.autorizacoes.criar({ ...prevBase, pessoaId: id.marcia, solicitadaPorPessoaId: null, justificativa: 'Pedido feito direto na administração.' });
    await entrarComo(api, 'joao.lima');
    const ev = await api.eventos.criar({ pessoaId: id.marcia, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'autorizacao_previa', autorizacaoPreviaId: a.id });
    expect(ev.autorizadoPorNome).toBe('Sem solicitante — cadastrada por Paula Nogueira');
    expect(ev.autorizadoPorPessoaId).toBeNull();
    expect(ev.autorizacaoSemSolicitante).toBe(true);
    await entrarComo(api, 'luiza.campos');
    const dep = await api.relatorios.resumo(30);
    expect(dep.totais.excecoes).toBe(antes.totais.excecoes + 1);
    const paula = dep.excecoesPorPorteiro.find((e) => e.operadorId === 'u4');
    expect(paula?.operador).toBe('Paula Nogueira');
    expect(paula?.total).toBe(1);
    expect(dep.excecoesPorPorteiro.find((e) => e.operadorId === 'u1')?.total).toBe(antes.excecoesPorPorteiro.find((e) => e.operadorId === 'u1')?.total);
    expect((await api.eventos.listar({ somenteExcecoes: true })).some((e) => e.id === ev.id)).toBe(true);
  });
});

describe('item 2: cadastro só com CPF', () => {
  it('nome, CPF válido e telefone são obrigatórios; guarda máscara e hash, nunca o CPF', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.pessoas.criar(nova({ nome: ' ' })))).code).toBe('NOME_OBRIGATORIO');
    expect((await esperaErro(api.pessoas.criar(nova({ documento: '123.456.789-00' })))).code).toBe('CPF_INVALIDO');
    expect((await esperaErro(api.pessoas.criar(nova({ documento: '' })))).code).toBe('DOCUMENTO_OBRIGATORIO');
    expect((await esperaErro(api.pessoas.criar(nova({ telefone: '1234' })))).code).toBe('TELEFONE_INVALIDO');
    expect((await esperaErro(api.pessoas.criar(nova({ telefone: undefined })))).code).toBe('TELEFONE_INVALIDO');
    const p = await api.pessoas.criar(nova());
    expect(p.documentoTipo).toBe('cpf');
    expect(p.documentoMascarado).toBe('***.982.247-**');
    expect(p.documentoBusca).toBe(await documentoBuscaCpf('52998224725', CHAVE_HMAC_DEMO)); // HMAC, não SHA puro
    expect(JSON.stringify(p)).not.toContain('52998224725');
  });

  it('duplicidade (409) é por CPF, mesmo com nome e formatação diferentes', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    await api.pessoas.criar(nova());
    const e = await esperaErro(api.pessoas.criar(nova({ nome: 'Outro Nome', documento: '52998224725' })));
    expect(e.status).toBe(409);
    expect(e.code).toBe('PESSOA_DUPLICADA');
    await api.pessoas.criar(nova({ nome: 'Fulano de Tal', documento: CPF_OK_2 })); // mesmo nome, outro CPF: ok
  });

  it('"sem CPF": exige nome e telefone, e a pessoa só entra por exceção do porteiro', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.pessoas.criar(nova({ semCpf: true, documento: undefined, telefone: '' })))).code).toBe('TELEFONE_INVALIDO');
    const p = await api.pessoas.criar(nova({ semCpf: true, documento: undefined }));
    expect(p.semCpf).toBe(true);
    expect(p.documentoMascarado).toBe('(sem CPF)');
    expect(p.documentoBusca).toBeUndefined();
    const dados = { pessoaId: p.id, unidadeDestinoId: un('D-32') };
    expect((await esperaErro(api.eventos.criar({ ...dados, autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana }))).code).toBe('SEM_CPF_SO_EXCECAO');
    expect((await esperaErro(api.eventos.criar({ ...dados, autorizadoPorTipo: 'morador_presente', autorizadoPorPessoaId: id.ana }))).code).toBe('SEM_CPF_SO_EXCECAO');
    const ev = await api.eventos.criar({ ...dados, autorizadoPorTipo: 'excecao_porteiro', justificativa: 'Pessoa sem CPF, morador confirmou depois.' });
    expect(ev.autorizadoPorTipo).toBe('excecao_porteiro');
  });

  it('vínculo não tem anexo de comprovante, nasce pendente, sem conferência, e não vira morador', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const v = await api.vinculos.criar({ pessoaId: id.marcos, unidadeId: un('D-32'), tipo: 'dependente', vigenciaInicio: HOJE, vigenciaFim: null, solicitadoPor: '' });
    expect(v.status).toBe('pendente');
    expect(v.conferencia).toBeNull();
    expect('documento' in v).toBe(false);
  });

  describe('conferência do comprovante (RF-05, RN-02)', () => {
    const pendente = async () => {
      const api = novaApi();
      await entrarComo(api, 'paula.nogueira');
      const p = await api.pessoas.criar(nova({ nome: 'Conferida Silva', documento: CPF_OK_2 }));
      const v = await api.vinculos.criar({ pessoaId: p.id, unidadeId: un('D-32'), tipo: 'inquilino', vigenciaInicio: HOJE, vigenciaFim: brt(2027, 10, 9), solicitadoPor: '' });
      return { api, v };
    };
    it('aprovar sem conferência registrada falha (422 CONFERENCIA_OBRIGATORIA)', async () => {
      const { api, v } = await pendente();
      const e = await esperaErro(api.vinculos.decidir({ id: v.id, decisao: 'aprovar' }));
      expect([e.status, e.code]).toEqual([422, 'CONFERENCIA_OBRIGATORIA']);
      // os pendentes do seed também não têm conferência
      expect((await esperaErro(api.vinculos.decidir({ id: 'V4', decisao: 'aprovar' }))).code).toBe('CONFERENCIA_OBRIGATORIA');
    });
    it('registra tipo, data e quem conferiu (sem arquivo); depois aprova; entra na trilha', async () => {
      const { api, v } = await pendente();
      const c = await api.vinculos.registrarConferencia(v.id, { tipo: 'contrato_locacao', observacao: 'Recebido por e-mail em 08/10/2026.' });
      expect(c.conferencia).toEqual({ tipoDocumento: 'contrato_locacao', data: brt(2026, 10, 9), conferidoPorId: 'u4', observacao: 'Recebido por e-mail em 08/10/2026.' });
      const vw = (await api.vinculos.listar({ status: 'pendente' })).find((x) => x.id === v.id)!;
      expect(vw.conferidoPorNome).toBe('Paula Nogueira');
      expect((await api.vinculos.decidir({ id: v.id, decisao: 'aprovar' })).status).toBe('aprovado');
      // aprovado: conferência congelada (trigger vinculo_unidade_transicao no banco)
      expect((await esperaErro(api.vinculos.registrarConferencia(v.id, { tipo: 'escritura' }))).code).toBe('CONFERENCIA_IMUTAVEL');
      await entrarComo(api, 'luiza.campos');
      const reg = (await api.auditoria.alteracoes({ acao: 'vinculo.conferir' })).find((r) => r.registroId === v.id)!;
      expect(reg.antes).toMatchObject({ conferencia: null });
      expect(reg.depois).toMatchObject({ conferencia: { tipoDocumento: 'contrato_locacao', conferidoPorId: 'u4' } });
    });
    it('valida tipo, descrição de "outro", dado pessoal e data futura', async () => {
      const { api, v } = await pendente();
      const code = async (i: Parameters<typeof api.vinculos.registrarConferencia>[1]) => (await esperaErro(api.vinculos.registrarConferencia(v.id, i))).code;
      expect(await code({ tipo: 'outro' })).toBe('DESCRICAO_OBRIGATORIA');
      expect(await code({ tipo: 'escritura', observacao: 'CPF 529.982.247-25' })).toBe('DADO_PESSOAL_NA_CONFERENCIA');
      expect(await code({ tipo: 'escritura', data: brt(2026, 10, 10) })).toBe('DATA_FUTURA');
      const ok = await api.vinculos.registrarConferencia(v.id, { tipo: 'outro', descricao: 'Formal de partilha' });
      expect(ok.conferencia).toMatchObject({ tipoDocumento: 'outro', descricao: 'Formal de partilha' });
    });
    it('porteiro não registra conferência (403); síndico registra', async () => {
      const { api, v } = await pendente();
      await entrarComo(api, 'joao.lima');
      expect((await esperaErro(api.vinculos.registrarConferencia(v.id, { tipo: 'escritura' }))).status).toBe(403);
      await entrarComo(api, 'roberto.faria'); // síndico
      expect((await api.vinculos.registrarConferencia(v.id, { tipo: 'escritura' })).conferencia?.tipoDocumento).toBe('escritura');
    });
    it('seed: todo vínculo aprovado tem conferência; nenhum vínculo guarda documento', async () => {
      const { api } = await pendente();
      const todos = await api.vinculos.listar();
      expect(todos.filter((v) => v.status === 'aprovado').every((v) => v.conferencia !== null)).toBe(true);
      expect(todos.some((v) => 'documento' in v || 'conferencias' in v)).toBe(false);
    });
  });

  it('aprovar exige cadastro completo (CPF válido e telefone); ao aprovar a categoria vira morador', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const semCpf = await api.pessoas.criar(nova({ semCpf: true, documento: undefined }));
    const v1 = await api.vinculos.criar({ pessoaId: semCpf.id, unidadeId: un('D-32'), tipo: 'dependente', vigenciaInicio: HOJE, vigenciaFim: null, solicitadoPor: '' });
    const e = await esperaErro(api.vinculos.decidir({ id: v1.id, decisao: 'aprovar' }));
    expect(e.status).toBe(422);
    expect(e.code).toBe('CADASTRO_INCOMPLETO');
    expect((await api.vinculos.listar({ status: 'pendente' })).find((v) => v.id === v1.id)?.pessoaCadastroCompleto).toBe(false);
    // rejeitar continua possível
    expect((await api.vinculos.decidir({ id: v1.id, decisao: 'rejeitar', justificativa: 'Cadastro incompleto.' })).status).toBe('rejeitado');
    const completa = await api.pessoas.criar(nova({ nome: 'Beltrano Completo', documento: CPF_OK_2 }));
    const v2 = await api.vinculos.criar({ pessoaId: completa.id, unidadeId: un('D-32'), tipo: 'dependente', vigenciaInicio: HOJE, vigenciaFim: null, solicitadoPor: '' });
    expect((await api.pessoas.ficha(completa.id)).pessoa.categoria).toBe('visitante');
    await api.vinculos.registrarConferencia(v2.id, { tipo: 'outro', descricao: 'Certidão de nascimento' });
    expect((await api.vinculos.decidir({ id: v2.id, decisao: 'aprovar' })).status).toBe('aprovado');
    expect((await api.pessoas.ficha(completa.id)).pessoa.categoria).toBe('morador');
  });

  it('seed: todas as pessoas têm CPF válido (máscara + hash) e telefone', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const todas = await api.pessoas.listar();
    expect(todas.length).toBeGreaterThan(100);
    for (const p of todas) {
      expect(p.documentoMascarado).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
      expect(p.documentoBusca).toMatch(/^[0-9a-f]{64}$/);
      expect((p.telefone ?? '').replace(/\D/g, '').length).toBeGreaterThanOrEqual(10);
      expect(p.documentoTipo).toBe('cpf');
    }
    expect(new Set(todas.map((p) => p.documentoBusca)).size).toBe(todas.length);
  });
});

describe('item 3: pedir vínculo não muda categoria', () => {
  it('busca da portaria exclui só quem tem vínculo VÁLIDO, não por categoria', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    expect((await api.pessoas.buscar('Ana Ribeiro', { semMoradores: true })).some((p) => p.id === id.ana)).toBe(false);
    expect((await api.pessoas.buscar('Ana Ribeiro')).some((p) => p.id === id.ana)).toBe(true);
    // Rodrigo só tem pedido pendente; Hélio Prates tem vínculo encerrado (categoria gravada: morador)
    expect((await api.pessoas.buscar('Rodrigo Alves', { semMoradores: true })).some((p) => p.id === id.rodrigo)).toBe(true);
    expect((await api.pessoas.buscar('Hélio Prates', { semMoradores: true })).some((p) => p.id === 'pe-helio-prates')).toBe(true);
  });

  it('"morador" sem vínculo válido não leva 422: vira visitante e exige autorizador (RN-01)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const helio = (await api.pessoas.ficha('pe-helio-prates')).pessoa;
    expect(helio.categoria).toBe('morador');
    const dados = { pessoaId: helio.id, unidadeDestinoId: un('D-32') };
    expect((await esperaErro(api.eventos.criar(dados))).code).toBe('AUTORIZADO_POR_OBRIGATORIO');
    const ev = await api.eventos.criar({ ...dados, autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana });
    expect(ev.categoriaPessoa).toBe('visitante');
    // morador com vínculo válido segue entrando como morador
    const ana = await api.eventos.criar({ pessoaId: id.ana, unidadeDestinoId: un('D-32') });
    expect(ana.categoriaPessoa).toBe('morador');
  });
});

describe('item 4: funcionário com restrição de condomínio', () => {
  it('restricoes.verificar aceita unidade nula e enxerga restrição de condomínio aprovada', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    expect((await api.restricoes.verificar(id.valter, null)).restrita).toBe(false);
    const r = await api.restricoes.criar({ pessoaId: id.valter, unidadeId: un('D-32'), motivo: 'Desligado', validaAte: brt(2026, 12, 31), solicitadaPorPessoaId: null, paraTodoCondominio: true });
    expect((await api.restricoes.verificar(id.valter, null)).restrita).toBe(false); // pendente de aprovação
    await entrarComo(api, 'roberto.faria');
    await api.restricoes.aprovar(r.id);
    const v = await api.restricoes.verificar(id.valter, null);
    expect(v.restrita).toBe(true);
    expect(v.alertas[0].motivo).toBe('Desligado');
    // restrição só de unidade não vale sem unidade de destino
    const api2 = novaApi();
    await entrarComo(api2, 'joao.lima');
    expect((await api2.restricoes.verificar(id.bruno, null)).restrita).toBe(false);
    expect((await api2.restricoes.verificar(id.bruno, un('D-32'))).restrita).toBe(true);
  });
});

describe('item 5: recusa do morador (UC02 A4)', () => {
  it('grava evento "recusado" encadeado, sem entrada, com o morador que recusou', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const ev = await api.eventos.registrarRecusa({ pessoaId: id.marcos, unidadeDestinoId: un('D-32'), meio: 'interfone', moradorPessoaId: id.ana, observacao: 'Não quer receber.' });
    expect(ev.tipo).toBe('recusado');
    expect(ev.autorizadoPorTipo).toBe('interfone');
    expect(ev.autorizadoPorPessoaId).toBe(id.ana);
    expect(ev.autorizadoPorNome).toBe('Ana Ribeiro');
    expect(ev.dentro).toBe(false);
    expect((await api.eventos.presentes()).some((e) => e.pessoaId === id.marcos && e.id === ev.id)).toBe(false);
    expect((await api.eventos.listar({ tipo: 'recusado' })).map((e) => e.id)).toContain(ev.id);
    // continua podendo entrar depois (não ficou "dentro")
    expect((await api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana })).tipo).toBe('entrada');
    await entrarComo(api, 'luiza.campos');
    expect((await api.auditoria.verificarIntegridade()).valido).toBe(true);
    expect((await api.relatorios.resumo(30)).totais.recusados).toBe(1);
  });

  it('exige morador com vínculo válido na unidade e meio interfone/morador presente', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const base = { pessoaId: id.marcos, unidadeDestinoId: un('D-32'), meio: 'interfone' as const, moradorPessoaId: id.ana };
    expect((await esperaErro(api.eventos.registrarRecusa({ ...base, moradorPessoaId: id.rodrigo }))).code).toBe('AUTORIZADOR_SEM_VINCULO');
    expect((await esperaErro(api.eventos.registrarRecusa({ ...base, moradorPessoaId: id.carla }))).code).toBe('AUTORIZADOR_SEM_VINCULO'); // vínculo em outra unidade
    expect((await esperaErro(api.eventos.registrarRecusa({ ...base, meio: 'excecao_porteiro' as never }))).code).toBe('MEIO_INVALIDO_PARA_TIPO');
    await entrarComo(api, 'luiza.campos');
    expect((await esperaErro(api.eventos.registrarRecusa(base))).status).toBe(403);
  });
});

describe('item 6: hora do manifesto da exportação', () => {
  it('geradoEm usa o horário de São Paulo (-03:00), não +3h', async () => {
    const api = novaApi(); // relógio congelado em 09/10/2026 14:32 (SP)
    await entrarComo(api, 'luiza.campos');
    const pacote = await api.auditoria.exportar();
    const manifesto = JSON.parse(pacote.conteudo.split('\n')[0]);
    expect(manifesto.geradoEm).toMatch(/^2026-10-09T14:32:00\.000-03:00/);
    expect(pacote.nomeArquivo).toContain('20261009-1432');
  });
});

describe('item 7: negado gravado uma vez só', () => {
  it('o modal não grava de novo quando o servidor já gravou o negado', async () => {
    let gravacoes = 0;
    const gravar = async () => { gravacoes++; return { eventoId: 'novo', codigo: 'EV-novo' }; };
    // restrição veio no 422 da confirmação: usa o que o servidor informou
    expect(await garantirNegado({ eventoId: 'ev-1', codigo: 'EV-1' }, gravar)).toEqual({ eventoId: 'ev-1', codigo: 'EV-1' });
    expect(gravacoes).toBe(0);
    // restrição detectada antes, sem negado gravado: grava uma única vez
    expect(await garantirNegado(null, gravar)).toEqual({ eventoId: 'novo', codigo: 'EV-novo' });
    expect(gravacoes).toBe(1);
  });

  it('contrato do servidor: cada eventos.criar bloqueado grava um negado (por isso a tela não pode repetir)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const entrada = { pessoaId: id.bruno, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone' as const, autorizadoPorPessoaId: id.ana };
    const e1 = await esperaErro(api.eventos.criar(entrada));
    const detalhes = e1.detalhes as { eventoId: string; codigo: string };
    expect(detalhes.eventoId).toBeTruthy();
    expect((await api.eventos.obter(detalhes.eventoId)).tipo).toBe('negado');
    const antes = (await api.eventos.listar({ tipo: 'negado' })).length;
    await esperaErro(api.eventos.criar(entrada));
    expect((await api.eventos.listar({ tipo: 'negado' })).length).toBe(antes + 1);
  });
});

describe('item 8: importação e busca', () => {
  const linha = (extra: Partial<{ linha: number; bloco: string; unidade: string; nome: string; documento: string; telefone: string; tipo: string }>) =>
    ({ linha: 2, bloco: 'A', unidade: '11', nome: 'Novo Morador', documento: '', telefone: '(11) 90000-0000', tipo: 'proprietário', ...extra });

  it('deduplica por CPF: pessoa com o mesmo CPF não é duplicada, mesmo com nome diferente', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const criada = await api.pessoas.criar(nova({ categoria: 'visitante' }));
    const antes = (await api.pessoas.listar()).length;
    const rel = await api.importacao.analisar({ arquivo: 'a.csv', linhas: [linha({ nome: 'Nome Diferente', documento: CPF_OK })] });
    const res = await api.importacao.confirmar(rel.id);
    expect(res.importados).toBe(1);
    expect((await api.pessoas.listar()).length).toBe(antes); // nenhuma pessoa nova
    expect((await api.pessoas.ficha(criada.id)).vinculos.some((v) => v.unidadeId === un('A-11') && v.status === 'legado')).toBe(true);
    // repetir a importação: já tem vínculo, reaproveita
    const rel2 = await api.importacao.analisar({ arquivo: 'a.csv', linhas: [linha({ nome: 'Nome Diferente', documento: CPF_OK })] });
    expect(rel2.inconsistencias.some((i) => i.codigo === 'DUPLICIDADE_BANCO')).toBe(true);
    expect((await api.importacao.confirmar(rel2.id)).reaproveitados).toBe(1);
  });

  it('nunca casa só por nome globalmente: sem CPF só reaproveita o mesmo nome na MESMA unidade', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const anas = async () => (await api.pessoas.listar()).filter((p) => p.nome === 'Ana Ribeiro').length;
    expect(await anas()).toBe(1);
    // outra unidade: pessoa nova (homônimo)
    const rel = await api.importacao.analisar({ arquivo: 'b.csv', linhas: [linha({ nome: 'Ana Ribeiro', unidade: '11' })] });
    expect(rel.inconsistencias.some((i) => i.codigo === 'DOC_AUSENTE' && i.tipo === 'aviso')).toBe(true);
    const res = await api.importacao.confirmar(rel.id);
    expect(res).toMatchObject({ importados: 1, reaproveitados: 0 });
    expect(await anas()).toBe(2);
    const nova_ = (await api.pessoas.listar()).filter((p) => p.nome === 'Ana Ribeiro' && p.unidadesVinculadas.includes(un('A-11')));
    expect(nova_).toHaveLength(1);
    expect(nova_[0].documentoMascarado).toBe('(sem CPF)');
    expect(nova_[0].semCpf).toBe(true);
    // mesma unidade (D-32): reaproveita
    const rel2 = await api.importacao.analisar({ arquivo: 'c.csv', linhas: [linha({ nome: 'Ana Ribeiro', bloco: 'D', unidade: '32' })] });
    expect(await api.importacao.confirmar(rel2.id)).toMatchObject({ importados: 0, reaproveitados: 1 });
    expect(await anas()).toBe(2);
  });

  it('CPF inválido vira aviso e o número não é gravado', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const rel = await api.importacao.analisar({ arquivo: 'd.csv', linhas: [linha({ nome: 'Cpf Ruim', documento: '123.456.789-00' })] });
    expect(rel.inconsistencias.find((i) => i.codigo === 'DOC_INVALIDO')?.tipo).toBe('aviso');
    await api.importacao.confirmar(rel.id);
    const p = (await api.pessoas.listar()).find((x) => x.nome === 'Cpf Ruim')!;
    expect(p.documentoMascarado).toBe('(sem CPF)');
    expect(p.documentoBusca).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain('12345678900');
  });

  it('busca por CPF completo é exata (hash); parcial vale nos dígitos visíveis', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const p = await api.pessoas.criar(nova());
    const exato = await api.pessoas.buscar('529.982.247-25');
    expect(exato.map((x) => x.id)).toEqual([p.id]);
    expect((await api.busca.global('52998224725')).pessoas.map((x) => x.id)).toEqual([p.id]);
    expect((await api.pessoas.buscar('11144477735')).length).toBe(0); // CPF válido que ninguém tem
    expect((await api.pessoas.buscar('982247')).some((x) => x.id === p.id)).toBe(true); // parcial
    expect((await api.pessoas.buscar('52998224700')).some((x) => x.id === p.id)).toBe(false); // 11 dígitos diferentes: sem match parcial
  });

  it('busca por placa traz só pessoas com vínculo VÁLIDO na unidade do veículo', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    // BRA-2E19 é da I-13: Marta (aprovada) sim; Rodrigo (pendente) não
    const r = (await api.pessoas.buscar('BRA-2E19')).map((p) => p.id);
    expect(r).toContain('pe-marta-siqueira');
    expect(r).not.toContain(id.rodrigo);
    const g = (await api.busca.global('BRA-2E19')).pessoas.map((p) => p.id);
    expect(g).not.toContain(id.rodrigo);
  });
});

describe('item 9: restrições vencidas no detalhe da unidade', () => {
  it('não lista restrição cuja validade já passou', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const r = await api.restricoes.criar({ pessoaId: id.marcos, unidadeId: un('D-32'), motivo: 'Teste vencida', validaAte: HOJE, solicitadaPorPessoaId: id.ana });
    expect((await api.unidades.detalhe(un('D-32'))).restricoes!.some((x) => x.id === r.id)).toBe(true);
    relogio.congelar(brt(2026, 10, 11, 10, 0));
    const d = await api.unidades.detalhe(un('D-32'));
    expect(d.restricoes!.some((x) => x.id === r.id)).toBe(false);
    expect(d.restricoes!.some((x) => x.id === 'rs-bruno')).toBe(true); // a vigente continua
  });
});

describe('item 10: trilha de alterações', () => {
  it('pessoa.criar grava quem, quando, antes/depois e mascara CPF e telefone', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const p = await api.pessoas.criar(nova());
    await entrarComo(api, 'luiza.campos');
    const reg = (await api.auditoria.alteracoes({ acao: 'pessoa.criar' }))[0];
    expect(reg).toMatchObject({ usuarioId: 'u1', usuarioNome: 'João Lima', usuarioPapel: 'porteiro', entidade: 'pessoa', registroId: p.id, antes: null, em: relogio.agora() });
    expect(reg.seq).toBeGreaterThan(0);
    const texto = JSON.stringify(reg);
    expect(reg.depois).toMatchObject({ nome: 'Fulano de Tal', documentoMascarado: '***.982.247-**', telefone: '(**) *****-5678' });
    expect(texto).not.toContain('91234-5678');
    expect(texto).not.toContain('52998224725');
    expect(texto).not.toContain('529.982.247-25');
    expect(texto).not.toContain('documentoBusca');
  });

  it('permissão auditoria.verificar: porteiro 403; auditor, síndico e administração leem', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.auditoria.alteracoes())).status).toBe(403);
    for (const p of ['luiza.campos', 'roberto.faria', 'paula.nogueira'] as const) {
      await entrarComo(api, p);
      expect(Array.isArray(await api.auditoria.alteracoes())).toBe(true);
    }
  });

  it('toda escrita deixa registro (todas as ações da lista)', async () => {
    const api = novaApi();
    // login com falha: login informado, sem senha
    await esperaErro(api.auth.login({ login: 'joao.lima', senha: '' }));
    await esperaErro(api.auth.login({ login: 'fantasma', senha: 'minha-senha-secreta' }));
    await entrarComo(api, 'paula.nogueira');
    const pe = await api.pessoas.criar(nova({ nome: 'Auditada Silva', documento: CPF_OK_2 }));
    await api.veiculos.criar({ unidadeId: un('D-32'), placa: 'ZZZ-9Z99', modelo: 'Teste', cor: 'azul' });
    const v = await api.vinculos.criar({ pessoaId: pe.id, unidadeId: un('D-32'), tipo: 'dependente', vigenciaInicio: HOJE, vigenciaFim: null, solicitadoPor: '' });
    await api.vinculos.registrarConferencia(v.id, { tipo: 'outro', descricao: 'Certidão de nascimento' });
    await api.vinculos.decidir({ id: v.id, decisao: 'aprovar' });
    const ap = await api.autorizacoes.criar({ ...prevBase, solicitadaPorPessoaId: id.ana });
    await api.autorizacoes.revogar(ap.id);
    const rs = await api.restricoes.criar({ pessoaId: id.marcos, unidadeId: un('D-32'), motivo: 'm', validaAte: brt(2026, 12, 31), solicitadaPorPessoaId: id.ana, paraTodoCondominio: true });
    await entrarComo(api, 'roberto.faria');
    await api.restricoes.aprovar(rs.id);
    await api.restricoes.revogar(rs.id);
    const enc = await api.encomendas.receber({ unidadeId: un('G-11'), destinatario: 'Carla Mendes', transportadora: 'X', codigoRastreio: '1', unidadeConfirmada: true });
    await api.encomendas.entregar({ id: enc.id, pessoaId: id.carla });
    const oc = await api.ocorrencias.criar({ tipo: 'outro', descricao: 'Teste', unidadeId: null, envolvidos: '' });
    await api.ocorrencias.alterarStatus(oc.id, 'em_andamento');
    const { usuario: u } = await api.usuarios.criar({ nome: 'Novo Porteiro', login: 'novo.porteiro', papel: 'porteiro' });
    await api.usuarios.desativar(u.id);
    await api.usuarios.reativar(u.id);
    await api.usuarios.redefinirAcesso(u.id);
    const rel = await api.importacao.analisar({ arquivo: 'x.csv', linhas: [{ linha: 2, bloco: 'A', unidade: '11', nome: 'Importada Nova', documento: '', telefone: '', tipo: '' }] });
    await api.importacao.confirmar(rel.id);
    await api.auth.logout();
    await entrarComo(api, 'luiza.campos');
    const log = await api.auditoria.alteracoes();
    const acoes = new Set(log.map((r) => r.acao));
    for (const a of [
      'auth.login', 'auth.login_falha', 'auth.logout', 'pessoa.criar', 'veiculo.criar', 'vinculo.criar', 'vinculo.conferir', 'vinculo.decidir',
      'autorizacao.criar', 'autorizacao.revogar', 'restricao.criar', 'restricao.aprovar', 'restricao.revogar',
      'encomenda.receber', 'encomenda.entregar', 'ocorrencia.criar', 'ocorrencia.alterarStatus',
      'usuario.criar', 'usuario.desativar', 'usuario.reativar', 'usuario.redefinirAcesso', 'importacao.confirmar',
    ]) expect(acoes, a).toContain(a);
    // append-only e em ordem: seq estritamente crescente (a lista vem do mais recente para o mais antigo)
    const seqs = log.map((r) => r.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(new Set(seqs).size).toBe(seqs.length);
    // falha de login: login informado e nunca a senha
    const falhas = log.filter((r) => r.acao === 'auth.login_falha');
    expect(falhas.map((f) => (f.depois as { login: string }).login).sort()).toEqual(['fantasma', 'joao.lima']); // login informado
    expect(falhas.find((f) => f.usuarioId === null)?.usuarioNome).toBe('fantasma'); // usuário inexistente: o próprio login informado
    expect(JSON.stringify(falhas)).not.toContain('minha-senha-secreta');
    expect(falhas.find((f) => (f.depois as { login: string }).login === 'joao.lima')?.usuarioId).toBe('u1');
    // importação: um registro só, com contagens
    const imp = log.filter((r) => r.acao === 'importacao.confirmar');
    expect(imp).toHaveLength(1);
    expect(imp[0].depois).toMatchObject({ importados: 1, reaproveitados: 0, lidas: 1 });
    // decisão do vínculo guarda antes e depois
    const dec = log.find((r) => r.acao === 'vinculo.decidir')!;
    expect(dec.antes).toMatchObject({ status: 'pendente' });
    expect(dec.depois).toMatchObject({ status: 'aprovado', decididoPorId: 'u4' }); // id, não nome copiado
  });

  it('revogar já revogado dá 409 e não sobrescreve a data; guarda quem revogou', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const ap = await api.autorizacoes.criar({ ...prevBase, solicitadaPorPessoaId: id.ana });
    relogio.congelar(brt(2026, 10, 9, 15, 0));
    await api.autorizacoes.revogar(ap.id);
    relogio.congelar(brt(2026, 10, 9, 16, 0));
    const e = await esperaErro(api.autorizacoes.revogar(ap.id));
    expect(e.status).toBe(409);
    const det = await api.unidades.detalhe(un('D-32'));
    expect(det.autorizacoes!.some((a) => a.id === ap.id)).toBe(false); // revogada some das ativas
    const todas = await api.autorizacoes.hoje();
    expect(todas.some((a) => a.id === ap.id)).toBe(false);
    await entrarComo(api, 'luiza.campos');
    const reg = (await api.auditoria.alteracoes({ acao: 'autorizacao.revogar' }));
    expect(reg).toHaveLength(1);
    expect(reg[0].depois).toMatchObject({ revogadaEm: brt(2026, 10, 9, 15, 0), revogadaPorId: 'u4' });

    await entrarComo(api, 'paula.nogueira');
    const r = await api.restricoes.criar({ pessoaId: id.marcos, unidadeId: un('D-32'), motivo: 'm', validaAte: brt(2026, 12, 31), solicitadaPorPessoaId: id.ana });
    await api.restricoes.revogar(r.id);
    expect((await esperaErro(api.restricoes.revogar(r.id))).status).toBe(409);
  });

  it('ocorrência: só aberta, em andamento, encerrada; encerrada é final; porteiro só a que abriu; guarda quem/quando', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const oc = await api.ocorrencias.criar({ tipo: 'outro', descricao: 'Portão com defeito', unidadeId: null, envolvidos: '' });
    expect(oc.abertaPorId).toBe('u1');
    expect((await esperaErro(api.ocorrencias.alterarStatus(oc.id, 'encerrada'))).code).toBe('TRANSICAO_INVALIDA'); // pula etapa
    expect((await esperaErro(api.ocorrencias.alterarStatus(oc.id, 'aberta'))).code).toBe('TRANSICAO_INVALIDA');
    await entrarComo(api, 'sergio.matos');
    expect((await esperaErro(api.ocorrencias.alterarStatus(oc.id, 'em_andamento'))).status).toBe(403); // de outro porteiro
    await entrarComo(api, 'joao.lima');
    relogio.congelar(brt(2026, 10, 9, 15, 0));
    expect((await api.ocorrencias.alterarStatus(oc.id, 'em_andamento')).status).toBe('em_andamento');
    expect((await esperaErro(api.ocorrencias.alterarStatus(oc.id, 'aberta'))).code).toBe('TRANSICAO_INVALIDA'); // não volta
    relogio.congelar(brt(2026, 10, 9, 16, 0));
    const fim = await api.ocorrencias.alterarStatus(oc.id, 'encerrada');
    expect(fim.historicoStatus).toEqual([
      { de: 'aberta', para: 'em_andamento', porId: 'u1', em: brt(2026, 10, 9, 15, 0) },
      { de: 'em_andamento', para: 'encerrada', porId: 'u1', em: brt(2026, 10, 9, 16, 0) },
    ]);
    // o nome vem da view, resolvido pelo id
    expect((await api.ocorrencias.listar()).find((o) => o.id === oc.id)?.historicoStatus.map((h) => h.porNome)).toEqual(['João Lima', 'João Lima']);
    const e = await esperaErro(api.ocorrencias.alterarStatus(oc.id, 'em_andamento'));
    expect(e.status).toBe(409);
    // administração altera ocorrência de qualquer porteiro
    await entrarComo(api, 'paula.nogueira');
    expect((await api.ocorrencias.alterarStatus('OC-2026-047', 'em_andamento')).status).toBe('em_andamento');
  });

  it('evento ganha operadorPapel (no hash) e formularioContingencia/correcaoValores também', async () => {
    expect(CAMPOS_CANONICOS_V1).toEqual(expect.arrayContaining(['operador_papel', 'formulario_contingencia', 'correcao_valores']));
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const ev = await api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana });
    expect(ev.operadorPapel).toBe('administracao');
    const lista = (await api.eventos.listar()).sort((a, b) => a.seq - b.seq) as unknown as EventoAcesso[];
    expect(lista.find((e) => e.id === 'e4818')?.operadorPapel).toBe('porteiro'); // seed
    expect((await verificarCadeiaEventos(lista)).valido).toBe(true);
    const adulterado = lista.map((e) => (e.id === ev.id ? { ...e, operadorPapel: 'sindico' as const } : e));
    expect((await verificarCadeiaEventos(adulterado)).motivo).toBe('hash_divergente');
    const semFormulario = lista.map((e) => (e.id === 'e4810' ? { ...e, formularioContingencia: 'outro' } : e));
    expect((await verificarCadeiaEventos(semFormulario)).primeiroEventoIdInvalido).toBe('e4810');
  });
});

describe('item 11: sem 2FA no MVP', () => {
  it('rbac não exporta mais as regras de segundo fator e o usuário não tem totpAtivo', async () => {
    expect('exige2faNoLogin' in rbac).toBe(false);
    expect('exigeTotpNoCadastro' in rbac).toBe(false);
    const api = novaApi();
    const u = await api.auth.login({ login: 'roberto.faria', senha: 'x' });
    expect('totpAtivo' in u).toBe(false);
    const { usuario: novo } = await api.usuarios.criar({ nome: 'Aud', login: 'aud.novo', papel: 'auditor' });
    expect('totpAtivo' in novo).toBe(false);
  });
});

describe('item 12: retroativo completo', () => {
  it('entrada e recusa retroativas exigem formulário (campo próprio, não a observação)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const real = brt(2026, 10, 9, 12, 0);
    const base = { pessoaId: id.marcos, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone' as const, autorizadoPorPessoaId: id.ana, retroativo: true, ocorridoEm: real };
    expect((await esperaErro(api.eventos.criar(base))).code).toBe('FORMULARIO_OBRIGATORIO');
    expect((await esperaErro(api.eventos.criar({ ...base, formularioContingencia: '   ' }))).code).toBe('FORMULARIO_OBRIGATORIO');
    const ev = await api.eventos.criar({ ...base, formularioContingencia: ' 0042 ', observacao: 'Queda de energia' });
    expect(ev.formularioContingencia).toBe('0042');
    expect(ev.observacao).toBe('Queda de energia');
    const rec = { pessoaId: id.marcia, unidadeDestinoId: un('D-32'), meio: 'interfone' as const, moradorPessoaId: id.ana, retroativo: true, ocorridoEm: real };
    expect((await esperaErro(api.eventos.registrarRecusa(rec))).code).toBe('FORMULARIO_OBRIGATORIO');
    expect((await api.eventos.registrarRecusa({ ...rec, formularioContingencia: '43' })).formularioContingencia).toBe('43');
    // evento comum não carrega formulário
    expect((await api.eventos.criar({ pessoaId: id.marcia, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana, formularioContingencia: '99' })).formularioContingencia).toBeNull();
    await entrarComo(api, 'luiza.campos');
    expect((await api.auditoria.verificarIntegridade()).valido).toBe(true);
  });

  it('saída retroativa: hora real entre a entrada e agora, com formulário', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    // e4814: Cláudia Rocha entrou às 11:02 de hoje (C-03) e segue dentro
    const op = { retroativo: true, formularioContingencia: '77' };
    expect((await esperaErro(api.eventos.registrarSaida('e4814', { ...op, ocorridoEm: brt(2026, 10, 9, 10, 0) }))).code).toBe('DATA_INCONSISTENTE'); // antes da entrada
    expect((await esperaErro(api.eventos.registrarSaida('e4814', { ...op, ocorridoEm: brt(2026, 10, 9, 15, 0) }))).code).toBe('DATA_INCONSISTENTE'); // futuro
    expect((await esperaErro(api.eventos.registrarSaida('e4814', { retroativo: true, ocorridoEm: brt(2026, 10, 9, 12, 0) }))).code).toBe('FORMULARIO_OBRIGATORIO');
    expect((await esperaErro(api.eventos.registrarSaida('e4814', { retroativo: true, formularioContingencia: '77' }))).code).toBe('DATA_INCONSISTENTE'); // sem hora real
    const s = await api.eventos.registrarSaida('e4814', { ...op, ocorridoEm: brt(2026, 10, 9, 12, 0), observacao: 'Saiu na queda' });
    expect(s).toMatchObject({ tipo: 'saida', retroativo: true, formularioContingencia: '77', ocorridoEm: brt(2026, 10, 9, 12, 0), refereEventoId: 'e4814' });
    expect(s.registradoEm).toBeGreaterThan(s.ocorridoEm);
    expect((await api.eventos.obter('e4814')).saida?.em).toBe(brt(2026, 10, 9, 12, 0));
    // saída comum continua sem formulário
    const comum = await api.eventos.registrarSaida('e4815');
    expect(comum.retroativo).toBe(false);
    expect(comum.formularioContingencia).toBeNull();
    await entrarComo(api, 'luiza.campos');
    expect((await api.auditoria.verificarIntegridade()).valido).toBe(true);
  });
});

describe('item 13: correção com valores e relatórios', () => {
  it('correção guarda valores no hash, views usam os efetivos e mostram original + correção', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const orig = await api.eventos.obter('e4814'); // Cláudia, C-03, 11:02 de hoje
    const novoQuando = brt(2026, 10, 8, 11, 5);
    const c = await api.eventos.corrigir('e4814', { justificativa: 'Porteiro digitou unidade e data errados.', valores: { unidadeDestinoId: un('C-04'), ocorridoEm: novoQuando } });
    expect(c.tipo).toBe('correcao');
    expect(c.correcaoValores).toEqual({ unidadeDestinoId: un('C-04'), ocorridoEm: novoQuando });
    expect(c.valoresCorrigidos).toEqual({ unidadeDestinoId: un('C-04'), ocorridoEm: novoQuando });
    const ef = await api.eventos.obter('e4814');
    expect(ef.unidadeDestinoId).toBe(un('C-04'));
    expect(ef.ocorridoEm).toBe(novoQuando);
    expect(ef.valoresOriginais).toEqual({ unidadeDestinoId: un('C-03'), ocorridoEm: orig.ocorridoEm });
    expect(ef.correcao).toMatchObject({ codigo: c.codigo, justificativa: 'Porteiro digitou unidade e data errados.', operadorNome: 'Paula Nogueira' });
    expect(ef.hash).toBe(orig.hash); // o registro original não foi alterado
    // listas, filtros, detalhe da unidade e presentes usam os valores efetivos
    expect((await api.eventos.listar({ unidadeId: un('C-04') })).some((e) => e.id === 'e4814')).toBe(true);
    expect((await api.eventos.listar({ unidadeId: un('C-03') })).some((e) => e.id === 'e4814')).toBe(false);
    expect((await api.unidades.detalhe(un('C-04'))).eventos!.some((e) => e.id === 'e4814')).toBe(true);
    expect((await api.eventos.presentes()).find((e) => e.id === 'e4814')?.unidadeDestinoId).toBe(un('C-04'));
    await entrarComo(api, 'luiza.campos');
    expect((await api.auditoria.verificarIntegridade()).valido).toBe(true);
  });

  it('relatório de acessos por dia usa a data corrigida', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const por = async (dia: number) => (await api.relatorios.resumo(30)).acessosPorDia.find((d) => d.dia === dia)!.entradas;
    const ontem = brt(2026, 10, 8);
    const [h0, o0] = [await por(HOJE), await por(ontem)];
    await api.eventos.corrigir('e4814', { justificativa: 'Data digitada errada na portaria.', valores: { ocorridoEm: brt(2026, 10, 8, 11, 5) } });
    expect(await por(HOJE)).toBe(h0 - 1);
    expect(await por(ontem)).toBe(o0 + 1);
  });

  it('não corrige evento de correção; a última correção acumula as anteriores', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const c1 = await api.eventos.corrigir('e4814', { justificativa: 'Unidade errada no registro.', valores: { unidadeDestinoId: un('C-04') } });
    const e = await esperaErro(api.eventos.corrigir(c1.id, { justificativa: 'Tentando corrigir a correção.', valores: { unidadeDestinoId: un('C-13') } }));
    expect(e.status).toBe(422);
    expect(e.code).toBe('CORRECAO_DE_CORRECAO');
    const c2 = await api.eventos.corrigir('e4814', { justificativa: 'Faltou acertar quem autorizou.', valores: { autorizadoPorPessoaId: id.ana } });
    expect(c2.correcaoValores).toEqual({ unidadeDestinoId: un('C-04'), autorizadoPorPessoaId: id.ana });
    expect(c2.autorizadoPorNomeCorrigido).toBe('Ana Ribeiro');
    const ef = await api.eventos.obter('e4814');
    expect(ef.unidadeDestinoId).toBe(un('C-04')); // não voltou ao original
    expect(ef.autorizadoPorNome).toBe('Ana Ribeiro'); // resolvido pelo id corrigido
    expect(ef.autorizadoPorNomeOriginal).toBe('Mônica Vieira');
    expect(ef.correcao?.codigo).toBe(c2.codigo);
    // só anotação (sem valores) mantém os valores efetivos anteriores
    const c3 = await api.eventos.corrigir('e4814', { justificativa: 'Apenas anotação do síndico.' });
    expect(c3.correcaoValores).toEqual(c2.correcaoValores);
  });

  it('valida os valores da correção (unidade, pessoa, data e autorizador)', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const j = 'Justificativa suficiente para corrigir.';
    expect((await esperaErro(api.eventos.corrigir('e4814', { justificativa: j, valores: { unidadeDestinoId: un('I-99') } }))).code).toBe('UNIDADE_NAO_ENCONTRADA');
    expect((await esperaErro(api.eventos.corrigir('e4814', { justificativa: j, valores: { unidadeDestinoId: null } }))).code).toBe('UNIDADE_OBRIGATORIA');
    expect((await esperaErro(api.eventos.corrigir('e4814', { justificativa: j, valores: { pessoaId: 'nao-existe' } }))).code).toBe('PESSOA_NAO_ENCONTRADA');
    expect((await esperaErro(api.eventos.corrigir('e4814', { justificativa: j, valores: { ocorridoEm: brt(2026, 10, 9, 20, 0) } }))).code).toBe('DATA_INCONSISTENTE');
    expect((await esperaErro(api.eventos.corrigir('e4814', { justificativa: j, valores: { autorizadoPorPessoaId: 'nao-existe' } }))).code).toBe('PESSOA_NAO_ENCONTRADA');
    // interfone exige o morador: não aceita apagar o autorizador
    expect((await esperaErro(api.eventos.corrigir('e4817', { justificativa: j, valores: { autorizadoPorPessoaId: null } }))).code).toBe('AUTORIZADOR_OBRIGATORIO');
  });

  it('correção de pessoa troca quem aparece como dentro/histórico', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    await api.eventos.corrigir('e4814', { justificativa: 'Pessoa trocada no registro.', valores: { pessoaId: id.marcos } });
    const ev = await api.eventos.obter('e4814');
    expect(ev.pessoaId).toBe(id.marcos);
    expect(ev.pessoaNome).toBe('Marcos Pereira');
    expect(ev.pessoaNomeOriginal).toBe('Cláudia Rocha');
    expect((await api.eventos.listar({ pessoa: 'Marcos' })).some((e) => e.id === 'e4814')).toBe(true);
  });

  it('turno: "excecoesHoje" (renomeado) conta as exceções do dia', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const r = await api.turno.resumo();
    expect('excecoesNoTurno' in r).toBe(false);
    expect(r.excecoesHoje).toBe(1); // e4813 (exceção do dia)
    await api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'excecao_porteiro', justificativa: 'Morador não atende o interfone' });
    expect((await api.turno.resumo()).excecoesHoje).toBe(2);
  });

  it('relatório de exceções agrupa por operadorId e exibe o nome', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    const r = await api.relatorios.resumo(30);
    expect(r.excecoesPorPorteiro.length).toBeGreaterThan(0);
    for (const e of r.excecoesPorPorteiro) {
      expect(e.operadorId).toMatch(/^u\d$/);
      expect(e.operador).not.toBe('?');
    }
    expect(new Set(r.excecoesPorPorteiro.map((e) => e.operadorId)).size).toBe(r.excecoesPorPorteiro.length);
  });

  it('validações: restrição com validade no passado e autorização com início depois do fim', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const e1 = await esperaErro(api.restricoes.criar({ pessoaId: id.marcos, unidadeId: un('D-32'), motivo: 'm', validaAte: brt(2026, 10, 8), solicitadaPorPessoaId: id.ana }));
    expect(e1.status).toBe(422);
    expect(e1.code).toBe('VALIDADE_INVALIDA');
    expect((await api.restricoes.criar({ pessoaId: id.marcos, unidadeId: un('D-32'), motivo: 'm', validaAte: HOJE, solicitadaPorPessoaId: id.ana })).validaAte).toBeGreaterThan(relogio.agora()); // hoje vale
    const e2 = await esperaErro(api.autorizacoes.criar({ ...prevBase, solicitadaPorPessoaId: id.ana, validaDe: brt(2026, 10, 12), validaAte: brt(2026, 10, 10) }));
    expect(e2.status).toBe(422);
    expect(e2.code).toBe('PERIODO_INVALIDO');
    expect((await api.autorizacoes.criar({ ...prevBase, solicitadaPorPessoaId: id.ana, validaDe: brt(2026, 10, 10), validaAte: brt(2026, 10, 12) })).validaDe).toBe(brt(2026, 10, 10));
  });
});
