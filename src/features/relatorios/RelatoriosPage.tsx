import { useApi } from '../../api';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { ROTULO_MEIO_CURTO } from '../../domain/types';
import { agora, fmtData, fmtDataCurta, DIA, partes } from '../../domain/time';
import { useAsync } from '../../app/useAsync';

const PETROLEO = '#0B5563';
const secao = 'flex flex-col gap-3 rounded-[10px] border border-[#DCE1E5] bg-white px-[22px] py-[18px]';

/** Barras horizontais (HTML/CSS). Os valores aparecem como texto, então não dependem de cor. */
function Barras({ itens, cor, rotuloVazio = 'Sem dados no período.' }: { itens: { rotulo: string; valor: number; cor?: string }[]; cor?: string; rotuloVazio?: string }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  if (itens.length === 0 || itens.every((i) => i.valor === 0)) return <p className="text-[#56616B]">{rotuloVazio}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {itens.map((i) => (
        <li key={i.rotulo} className="grid grid-cols-[170px_minmax(0,1fr)_48px] items-center gap-[10px]">
          <span className="truncate text-[14px]">{i.rotulo}</span>
          <span className="h-[14px] rounded-[3px] bg-[#EEF2F4]" aria-hidden><span className="block h-full rounded-[3px]" style={{ width: `${(i.valor / max) * 100}%`, background: i.cor ?? cor ?? PETROLEO }} /></span>
          <span className="text-right font-mono text-[14px]">{i.valor}</span>
        </li>
      ))}
    </ul>
  );
}

export function RelatoriosPage() {
  const api = useApi();
  const rel = useAsync(() => api.relatorios.resumo(30), []);
  const r = rel.data;
  const maxDia = Math.max(1, ...(r?.acessosPorDia.map((d) => d.entradas) ?? [1]));
  const pct = r ? Math.round((r.cadastroCompleto.unidadesCompletas / r.cadastroCompleto.total) * 100) : 0;
  const fim = agora();
  const cores = ['#0B5563', '#0B5563', '#DC6803', '#B42318'];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Relatórios" descricao={`Últimos 30 dias · ${fmtDataCurta(fim - 29 * DIA)} a ${fmtData(fim)}`}
        acoes={<Button variante="primario" onClick={() => window.print()}>Exportar PDF</Button>} />
      {rel.error && <Alert tom="vermelho" role="alert">{rel.error}</Alert>}
      {r && (
        <>
          <section className="rounded-[10px] border border-[#DCE1E5] bg-white px-[22px] py-[18px]">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-[16px] font-semibold">Acessos por dia</h2>
              <span className="text-[14px] text-[#56616B]">{r.totais.entradas} acessos no período · {r.totais.excecoes} exceções · {r.totais.negados} negados · {r.totais.retroativos} retroativos · fins de semana em tom claro</span>
            </div>
            <figure>
              <div role="img" aria-label="Gráfico de barras com o número de entradas por dia nos últimos 30 dias" className="mt-4 flex h-[180px] items-end gap-1 border-b border-[#C5CDD3]">
                {r.acessosPorDia.map((d) => {
                  const dow = partes(d.dia).dow;
                  const fds = dow === 0 || dow === 6;
                  return <div key={d.dia} title={`${fmtDataCurta(d.dia)}: ${d.entradas} entrada(s)`} className="flex-1 rounded-t-[3px]" style={{ height: `${(d.entradas / maxDia) * 100}%`, background: fds ? '#9CC7CF' : PETROLEO, minHeight: d.entradas > 0 ? 2 : 0 }} />;
                })}
              </div>
              <div className="mt-1.5 flex gap-1" aria-hidden>
                {r.acessosPorDia.map((d) => <span key={d.dia} className="flex-1 whitespace-nowrap text-[11px] text-[#56616B]">{String(partes(d.dia).dia).padStart(2, '0')}</span>)}
              </div>
              <figcaption className="sr-only">Entradas por dia: {r.acessosPorDia.map((d) => `${fmtDataCurta(d.dia)} ${d.entradas}`).join('; ')}</figcaption>
            </figure>
          </section>
          <div className="grid grid-cols-2 gap-4">
            <section className={secao}><h2 className="text-[16px] font-semibold">Acessos por meio de autorização</h2><Barras itens={r.acessosPorMeio.map((m) => ({ rotulo: ROTULO_MEIO_CURTO[m.meio], valor: m.total, cor: m.meio === 'excecao_porteiro' ? '#DC6803' : PETROLEO }))} /></section>
            <section className={secao}><h2 className="text-[16px] font-semibold">Liberações por exceção, por porteiro</h2><Barras cor="#DC6803" itens={r.excecoesPorPorteiro.map((e) => ({ rotulo: e.operador, valor: e.total }))} rotuloVazio="Nenhuma exceção no período." /></section>
            <section className={secao}><h2 className="text-[16px] font-semibold">Encomendas pendentes por idade</h2><Barras itens={r.encomendasPorIdade.map((e, i) => ({ rotulo: e.faixa, valor: e.total, cor: cores[i] ?? PETROLEO }))} /></section>
            <section className={secao}>
              <h2 className="text-[16px] font-semibold">Unidades com cadastro completo</h2>
              <div className="flex items-baseline gap-3"><span className="font-mono text-[40px] font-semibold">{pct}%</span><span className="text-[#56616B]">{r.cadastroCompleto.unidadesCompletas} de {r.cadastroCompleto.total} unidades</span></div>
              <div className="h-[14px] rounded-[3px] bg-[#EEF2F4]" role="img" aria-label={`${pct}% das unidades com cadastro completo`}><div className="h-full rounded-[3px]" style={{ width: `${pct}%`, background: PETROLEO }} /></div>
              <span className="text-[14px] text-[#56616B]">Completo = ao menos um morador com vínculo aprovado e documento. Vínculos legados ainda não contam.</span>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
