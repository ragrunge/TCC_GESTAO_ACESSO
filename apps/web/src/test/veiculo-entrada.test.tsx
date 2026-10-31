// @vitest-environment jsdom
// Veículo na entrada: bloco "A pé" / "Com veículo" (teclado, foco na placa, validação) e a sugestão "Mesmo da última
// visita" na tela de entrada, com o resumo e o que falta para confirmar.
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api';
import type { Api, PessoaBusca } from '../api/types';
import { ToastProvider } from '../components/Toast';
import { BlocoVeiculo, EntradaPage, VEICULO_VAZIO, type VeiculoForm } from '../features/portaria/EntradaPage';
import type { VeiculoAcesso } from '@portaria/domain/types';

const { PID, UID, UNID } = vi.hoisted(() => {
  const UID = '22222222-2222-4222-8222-222222222222';
  return { PID: '11111111-1111-4111-8111-111111111111', UID, UNID: { id: UID, bloco: 'D', numero: '32', ativo: true } };
});

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ usuario: { id: 'u1', nome: 'Paulo', papel: 'porteiro' } }),
  useCan: () => true,
}));
vi.mock('../app/catalogo', () => {
  const cat = {
    pronto: true, agrupamento: 'bloco', unidades: [UNID], ativas: [UNID], areasComuns: [],
    porId: (id: string) => (id === UID ? UNID : undefined), codigo: () => 'D-32', rotulo: () => 'BLOCO D · AP 32',
    porTexto: () => UNID, porBlocoNumero: (b: string, n: string) => (b === 'D' && n === '32' ? UNID : undefined),
    areaNome: () => '', recarregar: async () => undefined,
  };
  return { useCatalogo: () => cat };
});

afterEach(() => cleanup());

const ULTIMO: VeiculoAcesso = { placa: 'ABC1D23', modelo: 'Onix', cor: 'Prata' };

function Controlado({ ultimo = null, aoMudar }: { ultimo?: VeiculoAcesso | null; aoMudar?: (v: VeiculoForm) => void }) {
  const [v, setV] = useState<VeiculoForm>(VEICULO_VAZIO);
  return <BlocoVeiculo valor={v} ultimo={ultimo} onChange={(x) => { setV(x); aoMudar?.(x); }} />;
}

describe('BlocoVeiculo', () => {
  it('"A pé" é o padrão; "Com veículo" abre placa (com foco), modelo e cor', async () => {
    render(<Controlado />);
    expect((screen.getByRole('radio', { name: 'A pé' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText(/Placa/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Com veículo' }));
    const placa = await screen.findByLabelText(/Placa/);
    await waitFor(() => expect(document.activeElement).toBe(placa));
    expect(screen.getByLabelText('Modelo')).toBeTruthy();
    expect(screen.getByLabelText('Cor')).toBeTruthy();
  });

  it('placa: máscara com hífen; 7 caracteres fora do padrão mostram o erro', async () => {
    render(<Controlado />);
    fireEvent.click(screen.getByRole('radio', { name: 'Com veículo' }));
    const placa = await screen.findByLabelText(/Placa/) as HTMLInputElement;
    fireEvent.change(placa, { target: { value: 'abc1d23' } });
    expect(placa.value).toBe('ABC-1D23');
    expect(screen.queryByText(/fora do padrão/)).toBeNull();
    fireEvent.change(placa, { target: { value: 'ABCD123' } });
    expect(screen.getByText(/fora do padrão/)).toBeTruthy();
  });

  it('"Mesmo da última visita" preenche placa, modelo e cor e marca "Com veículo"', async () => {
    const aoMudar = vi.fn();
    render(<Controlado ultimo={ULTIMO} aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole('button', { name: /Mesmo da última visita: ABC-1D23 · Onix · Prata/ }));
    expect(aoMudar).toHaveBeenLastCalledWith({ comVeiculo: true, placa: 'ABC-1D23', modelo: 'Onix', cor: 'Prata' });
    expect((screen.getByRole('radio', { name: 'Com veículo' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('button', { name: /Mesmo da última visita/ })).toBeNull(); // já preenchido
  });
});

describe('EntradaPage: veículo', () => {
  function montar(ultimo: VeiculoAcesso | null) {
    const p = { id: PID, nome: 'Larissa Gomes', categoria: 'visitante', documentoTipo: 'cpf', documentoMascarado: '123.45*.***-**',
      ultimoAcesso: 'Sem acessos', unidadesVinculadas: [], unidadesVinculadasCodigos: [] } as unknown as PessoaBusca;
    const api = {
      pessoas: { ficha: vi.fn(async () => ({ pessoa: p, vinculos: [], eventos: [] })), buscar: vi.fn(async () => [p]), funcionario: vi.fn(async () => null) },
      restricoes: { verificar: vi.fn(async () => ({ restrita: false, alertas: [] })) },
      autorizacoes: { vigentes: vi.fn(async () => []) },
      vinculos: { autorizadores: vi.fn(async () => []) },
      eventos: { ultimoVeiculo: vi.fn(async () => ultimo) },
    } as unknown as Api;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiProvider api={api}><ToastProvider><MemoryRouter initialEntries={[`/entrada?pessoa=${PID}&unidade=${UID}`]}><EntradaPage /></MemoryRouter></ToastProvider></ApiProvider>
      </QueryClientProvider>,
    );
    return api;
  }

  it('consulta o último veículo da pessoa escolhida e oferece repetir; o resumo mostra o veículo', async () => {
    const api = montar(ULTIMO);
    const botao = await screen.findByRole('button', { name: /Mesmo da última visita/ });
    expect(api.eventos.ultimoVeiculo).toHaveBeenCalledWith(PID);
    const resumo = screen.getByRole('complementary', { name: 'Resumo do registro' });
    expect(resumo.textContent).toContain('A pé');
    fireEvent.click(botao);
    await waitFor(() => expect(resumo.textContent).toContain('ABC-1D23 · Onix · Prata'));
  });

  it('com veículo e sem placa válida, a confirmação aponta a placa como o que falta', async () => {
    montar(null);
    fireEvent.click(await screen.findByRole('radio', { name: 'Com veículo' }));
    await waitFor(() => expect(screen.getByText(/placa do veículo \(padrão antigo ou Mercosul\)/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Mesmo da última visita/ })).toBeNull();
  });
});
