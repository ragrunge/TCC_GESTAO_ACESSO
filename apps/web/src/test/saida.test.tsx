// @vitest-environment jsdom
// Tela "Registrar saída" (/saida) e a confirmação em "Presentes agora": busca entre quem está dentro (nome, destino,
// tipo de visita, CPF pela busca de pessoas), teclado (setas/Enter/Esc), confirmação, toast, foco de volta e ?entrada=.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EventoView } from '@portaria/domain/types';
import { ApiProvider } from '../api';
import type { Api, PessoaBusca } from '../api/types';
import { ToastProvider } from '../components/Toast';
import { casaPresente, digitosCpf, SaidaPage } from '../features/portaria/SaidaPage';
import { PessoasDentroPage } from '../features/portaria/PessoasDentroPage';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ usuario: { id: 'u1', nome: 'João Lima', papel: 'porteiro' } }),
  useCan: () => true,
}));
vi.mock('../app/catalogo', () => {
  const cat = { pronto: true, codigo: (id: string) => id, rotulo: (id: string) => id, porId: () => undefined };
  return { useCatalogo: () => cat };
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});
afterEach(() => cleanup());

const MIN = 60_000;
const ID_MARCIA = '11111111-1111-4111-8111-111111111111';
const ID_PEDRO = '22222222-2222-4222-8222-222222222222';
const ID_CARLOS = '33333333-3333-4333-8333-333333333333';

function entrada(id: string, nome: string, extra: Partial<EventoView> = {}): EventoView {
  return {
    id, seq: 1, tipo: 'entrada', categoriaPessoa: 'visitante', pessoaId: `p-${id}`, unidadeDestinoId: 'u1', areaComumId: null,
    ocorridoEm: Date.now() - 30 * MIN, registradoEm: Date.now() - 30 * MIN, retroativo: false, codigo: `EV-${id.slice(0, 3)}`,
    pessoaNome: nome, operadorNome: 'João Lima', unidadeRotulo: 'D-32', areaComumNome: null, autorizadoPorTipo: 'interfone',
    autorizadoPorNome: 'Ana Ribeiro', saida: null, dentro: true, entradaCodigo: null, autorizacaoSemSolicitante: false,
    permanencia: null, empresa: null, servico: null,
    ...extra,
  } as EventoView;
}

const MARCIA = entrada(ID_MARCIA, 'Márcia Pereira', { permanencia: { tipoVisita: 'visita', prazoAte: Date.now() + 200 * MIN, prorrogacoes: 0 } });
const PEDRO = entrada(ID_PEDRO, 'Pedro Almeida', {
  unidadeRotulo: 'A-101', categoriaPessoa: 'prestador', ocorridoEm: Date.now() - 120 * MIN,
  permanencia: { tipoVisita: 'entrega', prazoAte: Date.now() - 20 * MIN, prorrogacoes: 0 },
});
const CARLOS = entrada(ID_CARLOS, 'Carlos Souza', { unidadeRotulo: 'B-12', autorizadoPorNome: 'Bruno Dias' });

function montar(url = '/saida', presentes: EventoView[] = [MARCIA, PEDRO, CARLOS], pagina: 'saida' | 'pessoas' = 'saida') {
  let lista = [...presentes];
  const api = {
    eventos: {
      presentes: vi.fn(async () => lista),
      registrarSaida: vi.fn(async (id: string) => {
        const e = lista.find((x) => x.id === id)!;
        lista = lista.filter((x) => x.id !== id);
        return { ...e, id: 'saida-1', tipo: 'saida', codigo: 'EV-900', ocorridoEm: Date.now(), entradaCodigo: e.codigo } as EventoView;
      }),
    },
    pessoas: {
      buscar: vi.fn(async (): Promise<PessoaBusca[]> => [{ id: `p-${ID_CARLOS}`, nome: 'Carlos Souza', documentoMascarado: '***.456.789-**' } as PessoaBusca]),
    },
  } as unknown as Api;
  let loc = '';
  const Espia = () => { const l = useLocation(); loc = l.pathname + l.search; return null; };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApiProvider api={api}><ToastProvider><MemoryRouter initialEntries={[url]}><Espia />{pagina === 'saida' ? <SaidaPage /> : <PessoasDentroPage />}</MemoryRouter></ToastProvider></ApiProvider>
    </QueryClientProvider>,
  );
  return { api, local: () => loc };
}

const campo = () => screen.getByRole('combobox', { name: 'Buscar quem está dentro' }) as HTMLInputElement;
const digitar = (v: string) => fireEvent.change(campo(), { target: { value: v } });
const nomes = () => screen.getAllByRole('option').map((o) => o.textContent ?? '');

describe('filtro da saída', () => {
  it('nome sem acento, destino compacto ("d32"), tipo de visita e várias palavras', () => {
    expect(casaPresente(MARCIA, 'marcia')).toBe(true);
    expect(casaPresente(MARCIA, 'd32')).toBe(true);
    expect(casaPresente(MARCIA, 'D-32')).toBe(true);
    expect(casaPresente(PEDRO, 'entregador')).toBe(true);
    expect(casaPresente(PEDRO, 'prestador a-101')).toBe(true);
    expect(casaPresente(PEDRO, 'pedro d-32')).toBe(false);
  });
  it('CPF só com 3+ dígitos e sem letras', () => {
    expect(digitosCpf('456')).toBe('456');
    expect(digitosCpf('***.456.789-**')).toBe('456789');
    expect(digitosCpf('45')).toBeNull();
    expect(digitosCpf('A-101')).toBeNull();
  });
});

describe('SaidaPage', () => {
  it('foco na busca; expirado no topo com selo; todos os campos do resultado', async () => {
    montar();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    expect(document.activeElement).toBe(campo());
    expect(nomes()[0]).toMatch(/Pedro Almeida/);
    const pedro = screen.getAllByRole('option')[0]!;
    expect(within(pedro).getByText('Expirado')).toBeTruthy();
    expect(within(pedro).getByText(/Expirado há 20min/)).toBeTruthy();
    expect(within(pedro).getByText('A-101')).toBeTruthy();
    expect(screen.getByText('3 pessoas dentro agora')).toBeTruthy();
  });

  it('a busca filtra por nome, destino e tipo de visita', async () => {
    montar();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    digitar('marcia');
    expect(nomes()).toHaveLength(1);
    expect(nomes()[0]).toMatch(/Márcia Pereira/);
    digitar('b12');
    expect(nomes()[0]).toMatch(/Carlos Souza/);
    digitar('entregador');
    expect(nomes()[0]).toMatch(/Pedro Almeida/);
    digitar('zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Ninguém dentro com “zzz”.')).toBeTruthy();
    // Esc limpa a busca
    fireEvent.keyDown(campo(), { key: 'Escape' });
    expect(campo().value).toBe('');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('CPF parcial: consulta a busca de pessoas (corpo) e cruza pelo id, mostrando o mascarado', async () => {
    const { api } = montar();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    digitar('456');
    await waitFor(() => expect(api.pessoas.buscar).toHaveBeenCalledWith('456', { limite: 50 }));
    await waitFor(() => expect(nomes()).toHaveLength(1));
    expect(nomes()[0]).toMatch(/Carlos Souza/);
    expect(screen.getByText('***.456.789-**')).toBeTruthy();
  });

  it('teclado: seta + Enter abre a confirmação com o resumo; Esc volta sem registrar e o foco volta à busca', async () => {
    const { api } = montar();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    fireEvent.keyDown(campo(), { key: 'ArrowDown' }); // do 1º (Pedro) para o 2º (Márcia)
    fireEvent.keyDown(campo(), { key: 'Enter' });
    const modal = await screen.findByRole('dialog', { name: 'Registrar saída · Márcia Pereira' });
    expect(within(modal).getByText('D-32')).toBeTruthy();
    expect(within(modal).getByText(/Entrou às/)).toBeTruthy();
    expect(within(modal).getByText(/Ana Ribeiro/)).toBeTruthy();
    expect(document.activeElement).toBe(within(modal).getByRole('button', { name: 'Confirmar saída' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.eventos.registrarSaida).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(campo());
  });

  it('confirmar: registra a saída ligada à entrada, toast, limpa a busca, some da lista e o foco volta', async () => {
    const { api } = montar();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    digitar('carlos');
    fireEvent.click(screen.getByRole('option', { name: /Carlos Souza/ }));
    const modal = await screen.findByRole('dialog', { name: 'Registrar saída · Carlos Souza' });
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: 'Confirmar saída' })); });
    expect(api.eventos.registrarSaida).toHaveBeenCalledWith(ID_CARLOS);
    expect(await screen.findByText(/Saída de Carlos Souza registrada às \d\d:\d\d \(EV-900, ligada à entrada EV-333\)\./)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(campo().value).toBe('');
    expect(document.activeElement).toBe(campo());
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
  });

  it('Enter repetido (tecla mantida) não confirma', async () => {
    const { api } = montar();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    fireEvent.keyDown(campo(), { key: 'Enter' });
    const modal = await screen.findByRole('dialog');
    const botao = within(modal).getByRole('button', { name: 'Confirmar saída' });
    const ev = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true });
    botao.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(api.eventos.registrarSaida).not.toHaveBeenCalled();
  });

  it('?entrada=<uuid> abre já selecionado e consome o parâmetro; inválido é ignorado', async () => {
    const a = montar(`/saida?entrada=${ID_MARCIA}`);
    expect(await screen.findByRole('dialog', { name: 'Registrar saída · Márcia Pereira' })).toBeTruthy();
    expect(a.local()).toBe('/saida');
    cleanup();
    const b = montar('/saida?entrada=nao-e-uuid');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(b.local()).toBe('/saida');
  });

  it('?entrada= de quem já saiu: aviso, sem confirmação', async () => {
    montar('/saida?entrada=44444444-4444-4444-8444-444444444444');
    expect(await screen.findByText(/não está mais entre os presentes/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('estado vazio', async () => {
    montar('/saida', []);
    expect(await screen.findByText('Ninguém dentro agora.')).toBeTruthy();
  });

  it('"Saída retroativa" na confirmação abre o formulário de contingência', async () => {
    montar();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    fireEvent.keyDown(campo(), { key: 'Enter' });
    const modal = await screen.findByRole('dialog', { name: 'Registrar saída · Pedro Almeida' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Saída retroativa' }));
    expect(await screen.findByRole('dialog', { name: 'Saída retroativa · Pedro Almeida' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /Registrar saída/ })).toBeNull();
  });
});

describe('Presentes agora: "Registrar saída" pede confirmação', () => {
  it('o botão da linha abre a mesma confirmação; só registra ao confirmar', async () => {
    const { api } = montar('/pessoas', [MARCIA], 'pessoas');
    const linha = await waitFor(() => { const r = screen.getAllByRole('row').find((x) => x.textContent?.includes('Márcia Pereira')); expect(r).toBeTruthy(); return r!; });
    fireEvent.click(within(linha).getByRole('button', { name: 'Registrar saída' }));
    const modal = await screen.findByRole('dialog', { name: 'Registrar saída · Márcia Pereira' });
    expect(api.eventos.registrarSaida).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(modal).getByRole('button', { name: 'Confirmar saída' })); });
    expect(api.eventos.registrarSaida).toHaveBeenCalledWith(ID_MARCIA);
    expect(await screen.findByText(/Saída de Márcia Pereira registrada/)).toBeTruthy();
  });
});
