import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../api';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { BotoesTorre, GradeAndares } from '../../components/TowerUnitPicker';
import { useCan } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { useAsync } from '../../app/useAsync';
import { useCatalogo } from '../../app/catalogo';
import { EditarUnidadeModal, UnidadeDetalhe } from './UnidadeDetalhePage';

const PADRAO = 'T4-32';

/**
 * Unidades (RF-01): mestre-detalhe. À esquerda torres + grade por andar (unidades do banco, inclusive as desativadas,
 * tracejadas); à direita o detalhe. A URL aceita o uuid ou o código legível (/unidades/T4-32).
 */
export function UnidadesPage() {
  const api = useApi();
  const nav = useNavigate();
  const { avisar } = useToast();
  const catalogo = useCatalogo();
  const podeEditar = useCan('unidade.editar');
  const [nova, setNova] = useState(false);
  const { id } = useParams();
  const ref = id ?? PADRAO;
  const sel = catalogo.porId(ref) ?? catalogo.porTexto(ref);
  const [torre, setTorre] = useState<number>(sel?.torre ?? 4);
  const lista = useAsync(() => api.unidades.listar(), [catalogo.unidades]);

  // Mudou a unidade (busca global, link): acompanha a torre dela
  useEffect(() => { if (sel) setTorre(sel.torre); }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const torres = useMemo(() => [...new Set(catalogo.unidades.map((u) => u.torre))].sort((a, b) => a - b), [catalogo.unidades]);
  const daTorre = catalogo.unidades.filter((u) => u.torre === torre);
  const numeros = daTorre.map((u) => u.numero).sort((a, b) => Number(a) - Number(b));
  const inativos = new Set(daTorre.filter((u) => !u.ativo).map((u) => u.numero));
  const completas = new Set((lista.data ?? []).filter((u) => u.cadastroCompleto && u.unidade.torre === torre).map((u) => u.unidade.numero));
  return (
    <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-5">
      <div className="sticky top-0 flex flex-col gap-3 rounded-[10px] border border-[#DCE1E5] bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">Unidades</h2>
          {podeEditar && <Button onClick={() => setNova(true)}>Nova unidade</Button>}
        </div>
        <BotoesTorre torre={torre} onEscolher={setTorre} variante="lista" rotulo="Torre" torres={torres} />
        <GradeAndares torre={torre} numero={sel?.torre === torre ? sel.numero : null} numeros={numeros} inativos={inativos}
          variante="lista" destaque={completas} onEscolher={(n) => { const u = daTorre.find((x) => x.numero === n); if (u) nav(`/unidades/${u.id}`); }} />
        <div className="text-[12px] text-[#56616B]">Destaque azul claro: unidades com cadastro completo (ao menos um morador com vínculo aprovado). Tracejadas: desativadas.</div>
        {lista.error && <Alert tom="vermelho" role="alert">{lista.error}</Alert>}
      </div>
      {catalogo.pronto && !sel ? <Alert tom="vermelho" role="alert">Unidade inexistente.</Alert> : <UnidadeDetalhe id={sel?.id ?? ref} />}
      {nova && <EditarUnidadeModal id={null} onClose={() => setNova(false)} onFeito={async (cod) => {
        await catalogo.recarregar(); setNova(false); avisar({ texto: `Unidade ${cod} cadastrada.` }); nav(`/unidades/${cod}`);
      }} />}
    </div>
  );
}
