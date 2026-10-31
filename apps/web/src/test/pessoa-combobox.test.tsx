// @vitest-environment jsdom
// Seletor de pessoa (Combobox shadcn/ui): busca com debounce, estados, teclado, "Cadastrar nova pessoa" e pessoa
// indisponível (já vinculada à unidade). Sem user-event no projeto: fireEvent.
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api';
import type { Api, PessoaBusca } from '../api/types';
import { PessoaCombobox } from '../components/PessoaCombobox';
import { prefillDoTermo } from '../features/cadastro/NovaPessoaForm';

beforeAll(() => {
  // jsdom não tem ResizeObserver (Radix Popper) nem scrollIntoView (cmdk rola até a opção destacada).
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});
afterEach(() => cleanup());

const pessoa = (id: string, nome: string, extra: Partial<PessoaBusca> = {}): PessoaBusca => ({
  id, nome, categoria: 'visitante', documentoTipo: 'cpf', documentoMascarado: '123.45*.***-**',
  ultimoAcesso: 'Sem acessos', unidadesVinculadas: [], unidadesVinculadasCodigos: [], criadoEm: 0, ...extra,
});
const LARISSA = pessoa('p1', 'Larissa Gomes', { unidadesVinculadas: ['u-d32'], unidadesVinculadasCodigos: ['D-32'], categoria: 'morador' });
const LUCAS = pessoa('p2', 'Lucas Ferraz');

function montar({ buscar = vi.fn(async () => [LARISSA, LUCAS]), onCadastrar, indisponivel }: {
  buscar?: ReturnType<typeof vi.fn>; onCadastrar?: (t: string) => void; indisponivel?: (p: PessoaBusca) => string | null;
} = {}) {
  const escolhas: (PessoaBusca | null)[] = [];
  function Casca() {
    const [v, setV] = useState<PessoaBusca | null>(null);
    return <PessoaCombobox valor={v} onChange={(p) => { escolhas.push(p); setV(p); }} onCadastrar={onCadastrar} indisponivel={indisponivel} />;
  }
  const api = { pessoas: { buscar } } as unknown as Api;
  render(<QueryClientProvider client={new QueryClient()}><ApiProvider api={api}><Casca /></ApiProvider></QueryClientProvider>);
  return { buscar, escolhas, campo: () => screen.getByRole('combobox', { name: 'Pessoa' }) as HTMLInputElement };
}
const digitar = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });

describe('PessoaCombobox', () => {
  it('menos de 2 caracteres: pede mais texto e não busca', async () => {
    const { buscar, campo } = montar();
    digitar(campo(), 'L');
    expect(await screen.findByText(/Digite ao menos 2 caracteres/)).toBeTruthy();
    await act(() => new Promise((r) => setTimeout(r, 320)));
    expect(buscar).not.toHaveBeenCalled();
    expect(campo().getAttribute('aria-expanded')).toBe('true');
  });

  it('debounce: só busca o termo final, mostra "Buscando…" e depois as opções com CPF mascarado, categoria e unidades', async () => {
    let soltar: (v: PessoaBusca[]) => void = () => {};
    const buscar = vi.fn(() => new Promise<PessoaBusca[]>((r) => { soltar = r; }));
    const { campo } = montar({ buscar });
    digitar(campo(), 'La'); digitar(campo(), 'Lar'); digitar(campo(), 'Lari');
    expect(screen.getByText('Buscando…')).toBeTruthy();
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));
    expect(buscar).toHaveBeenCalledWith('Lari');
    soltar([LARISSA, LUCAS]);
    const op = await screen.findByRole('option', { name: /Larissa Gomes/ });
    expect(op.textContent).toContain('123.45*.***-**');
    expect(op.textContent).toContain('Morador');
    expect(op.textContent).toContain('D-32');
    expect(screen.getByRole('option', { name: /Lucas Ferraz/ }).textContent).toContain('Sem vínculo válido');
    expect(screen.queryByText('Buscando…')).toBeNull();
  });

  it('teclado: setas destacam (aria-activedescendant), Enter escolhe e o foco vai para "Trocar"; Esc fecha a lista', async () => {
    const { campo, escolhas } = montar();
    digitar(campo(), 'Lu');
    await screen.findByRole('option', { name: /Lucas Ferraz/ });
    fireEvent.keyDown(campo(), { key: 'Escape' });
    await waitFor(() => expect(campo().getAttribute('aria-expanded')).toBe('false'));
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(campo(), { key: 'ArrowDown' }); // reabre
    await screen.findByRole('option', { name: /Lucas Ferraz/ });
    fireEvent.keyDown(campo(), { key: 'ArrowDown' });
    const ativo = campo().getAttribute('aria-activedescendant');
    expect(ativo && document.getElementById(ativo)?.textContent).toContain('Lucas Ferraz');
    fireEvent.keyDown(campo(), { key: 'Enter' });
    expect(escolhas.at(-1)?.id).toBe('p2');
    const trocar = await screen.findByRole('button', { name: 'Trocar pessoa (Lucas Ferraz)' });
    await waitFor(() => expect(document.activeElement).toBe(trocar));
    fireEvent.click(trocar);
    await waitFor(() => expect(document.activeElement).toBe(campo()));
  });

  it('pessoa indisponível (já vinculada à unidade): opção desabilitada com o motivo, clique não escolhe', async () => {
    const { campo, escolhas } = montar({ indisponivel: (p) => (p.unidadesVinculadas.includes('u-d32') ? 'Já tem vínculo válido com esta unidade' : null) });
    digitar(campo(), 'La');
    const op = await screen.findByRole('option', { name: /Larissa Gomes/ });
    expect(op.getAttribute('aria-disabled')).toBe('true');
    expect(op.textContent).toContain('Já tem vínculo válido com esta unidade');
    fireEvent.click(op);
    expect(escolhas).toHaveLength(0);
    expect(screen.getByRole('option', { name: /Lucas Ferraz/ }).getAttribute('aria-disabled')).toBe('false');
  });

  it('nenhum resultado: avisa e oferece "Cadastrar nova pessoa" com o texto digitado', async () => {
    const onCadastrar = vi.fn();
    const { campo } = montar({ buscar: vi.fn(async () => []), onCadastrar });
    digitar(campo(), 'Zulmira');
    expect(await screen.findByText('Nenhuma pessoa encontrada.')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'Cadastrar nova pessoa' }));
    expect(onCadastrar).toHaveBeenCalledWith('Zulmira');
  });

  it('erro da API: mensagem na lista', async () => {
    const { campo } = montar({ buscar: vi.fn(async () => { throw new Error('Sem conexão com a API.'); }) });
    digitar(campo(), 'Lu');
    expect(await screen.findByText('Não foi possível buscar: Sem conexão com a API.')).toBeTruthy();
  });
});

describe('prefillDoTermo (cadastro a partir do termo buscado)', () => {
  it('texto vai para o nome, dígitos para o CPF, código de unidade para nenhum', () => {
    expect(prefillDoTermo(' Zulmira ')).toEqual({ nome: 'Zulmira' });
    expect(prefillDoTermo('529.982.247-25')).toEqual({ documento: '52998224725' });
    expect(prefillDoTermo('52998')).toEqual({ documento: '52998' });
    expect(prefillDoTermo('D-32')).toEqual({});
    expect(prefillDoTermo('123456789012')).toEqual({});
  });
});
