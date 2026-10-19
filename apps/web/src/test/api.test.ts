import { afterEach, describe, expect, it } from 'vitest';
import { entrarComo, esperaErro, id, novaApi, un } from './helpers';
import { brt, relogio } from '@portaria/domain/time';
import { verificarCadeiaEventos } from '@portaria/domain/hashChain';
import type { EventoAcesso } from '@portaria/domain/types';

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe('restrição (RF-16)', () => {
  it('bloqueia a entrada e grava um evento "negado" na trilha', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const antes = (await api.eventos.listar()).length;
    const erro = await esperaErro(api.eventos.criar({
      pessoaId: id.bruno, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana,
    }));
    expect(erro.status).toBe(422);
    expect(erro.code).toBe('PESSOA_EM_RESTRICAO');
    const depois = await api.eventos.listar();
    expect(depois.length).toBe(antes + 1);
    expect(depois[0].tipo).toBe('negado');
    expect(depois[0].pessoaId).toBe(id.bruno);
    await entrarComo(api, 'luiza.campos');
    expect((await api.auditoria.verificarIntegridade()).valido).toBe(true);
  });

  it('restrição para todo o condomínio só vale depois da aprovação do síndico (RN-06)', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const r = await api.restricoes.criar({
      pessoaId: id.marcos, unidadeId: un('D-32'), motivo: 'Teste', validaAte: brt(2026, 12, 31), solicitadaPorPessoaId: id.ana, paraTodoCondominio: true,
    });
    expect(r.escopo).toBe('condominio');
    expect((await api.restricoes.verificar(id.marcos, un('G-11'))).restrita).toBe(false);
    expect((await esperaErro(api.restricoes.aprovar(r.id))).status).toBe(403);
    await entrarComo(api, 'roberto.faria');
    await api.restricoes.aprovar(r.id);
    expect((await api.restricoes.verificar(id.marcos, un('G-11'))).restrita).toBe(true);
  });

  it('restrição para todo o condomínio barra funcionário que entra sem unidade de destino', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const r = await api.restricoes.criar({
      pessoaId: id.valter, unidadeId: un('D-32'), motivo: 'Funcionário desligado', validaAte: brt(2026, 12, 31), solicitadaPorPessoaId: null, paraTodoCondominio: true,
    });
    await entrarComo(api, 'roberto.faria');
    await api.restricoes.aprovar(r.id);
    await entrarComo(api, 'joao.lima');
    const presente = (await api.eventos.presentes()).find((p) => p.pessoaId === id.valter)!;
    await api.eventos.registrarSaida(presente.id);
    const erro = await esperaErro(api.eventos.criar({ pessoaId: id.valter, unidadeDestinoId: null, autorizadoPorTipo: 'escala' }));
    expect(erro.code).toBe('PESSOA_EM_RESTRICAO');
  });
});

describe('entrada de não morador', () => {
  it('RN-01: rejeita sem autorizador (422)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const e1 = await esperaErro(api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('D-32') }));
    expect(e1.status).toBe(422);
    expect(e1.code).toBe('AUTORIZADO_POR_OBRIGATORIO');
    const e2 = await esperaErro(api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone' }));
    expect(e2.status).toBe(422);
    expect(e2.code).toBe('AUTORIZADO_POR_SEM_IDENTIFICACAO');
  });

  it('registra entrada por interfone com morador de vínculo válido', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const ev = await api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana });
    expect(ev.tipo).toBe('entrada');
    expect(ev.autorizadoPorNome).toBe('Ana Ribeiro');
    expect(ev.operadorNome).toBe('João Lima');
  });

  it('exceção sem justificativa de 15+ caracteres é rejeitada (RF-17)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const base = { pessoaId: id.enel, unidadeDestinoId: un('B-24'), autorizadoPorTipo: 'excecao_porteiro' as const };
    expect((await esperaErro(api.eventos.criar({ ...base }))).code).toBe('JUSTIFICATIVA_OBRIGATORIA');
    expect((await esperaErro(api.eventos.criar({ ...base, justificativa: 'curta demais' }))).code).toBe('JUSTIFICATIVA_OBRIGATORIA');
    const ok = await api.eventos.criar({ ...base, justificativa: 'Serviço público (luz, água, gás)' });
    expect(ok.autorizadoPorTipo).toBe('excecao_porteiro');
  });

  it('autorização prévia fora da janela de horário não vale; dentro da janela vale (RN-07)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const ap = (await api.autorizacoes.vigentes(id.lumen, un('F-04')))[0];
    expect(ap.estado).toBe('fora_da_janela'); // 14:32, janela 15h–17h
    const dados = { pessoaId: id.lumen, unidadeDestinoId: un('F-04'), autorizadoPorTipo: 'autorizacao_previa' as const, autorizacaoPreviaId: ap.id };
    expect((await esperaErro(api.eventos.criar(dados))).code).toBe('AUTORIZACAO_PREVIA_INVALIDA');
    relogio.congelar(brt(2026, 10, 9, 15, 30));
    const ev = await api.eventos.criar(dados);
    expect(ev.autorizadoPorNome).toBe('Sílvia Prado');
  });

  it('autorização prévia vencida não vale', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const ap = (await api.autorizacoes.vigentes(id.lumen, un('F-04')))[0];
    relogio.congelar(brt(2026, 10, 10, 15, 30)); // dia seguinte: validade era 09/10
    expect((await esperaErro(api.eventos.criar({
      pessoaId: id.lumen, unidadeDestinoId: un('F-04'), autorizadoPorTipo: 'autorizacao_previa', autorizacaoPreviaId: ap.id,
    }))).code).toBe('AUTORIZACAO_PREVIA_INVALIDA');
  });

  it('cadastro de autorização prévia exige validade (sem padrão)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const e = await esperaErro(api.autorizacoes.criar({
      unidadeId: un('D-32'), pessoaId: id.marcos, validaAte: null, diasSemana: null, horaInicio: null, horaFim: null, solicitadaPorPessoaId: id.ana,
    }));
    expect(e.code).toBe('VALIDADE_OBRIGATORIA');
  });

  it('vínculo legado vale para interfone e para retirada de encomenda', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    // Lúcia Ribeiro é dependente com vínculo LEGADO na D-32
    const ev = await api.eventos.criar({ pessoaId: id.marcia, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.lucia });
    expect(ev.autorizadoPorNome).toBe('Lúcia Ribeiro');
    const enc = await api.encomendas.entregar({ id: 'K108', pessoaId: id.lucia });
    expect(enc.retiradaPorPessoaId).toBe(id.lucia);
  });

  it('funcionário do condomínio entra por Escala; diarista (prestador) não pode usar Escala', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const e = await esperaErro(api.eventos.criar({ pessoaId: 'pe-juliana-costa', unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'escala' }));
    expect(e.code).toBe('MEIO_INVALIDO_PARA_TIPO');
    // Válter já está dentro (seed): registra saída e entrada de novo via escala
    const presente = (await api.eventos.presentes()).find((p) => p.pessoaId === id.valter)!;
    await api.eventos.registrarSaida(presente.id);
    const ev = await api.eventos.criar({ pessoaId: id.valter, unidadeDestinoId: null, autorizadoPorTipo: 'escala' });
    expect(ev.autorizadoPorTipo).toBe('escala');
  });

  it('lançamento retroativo guarda hora real e hora do lançamento', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const real = brt(2026, 10, 9, 12, 0);
    const ev = await api.eventos.criar({
      pessoaId: id.marcos, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana,
      retroativo: true, ocorridoEm: real, formularioContingencia: '12',
    });
    expect(ev.retroativo).toBe(true);
    expect(ev.formularioContingencia).toBe('12');
    expect(ev.ocorridoEm).toBe(real);
    expect(ev.registradoEm).toBeGreaterThan(ev.ocorridoEm);
    const futuro = await esperaErro(api.eventos.criar({
      pessoaId: id.marcia, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana,
      retroativo: true, ocorridoEm: brt(2026, 10, 9, 18, 0),
    }));
    expect(futuro.code).toBe('DATA_INCONSISTENTE');
  });
});

describe('trilha append-only (RN-04, RNF-01)', () => {
  it('saída cria um NOVO evento ligado à entrada e não altera a entrada', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const entrada = await api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana });
    const antes = JSON.stringify(await api.eventos.obter(entrada.id));
    const total = (await api.eventos.listar()).length;
    const saida = await api.eventos.registrarSaida(entrada.id);
    expect(saida.id).not.toBe(entrada.id);
    expect(saida.codigo).not.toBe(entrada.codigo);
    expect(saida.codigo).toMatch(/^EV-\d{6}$/); // derivado de seq
    expect(saida.tipo).toBe('saida');
    expect(saida.refereEventoId).toBe(entrada.id);
    expect((await api.eventos.listar()).length).toBe(total + 1);
    const depois = await api.eventos.obter(entrada.id);
    // os campos gravados da entrada são idênticos; só a visão derivada passa a apontar para a saída
    const { saida: s1, dentro: d1, ...a } = JSON.parse(antes);
    const { saida: s2, dentro: d2, ...b } = depois as unknown as Record<string, unknown>;
    expect(b).toEqual(a);
    expect(s1).toBeNull(); expect(d1).toBe(true);
    expect(s2).not.toBeNull(); expect(d2).toBe(false);
    expect((await esperaErro(api.eventos.registrarSaida(entrada.id))).code).toBe('SAIDA_JA_REGISTRADA');
  });

  it('verificação de integridade detecta adulteração e aponta o primeiro registro', async () => {
    (globalThis as { window?: unknown }).window = globalThis;
    const api = novaApi({ ferramentasDev: true });
    await entrarComo(api, 'luiza.campos');
    const ok = await api.auditoria.verificarIntegridade();
    expect(ok.valido).toBe(true);
    expect(ok.verificados).toBeGreaterThan(100);
    await (globalThis as unknown as { __adulterarEvento: (r: string) => Promise<void> }).__adulterarEvento('e4808');
    const r = await api.auditoria.verificarIntegridade();
    expect(r.valido).toBe(false);
    expect(r.primeiroEventoIdInvalido).toBe('e4808');
    expect(r.motivo).toBe('hash_divergente');
  });

  it('verificarCadeia aponta lacuna de seq e hash_anterior incoerente', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    const lista = (await api.eventos.listar()).sort((a, b) => a.seq - b.seq) as unknown as EventoAcesso[];
    const semUm = lista.filter((e) => e.seq !== 5);
    expect((await verificarCadeiaEventos(semUm)).motivo).toBe('lacuna_de_seq');
    const trocado = lista.map((e) => (e.seq === 7 ? { ...e, hashAnterior: 'x'.repeat(64) } : e));
    const r = await verificarCadeiaEventos(trocado);
    expect(r.primeiroSeqInvalido).toBe(7);
    expect(r.motivo).toBe('hash_anterior_incoerente');
  });

  it('exportação gera .jsonl com manifesto, eventos e hashes', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    const pacote = await api.auditoria.exportar({ somenteExcecoes: true });
    expect(pacote.nomeArquivo.endsWith('.jsonl')).toBe(true);
    const linhas = pacote.conteudo.trim().split('\n').map((l) => JSON.parse(l));
    expect(linhas[0].tipo).toBe('manifesto');
    expect(linhas[0].instrucoesVerificacao.length).toBeGreaterThan(2);
    const eventos = linhas.filter((l) => l.tipo === 'evento');
    expect(eventos.length).toBe(pacote.quantidade);
    expect(eventos.every((e) => /^[0-9a-f]{64}$/.test(e.evento.hash))).toBe(true);
  });
});

describe('vínculos (RN-03, RF-06)', () => {
  it('porteiro não consegue criar vínculo (403)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const e = await esperaErro(api.vinculos.criar({
      pessoaId: id.marcos, unidadeId: un('D-32'), tipo: 'dependente', vigenciaInicio: brt(2026, 10, 9), vigenciaFim: null,
      solicitadoPor: 'portaria',
    }));
    expect(e.status).toBe(403);
  });

  it('porteiro não aprova vínculo (403)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.vinculos.decidir({ id: 'V3', decisao: 'aprovar' }))).status).toBe(403);
  });

  it('aprovar vínculo exige conferência do comprovante (RF-05); justificativa opcional fica gravada na decisão', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    expect((await esperaErro(api.vinculos.decidir({ id: 'V1', decisao: 'aprovar' }))).code).toBe('CONFERENCIA_OBRIGATORIA');
    await api.vinculos.registrarConferencia('V1', { tipo: 'contrato_locacao' });
    const v = await api.vinculos.decidir({ id: 'V1', decisao: 'aprovar', justificativa: 'Proprietária confirmou por telefone.' });
    expect(v.status).toBe('aprovado');
    expect(v.justificativa).toBe('Proprietária confirmou por telefone.');
    expect(v.decididoPorId).toBe('u4');
    expect((await api.vinculos.listar()).find((x) => x.id === v.id)?.decididoPorNome).toBe('Paula Nogueira');
  });

  it('rejeitar exige justificativa; vínculo pendente não dá acesso de morador', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    expect((await esperaErro(api.vinculos.decidir({ id: 'V1', decisao: 'rejeitar' }))).code).toBe('JUSTIFICATIVA_OBRIGATORIA');
    const r = await api.vinculos.decidir({ id: 'V1', decisao: 'rejeitar', justificativa: 'Locador não é o proprietário registrado.' });
    expect(r.status).toBe('rejeitado');
    // aprovar com conferência registrada não exige justificativa
    await api.vinculos.registrarConferencia('V3', { tipo: 'escritura' });
    expect((await api.vinculos.decidir({ id: 'V3', decisao: 'aprovar' })).status).toBe('aprovado');
  });

  it('pendente não autoriza: Rodrigo Alves não retira encomenda nem é aceito como morador', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const e = await esperaErro(api.encomendas.entregar({ id: 'K102', pessoaId: id.rodrigo }));
    expect(e.code).toBe('PESSOA_SEM_VINCULO');
    // sem vínculo válido não há acesso de morador: segue a regra de visitante (RN-01)
    expect((await esperaErro(api.eventos.criar({ pessoaId: id.rodrigo, unidadeDestinoId: un('I-13') }))).code).toBe('AUTORIZADO_POR_OBRIGATORIO');
  });
});

describe('encomendas (RN-08, RF-23)', () => {
  it('entrega bloqueada para pessoa sem vínculo com a unidade', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const e = await esperaErro(api.encomendas.entregar({ id: 'K107', pessoaId: id.marcos }));
    expect(e.status).toBe(422);
    expect(e.code).toBe('PESSOA_SEM_VINCULO');
  });

  it('recebimento exige confirmação da unidade', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const base = { unidadeId: un('G-11'), destinatario: 'Carla Mendes', transportadora: 'Correios', codigoRastreio: 'X1' };
    expect((await esperaErro(api.encomendas.receber({ ...base, unidadeConfirmada: false }))).code).toBe('UNIDADE_NAO_CONFIRMADA');
    const ok = await api.encomendas.receber({ ...base, unidadeConfirmada: true });
    expect(ok.recebidaPorId).toBe('u1');
    expect((await api.encomendas.listar()).find((x) => x.id === ok.id)?.recebidaPorNome).toBe('João Lima');
  });
});

describe('RBAC e usuários', () => {
  it('auditor é somente leitura; administração gerencia usuários, exceto síndico (RNF-04); síndico tudo', async () => {
    const api = novaApi();
    await entrarComo(api, 'luiza.campos');
    expect((await esperaErro(api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('D-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana }))).status).toBe(403);
    expect((await esperaErro(api.usuarios.listar())).status).toBe(403);
    await entrarComo(api, 'paula.nogueira');
    expect((await api.usuarios.listar()).length).toBeGreaterThan(0); // spec 5.2: administração gerencia usuários
    expect((await esperaErro(api.usuarios.criar({ nome: 'Novo Síndico', login: 'novo.sindico', papel: 'sindico' }))).status).toBe(403);
    await entrarComo(api, 'roberto.faria');
    const { usuario: novo } = await api.usuarios.criar({ nome: 'Teste Auditor', login: 'teste.auditor', papel: 'auditor' });
    const des = await api.usuarios.desativar(novo.id);
    expect(des.ativo).toBe(false);
  });

  it('login é só usuário + senha para todos os papéis (2FA fica para o pós-MVP)', async () => {
    const api = novaApi();
    expect((await api.auth.login({ login: 'joao.lima', senha: 'x' })).papel).toBe('porteiro');
    expect((await api.auth.login({ login: 'paula.nogueira', senha: 'x' })).papel).toBe('administracao');
    expect((await api.auth.login({ login: 'roberto.faria', senha: 'x' })).papel).toBe('sindico');
    expect((await api.auth.me())?.login).toBe('roberto.faria');
    expect(Object.keys((api.auth as object))).not.toContain('verificar2fa');
    expect((await esperaErro(api.auth.login({ login: 'joao.lima', senha: '' }))).code).toBe('CREDENCIAIS_INVALIDAS');
  });
});
