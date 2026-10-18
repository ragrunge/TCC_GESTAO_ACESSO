// Server state de unidades (React Query v5). A lista pagina por torre (a grade mostra uma torre por vez): nada de
// baixar as 165 com resumo de uma vez. O catálogo leve (todas, sem resumo) continua no CatalogoProvider.
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi, type NovaUnidadeInput } from '../../api';
import { CHAVES } from '../../app/consultas';

const POR_PAGINA = 50;

export function useUnidadesDaTorre(torre: number) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: CHAVES.unidadesDaTorre(torre),
    queryFn: ({ pageParam }) => api.unidades.listarPagina({ torre, cursor: pageParam, limite: POR_PAGINA }),
    initialPageParam: null as string | null,
    // `undefined` encerra a paginação (null não encerra no v5).
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    staleTime: 0, // vínculos aprovados em outra tela mudam o destaque de "cadastro completo"
  });
}

/**
 * `ref`: uuid ou código "T4-32". A tela abre por "/unidades/T4-32" e troca para o uuid quando o catálogo carrega: sem
 * `keepPreviousData` a troca de chave zera o dado e desmonta o modal que o usuário já tinha aberto.
 */
export function useUnidadeDetalhe(ref: string) {
  const api = useApi();
  return useQuery({ queryKey: CHAVES.unidade(ref), queryFn: () => api.unidades.detalhe(ref), staleTime: 0, placeholderData: keepPreviousData });
}

/** Toda escrita de unidade invalida o catálogo (seletores, códigos) e tudo que é de unidade (resumo, detalhe). */
export function useInvalidarUnidades() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: CHAVES.catalogo }),
    qc.invalidateQueries({ queryKey: CHAVES.unidades }),
  ]).then(() => undefined);
}

export function useAcoesUnidade() {
  const api = useApi();
  const invalidar = useInvalidarUnidades();
  return {
    criar: useMutation({ mutationFn: (i: NovaUnidadeInput) => api.unidades.criar(i), onSuccess: invalidar }),
    editar: useMutation({ mutationFn: (i: NovaUnidadeInput & { id: string }) => api.unidades.editar(i), onSuccess: invalidar }),
    // ativo -> desativar; inativo -> reativar. 409 (já estava assim) também invalida: a tela volta ao estado do servidor.
    alternarAtivo: useMutation({
      mutationFn: (u: { id: string; ativo: boolean }) => (u.ativo ? api.unidades.desativar(u.id) : api.unidades.reativar(u.id)),
      onSettled: invalidar,
    }),
  };
}
