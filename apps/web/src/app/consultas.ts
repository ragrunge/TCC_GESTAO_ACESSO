// Server state compartilhado pelo Layout e pela tela de Unidades (React Query v5). Chaves num lugar só: quem escreve
// (CRUD de unidades, decisão de vínculo) invalida pelo prefixo, sem precisar conhecer cada tela que lê.
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api';

export const CHAVES = {
  catalogo: ['catalogo'] as const,
  /** Prefixo de tudo que é de unidade (lista por torre e detalhe). */
  unidades: ['unidades'] as const,
  unidadesDaTorre: (torre: number) => ['unidades', 'lista', torre] as const,
  unidade: (ref: string) => ['unidades', 'detalhe', ref] as const,
  /** Prefixo de tudo que é de vínculo: filas, contagens (badge) e autorizadores da unidade. */
  vinculos: ['vinculos'] as const,
  vinculosPendentes: ['vinculos', 'contagem', 'pendente'] as const,
  vinculosContagem: (status: string) => ['vinculos', 'contagem', status] as const,
  vinculosFila: (aba: string) => ['vinculos', 'fila', aba] as const,
  autorizadores: (unidadeId: string) => ['vinculos', 'autorizadores', unidadeId] as const,
  /** Prefixo de tudo que é de pessoa: lista do Cadastro, busca da tela e ficha. */
  pessoas: ['pessoas'] as const,
  pessoasLista: (categoria: string) => ['pessoas', 'lista', categoria] as const,
  /** O termo pode ser CPF: a chave fica só na memória (gcTime curto, nada de persistir o cache). */
  pessoasBusca: (q: string) => ['pessoas', 'busca', q] as const,
  ficha: (id: string) => ['pessoas', 'ficha', id] as const,
  funcionarios: ['funcionarios'] as const,
  /** Prefixo da busca do topo. */
  busca: ['busca'] as const,
  buscaGlobal: (q: string) => ['busca', 'global', q] as const,
  /** Prefixo de tudo que é trilha de acesso: histórico, últimas movimentações, presentes e correções. */
  eventos: ['eventos'] as const,
  eventosLista: (filtro: string) => ['eventos', 'lista', filtro] as const,
  eventosUltimos: ['eventos', 'ultimos'] as const,
  presentes: ['eventos', 'presentes'] as const,
  correcoes: (id: string) => ['eventos', 'correcoes', id] as const,
  operadores: ['eventos', 'operadores'] as const,
  turno: ['turno'] as const,
  autorizacoes: ['autorizacoes'] as const,
  autorizacoesHoje: ['autorizacoes', 'hoje'] as const,
  restricoes: ['restricoes'] as const,
  restricoesPendentes: ['restricoes', 'pendentes'] as const,
  /** Verificação da cadeia inteira: cara na API real; a gaveta reaproveita o resultado por alguns segundos. */
  integridade: ['auditoria', 'integridade'] as const,
  alteracoes: (acao: string) => ['auditoria', 'alteracoes', acao] as const,
};

/** Escritas que mudam vínculo: a fila, o badge, a unidade (moradores e resumo), a pessoa (ficha, categoria) e a busca. */
export const APOS_VINCULO = [CHAVES.vinculos, CHAVES.unidades, CHAVES.pessoas, CHAVES.busca] as const;
/** Escritas de pessoa: lista, ficha, busca, e os nomes nas filas de vínculo e nos funcionários. */
export const APOS_PESSOA = [CHAVES.pessoas, CHAVES.busca, CHAVES.vinculos, CHAVES.funcionarios] as const;
/** Escritas de veículo: o detalhe da unidade e a busca por placa. */
export const APOS_VEICULO = [CHAVES.unidades, CHAVES.busca] as const;
export const APOS_FUNCIONARIO = [CHAVES.funcionarios, CHAVES.pessoas, CHAVES.busca] as const;
/**
 * Registro de acesso (entrada, recusa, negado, saída, correção): presentes, turno e histórico; e também o detalhe da
 * unidade e a ficha (últimos acessos), a busca ("último acesso"), o uso das autorizações de hoje e a integridade.
 */
export const APOS_EVENTO = [CHAVES.eventos, CHAVES.turno, CHAVES.unidades, CHAVES.pessoas, CHAVES.busca, CHAVES.autorizacoes, CHAVES.integridade, ['auditoria', 'alteracoes']] as const;
/** Autorização prévia e restrição: o detalhe da unidade, o turno (contagens), as listas de hoje e as pendências. */
export const APOS_AUTORIZACAO = [...APOS_VINCULO, CHAVES.turno, CHAVES.autorizacoes, CHAVES.restricoes] as const;

/** Invalida os prefixos dados (resolve quando as consultas ativas recarregaram). */
export function useInvalidar() {
  const qc = useQueryClient();
  return (prefixos: readonly (readonly unknown[])[]) =>
    Promise.all(prefixos.map((k) => qc.invalidateQueries({ queryKey: k }))).then(() => undefined);
}

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
