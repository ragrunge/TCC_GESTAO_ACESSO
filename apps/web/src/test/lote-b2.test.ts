// Alinhamento do mock ao schema (Parte 1) e lacunas do MVP (lote B2). Cada bloco falharia antes da mudança.
import { describe, expect, it } from 'vitest';
import { entrarComo, esperaErro, id, novaApi, un } from './helpers';
import { brt, relogio } from '@portaria/domain/time';
import { CAMPOS_CANONICOS_V1, calcularHashExportado } from '@portaria/domain/hashChain';
import { CHAVE_HMAC_DEMO, documentoBuscaCpf } from '@portaria/domain/cpf';
import type { Api } from '../api/types';

const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';
const CPF_C = '390.533.447-05';
const JUST = 'Manutenção preventiva combinada com a administração';
const ESCALA_NOITE = { diasSemana: [1, 2, 3, 4, 5], horaInicio: '22:00', horaFim: '06:00' };

async function linhasExportadas(api: Api, f?: Parameters<Api['auditoria']['exportar']>[0]) {
  return (await api.auditoria.exportar(f)).conteudo.trim().split('\n').map((l) => JSON.parse(l));
}

describe('Parte 1: mock alinhado ao schema', () => {
  it('evento gravado tem as colunas do schema: sem código, sem nome copiado, ponto de acesso por id', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const ev = await api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('T4-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana });
    await entrarComo(api, 'luiza.campos');
    const [, linha] = await linhasExportadas(api, { eventoId: ev.id });
    expect(Object.keys(linha.evento)).toEqual(['v', ...CAMPOS_CANONICOS_V1, 'hash_anterior', 'hash']);
    expect(linha.evento).not.toHaveProperty('codigo');
    expect(linha.evento).not.toHaveProperty('autorizado_por_nome');
    expect(JSON.stringify(linha.evento)).not.toContain('Ana Ribeiro'); // nome só por join (view/exibição)
    expect(linha.evento.ponto_acesso_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(linha.evento.unidade_destino_id).toBe(un('T4-32'));
    // a view resolve nome, código (derivado de seq) e rótulo da unidade
    expect(ev.codigo).toBe(`EV-${String(ev.seq).padStart(6, '0')}`);
    expect(ev.autorizadoPorNome).toBe('Ana Ribeiro');
    expect(ev.unidadeRotulo).toBe('T4-32');
    expect(ev.pontoAcessoNome).toBe('Portaria social');
    // fora da contingência o relógio é do servidor: ocorrido = registrado (CHECK evento_retroativo_tempo_ck)
    expect(ev.ocorridoEm).toBe(ev.registradoEm);
    expect(await calcularHashExportado(linha.evento)).toBe(ev.hash);
  });

  it('negado não copia o motivo para a justificativa (o motivo está na restrição)', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    await esperaErro(api.eventos.criar({ pessoaId: id.bruno, unidadeDestinoId: un('T4-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana }));
    const negado = (await api.eventos.listar({ tipo: 'negado' }))[0];
    expect(negado.justificativa).toBeNull();
    expect(negado.restricaoId).toBe('rs-bruno');
  });

  it('restrição de unidade exige o morador solicitante, com vínculo válido', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const base = { pessoaId: id.marcos, unidadeId: un('T4-32'), motivo: 'Morador pediu', validaAte: brt(2026, 12, 31) };
    expect((await esperaErro(api.restricoes.criar({ ...base, solicitadaPorPessoaId: null }))).code).toBe('SOLICITANTE_OBRIGATORIO');
    expect((await esperaErro(api.restricoes.criar({ ...base, solicitadaPorPessoaId: id.carla }))).code).toBe('SOLICITANTE_SEM_VINCULO'); // outra unidade
    const r = await api.restricoes.criar({ ...base, solicitadaPorPessoaId: id.ana });
    expect(r.solicitadaPorPessoaId).toBe(id.ana);
    const det = await api.unidades.detalhe(un('T4-32'));
    expect(det.restricoes!.find((x) => x.id === r.id)).toMatchObject({ solicitadaPorNome: 'Ana Ribeiro', cadastradaPorNome: 'João Lima (Porteiro)' });
  });

  it('documentoBusca é HMAC-SHA256 (chave de demonstração) e o telefone é guardado só com dígitos', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const p = await api.pessoas.criar({ nome: 'Teste HMAC', documento: CPF_A, telefone: '(11) 91234-5678', categoria: 'visitante' });
    expect(p.documentoBusca).toBe(await documentoBuscaCpf(CPF_A, CHAVE_HMAC_DEMO));
    expect(p.telefone).toBe('11912345678');
    expect((await api.pessoas.buscar('529.982.247-25')).map((x) => x.id)).toEqual([p.id]); // busca exata pelo CPF
    for (const x of (await api.pessoas.listar()).slice(0, 20)) expect(x.telefone ?? '').toMatch(/^\d{10,11}$/);
  });

  it('unidade tem id uuid; o código "T4-32" é derivado e a busca por "4-32" continua funcionando', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const { unidades, areasComuns } = await api.catalogo.obter();
    expect(unidades).toHaveLength(165);
    expect(unidades.every((u) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u.id))).toBe(true);
    expect(areasComuns.map((a) => a.nome)).toEqual(['Salão de festas', 'Piscina', 'Quadra', 'Academia', 'Administração', 'Casa de máquinas', 'Jardins']);
    expect((await api.pessoas.buscar('4-32')).some((p) => p.id === id.ana)).toBe(true);
    expect((await api.busca.global('T4-32')).unidades[0]).toEqual({ id: un('T4-32'), motivo: 'Unidade' });
    expect((await api.unidades.detalhe('T4-32')).unidade.id).toBe(un('T4-32')); // link legível
    const ana = (await api.pessoas.buscar('Ana Ribeiro')).find((p) => p.id === id.ana)!;
    expect(ana.unidadesVinculadasCodigos).toEqual(['T4-32']);
  });

  it('vínculo, encomenda, ocorrência e autorização guardam ids de usuário; as views resolvem o nome', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const v = await api.vinculos.criar({ pessoaId: id.marcos, unidadeId: un('T4-32'), tipo: 'dependente', vigenciaInicio: brt(2026, 10, 9), vigenciaFim: null, solicitadoPor: '' });
    expect(v).toMatchObject({ registradoPorId: 'u4', encerradoEm: null });
    expect((await api.vinculos.listar()).find((x) => x.id === v.id)).toMatchObject({ registradoPorNome: 'Paula Nogueira', unidadeCodigo: 'T4-32' });
    const helio = (await api.vinculos.listar({ status: 'encerrado' })).find((x) => x.pessoaNome === 'Hélio Prates')!;
    expect(helio.encerradoEm).not.toBeNull(); // CHECK vinculo_encerrado_ck
    const enc = (await api.encomendas.listar()).find((e) => e.id === 'K99')!;
    expect(enc).toMatchObject({ recebidaPorId: 'u3', recebidaPorNome: 'Marina Couto', retiradaRegistradaPorNome: 'Sérgio Matos', retiradaPorNome: 'Paulo Ribeiro (dependente)' });
    const oc = (await api.ocorrencias.listar()).find((o) => o.id === 'OC-2026-047')!;
    expect(oc).toMatchObject({ abertaPorId: 'u1', abertaPorNome: 'João Lima' });
  });

  it('importação persiste o estado "analisada" (sem as linhas) e passa a "confirmada"', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const r = await api.importacao.analisar({ arquivo: 'p.csv', linhas: [{ linha: 2, torre: '1', unidade: '11', nome: 'Importada Nova', documento: CPF_C, telefone: '11999998888' }] });
    expect(r.status).toBe('analisada');
    await api.importacao.confirmar(r.id);
    expect((await esperaErro(api.importacao.confirmar(r.id))).status).toBe(404); // linhas descartadas após confirmar
    const log = (await (async () => { await entrarComo(api, 'luiza.campos'); return api.auditoria.alteracoes({ entidade: 'importacao' }); })());
    expect(log.map((x) => x.acao)).toEqual(['importacao.confirmar', 'importacao.analisar']);
    expect(log[0].depois).toMatchObject({ status: 'confirmada', importados: 1 });
    expect(JSON.stringify(log)).not.toContain('39053344705'); // o CPF não vai para a trilha
  });
});

describe('RF-01: CRUD de unidades', () => {
  it('cria com torre/número únicos, edita só sem referências, desativa e reativa; auditor só lê', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    expect((await esperaErro(api.unidades.criar({ torre: 4, numero: '32' }))).code).toBe('UNIDADE_DUPLICADA');
    expect((await esperaErro(api.unidades.criar({ torre: 4, numero: '3a' }))).code).toBe('UNIDADE_INVALIDA');
    const nova = await api.unidades.criar({ torre: 10, numero: '101' });
    expect(nova.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await api.catalogo.obter()).unidades).toHaveLength(166);
    const editada = await api.unidades.editar({ id: nova.id, torre: 10, numero: '102' });
    expect(editada.numero).toBe('102');
    expect((await esperaErro(api.unidades.editar({ id: un('T4-32'), torre: 4, numero: '99' }))).code).toBe('UNIDADE_REFERENCIADA');
    expect((await api.unidades.desativar(nova.id)).ativo).toBe(false);
    expect((await esperaErro(api.unidades.desativar(nova.id))).status).toBe(409);
    expect((await api.unidades.reativar(nova.id)).ativo).toBe(true);
    await entrarComo(api, 'luiza.campos');
    expect((await api.unidades.listar()).length).toBe(166);
    expect((await esperaErro(api.unidades.criar({ torre: 11, numero: '11' }))).status).toBe(403);
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.unidades.desativar(nova.id))).status).toBe(403);
  });

  it('unidade inativa não recebe entrada, encomenda nem vínculo, mas continua no histórico', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    await api.unidades.desativar(un('T4-32'));
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: un('T4-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana }))).code).toBe('UNIDADE_INATIVA');
    expect((await esperaErro(api.encomendas.receber({ unidadeId: un('T4-32'), destinatario: 'Ana', transportadora: 'X', codigoRastreio: '1', unidadeConfirmada: true }))).code).toBe('UNIDADE_INATIVA');
    await entrarComo(api, 'paula.nogueira');
    expect((await esperaErro(api.vinculos.criar({ pessoaId: id.marcos, unidadeId: un('T4-32'), tipo: 'dependente', vigenciaInicio: brt(2026, 10, 9), vigenciaFim: null, solicitadoPor: '' }))).code).toBe('UNIDADE_INATIVA');
    const det = await api.unidades.detalhe(un('T4-32'));
    expect(det.unidade.ativo).toBe(false);
    expect(det.eventos!.length).toBeGreaterThan(0); // histórico preservado
    expect((await api.eventos.listar({ unidadeId: un('T4-32') })).length).toBeGreaterThan(0);
  });
});

describe('RF-09: funcionários', () => {
  it('cadastra com as regras de CPF e telefone, valida a escala e entra por escala noturna', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const base = { nome: 'Nilo Vigia', documento: CPF_A, telefone: '11977776666', funcao: 'Vigia noturno', escala: ESCALA_NOITE };
    expect((await esperaErro(api.funcionarios.criar({ ...base, documento: '123' }))).code).toBe('CPF_INVALIDO');
    expect((await esperaErro(api.funcionarios.criar({ ...base, telefone: '123' }))).code).toBe('TELEFONE_INVALIDO');
    expect((await esperaErro(api.funcionarios.criar({ ...base, escala: { ...ESCALA_NOITE, horaFim: '22:00' } }))).code).toBe('ESCALA_INVALIDA');
    expect((await esperaErro(api.funcionarios.criar({ ...base, funcao: ' ' }))).code).toBe('FUNCAO_OBRIGATORIA');
    const f = await api.funcionarios.criar(base);
    expect(f.pessoa).toMatchObject({ categoria: 'funcionario', telefone: '11977776666' });
    expect((await api.funcionarios.listar()).map((x) => x.pessoa.nome)).toContain('Nilo Vigia');
    // sábado 03h: ainda é o turno de sexta (atravessa a meia-noite)
    relogio.congelar(brt(2026, 10, 10, 3, 0));
    await entrarComo(api, 'joao.lima');
    expect((await api.eventos.criar({ pessoaId: f.pessoaId, unidadeDestinoId: null, autorizadoPorTipo: 'escala' })).autorizadoPorTipo).toBe('escala');
    expect((await esperaErro(api.funcionarios.editar({ pessoaId: f.pessoaId, ativo: false }))).status).toBe(403); // porteiro
  });

  it('funcionário desativado não entra por escala; a edição fica na trilha', async () => {
    const api = novaApi();
    await entrarComo(api, 'roberto.faria');
    const f = await api.funcionarios.criar({ nome: 'Rui Jardineiro', documento: CPF_B, telefone: '1133334444', funcao: 'Jardineiro', escala: { diasSemana: [5], horaInicio: '08:00', horaFim: '17:00' } });
    const ed = await api.funcionarios.editar({ pessoaId: f.pessoaId, ativo: false });
    expect(ed.ativo).toBe(false);
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.eventos.criar({ pessoaId: f.pessoaId, unidadeDestinoId: null, autorizadoPorTipo: 'escala' }))).code).toBe('ESCALA_FORA_DO_HORARIO');
    await entrarComo(api, 'luiza.campos');
    const reg = (await api.auditoria.alteracoes({ acao: 'funcionario.editar' }))[0];
    expect(reg.antes).toMatchObject({ ativo: true });
    expect(reg.depois).toMatchObject({ ativo: false });
  });
});

describe('RN-09 e correção (art. 18)', () => {
  it('pessoas.editar completa o cadastro (tira de "sem CPF"), com antes e depois na trilha', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const p = await api.pessoas.criar({ nome: 'Sem Documento', semCpf: true, telefone: '11955554444', categoria: 'visitante' });
    expect((await esperaErro(api.pessoas.editar({ id: p.id, documento: CPF_A }))).status).toBe(403); // porteiro
    await entrarComo(api, 'paula.nogueira');
    expect((await esperaErro(api.pessoas.editar({ id: p.id, documento: '111.111.111-11' }))).code).toBe('CPF_INVALIDO');
    expect((await esperaErro(api.pessoas.editar({ id: p.id, telefone: '99' }))).code).toBe('TELEFONE_INVALIDO');
    expect((await esperaErro(api.pessoas.editar({ id: p.id, documento: (await api.pessoas.ficha(id.ana)).pessoa.documentoMascarado }))).status).toBe(422);
    const ed = await api.pessoas.editar({ id: p.id, nome: 'Com Documento', documento: CPF_A, telefone: '(11) 98888-7777' });
    expect(ed).toMatchObject({ nome: 'Com Documento', documentoMascarado: '***.982.247-**', telefone: '11988887777' });
    expect(ed.semCpf).toBeUndefined();
    const outra = await api.pessoas.criar({ nome: 'Outra', documento: CPF_B, telefone: '11955554444', categoria: 'visitante' });
    expect((await esperaErro(api.pessoas.editar({ id: outra.id, documento: CPF_A }))).code).toBe('PESSOA_DUPLICADA');
    await entrarComo(api, 'luiza.campos');
    const reg = (await api.auditoria.alteracoes({ acao: 'pessoa.editar' }))[0];
    expect(reg.antes).toMatchObject({ nome: 'Sem Documento', semCpf: true });
    expect(reg.depois).toMatchObject({ nome: 'Com Documento', documentoMascarado: '***.982.247-**' });
    expect(JSON.stringify(reg)).not.toContain('11988887777'); // telefone mascarado na trilha
  });

  it('regularizar legado: exige cadastro completo (422) e passa a aprovado; lista marca o legado vencido', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const r = await api.importacao.analisar({ arquivo: 'p.csv', linhas: [{ linha: 2, torre: '1', unidade: '11', nome: 'Legado Sem Cpf', documento: '', telefone: '' }] });
    await api.importacao.confirmar(r.id);
    const leg = (await api.vinculos.listar({ status: 'legado' })).find((v) => v.pessoaNome === 'Legado Sem Cpf')!;
    expect(leg.pessoaCadastroCompleto).toBe(false);
    expect((await esperaErro(api.vinculos.regularizar(leg.id))).code).toBe('CADASTRO_INCOMPLETO');
    await api.pessoas.editar({ id: leg.pessoaId, documento: CPF_B, telefone: '11912340000' });
    // RN-09 + RF-05: regularizar também exige a conferência do comprovante
    expect((await esperaErro(api.vinculos.regularizar(leg.id))).code).toBe('CONFERENCIA_OBRIGATORIA');
    await api.vinculos.registrarConferencia(leg.id, { tipo: 'escritura' });
    const ok = await api.vinculos.regularizar(leg.id);
    expect(ok).toMatchObject({ status: 'aprovado', decididoPorId: 'u4' });
    expect((await api.pessoas.ficha(leg.pessoaId)).pessoa.categoria).toBe('morador');
    expect((await esperaErro(api.vinculos.regularizar(leg.id))).code).toBe('VINCULO_NAO_LEGADO');
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.vinculos.regularizar('V102'))).status).toBe(403);
    // depois do prazo (31/03/2027) o legado aparece como vencido
    relogio.congelar(brt(2027, 4, 2, 10, 0));
    await entrarComo(api, 'paula.nogueira');
    const legados = await api.vinculos.listar({ status: 'legado' });
    expect(legados.length).toBeGreaterThan(0);
    expect(legados.every((v) => v.legadoVencido)).toBe(true);
  });
});

describe('RF-33 e RNF-04: usuários e trilha de acesso negado', () => {
  it('administração gerencia usuários, mas não síndico; ninguém altera o próprio papel', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const { usuario: novo } = await api.usuarios.criar({ nome: 'Nova Portaria', login: 'nova.portaria', papel: 'porteiro' });
    expect((await api.usuarios.alterarPapel(novo.id, 'auditor')).papel).toBe('auditor');
    expect((await esperaErro(api.usuarios.alterarPapel(novo.id, 'sindico'))).status).toBe(403); // promover a síndico
    expect((await esperaErro(api.usuarios.alterarPapel('u5', 'porteiro'))).status).toBe(403); // rebaixar o síndico
    expect((await esperaErro(api.usuarios.desativar('u5'))).status).toBe(403);
    expect((await esperaErro(api.usuarios.alterarPapel('u4', 'sindico'))).code).toBe('AUTO_ALTERACAO_PAPEL');
    expect((await esperaErro(api.usuarios.alterarPapel('u4', 'porteiro'))).status).toBe(422);
    await entrarComo(api, 'roberto.faria');
    expect((await api.usuarios.alterarPapel(novo.id, 'sindico')).papel).toBe('sindico');
    expect((await esperaErro(api.usuarios.alterarPapel('u5', 'porteiro'))).code).toBe('AUTO_ALTERACAO_PAPEL');
    await entrarComo(api, 'luiza.campos');
    const reg = (await api.auditoria.alteracoes({ acao: 'usuario.alterarPapel' })).map((r) => [r.antes?.papel, r.depois?.papel]);
    expect(reg).toEqual([['auditor', 'sindico'], ['porteiro', 'auditor']]);
  });

  it('todo 403 grava acesso.negado com a ação tentada', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    await esperaErro(api.vinculos.decidir({ id: 'V3', decisao: 'aprovar' }));
    await esperaErro(api.lgpd.aplicarRetencao());
    await entrarComo(api, 'paula.nogueira');
    await esperaErro(api.usuarios.alterarPapel('u5', 'porteiro'));
    await entrarComo(api, 'luiza.campos');
    const negados = await api.auditoria.alteracoes({ acao: 'acesso.negado' });
    expect(negados.map((n) => [n.usuarioId, (n.depois as { acao: string }).acao])).toEqual([
      ['u4', 'usuario.gerenciar_sindico'], ['u1', 'lgpd.retencao'], ['u1', 'vinculo.decidir'],
    ]);
  });
});

describe('RF-36: prestador em área comum', () => {
  it('entra por exceção ou por autorização prévia da administração; o evento guarda empresa e serviço', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const { areasComuns } = await api.catalogo.obter();
    const piscina = areasComuns.find((a) => a.nome === 'Piscina')!;
    const academia = areasComuns.find((a) => a.nome === 'Academia')!;
    // porteiro não cria autorização de área comum
    const ap = { pessoaId: 'pe-adriano-melo', unidadeId: null, areaComumId: academia.id, validaAte: brt(2026, 10, 31), diasSemana: null, horaInicio: null, horaFim: null, solicitadaPorPessoaId: null };
    expect((await esperaErro(api.autorizacoes.criar(ap))).status).toBe(403);
    expect((await esperaErro(api.eventos.criar({ pessoaId: id.marcos, unidadeDestinoId: null, areaComumId: piscina.id, autorizadoPorTipo: 'excecao_porteiro', justificativa: JUST }))).code).toBe('AREA_COMUM_SO_PRESTADOR');
    expect((await esperaErro(api.eventos.criar({ pessoaId: 'pe-adriano-melo', unidadeDestinoId: null, areaComumId: piscina.id, autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana }))).code).toBe('MEIO_INVALIDO_PARA_TIPO');
    const ev = await api.eventos.criar({ pessoaId: 'pe-adriano-melo', unidadeDestinoId: null, areaComumId: piscina.id, autorizadoPorTipo: 'excecao_porteiro', justificativa: JUST });
    expect(ev).toMatchObject({ areaComumId: piscina.id, unidadeDestinoId: null, empresa: 'Melo Elétrica', servico: 'Elétrica', unidadeRotulo: 'Piscina' });
    await api.eventos.registrarSaida(ev.id);
    // administração cria a autorização de área comum: sem solicitante e sem contar como exceção
    await entrarComo(api, 'paula.nogueira');
    expect((await esperaErro(api.autorizacoes.criar({ ...ap, pessoaId: id.marcos }))).code).toBe('AREA_COMUM_SO_PRESTADOR');
    expect((await esperaErro(api.autorizacoes.criar({ ...ap, solicitadaPorPessoaId: id.ana }))).code).toBe('AREA_COMUM_SEM_SOLICITANTE');
    const a = await api.autorizacoes.criar(ap);
    expect(a).toMatchObject({ unidadeId: null, areaComumId: academia.id, semSolicitante: false, solicitadaPorPessoaId: null });
    await entrarComo(api, 'luiza.campos');
    const antes = (await api.relatorios.resumo({ de: brt(2026, 10, 9), ate: brt(2026, 10, 9) })).totais.excecoes;
    await entrarComo(api, 'joao.lima');
    const vig = await api.autorizacoes.vigentes('pe-adriano-melo', academia.id, { areaComum: true });
    expect(vig.map((x) => x.id)).toEqual([a.id]);
    expect(vig[0].unidadeRotulo).toBe('Academia');
    const ev2 = await api.eventos.criar({ pessoaId: 'pe-adriano-melo', unidadeDestinoId: null, areaComumId: academia.id, autorizadoPorTipo: 'autorizacao_previa', autorizacaoPreviaId: a.id });
    expect(ev2.autorizadoPorNome).toBe('Área comum — cadastrada por Paula Nogueira');
    expect(ev2.autorizacaoSemSolicitante).toBe(false);
    await entrarComo(api, 'luiza.campos');
    expect((await api.relatorios.resumo({ de: brt(2026, 10, 9), ate: brt(2026, 10, 9) })).totais.excecoes).toBe(antes);
    expect((await api.auditoria.verificarIntegridade()).valido).toBe(true);
  });
});

describe('RN-08: autorização de retirada de encomenda', () => {
  it('morador com vínculo autoriza alguém com CPF; só o autorizado (ou quem tem vínculo) retira', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    const base = { encomendaId: 'K108', pessoaId: id.marcos, solicitadaPorPessoaId: id.ana }; // K108: T4-32
    expect((await esperaErro(api.encomendas.autorizarRetirada({ ...base, solicitadaPorPessoaId: id.carla }))).code).toBe('SOLICITANTE_SEM_VINCULO');
    const semCpf = await api.pessoas.criar({ nome: 'Sem Cpf Retira', semCpf: true, telefone: '11944443333', categoria: 'visitante' });
    expect((await esperaErro(api.encomendas.autorizarRetirada({ ...base, pessoaId: semCpf.id }))).code).toBe('CPF_OBRIGATORIO');
    expect((await esperaErro(api.encomendas.entregar({ id: 'K108', pessoaId: id.marcos }))).code).toBe('PESSOA_SEM_VINCULO');
    const aut = await api.encomendas.autorizarRetirada(base);
    expect((await esperaErro(api.encomendas.autorizarRetirada(base))).code).toBe('AUTORIZACAO_DUPLICADA');
    expect((await esperaErro(api.encomendas.entregar({ id: 'K108', pessoaId: id.marcia }))).code).toBe('PESSOA_SEM_VINCULO'); // não autorizada
    const e = await api.encomendas.entregar({ id: 'K108', pessoaId: id.marcos });
    expect(e).toMatchObject({ retiradaPorPessoaId: id.marcos, retiradaAutorizacaoId: aut.id, retiradaRegistradaPorId: 'u1' });
    const v = (await api.encomendas.listar()).find((x) => x.id === 'K108')!;
    expect(v.retiradaPorNome).toBe('Marcos Pereira (autorizado por Ana Ribeiro)');
    await entrarComo(api, 'luiza.campos');
    expect((await esperaErro(api.encomendas.autorizarRetirada({ ...base, encomendaId: 'K107' }))).status).toBe(403);
  });
});

describe('LGPD (spec 9.3) e retenção (RNF-09)', () => {
  it('exporta os dados da pessoa (cadastro mascarado) e registra a exportação', async () => {
    const api = novaApi();
    await entrarComo(api, 'joao.lima');
    expect((await esperaErro(api.lgpd.exportarPessoa(id.ana))).status).toBe(403);
    await entrarComo(api, 'paula.nogueira');
    const pacote = await api.lgpd.exportarPessoa(id.ana);
    const j = JSON.parse(pacote.conteudo);
    const ana = (await api.pessoas.ficha(id.ana)).pessoa;
    expect(j.titular).toMatchObject({ nome: 'Ana Ribeiro', cpf: ana.documentoMascarado });
    expect(j.titular.telefone).toMatch(/^\(\*\*\) \*{5}-\d{4}$/);
    expect(pacote.conteudo).not.toContain(ana.documentoBusca!);
    expect(pacote.conteudo).not.toContain(ana.telefone!);
    expect(j.vinculos[0]).toMatchObject({ unidade: 'T4-32', status: 'aprovado' });
    expect(j.veiculos.map((v: { placa: string }) => v.placa)).toContain('FKR-2C41');
    expect(j.encomendasRetiradas).toEqual([]);
    expect(Array.isArray(j.eventos)).toBe(true);
    await entrarComo(api, 'luiza.campos');
    expect((await api.auditoria.alteracoes({ acao: 'lgpd.exportar' }))[0]).toMatchObject({ usuarioId: 'u4', registroId: id.ana });
  });

  it('anonimiza a pedido (só síndico, sem vínculo válido), informa o retido e redige a trilha; a cadeia continua válida', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    const p = await api.pessoas.criar({ nome: 'Titular Pede Exclusao', documento: CPF_A, telefone: '11922221111', categoria: 'visitante' });
    expect((await esperaErro(api.lgpd.anonimizar(p.id))).status).toBe(403); // administração não anonimiza
    await entrarComo(api, 'joao.lima');
    await api.eventos.criar({ pessoaId: p.id, unidadeDestinoId: un('T4-32'), autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: id.ana });
    await entrarComo(api, 'roberto.faria');
    expect((await esperaErro(api.lgpd.anonimizar(id.ana))).code).toBe('PESSOA_COM_VINCULO_VALIDO');
    const r = await api.lgpd.anonimizar(p.id);
    expect(r.registrosRedigidos).toBe(1); // o pessoa.criar
    expect(r.retido.join(' ')).toContain('Eventos de acesso');
    const ficha = await api.pessoas.ficha(p.id);
    expect(ficha.pessoa).toMatchObject({ nome: 'Pessoa anonimizada', documentoMascarado: '(anonimizado)' });
    expect(ficha.pessoa.documentoBusca).toBeUndefined();
    expect(ficha.pessoa.telefone).toBeUndefined();
    expect(ficha.eventos!.length).toBe(1); // o evento fica (só o id)
    expect((await esperaErro(api.lgpd.anonimizar(p.id))).status).toBe(409);
    expect((await api.pessoas.buscar('Titular Pede')).length).toBe(0);
    const trilha = await api.auditoria.alteracoes({ entidade: 'pessoa' });
    const criar = trilha.find((x) => x.acao === 'pessoa.criar' && x.registroId === p.id)!;
    expect(criar.redigidoEm).not.toBeNull();
    expect(JSON.stringify(criar)).not.toContain('Titular Pede Exclusao');
    expect((await api.auditoria.verificarIntegridade()).valido).toBe(true);
    // o mesmo CPF pode ser cadastrado de novo depois da anonimização (o HMAC saiu)
    expect((await api.pessoas.criar({ nome: 'Titular Voltou', documento: CPF_A, telefone: '11922221111', categoria: 'visitante' })).id).not.toBe(p.id);
  });

  it('retenção anonimiza o visitante 3 anos sem acesso e o ex-morador com vínculo encerrado há 3 anos; é idempotente', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    expect((await esperaErro(api.lgpd.aplicarRetencao())).status).toBe(403);
    await entrarComo(api, 'roberto.faria');
    const r = await api.lgpd.aplicarRetencao();
    expect(r).toMatchObject({ visitantesPrestadores: 1, moradores: 1 });
    expect(r.pessoaIds.sort()).toEqual(['pe-jurema-castilho', 'pe-osvaldo-brandao']);
    expect((await api.pessoas.ficha('pe-osvaldo-brandao')).pessoa.nome).toBe('Pessoa anonimizada');
    expect((await api.pessoas.ficha('pe-ana-ribeiro')).pessoa.nome).toBe('Ana Ribeiro');
    expect((await api.lgpd.aplicarRetencao())).toMatchObject({ visitantesPrestadores: 0, moradores: 0 });
    const reg = (await api.auditoria.alteracoes({ acao: 'lgpd.retencao' }))[1];
    expect(reg.depois).toMatchObject({ visitantesPrestadores: 1, moradores: 1 });
    expect(JSON.stringify(reg)).not.toContain('Osvaldo');
  });

  it('última execução da retenção: null antes de rodar; depois, a mais recente com quem rodou e as contagens; só o síndico', async () => {
    const api = novaApi();
    await entrarComo(api, 'paula.nogueira');
    expect((await esperaErro(api.lgpd.ultimaRetencao())).status).toBe(403);
    await entrarComo(api, 'roberto.faria');
    expect(await api.lgpd.ultimaRetencao()).toBeNull();
    await api.lgpd.aplicarRetencao();
    await api.lgpd.aplicarRetencao();
    const u = await api.lgpd.ultimaRetencao();
    expect(u).toMatchObject({ porNome: 'Roberto Faria', resultado: { visitantesPrestadores: 0, moradores: 0, registrosRedigidos: 0, pessoaIds: [] } });
    expect(typeof u!.em).toBe('number');
  });

  it('selo e âncora externa não existem no mock: suporta() falso e 501 legível; o resto continua suportado', async () => {
    const api = novaApi();
    await entrarComo(api, 'roberto.faria');
    for (const op of ['auditoria.selos', 'auditoria.selar', 'auditoria.conferirAncora']) expect(api.suporta!(op), op).toBe(false);
    for (const op of ['lgpd.exportarPessoa', 'lgpd.ultimaRetencao', 'auditoria.verificarIntegridade', 'veiculos.criar']) expect(api.suporta!(op), op).toBe(true);
    expect(await esperaErro(api.auditoria.selar())).toMatchObject({ status: 501, code: 'MODULO_INDISPONIVEL' });
  });
});
