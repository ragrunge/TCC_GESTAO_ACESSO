import { describe, expect, it } from 'vitest';
import { gerarUnidades, unidadeExiste } from '../domain/units';
import {
  descreverJanela, estadoAutorizacaoPrevia, meiosAceitos, restricoesVigentes, validarDecisaoVinculo, vinculoValido,
} from '../domain/rules';
import { brt } from '../domain/time';
import type { AutorizacaoPrevia, VinculoUnidade } from '../domain/types';

describe('unidades', () => {
  it('gera exatamente 165 unidades (160 nas torres 1–8 + 5 na torre 9)', () => {
    const us = gerarUnidades();
    expect(us.length).toBe(165);
    expect(us.filter((u) => u.torre === 9).length).toBe(5);
    expect(us.filter((u) => u.torre <= 8).length).toBe(160);
    expect(new Set(us.map((u) => u.id)).size).toBe(165);
    expect(unidadeExiste('T4-32')).toBe(true);
    expect(unidadeExiste('T2-104')).toBe(false);
    expect(unidadeExiste('T9-21')).toBe(false);
    expect(unidadeExiste('T1-61')).toBe(false);
  });
});

describe('regras puras', () => {
  const ap: AutorizacaoPrevia = {
    id: 'a', unidadeId: 'T4-32', pessoaId: 'p', validaDe: brt(2026, 9, 1), validaAte: brt(2026, 11, 30, 23, 59), diasSemana: [1, 2, 3, 4, 5],
    horaInicio: '08:00', horaFim: '18:00', cadastradaPorNome: 'x', solicitadaPorPessoaId: null, solicitadaPorNome: 'x', revogadaEm: null,
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
    prazoRegularizacao: null, conferencias: [], solicitadoPor: '', solicitadoEm: 0, ...x,
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
    const falha = [{ ok: false, rotulo: 'a', detalhe: '' }];
    expect(validarDecisaoVinculo('aprovar', '', falha)?.code).toBe('JUSTIFICATIVA_OBRIGATORIA');
    expect(validarDecisaoVinculo('aprovar', 'x'.repeat(15), falha)).toBeNull();
    expect(validarDecisaoVinculo('aprovar', '', [{ ok: true, rotulo: 'a', detalhe: '' }])).toBeNull();
  });

  it('restrição de condomínio pendente não vigora', () => {
    const r = { id: 'r', escopo: 'condominio' as const, unidadeId: 'T1-11', pessoaId: 'p', motivo: 'm', validaAte: brt(2026, 12, 31), cadastradaPorNome: '', cadastradaEm: 0, solicitadaPorNome: '', aprovadaPorNome: null, aprovadaEm: null, revogadaEm: null };
    expect(restricoesVigentes([r], 'p', 'T9-11', brt(2026, 10, 9))).toHaveLength(0);
    expect(restricoesVigentes([{ ...r, aprovadaEm: 1 }], 'p', 'T9-11', brt(2026, 10, 9))).toHaveLength(1);
  });
});
