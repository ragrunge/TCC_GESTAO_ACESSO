// @vitest-environment jsdom
// Vínculo com unidade: validações do formulário compartilhado (as mesmas recusas da API) e o fluxo pela ficha da pessoa
// (Bloco -> Apartamento -> tipo -> revisão -> confirmar -> pendente), com as invalidações certas.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pessoa } from '@portaria/domain/types';
import { ApiProvider } from '../api';
import type { Api, VinculoView } from '../api/types';
import { ToastProvider } from '../components/Toast';
import { FichaPessoaModal } from '../features/cadastro/FichaPessoaModal';
import { pontuar } from '../components/ui/combobox';
import { motivoConflito, validarNovoVinculo, type RascunhoVinculo } from '../features/vinculos/NovoVinculo';

const { permissoes, UNIDADES } = vi.hoisted(() => ({
  permissoes: new Set<string>(),
  UNIDADES: [
    { id: 'u-a101', bloco: 'A', numero: '101', ativo: true },
    { id: 'u-a102', bloco: 'A', numero: '102', ativo: false },
    { id: 'u-b201', bloco: 'B', numero: '201', ativo: true },
    { id: 'u-c301', bloco: 'C', numero: '301', ativo: false },
  ],
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ usuario: { id: 'u1', nome: 'Paula', papel: 'administracao' } }),
  useCan: (a: string) => permissoes.has(a),
}));
vi.mock('../app/catalogo', () => {
  const porId = (id?: string | null) => UNIDADES.find((u) => u.id === id);
  const cat = {
    pronto: true, agrupamento: 'Bloco', unidades: UNIDADES, ativas: UNIDADES.filter((u) => u.ativo), areasComuns: [],
    porId, codigo: (id?: string | null) => { const u = porId(id); return u ? `${u.bloco}-${u.numero}` : '—'; },
    rotulo: () => '', porTexto: () => undefined, porBlocoNumero: () => undefined, areaNome: () => '—', recarregar: async () => undefined,
  };
  return { useCatalogo: () => cat };
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});
beforeEach(() => { permissoes.clear(); ['vinculo.criar', 'pessoa.editar'].forEach((a) => permissoes.add(a)); });
afterEach(() => cleanup());

const PESSOA: Pessoa = { id: 'p1', nome: 'Larissa Gomes', categoria: 'visitante', documentoTipo: 'cpf', documentoMascarado: '***.456.789-**', criadoEm: 0 };
const vinculo = (extra: Partial<VinculoView>): VinculoView => ({
  id: 'v1', pessoaId: 'p1', unidadeId: 'u-b201', tipo: 'proprietario', status: 'pendente', vigenciaInicio: null, vigenciaFim: null,
  prazoRegularizacao: null, conferencia: null, solicitadoPor: '', solicitadoEm: 0, registradoPorId: 'u1',
  pessoaNome: 'Larissa Gomes', pessoaDocumento: '***.456.789-**', pessoaCadastroCompleto: true, unidadeCodigo: 'B-201',
  decididoPorNome: null, registradoPorNome: null, conferidoPorNome: null, legadoVencido: false, encerradoEm: null, ...extra,
});

describe('validarNovoVinculo (espelho das recusas da API)', () => {
  const base: RascunhoVinculo = { pessoa: { id: 'p1' }, unidade: { id: 'u', bloco: 'A', numero: '101', ativo: true }, tipo: 'proprietario', inicio: '2026-10-23', fim: '', conflito: null };
  it('completo e válido: sem erros', () => expect(validarNovoVinculo(base)).toEqual({}));
  it('pessoa e unidade obrigatórias', () => {
    expect(validarNovoVinculo({ ...base, pessoa: null, unidade: null })).toEqual({ pessoa: 'Escolha a pessoa.', unidade: 'Escolha a unidade.' });
  });
  it('cadastro desativado ou anonimizado não recebe vínculo', () => {
    expect(validarNovoVinculo({ ...base, pessoa: { id: 'p1', desativadaEm: 1 } }).pessoa).toMatch(/desativado/);
    expect(validarNovoVinculo({ ...base, pessoa: { id: 'p1', anonimizadaEm: 1 } }).pessoa).toMatch(/anonimizado/);
  });
  it('unidade desativada e vínculo que duplicaria', () => {
    expect(validarNovoVinculo({ ...base, unidade: { ...base.unidade!, ativo: false } }).unidade).toBe('A unidade A-101 está desativada.');
    expect(validarNovoVinculo({ ...base, conflito: 'Já tem vínculo pendente com esta unidade' }).unidade).toMatch(/não dá para duplicar/);
  });
  it('inquilino exige fim; fim não pode ser antes do início', () => {
    expect(validarNovoVinculo({ ...base, tipo: 'inquilino' }).fim).toBe('Inquilino exige data de fim da vigência.');
    expect(validarNovoVinculo({ ...base, tipo: 'inquilino', fim: '2027-10-23' })).toEqual({});
    expect(validarNovoVinculo({ ...base, fim: '2026-10-22' }).fim).toBe('O fim da vigência não pode ser anterior ao início.');
  });
  it('motivoConflito: pendente/aprovado/legado bloqueiam; rejeitado/encerrado não; unidade válida da busca bloqueia', () => {
    expect(motivoConflito([vinculo({ status: 'pendente' })], 'p1', 'u-b201')).toBe('Já tem vínculo pendente com esta unidade');
    expect(motivoConflito([vinculo({ status: 'legado' })], 'p1', 'u-b201')).toBe('Já tem vínculo legado com esta unidade');
    expect(motivoConflito([vinculo({ status: 'encerrado' }), vinculo({ status: 'rejeitado' })], 'p1', 'u-b201')).toBeNull();
    expect(motivoConflito([], 'p1', 'u-b201', ['u-b201'])).toBe('Já tem vínculo válido com esta unidade');
    expect(motivoConflito([vinculo({})], 'p1', 'u-a101')).toBeNull();
  });
});

describe('pontuar (filtro do Combobox por palavra-chave)', () => {
  it('"B" casa só o bloco B (não todo "Bloco X"); "1" prefere os que começam com 1; sem acento e sem caixa', () => {
    expect(pontuar('x', 'b', ['B'])).toBe(1);
    expect(pontuar('x', 'b', ['A'])).toBe(0);
    expect(pontuar('x', '1', ['11', 'B-11'])).toBe(0.8);
    expect(pontuar('x', '1', ['21', 'B-21'])).toBe(0.4);
    expect(pontuar('x', 'ap 11', ['11', 'B-11', 'AP 11'])).toBe(1);
    expect(pontuar('x', 'Sao', ['São Paulo'])).toBe(0.8);
    expect(pontuar('x', '', ['A'])).toBe(1);
  });
});

function montarFicha(pessoa: Pessoa = PESSOA, vinculos: VinculoView[] = [vinculo({})]) {
  const criar = vi.fn(async () => ({ ...vinculo({ id: 'v2', unidadeId: 'u-a101', tipo: 'inquilino' }) }));
  const api = {
    pessoas: { ficha: vi.fn(async () => ({ pessoa, vinculos, eventos: [] })) },
    vinculos: { criar },
  } as unknown as Api;
  const qc = new QueryClient();
  const invalidar = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}><ApiProvider api={api}><ToastProvider><MemoryRouter>
      <FichaPessoaModal id={pessoa.id} onClose={() => undefined} />
    </MemoryRouter></ToastProvider></ApiProvider></QueryClientProvider>,
  );
  return { criar, invalidar };
}
const escolher = async (combobox: string, opcao: RegExp) => {
  fireEvent.click(screen.getByRole('combobox', { name: combobox }));
  fireEvent.click(await screen.findByRole('option', { name: opcao }));
};

describe('Ficha da pessoa: vincular a uma unidade', () => {
  it('Bloco -> Apartamento (desativada e já vinculada indisponíveis) -> tipo -> revisão -> confirmar: pendente e invalida ficha/unidade/fila', async () => {
    const { criar, invalidar } = montarFicha();
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a uma unidade' }));
    await screen.findByRole('combobox', { name: 'Bloco' }); // o formulário é carregado sob demanda (lazy)
    const dialogo = screen.getByRole('dialog', { name: 'Vincular a uma unidade' });
    expect(within(dialogo).getByText('Larissa Gomes')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Apartamento' }).hasAttribute('disabled')).toBe(true);

    // Bloco C só tem unidade desativada; no B, a 201 já tem vínculo pendente desta pessoa
    fireEvent.click(screen.getByRole('combobox', { name: 'Bloco' }));
    expect((await screen.findByRole('option', { name: /Bloco C/ })).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: /Bloco B/ }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Apartamento' }));
    const b201 = await screen.findByRole('option', { name: /AP 201/ });
    expect(b201.getAttribute('aria-disabled')).toBe('true');
    expect(b201.textContent).toContain('Já tem vínculo pendente com esta unidade');
    fireEvent.keyDown(b201, { key: 'Escape' });

    await escolher('Bloco', /Bloco A/);
    fireEvent.click(screen.getByRole('combobox', { name: 'Apartamento' }));
    const a102 = await screen.findByRole('option', { name: /AP 102/ });
    expect(a102.getAttribute('aria-disabled')).toBe('true');
    expect(a102.textContent).toContain('Desativada');
    fireEvent.click(screen.getByRole('option', { name: /AP 101/ }));
    expect(screen.getByRole('combobox', { name: 'Apartamento' }).textContent).toContain('AP 101');

    // Inquilino sem fim da vigência: barrado antes da revisão
    fireEvent.click(screen.getByRole('radio', { name: 'Inquilino' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revisar vínculo' }));
    expect(await screen.findByText('Inquilino exige data de fim da vigência.')).toBeTruthy();
    expect(criar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Fim da vigência (obrigatório)'), { target: { value: '2027-10-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar vínculo' }));

    const resumo = await screen.findByText('Vincular Larissa Gomes a Bloco A · AP 101 como Inquilino');
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    expect(screen.getByText('Fica pendente de aprovação')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));

    await waitFor(() => expect(criar).toHaveBeenCalledTimes(1));
    expect(criar).toHaveBeenCalledWith(expect.objectContaining({ pessoaId: 'p1', unidadeId: 'u-a101', tipo: 'inquilino', solicitadoPor: '' }));
    const enviado = (criar.mock.calls[0] as unknown as [{ vigenciaInicio: number; vigenciaFim: number }])[0];
    expect(typeof enviado.vigenciaInicio).toBe('number');
    expect(typeof enviado.vigenciaFim).toBe('number');

    // Volta para a ficha com o aviso de pendente
    expect(await screen.findByRole('dialog', { name: 'Ficha da pessoa' })).toBeTruthy();
    expect(screen.getAllByText(/Vincular Larissa Gomes a Bloco A · AP 101 como Inquilino/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fica pendente até a aprovação/).length).toBeGreaterThan(0);
    const chaves = invalidar.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const k of [['vinculos'], ['unidades'], ['pessoas'], ['busca']]) expect(chaves).toContain(JSON.stringify(k));
  });

  it('erro da API (409) na confirmação: fica na revisão com a mensagem', async () => {
    const { criar } = montarFicha(PESSOA, []);
    const { ApiError } = await import('../api');
    criar.mockRejectedValueOnce(new ApiError(409, 'VINCULO_DUPLICADO', 'Já existe vínculo ativo ou pendente desta pessoa com a unidade.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a uma unidade' }));
    await screen.findByRole('combobox', { name: 'Bloco' });
    await escolher('Bloco', /Bloco B/);
    await escolher('Apartamento', /AP 201/);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar vínculo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar vínculo' }));
    expect(await screen.findByText('Já existe vínculo ativo ou pendente desta pessoa com a unidade.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voltar e corrigir' })).toBeTruthy();
  });

  it('Cancelar volta para a ficha sem criar nada', async () => {
    const { criar } = montarFicha();
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a uma unidade' }));
    await screen.findByRole('combobox', { name: 'Bloco' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('dialog', { name: 'Ficha da pessoa' })).toBeTruthy();
    expect(criar).not.toHaveBeenCalled();
  });

  it('pessoa desativada: botão desabilitado com explicação; anonimizada: sem botão', async () => {
    montarFicha({ ...PESSOA, desativadaEm: 1 });
    const botao = await screen.findByRole('button', { name: 'Vincular a uma unidade' });
    expect(botao.hasAttribute('disabled')).toBe(true);
    expect(document.getElementById(botao.getAttribute('aria-describedby')!)?.textContent).toMatch(/reative o cadastro/);
    cleanup();
    montarFicha({ ...PESSOA, anonimizadaEm: 1, nome: '[anonimizado]' });
    await screen.findByText('[anonimizado]');
    expect(screen.queryByRole('button', { name: 'Vincular a uma unidade' })).toBeNull();
  });

  it('sem vinculo.criar (porteiro, auditor): sem botão', async () => {
    permissoes.delete('vinculo.criar');
    montarFicha();
    await screen.findByText('Larissa Gomes');
    expect(screen.queryByRole('button', { name: 'Vincular a uma unidade' })).toBeNull();
  });
});
