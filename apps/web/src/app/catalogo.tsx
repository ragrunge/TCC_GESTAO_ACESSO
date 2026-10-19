// Catálogo de unidades e áreas comuns vindo da API (RF-01, RF-36). A unidade tem id uuid; a UI mostra o código
// "D-32" derivado de bloco e número, e o rótulo com o nome do agrupamento que a API configura ("Bloco"/"Torre").
// Fica no Layout (exige sessão) e é recarregado depois do CRUD de unidades.
// React Query (chave CHAVES.catalogo): o CRUD de unidades invalida, e o logout limpa o cache (AuthContext).
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api';
import type { AreaComum, Unidade } from '@portaria/domain/types';
import { acharUnidadePorTexto, codigoUnidade, ESTRUTURA_PADRAO, rotuloUnidade, type Agrupamento } from '@portaria/domain/units';
import { CHAVES } from './consultas';

interface CatalogoCtx {
  pronto: boolean;
  /** "Bloco" ou "Torre" (da API); antes de o catálogo carregar, o padrão do domain. */
  agrupamento: Agrupamento;
  unidades: Unidade[];
  /** Só as ativas: novas entradas, encomendas, vínculos e o seletor de bloco/unidade. */
  ativas: Unidade[];
  areasComuns: AreaComum[];
  porId: (id: string | null | undefined) => Unidade | undefined;
  /** "D-32" (ou o próprio id, se a unidade ainda não carregou). */
  codigo: (id: string | null | undefined) => string;
  /** "BLOCO D · AP 32". */
  rotulo: (id: string | null | undefined, caixaAlta?: boolean) => string;
  /** Unidade de um texto livre ("D-32", "d 32"); `ativa` restringe às ativas. */
  porTexto: (texto: string, ativa?: boolean) => Unidade | undefined;
  /** Unidade ativa por bloco e número. */
  porBlocoNumero: (bloco: string, numero: string) => Unidade | undefined;
  areaNome: (id: string | null | undefined) => string;
  recarregar: () => Promise<void>;
}

const Ctx = createContext<CatalogoCtx | null>(null);

export function CatalogoProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const qc = useQueryClient();
  const cat = useQuery({ queryKey: CHAVES.catalogo, queryFn: () => api.catalogo.obter() });
  const recarregar = useCallback(() => qc.invalidateQueries({ queryKey: CHAVES.catalogo }), [qc]);
  const valor = useMemo((): CatalogoCtx => {
    const agrupamento = cat.data?.agrupamento ?? ESTRUTURA_PADRAO.agrupamento;
    const unidades = cat.data?.unidades ?? [];
    const areasComuns = cat.data?.areasComuns ?? [];
    const mapa = new Map(unidades.map((u) => [u.id, u]));
    const ativas = unidades.filter((u) => u.ativo);
    return {
      pronto: !!cat.data, agrupamento, unidades, ativas, areasComuns,
      porId: (id) => (id ? mapa.get(id) : undefined),
      codigo: (id) => { if (!id) return '—'; const u = mapa.get(id); return u ? codigoUnidade(u) : id; },
      rotulo: (id, caixaAlta = true) => { if (!id) return '—'; const u = mapa.get(id); return u ? rotuloUnidade(u, agrupamento, caixaAlta) : id; },
      porTexto: (texto, ativa = false) => acharUnidadePorTexto(ativa ? ativas : unidades, texto),
      porBlocoNumero: (bloco, numero) => ativas.find((u) => u.bloco === bloco && u.numero === numero),
      areaNome: (id) => areasComuns.find((a) => a.id === id)?.nome ?? '—',
      recarregar,
    };
  }, [cat.data, recarregar]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useCatalogo(): CatalogoCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCatalogo fora de <CatalogoProvider>');
  return c;
}
