// @vitest-environment jsdom
// Pré-preenchimento da entrada a partir do painel: ?pessoa=<uuid>&unidade=<uuid> | &area=<uuid> (preservando retroativo).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api';
import type { Api, PessoaBusca } from '../api/types';
import { ToastProvider } from '../components/Toast';
import { EntradaPage } from '../features/portaria/EntradaPage';

const { PID, UID, AID, UNID, AREA } = vi.hoisted(() => {
  const UID = '22222222-2222-4222-8222-222222222222';
  const AID = '33333333-3333-4333-8333-333333333333';
  return {
    PID: '11111111-1111-4111-8111-111111111111', UID, AID,
    UNID: { id: UID, bloco: 'D', numero: '32', ativo: true }, AREA: { id: AID, nome: 'Salão de festas', ativo: true },
  };
});

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ usuario: { id: 'u1', nome: 'Paulo', papel: 'porteiro' } }),
  useCan: () => true,
}));
vi.mock('../app/catalogo', () => {
  const cat = {
    pronto: true, agrupamento: 'bloco', unidades: [UNID], ativas: [UNID], areasComuns: [AREA],
    porId: (id: string) => (id === UID ? UNID : undefined), codigo: () => 'D-32', rotulo: () => 'BLOCO D · AP 32',
    porTexto: () => UNID, porBlocoNumero: (b: string, n: string) => (b === 'D' && n === '32' ? UNID : undefined),
    areaNome: () => AREA.nome, recarregar: async () => undefined,
  };
  return { useCatalogo: () => cat };
});

const pessoa = (categoria: PessoaBusca['categoria'], extra: Partial<PessoaBusca> = {}) => ({
  id: PID, nome: 'Larissa Gomes', categoria, documentoTipo: 'cpf', documentoMascarado: '123.45*.***-**',
  ultimoAcesso: 'Sem acessos', unidadesVinculadas: [], unidadesVinculadasCodigos: [], ...extra,
}) as PessoaBusca;

function montar(url: string, p: PessoaBusca = pessoa('visitante')) {
  const api = {
    pessoas: {
      ficha: vi.fn(async () => ({ pessoa: p, vinculos: [], eventos: [] })),
      buscar: vi.fn(async () => [p]),
      funcionario: vi.fn(async () => null),
    },
    restricoes: { verificar: vi.fn(async () => ({ restrita: false, alertas: [] })) },
    autorizacoes: { vigentes: vi.fn(async () => []) },
    vinculos: { autorizadores: vi.fn(async () => []) },
  } as unknown as Api;
  let loc = '';
  const Espia = () => { const l = useLocation(); loc = l.pathname + l.search; return null; };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider api={api}><ToastProvider><MemoryRouter initialEntries={[url]}><Espia /><EntradaPage /></MemoryRouter></ToastProvider></ApiProvider>
    </QueryClientProvider>,
  );
  return { api, local: () => loc };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('EntradaPage: pré-preenchimento por query params', () => {
  it('pessoa + unidade: seleciona os dois, consulta autorizações e limpa os params mantendo retroativo', async () => {
    const { api, local } = montar(`/entrada?retroativo=1&pessoa=${PID}&unidade=${UID}`);
    await screen.findByRole('button', { name: 'Trocar' });
    await waitFor(() => expect(api.autorizacoes.vigentes).toHaveBeenCalledWith(PID, UID));
    expect(screen.getByRole('button', { name: 'Trocar' })).toBeTruthy();
    expect(local()).toBe('/entrada?retroativo=1');
  });

  it('prestador + área: seleciona a área comum', async () => {
    const { api } = montar(`/entrada?pessoa=${PID}&area=${AID}`, pessoa('prestador'));
    await waitFor(() => expect(api.autorizacoes.vigentes).toHaveBeenCalledWith(PID, AID, { areaComum: true }));
    expect(screen.getByRole('radio', { name: 'Salão de festas' }).getAttribute('aria-checked')).toBe('true');
  });

  it('área para quem não é prestador: ignora', async () => {
    const { api, local } = montar(`/entrada?pessoa=${PID}&area=${AID}`);
    await waitFor(() => expect(local()).toBe('/entrada'));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Trocar' })).toBeNull();
    expect(api.autorizacoes.vigentes).not.toHaveBeenCalled();
  });

  it.each([
    ['uuid inválido', '/entrada?pessoa=abc&unidade=xyz'],
    ['unidade inexistente', `/entrada?pessoa=${PID}&unidade=99999999-9999-4999-8999-999999999999`],
    ['sem destino', `/entrada?pessoa=${PID}`],
    ['unidade e área juntas', `/entrada?pessoa=${PID}&unidade=${UID}&area=${AID}`],
  ])('%s: tela vazia, sem chamar a API de pessoas quando o formato é inválido', async (_n, url) => {
    const { api, local } = montar(url);
    await waitFor(() => expect(local()).toBe('/entrada'));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Trocar' })).toBeNull();
    expect(api.autorizacoes.vigentes).not.toHaveBeenCalled();
  });

  it('pessoa desativada ou fora da busca: ignora sem quebrar', async () => {
    const { api, local } = montar(`/entrada?pessoa=${PID}&unidade=${UID}`, pessoa('visitante', { desativadaEm: 1 }));
    await waitFor(() => expect(api.pessoas.ficha).toHaveBeenCalled());
    await waitFor(() => expect(local()).toBe('/entrada'));
    expect(screen.queryByRole('button', { name: 'Trocar' })).toBeNull();
  });
});
