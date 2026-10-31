import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { BotoesBloco, GradeAndares } from '../../components/TowerUnitPicker';
import { useCan } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { mensagemErro } from '../../app/useAsync';
import { useCatalogo } from '../../app/catalogo';
import { EditarUnidadeModal, UnidadeDetalhe } from './UnidadeDetalhePage';
import { compararBlocos } from '@portaria/domain/units';
import { useUnidadesDoBloco } from './useUnidades';
import { ErroCarregar, Esqueleto, Osso } from '../../components/Carregando';

/**
 * Unidades (RF-01): mestre-detalhe. À esquerda blocos + grade por andar (unidades do banco, inclusive as desativadas,
 * tracejadas); à direita o detalhe. A URL aceita o uuid ou o código legível (/unidades/D-32).
 * O resumo (destaque de cadastro completo) vem paginado por bloco: só o bloco aberto é carregado.
 */
export function UnidadesPage() {
  const nav = useNavigate();
  const { avisar } = useToast();
  const catalogo = useCatalogo();
  const podeEditar = useCan('unidade.editar');
  const [nova, setNova] = useState(false);
  const { id } = useParams();
  // Sem unidade na URL, nada fica selecionado: o bloco aberto é o primeiro do catálogo e o detalhe espera a escolha.
  const sel = id ? (catalogo.porId(id) ?? catalogo.porTexto(id)) : undefined;
  const blocos = useMemo(() => [...new Set(catalogo.unidades.map((u) => u.bloco))].sort(compararBlocos), [catalogo.unidades]);
  const [escolhido, setBloco] = useState<string | null>(sel?.bloco ?? null);
  const bloco = escolhido ?? blocos[0] ?? '';
  const lista = useUnidadesDoBloco(bloco);
  const resumos = useMemo(() => lista.data?.pages.flatMap((p) => p.itens) ?? [], [lista.data]);

  // Mudou a unidade (busca global, link): acompanha o bloco dela
  useEffect(() => { if (sel) setBloco(sel.bloco); }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const doBloco = catalogo.unidades.filter((u) => u.bloco === bloco);
  const numeros = doBloco.map((u) => u.numero).sort((a, b) => Number(a) - Number(b));
  const inativos = new Set(doBloco.filter((u) => !u.ativo).map((u) => u.numero));
  const completas = new Set(resumos.filter((u) => u.cadastroCompleto && u.unidade.bloco === bloco).map((u) => u.unidade.numero));
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col xl:sticky xl:top-0 gap-3 rounded-[10px] border border-[#DCE1E5] bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">Unidades</h2>
          {podeEditar && <Button variante="contorno" pequeno onClick={() => setNova(true)}>Nova unidade</Button>}
        </div>
        <BotoesBloco bloco={bloco} onEscolher={setBloco} variante="lista" blocos={blocos} />
        {lista.isLoading ? (
          <Esqueleto rotulo="unidades do bloco" className="grid grid-cols-4 gap-2">
            {Array.from({ length: 16 }, (_, i) => <Osso key={i} className="h-10 rounded-lg" />)}
          </Esqueleto>
        ) : <GradeAndares bloco={bloco} numero={sel?.bloco === bloco ? sel.numero : null} numeros={numeros} inativos={inativos}
          variante="lista" destaque={completas} onEscolher={(n) => { const u = doBloco.find((x) => x.numero === n); if (u) nav(`/unidades/${u.id}`); }} />}
        <div className="text-[12px] text-[#56616B]">Destaque azul claro: unidades com cadastro completo (ao menos um morador com vínculo aprovado). Tracejadas: desativadas.</div>
        {lista.hasNextPage && (
          <Button onClick={() => void lista.fetchNextPage()} carregando={lista.isFetchingNextPage}>Carregar mais unidades</Button>
        )}
        {lista.error && <ErroCarregar mensagem={mensagemErro(lista.error)} onTentar={() => lista.refetch()} />}
      </div>
      {!id ? (
        <div className="rounded-[10px] border border-dashed border-[#C5CDD3] bg-white p-6 text-[14px] text-[#56616B]">Escolha um bloco e uma unidade para ver moradores, veículos, autorizações e acessos.</div>
      ) : catalogo.pronto && !sel ? <Alert tom="vermelho" role="alert">Unidade inexistente.</Alert> : <UnidadeDetalhe id={sel?.id ?? id} />}
      {nova && <EditarUnidadeModal id={null} onClose={() => setNova(false)} onFeito={(cod) => {
        setNova(false); avisar({ texto: `Unidade ${cod} cadastrada.` }); nav(`/unidades/${cod}`);
      }} />}
    </div>
  );
}
