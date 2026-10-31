import { useState } from 'react';
import { Ban, Check } from 'lucide-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi, type PessoaBusca, type PessoaLista, type RestricaoResumo } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Cel, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, ROTULO_VINCULO, type CategoriaPessoa } from '@portaria/domain/types';
import { mensagemErro } from '../../app/useAsync';
import { useCatalogo } from '../../app/catalogo';
import { APOS_PESSOA, CHAVES, useDebounce, useInvalidar } from '../../app/consultas';
import { FichaPessoaModal } from './FichaPessoaModal';
import { NovaPessoaModal } from './NovaPessoaForm';
import { BarraFiltros, CampoFiltro, CONTROLE, ContagemResultado, FiltroBusca, FiltroCheck, lerOpcao, naUrl, useFiltrosUrl } from '../../components/Filtros';

const POR_PAGINA = 50;
/** Busca da tela: até 50 resultados (texto livre vai no corpo do POST, nunca na URL: pode ser CPF). */
const LIMITE_BUSCA = 50;
// Nome, vínculo ou tipo, CPF · telefone (mascarados), unidade e situação. O CPF e o telefone separam homônimos.
const COLUNAS = 'minmax(0,1.3fr) minmax(0,0.9fr) minmax(290px,1.1fr) 80px 112px';

/** Texto do selo de restrição (sem motivo: o detalhe fica na unidade e na portaria). */
function textoRestricao(r: RestricaoResumo) {
  if (r.estado === 'pendente') return 'Restrição pendente';
  const mais = r.total > 1 ? ` +${r.total - 1}` : '';
  return r.unidadeCodigo ? `Restrito na ${r.unidadeCodigo}${mais}` : `Restrito no condomínio${mais}`;
}

export function CadastroPage() {
  const api = useApi();
  const { avisar } = useToast();
  const podeCriar = useCan('pessoa.cadastrar_morador');
  const invalidar = useInvalidar();
  const { codigo } = useCatalogo();
  // A busca (pode ser CPF) fica só no estado. Tipo e "desativados" vão para a URL (tipo=, desativados=1).
  const { params, gravar } = useFiltrosUrl();
  const [q, setQ] = useState('');
  const cat = lerOpcao(params.get('tipo'), ['todas', ...Object.keys(ROTULO_CATEGORIA)] as ('todas' | CategoriaPessoa)[], 'todas');
  // RF-02: desativados ficam fora por padrão (como na portaria); aqui dá para vê-los e reativá-los pela ficha.
  const desativados = params.get('desativados') === '1';
  const [ficha, setFicha] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const termo = useDebounce(q.trim(), 200);
  const buscando = termo.length >= 2;

  // Sem texto: a lista inteira, paginada no servidor (categoria filtra lá).
  const lista = useInfiniteQuery({
    queryKey: CHAVES.pessoasLista(cat, desativados),
    queryFn: ({ pageParam }) => api.pessoas.listarPagina({ categoria: cat === 'todas' ? undefined : cat, cursor: pageParam, limite: POR_PAGINA, incluirDesativadas: desativados }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    enabled: !buscando,
    staleTime: 0,
  });
  // Com texto: a mesma busca da portaria (nome, CPF, unidade, placa); a categoria filtra o resultado.
  const busca = useQuery({
    queryKey: CHAVES.pessoasBusca(termo, desativados),
    queryFn: () => api.pessoas.buscar(termo, { limite: LIMITE_BUSCA, incluirDesativadas: desativados }),
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
    // Lista e busca trazem a restrição (ausente para quem não vê restrições)
    const r = p.restricao ?? null;
    const unidade = v?.unidadeId ?? p.unidadesVinculadas[0] ?? null;
    // Demais unidades com vínculo válido além da mostrada (ex.: proprietário de duas)
    const outras = p.unidadesVinculadas.filter((u) => u !== unidade).length;
    return {
      tipo: v ? ROTULO_VINCULO[v.tipo] : ROTULO_CATEGORIA[p.categoria],
      // Vínculo aprovado é o normal: selo só quando falta algo (pendente, legado) ou acabou (rejeitado, encerrado)
      selo: v && v.status !== 'aprovado' ? <SeloVinculo status={v.status} tamanho="xs" /> : null,
      unidade: unidade ? `${codigo(unidade)}${outras ? ` +${outras}` : ''}` : null,
      documento: [p.documentoMascarado, p.telefoneMascarado].filter(Boolean).join(' · '),
      // Situação do cadastro (RF-02), separada do vínculo. Desativado não é alerta: cinza.
      restricao: r ? textoRestricao(r) : null,
      situacao: p.desativadaEm ? <Badge tom="neutro" icone={Ban}>Desativado</Badge> : <Badge tom="verde" icone={Check}>Ativo</Badge>,
    };
  }

  const sufixoContagem = buscando
    ? ((busca.data?.length ?? 0) >= LIMITE_BUSCA ? '(refine a busca)' : '')
    : lista.hasNextPage ? (linhas.length === 1 ? 'carregada' : 'carregadas') : '';
  const ativos = [!!q.trim(), cat !== 'todas', desativados].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Cadastro de pessoas" descricao="Moradores com vínculo e pessoas cadastradas na portaria. Clique para abrir a ficha da pessoa."
        acoes={podeCriar && <Button variante="primario" onClick={() => setNovo(true)}>Nova pessoa</Button>} />
      <BarraFiltros ativos={ativos} principalAtivo={!!q.trim()} onLimpar={() => { setQ(''); gravar({ tipo: undefined, desativados: undefined }); }}
        principal={<FiltroBusca rotulo="Buscar por nome, CPF, unidade ou placa" value={q} onChange={setQ} />}>
        <CampoFiltro rotulo="Tipo" largura="md:w-48">
          <select className={CONTROLE} value={cat} onChange={(e) => gravar({ tipo: naUrl(e.target.value, 'todas') })}>
            <option value="todas">Todos</option>{(Object.keys(ROTULO_CATEGORIA) as CategoriaPessoa[]).map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}
          </select>
        </CampoFiltro>
        <FiltroCheck rotulo="Mostrar desativados" checked={desativados} onChange={(v) => gravar({ desativados: v ? '1' : undefined })} />
      </BarraFiltros>
      <ContagemResultado n={linhas.length} singular="pessoa" plural="pessoas" sufixo={sufixoContagem} className="-mb-2 px-1" />
      {erro && <Alert tom="vermelho" role="alert">{mensagemErro(erro)}</Alert>}
      <Lista legenda="Pessoas cadastradas" colunas={COLUNAS} empilhar carregando={carregando}>
        <ListaCab rotulos={['Nome', 'Vínculo ou tipo', 'CPF · telefone', 'Unidade', 'Situação']} />
        {linhas.map((p) => {
          const l = linhaDe(p);
          // No celular (cartão de 2 colunas): nome e situação, tipo e unidade, documento embaixo
          return (
            <ListaLinha key={p.id} minH={52} padY={8} onClick={() => setFicha(p.id)}
              ariaLabel={`Abrir ficha de ${p.nome}${l.restricao ? ` (${l.restricao})` : ''}`}>
              {/* Selo embaixo do nome: ao lado, ele cortava o nome em 1280 px */}
              <Cel className="order-1 flex min-w-0 flex-col items-start gap-1 md:order-none">
                <span className="max-w-full truncate font-semibold">{p.nome}</span>
                {l.restricao && <Badge tom="vermelho" icone={Ban} tamanho="xs" className="shrink-0">{l.restricao}</Badge>}
              </Cel>
              <Cel className="order-3 flex flex-wrap items-center gap-1.5 text-[14px] md:order-none">{l.tipo}{l.selo}</Cel>
              <Cel className="order-5 col-span-2 truncate font-mono text-[13px] text-[#33424B] md:order-none md:col-span-1">{l.documento || <span className="font-sans text-[#56616B]">—</span>}</Cel>
              <Cel className="order-4 justify-self-end font-mono font-semibold md:order-none md:justify-self-auto">{l.unidade ?? <span className="font-sans font-normal text-[#56616B]">—</span>}</Cel>
              <Cel className="order-2 justify-self-end md:order-none md:justify-self-auto">{l.situacao}</Cel>
            </ListaLinha>
          );
        })}
        {!carregando && !erro && linhas.length === 0 && <Vazio>Nenhuma pessoa encontrada.</Vazio>}
      </Lista>
      {!buscando && lista.hasNextPage && (
        <Button className="self-start" carregando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>Carregar mais</Button>
      )}
      {ficha && <FichaPessoaModal id={ficha} onClose={() => setFicha(null)} />}
      {novo && <NovaPessoaModal onClose={() => setNovo(false)} onFeito={(p) => { setNovo(false); avisar({ texto: `${p.nome} cadastrado(a).` }); void invalidar(APOS_PESSOA); }}
        onExistente={(pid) => { setNovo(false); setFicha(pid); void invalidar(APOS_PESSOA); }} />}
    </div>
  );
}
