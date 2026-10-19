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

const PADRAO = 'D-32';

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
  const ref = id ?? PADRAO;
  const sel = catalogo.porId(ref) ?? catalogo.porTexto(ref);
  const [bloco, setBloco] = useState<string>(sel?.bloco ?? 'D');
  const lista = useUnidadesDoBloco(bloco);
  const resumos = useMemo(() => lista.data?.pages.flatMap((p) => p.itens) ?? [], [lista.data]);

  // Mudou a unidade (busca global, link): acompanha o bloco dela
  useEffect(() => { if (sel) setBloco(sel.bloco); }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocos = useMemo(() => [...new Set(catalogo.unidades.map((u) => u.bloco))].sort(compararBlocos), [catalogo.unidades]);
  const doBloco = catalogo.unidades.filter((u) => u.bloco === bloco);
  const numeros = doBloco.map((u) => u.numero).sort((a, b) => Number(a) - Number(b));
  const inativos = new Set(doBloco.filter((u) => !u.ativo).map((u) => u.numero));
  const completas = new Set(resumos.filter((u) => u.cadastroCompleto && u.unidade.bloco === bloco).map((u) => u.unidade.numero));
  return (
    <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-5">
      <div className="sticky top-0 flex flex-col gap-3 rounded-[10px] border border-[#DCE1E5] bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">Unidades</h2>
          {podeEditar && <Button onClick={() => setNova(true)}>Nova unidade</Button>}
        </div>
        <BotoesBloco bloco={bloco} onEscolher={setBloco} variante="lista" blocos={blocos} />
        <GradeAndares bloco={bloco} numero={sel?.bloco === bloco ? sel.numero : null} numeros={numeros} inativos={inativos}
          variante="lista" destaque={completas} onEscolher={(n) => { const u = doBloco.find((x) => x.numero === n); if (u) nav(`/unidades/${u.id}`); }} />
        <div className="text-[12px] text-[#56616B]">Destaque azul claro: unidades com cadastro completo (ao menos um morador com vínculo aprovado). Tracejadas: desativadas.</div>
        {lista.hasNextPage && (
          <Button onClick={() => void lista.fetchNextPage()} disabled={lista.isFetchingNextPage}>
            {lista.isFetchingNextPage ? 'Carregando…' : 'Carregar mais unidades'}
          </Button>
        )}
        {lista.error && <Alert tom="vermelho" role="alert">{mensagemErro(lista.error)}</Alert>}
      </div>
      {catalogo.pronto && !sel ? <Alert tom="vermelho" role="alert">Unidade inexistente.</Alert> : <UnidadeDetalhe id={sel?.id ?? ref} />}
      {nova && <EditarUnidadeModal id={null} onClose={() => setNova(false)} onFeito={(cod) => {
        setNova(false); avisar({ texto: `Unidade ${cod} cadastrada.` }); nav(`/unidades/${cod}`);
      }} />}
    </div>
  );
}
