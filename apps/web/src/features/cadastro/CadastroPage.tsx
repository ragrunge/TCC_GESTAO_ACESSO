import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi, type PessoaBusca, type PessoaLista } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, ROTULO_VINCULO, type CategoriaPessoa } from '@portaria/domain/types';
import { mensagemErro } from '../../app/useAsync';
import { APOS_PESSOA, CHAVES, useDebounce, useInvalidar } from '../../app/consultas';
import { FichaPessoaModal } from './FichaPessoaModal';
import { NovaPessoaModal } from './NovaPessoaForm';

const POR_PAGINA = 50;
/** Busca da tela: até 50 resultados (texto livre vai no corpo do POST, nunca na URL: pode ser CPF). */
const LIMITE_BUSCA = 50;
const COLUNAS = 'minmax(0,1.4fr) minmax(0,1fr) 100px 170px';

export function CadastroPage() {
  const api = useApi();
  const { avisar } = useToast();
  const podeCriar = useCan('pessoa.cadastrar_morador');
  const invalidar = useInvalidar();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'todas' | CategoriaPessoa>('todas');
  const [ficha, setFicha] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const termo = useDebounce(q.trim(), 200);
  const buscando = termo.length >= 2;

  // Sem texto: a lista inteira, paginada no servidor (categoria filtra lá).
  const lista = useInfiniteQuery({
    queryKey: CHAVES.pessoasLista(cat),
    queryFn: ({ pageParam }) => api.pessoas.listarPagina({ categoria: cat === 'todas' ? undefined : cat, cursor: pageParam, limite: POR_PAGINA }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    enabled: !buscando,
    staleTime: 0,
  });
  // Com texto: a mesma busca da portaria (nome, CPF, unidade, placa); a categoria filtra o resultado.
  const busca = useQuery({
    queryKey: CHAVES.pessoasBusca(termo),
    queryFn: () => api.pessoas.buscar(termo, { limite: LIMITE_BUSCA }),
    enabled: buscando,
    staleTime: 0,
    gcTime: 30_000,
  });

  const linhas: (PessoaBusca | PessoaLista)[] = buscando
    ? (busca.data ?? []).filter((p) => cat === 'todas' || p.categoria === cat)
    : (lista.data?.pages.flatMap((p) => p.itens) ?? []);
  const carregando = buscando ? busca.isLoading : lista.isLoading;
  const erro = buscando ? busca.error : lista.error;

  function linhaDe(p: PessoaBusca | PessoaLista) {
    const v = 'vinculoPrincipal' in p ? p.vinculoPrincipal : null;
    return {
      tipo: v ? ROTULO_VINCULO[v.tipo] : ROTULO_CATEGORIA[p.categoria],
      unidade: v?.unidadeId ?? p.unidadesVinculadas[0] ?? null,
      status: v ? <SeloVinculo status={v.status} /> : <Badge tom="neutro">{ROTULO_CATEGORIA[p.categoria]}</Badge>,
    };
  }

  const contagem = buscando
    ? `${linhas.length} pessoa(s)${(busca.data?.length ?? 0) >= LIMITE_BUSCA ? ' (refine a busca)' : ''}`
    : `${linhas.length} pessoa(s)${lista.hasNextPage ? ' carregada(s)' : ''}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Pessoas" descricao="Moradores com vínculo e pessoas cadastradas na portaria. Clique para abrir a ficha da pessoa."
        acoes={podeCriar && <Button variante="primario" onClick={() => setNovo(true)}>Nova pessoa</Button>} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Buscar por nome, documento ou unidade" className="w-full sm:w-96"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="Tipo"><select className="input" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)}>
          <option value="todas">Todos</option>{(Object.keys(ROTULO_CATEGORIA) as CategoriaPessoa[]).map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}
        </select></Field>
        <p className="pb-2.5 text-[14px] text-[#56616B]" aria-live="polite">{contagem}</p>
      </div>
      {erro && <Alert tom="vermelho" role="alert">{mensagemErro(erro)}</Alert>}
      <Lista legenda="Pessoas cadastradas" colunas={COLUNAS} empilhar>
        <ListaCab rotulos={['Nome', 'Vínculo ou tipo', 'Unidade', 'Status']} />
        {linhas.map((p) => {
          const l = linhaDe(p);
          return (
            <ListaLinha key={p.id} padY={8} onClick={() => setFicha(p.id)} ariaLabel={`Abrir ficha de ${p.nome}`}>
              <Cel className="truncate font-medium">{p.nome}</Cel>
              <Cel className="text-[14px]">{l.tipo}</Cel>
              <CelUnidade id={l.unidade} />
              <Cel>{l.status}</Cel>
            </ListaLinha>
          );
        })}
        {!carregando && linhas.length === 0 && <Vazio>Nenhuma pessoa encontrada.</Vazio>}
      </Lista>
      {!buscando && lista.hasNextPage && (
        <Button className="self-start" carregando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>Carregar mais</Button>
      )}
      {ficha && <FichaPessoaModal id={ficha} onClose={() => setFicha(null)} />}
      {novo && <NovaPessoaModal onClose={() => setNovo(false)} onFeito={(p) => { setNovo(false); avisar({ texto: `${p.nome} cadastrado(a).` }); void invalidar(APOS_PESSOA); }} />}
    </div>
  );
}
