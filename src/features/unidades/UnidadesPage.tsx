import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../api';
import { Alert } from '../../components/Alert';
import { BotoesTorre, GradeAndares } from '../../components/TowerUnitPicker';
import { parseUnidadeId, unidadeId } from '../../domain/units';
import { useAsync } from '../../app/useAsync';
import { UnidadeDetalhe } from './UnidadeDetalhePage';

const PADRAO = 'T4-32';

/** Unidades: mestre-detalhe. À esquerda torres + grade por andar; à direita o detalhe da unidade escolhida. */
export function UnidadesPage() {
  const api = useApi();
  const nav = useNavigate();
  const { id } = useParams();
  const selecionada = id && parseUnidadeId(id) ? id : PADRAO;
  const [torre, setTorre] = useState(parseUnidadeId(selecionada)!.torre);
  const lista = useAsync(() => api.unidades.listar(), []);

  // Mudou a unidade (busca global, link): acompanha a torre dela
  useEffect(() => { const p = parseUnidadeId(selecionada); if (p) setTorre(p.torre); }, [selecionada]);

  const completas = new Set((lista.data ?? []).filter((u) => u.cadastroCompleto && u.unidade.torre === torre).map((u) => u.unidade.numero));
  return (
    <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-5">
      <div className="sticky top-0 flex flex-col gap-3 rounded-[10px] border border-[#DCE1E5] bg-white p-4">
        <h2 className="text-[16px] font-semibold">Unidades</h2>
        <BotoesTorre torre={torre} onEscolher={setTorre} variante="lista" rotulo="Torre" />
        <GradeAndares torre={torre} numero={parseUnidadeId(selecionada)?.torre === torre ? parseUnidadeId(selecionada)!.numero : null}
          variante="lista" destaque={completas} onEscolher={(n) => nav(`/unidades/${unidadeId(torre, n)}`)} />
        <div className="text-[12px] text-[#56616B]">Destaque azul claro: unidades com cadastro completo (ao menos um morador com vínculo aprovado).</div>
        {lista.error && <Alert tom="vermelho" role="alert">{lista.error}</Alert>}
      </div>
      <UnidadeDetalhe id={selecionada} />
    </div>
  );
}
