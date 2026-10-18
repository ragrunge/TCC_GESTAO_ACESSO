// Server state compartilhado pelo Layout e pela tela de Unidades (React Query v5). Chaves num lugar só: quem escreve
// (CRUD de unidades, decisão de vínculo) invalida pelo prefixo, sem precisar conhecer cada tela que lê.
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '../api';

export const CHAVES = {
  catalogo: ['catalogo'] as const,
  /** Prefixo de tudo que é de unidade (lista por torre e detalhe). */
  unidades: ['unidades'] as const,
  unidadesDaTorre: (torre: number) => ['unidades', 'lista', torre] as const,
  unidade: (ref: string) => ['unidades', 'detalhe', ref] as const,
  vinculosPendentes: ['vinculos', 'contagem', 'pendente'] as const,
  buscaGlobal: (q: string) => ['busca', 'global', q] as const,
};

/** Valor que só muda depois de `ms` sem alteração (busca enquanto digita). */
export function useDebounce<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/** Badge "Vínculos pendentes". `staleTime: 0`: decisões em outras telas aparecem na próxima navegação. */
export function useContagemPendentes(habilitado: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: CHAVES.vinculosPendentes,
    queryFn: () => api.vinculos.contar('pendente'),
    enabled: habilitado,
    staleTime: 0,
  });
}

/**
 * Busca do topo (nome, CPF, unidade ou placa), a partir de 2 caracteres e 150 ms sem digitar. O termo pode ser um CPF:
 * a chave fica só na memória e sai dela 30 s depois de não ser mais usada (nada de persistir o cache).
 */
export function useBuscaGlobal(q: string) {
  const api = useApi();
  const termo = useDebounce(q.trim(), 150);
  const ativo = termo.length >= 2 && q.trim().length >= 2;
  return useQuery({
    queryKey: CHAVES.buscaGlobal(termo),
    queryFn: () => api.busca.global(termo),
    enabled: ativo,
    staleTime: 0,
    gcTime: 30_000,
    placeholderData: keepPreviousData, // sem piscar a lista entre uma tecla e outra
  });
}
