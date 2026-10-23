// @vitest-environment jsdom
// Tempo de permanência na portaria (spec §14 2026-10-23): coluna Permanência de "Presentes agora" (estado em texto e
// ícone, não só cor), seletor do tipo de visita na entrada (rádios nativos, um grupo) e a rota de prorrogação no cliente.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { brt } from '@portaria/domain/time';
import { createHttpApi } from '../api/http/createHttpApi';
import { CelPermanencia } from '../features/portaria/PessoasDentroPage';
import { SeletorTipoVisita } from '../features/portaria/EntradaPage';

afterEach(() => cleanup());

const MIN = 60_000;
const entrada = brt(2026, 10, 23, 14, 0);

describe('CelPermanencia', () => {
  it('no prazo: decorrido, tipo e "Até HH:MM"', () => {
    render(<CelPermanencia entradaEm={entrada} agora={entrada + 65 * MIN} permanencia={{ tipoVisita: 'visita', prazoAte: entrada + 240 * MIN, prorrogacoes: 0 }} />);
    expect(screen.getByText('1h05')).toBeTruthy();
    expect(screen.getByText(/Visita/)).toBeTruthy();
    expect(screen.getByText('Até 18:00')).toBeTruthy();
  });

  it('vence em ≤ 15 min: texto "Vence em X"', () => {
    const { container } = render(<CelPermanencia entradaEm={entrada} agora={entrada + 20 * MIN} permanencia={{ tipoVisita: 'entrega', prazoAte: entrada + 30 * MIN, prorrogacoes: 0 }} />);
    expect(screen.getByText(/Vence em 10min/)).toBeTruthy();
    expect(screen.getByText(/Entregador/)).toBeTruthy();
    expect(container.querySelector('svg')).not.toBeNull(); // ícone além da cor
  });

  it('expirado: "Expirado há X" e o nº de prorrogações', () => {
    render(<CelPermanencia entradaEm={entrada} agora={entrada + 100 * MIN} permanencia={{ tipoVisita: 'transporte_app', prazoAte: entrada + 75 * MIN, prorrogacoes: 1 }} />);
    expect(screen.getByText(/Expirado há 25min/)).toBeTruthy();
    expect(screen.getByText('· prorrogado 1×')).toBeTruthy();
  });

  it('sem prazo gravado (morador, funcionário, entrada antiga): o alerta de 8 h de antes', () => {
    render(<CelPermanencia entradaEm={entrada} agora={entrada + 9 * 60 * MIN} permanencia={null} />);
    expect(screen.getByText('acima de 8h')).toBeTruthy();
  });
});

describe('SeletorTipoVisita', () => {
  it('um grupo de rádios nativos (teclado: setas), com o prazo de cada tipo; troca pelo clique no rótulo', () => {
    const onChange = vi.fn();
    render(<SeletorTipoVisita valor="visita" onChange={onChange} />);
    const grupo = screen.getByRole('group', { name: /Tipo de visita/ });
    expect(grupo).toBeTruthy();
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.name)).toEqual(['tipo-visita', 'tipo-visita', 'tipo-visita', 'tipo-visita']);
    expect(screen.getByRole('radio', { name: /Visita/ })).toHaveProperty('checked', true);
    expect(screen.getByText('30 min')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Motorista de app/ }));
    expect(onChange).toHaveBeenCalledWith('transporte_app');
  });
});

describe('cliente HTTP: prorrogação', () => {
  it('POST /eventos-acesso/:id/permanencia/prorrogacoes sem corpo; resposta desembrulhada', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => ({
      status: 201, statusText: '', headers: {}, config, request: {},
      data: { data: { eventoId: 'ev1', tipoVisita: 'entrega', prazoAte: entrada + 90 * MIN, prorrogacoes: 1 } },
    }));
    const api = createHttpApi('/api/v1', { adapter });
    const r = await api.eventos.prorrogarPermanencia('ev1');
    expect(r).toEqual({ eventoId: 'ev1', tipoVisita: 'entrega', prazoAte: entrada + 90 * MIN, prorrogacoes: 1 });
    expect(adapter.mock.calls[0]![0]).toMatchObject({ method: 'post', url: '/eventos-acesso/ev1/permanencia/prorrogacoes' });
  });
});
