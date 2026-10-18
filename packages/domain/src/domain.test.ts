import { describe, expect, it } from 'vitest';
import { acharUnidadePorTexto, andarDoNumero, codigoUnidade, gerarUnidades, parseCodigoUnidade, validarEstruturaUnidade } from './units';
import {
  cadastroCompleto, descreverJanela, elegivelRetencao, escalaVigente, estadoAutorizacaoPrevia, legadoVencido, meiosAceitos,
  podeEntregarEncomenda, restricoesVigentes, validarAutorizacaoEntrada, validarConferencia, validarDecisaoVinculo, validarEscala, vinculoValido,
} from './rules';
import { brt, menosAnos } from './time';
import type { AutorizacaoPrevia, Funcionario, Pessoa, VinculoUnidade } from './types';
import { codigoEvento } from './hashChain';

describe('unidades', () => {
  it('estrutura inicial: exatamente 165 unidades (160 nas torres 1–8 + 5 na torre 9)', () => {
    const us = gerarUnidades();
    expect(us.length).toBe(165);
    expect(us.filter((u) => u.torre === 9).length).toBe(5);
    expect(us.filter((u) => u.torre <= 8).length).toBe(160);
    const codigos = new Set(us.map(codigoUnidade));
    expect(codigos.size).toBe(165);
    expect(codigos.has('T4-32')).toBe(true);
    expect(codigos.has('T2-104')).toBe(false);
    expect(codigos.has('T9-21')).toBe(false);
    expect(codigos.has('T1-61')).toBe(false);
  });

  it('código é derivado; a busca por texto aceita "4-32", "T4 32" e acha pelo par torre/número', () => {
    expect(parseCodigoUnidade('4-32')).toEqual({ torre: 4, numero: '32' });
    expect(parseCodigoUnidade('t4 32')).toEqual({ torre: 4, numero: '32' });
    expect(parseCodigoUnidade('T10-101')).toEqual({ torre: 10, numero: '101' });
    expect(parseCodigoUnidade('Ana')).toBeNull();
    const lista = [{ id: 'uuid-a', torre: 4, numero: '32', ativo: true }, { id: 'uuid-b', torre: 1, numero: '11', ativo: true }];
    expect(acharUnidadePorTexto(lista, '4-32')?.id).toBe('uuid-a');
    expect(acharUnidadePorTexto(lista, '4-33')).toBeUndefined();
    expect(andarDoNumero('32')).toBe(3);
    expect(andarDoNumero('101')).toBe(1);
    expect(validarEstruturaUnidade(0, '11')).not.toBeNull();
    expect(validarEstruturaUnidade(4, '3a')).not.toBeNull();
    expect(validarEstruturaUnidade(10, '101')).toBeNull();
  });

  it('código do evento deriva de seq', () => {
    expect(codigoEvento(42)).toBe('EV-000042');
  });
});

describe('regras puras', () => {
  const ap: AutorizacaoPrevia = {
    id: 'a', unidadeId: 'T4-32', pessoaId: 'p', validaDe: brt(2026, 9, 1), validaAte: brt(2026, 11, 30, 23, 59), diasSemana: [1, 2, 3, 4, 5],
    horaInicio: '08:00', horaFim: '18:00', cadastradaPorId: 'u', cadastradaEm: 0, solicitadaPorPessoaId: 'm', areaComumId: null,
    semSolicitante: false, justificativa: null, revogadaEm: null, revogadaPorId: null,
  };
  it('autorização prévia: validade, dia da semana e horário', () => {
    expect(estadoAutorizacaoPrevia(ap, brt(2026, 10, 9, 14, 32))).toBe('valida'); // sexta
    expect(estadoAutorizacaoPrevia(ap, brt(2026, 10, 10, 14, 32))).toBe('fora_da_janela'); // sábado
    expect(estadoAutorizacaoPrevia(ap, brt(2026, 10, 9, 19, 0))).toBe('fora_da_janela');
    expect(estadoAutorizacaoPrevia(ap, brt(2026, 12, 1, 10, 0))).toBe('expirada');
    expect(estadoAutorizacaoPrevia({ ...ap, revogadaEm: 1 }, brt(2026, 10, 9, 14, 32))).toBe('revogada');
    expect(descreverJanela(ap)).toBe('seg a sex, 8h–18h');
  });

  const v = (x: Partial<VinculoUnidade>): VinculoUnidade => ({
    id: 'v', pessoaId: 'p', unidadeId: 'T4-32', tipo: 'proprietario', status: 'aprovado', vigenciaInicio: null, vigenciaFim: null,
    prazoRegularizacao: null, conferencia: null, solicitadoPor: '', solicitadoEm: 0, registradoPorId: 'u', encerradoEm: null, ...x,
  });
  it('vínculo válido = aprovado ou legado dentro do prazo', () => {
    const hoje = brt(2026, 10, 9, 14, 32);
    expect(vinculoValido(v({}), hoje)).toBe(true);
    expect(vinculoValido(v({ status: 'pendente' }), hoje)).toBe(false);
    expect(vinculoValido(v({ status: 'rejeitado' }), hoje)).toBe(false);
    expect(vinculoValido(v({ status: 'legado', prazoRegularizacao: brt(2027, 3, 31) }), hoje)).toBe(true);
    expect(vinculoValido(v({ status: 'legado', prazoRegularizacao: brt(2026, 9, 30) }), hoje)).toBe(false);
    expect(vinculoValido(v({ vigenciaFim: brt(2026, 10, 8) }), hoje)).toBe(false);
  });

  it('meio "escala" só aparece para funcionário', () => {
    expect(meiosAceitos('funcionario')).toContain('escala');
    expect(meiosAceitos('prestador')).not.toContain('escala');
    expect(meiosAceitos('visitante')).not.toContain('escala');
  });

  it('decisão de vínculo', () => {
    const c = { tipoDocumento: 'escritura' as const, data: 0, conferidoPorId: 'u' };
    expect(validarDecisaoVinculo('aprovar', '', null)?.code).toBe('CONFERENCIA_OBRIGATORIA');
    expect(validarDecisaoVinculo('aprovar', '', c)).toBeNull();
    expect(validarDecisaoVinculo('rejeitar', '', c)?.code).toBe('JUSTIFICATIVA_OBRIGATORIA');
  });

  it('conferência do comprovante (RF-05)', () => {
    const hoje = brt(2026, 10, 9, 14, 32);
    const ok = { tipo: 'contrato_locacao', data: brt(2026, 10, 9) };
    expect(validarConferencia(ok, hoje)).toBeNull();
    expect(validarConferencia({ ...ok, tipo: 'rg' }, hoje)?.code).toBe('TIPO_COMPROVANTE_INVALIDO');
    expect(validarConferencia({ ...ok, tipo: 'outro' }, hoje)?.code).toBe('DESCRICAO_OBRIGATORIA');
    expect(validarConferencia({ ...ok, tipo: 'outro', descricao: 'Formal de partilha' }, hoje)).toBeNull();
    expect(validarConferencia({ ...ok, observacao: 'x'.repeat(201) }, hoje)?.code).toBe('OBSERVACAO_LONGA');
    expect(validarConferencia({ ...ok, observacao: 'CPF 529.982.247-25' }, hoje)?.code).toBe('DADO_PESSOAL_NA_CONFERENCIA');
    expect(validarConferencia({ ...ok, observacao: '(11) 98765-4321' }, hoje)?.code).toBe('DADO_PESSOAL_NA_CONFERENCIA');
    expect(validarConferencia({ ...ok, observacao: 'Recebido por e-mail em 01/10/2026' }, hoje)).toBeNull();
    expect(validarConferencia({ ...ok, data: brt(2026, 10, 10) }, hoje)?.code).toBe('DATA_FUTURA');
  });

  it('restrição de condomínio pendente não vigora', () => {
    const r = { id: 'r', escopo: 'condominio' as const, unidadeId: 'T1-11', pessoaId: 'p', motivo: 'm', validaAte: brt(2026, 12, 31), cadastradaPorId: 'u', cadastradaEm: 0, solicitadaPorPessoaId: null, aprovadaPorId: null, aprovadaEm: null, revogadaEm: null, revogadaPorId: null };
    expect(restricoesVigentes([r], 'p', 'T9-11', brt(2026, 10, 9))).toHaveLength(0);
    expect(restricoesVigentes([{ ...r, aprovadaEm: 1 }], 'p', 'T9-11', brt(2026, 10, 9))).toHaveLength(1);
  });

  it('RF-36: área comum só para prestador, por autorização prévia ou exceção', () => {
    expect(meiosAceitos('prestador', 'area_comum')).toEqual(['autorizacao_previa', 'excecao_porteiro']);
    const ctx = { quando: brt(2026, 10, 9, 10), moradoresValidosIds: new Set<string>(), autorizacoes: [] };
    const just = 'Manutenção da bomba da piscina';
    expect(validarAutorizacaoEntrada({ categoriaPessoa: 'visitante', areaComumId: 'a', autorizadoPorTipo: 'excecao_porteiro', justificativa: just }, ctx)?.code)
      .toBe('AREA_COMUM_SO_PRESTADOR');
    expect(validarAutorizacaoEntrada({ categoriaPessoa: 'prestador', areaComumId: 'a', autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: 'm' }, ctx)?.code)
      .toBe('MEIO_INVALIDO_PARA_TIPO');
    expect(validarAutorizacaoEntrada({ categoriaPessoa: 'prestador', areaComumId: 'a', unidadeDestinoId: 'u' }, ctx)?.code).toBe('DESTINO_DUPLO');
    expect(validarAutorizacaoEntrada({ categoriaPessoa: 'prestador', areaComumId: 'a', autorizadoPorTipo: 'excecao_porteiro', justificativa: just }, ctx)).toBeNull();
  });

  it('RN-08: entrega por vínculo válido ou por autorização de retirada', () => {
    const hoje = brt(2026, 10, 9, 14, 32);
    expect(podeEntregarEncomenda([v({})], 'p', 'T4-32', hoje)).toEqual({ ok: true, por: 'vinculo' });
    expect(podeEntregarEncomenda([], 'p', 'T4-32', hoje, true)).toEqual({ ok: true, por: 'autorizacao' });
    expect(podeEntregarEncomenda([], 'p', 'T4-32', hoje, false, 'T4-32')).toMatchObject({ ok: false });
  });

  it('cadastro completo e legado vencido', () => {
    const p = { semCpf: false, documentoBusca: 'h', telefone: '11912345678', anonimizadaEm: null };
    expect(cadastroCompleto(p)).toBe(true);
    expect(cadastroCompleto({ ...p, telefone: '1234' })).toBe(false);
    expect(cadastroCompleto({ ...p, semCpf: true })).toBe(false);
    expect(cadastroCompleto({ ...p, anonimizadaEm: 1 })).toBe(false);
    const hoje = brt(2026, 10, 9);
    expect(legadoVencido(v({ status: 'legado', prazoRegularizacao: brt(2026, 9, 30) }), hoje)).toBe(true);
    expect(legadoVencido(v({ status: 'legado', prazoRegularizacao: brt(2027, 3, 31) }), hoje)).toBe(false);
  });
});

describe('retenção (RNF-09)', () => {
  const v = (x: Partial<VinculoUnidade>): VinculoUnidade => ({
    id: 'v', pessoaId: 'p', unidadeId: 'u', tipo: 'proprietario', status: 'aprovado', vigenciaInicio: null, vigenciaFim: null,
    prazoRegularizacao: null, conferencia: null, solicitadoPor: '', solicitadoEm: 0, registradoPorId: 'u', encerradoEm: null, ...x,
  });
  const hoje = brt(2026, 10, 9, 14, 32);
  const pessoa = (categoria: Pessoa['categoria'], criadoEm = brt(2020, 1, 1)) => ({ categoria, anonimizadaEm: null, criadoEm });
  it('3 anos de calendário', () => {
    expect(menosAnos(hoje, 3)).toBe(brt(2023, 10, 9, 14, 32));
    expect(menosAnos(brt(2028, 2, 29), 3)).toBe(brt(2025, 2, 28));
  });
  it('visitante/prestador pelo último acesso; morador pelo fim do último vínculo', () => {
    expect(elegivelRetencao(pessoa('visitante'), [], brt(2023, 1, 1), hoje)).toBe(true);
    expect(elegivelRetencao(pessoa('visitante'), [], brt(2024, 1, 1), hoje)).toBe(false);
    expect(elegivelRetencao(pessoa('prestador'), [], null, hoje)).toBe(true); // nunca entrou: conta do cadastro
    const enc = (fim: number) => v({ status: 'encerrado', encerradoEm: fim });
    expect(elegivelRetencao(pessoa('morador'), [enc(brt(2023, 6, 30))], null, hoje)).toBe(true);
    expect(elegivelRetencao(pessoa('morador'), [enc(brt(2023, 6, 30)), enc(brt(2024, 1, 1))], null, hoje)).toBe(false);
    expect(elegivelRetencao(pessoa('morador'), [enc(brt(2023, 6, 30)), v({ status: 'aprovado' })], null, hoje)).toBe(false);
    expect(elegivelRetencao(pessoa('funcionario'), [], null, hoje)).toBe(false);
    expect(elegivelRetencao({ ...pessoa('visitante'), anonimizadaEm: 1 }, [], null, hoje)).toBe(false);
  });
});

describe('escalaVigente (RF-09)', () => {
  it('validarEscala: dias, formato e início diferente do fim (inclusive turno que atravessa a meia-noite)', () => {
    expect(validarEscala({ diasSemana: [1, 2], horaInicio: '22:00', horaFim: '06:00' })).toBeNull();
    expect(validarEscala({ diasSemana: [], horaInicio: '08:00', horaFim: '18:00' })).not.toBeNull();
    expect(validarEscala({ diasSemana: [7], horaInicio: '08:00', horaFim: '18:00' })).not.toBeNull();
    expect(validarEscala({ diasSemana: [1], horaInicio: '08:00', horaFim: '08:00' })).not.toBeNull();
    expect(validarEscala({ diasSemana: [1], horaInicio: '8h', horaFim: '18:00' })).not.toBeNull();
  });
  const f = (dias: number[], horaInicio: string, horaFim: string): Funcionario => ({ pessoaId: 'p', funcao: 'Zelador', escala: { diasSemana: dias, horaInicio, horaFim }, ativo: true });
  it('escala diurna: só no dia e dentro do horário', () => {
    const diurna = f([1, 2, 3, 4, 5], '08:00', '18:00');
    expect(escalaVigente(diurna, brt(2026, 10, 9, 10, 0))).toBe(true); // sexta
    expect(escalaVigente(diurna, brt(2026, 10, 9, 19, 0))).toBe(false);
    expect(escalaVigente(diurna, brt(2026, 10, 10, 10, 0))).toBe(false); // sábado
  });
  it('escala que atravessa a meia-noite vale no dia do início do turno', () => {
    const noturna = f([1, 2, 3, 4, 5], '22:00', '06:00'); // seg a sex à noite
    expect(escalaVigente(noturna, brt(2026, 10, 9, 23, 0))).toBe(true); // sex 23h (início sexta)
    expect(escalaVigente(noturna, brt(2026, 10, 10, 3, 0))).toBe(true); // sáb 3h: ainda é o turno de sexta
    expect(escalaVigente(noturna, brt(2026, 10, 10, 23, 0))).toBe(false); // sáb 23h: sábado não está na escala
    expect(escalaVigente(noturna, brt(2026, 10, 12, 3, 0))).toBe(false); // seg 3h: seria turno de domingo
    expect(escalaVigente(noturna, brt(2026, 10, 12, 23, 0))).toBe(true); // seg 23h
    expect(escalaVigente(noturna, brt(2026, 10, 9, 3, 0))).toBe(true); // sex 3h: turno de quinta
    expect(escalaVigente(noturna, brt(2026, 10, 9, 12, 0))).toBe(false); // meio-dia fora do turno
  });
  it('funcionário inativo ou ausente nunca tem escala vigente', () => {
    expect(escalaVigente({ ...f([5], '22:00', '06:00'), ativo: false }, brt(2026, 10, 9, 23, 0))).toBe(false);
    expect(escalaVigente(undefined, brt(2026, 10, 9, 23, 0))).toBe(false);
  });
});
