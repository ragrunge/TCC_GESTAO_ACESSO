import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { useApi, type VinculoView } from '../../api';
import { Alert } from '../../components/Alert';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { useToast } from '../../components/Toast';
import { ROTULO_VINCULO } from '@portaria/domain/types';
import { MIN_JUSTIFICATIVA, exigeJustificativaParaAprovar, justificativaValida } from '@portaria/domain/rules';
import { fmtData, fmtDataHora } from '@portaria/domain/time';
import { rotuloUnidade } from '@portaria/domain/units';
import { mensagemErro, useAsync } from '../../app/useAsync';

export function VinculosPage() {
  const api = useApi();
  const { avisar } = useToast();
  const [aba, setAba] = useState<'pendentes' | 'decididos'>('pendentes');
  const todos = useAsync(() => api.vinculos.listar(), []);
  const [sel, setSel] = useState<string | null>(null);
  const [acao, setAcao] = useState<'aprovar' | 'rejeitar' | null>(null);
  const [just, setJust] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const pend = (todos.data ?? []).filter((v) => v.status === 'pendente');
  const decid = (todos.data ?? []).filter((v) => v.status === 'aprovado' && v.decididoEm || v.status === 'rejeitado').sort((a, b) => (b.decididoEm ?? 0) - (a.decididoEm ?? 0));
  const lista = aba === 'pendentes' ? pend : decid;
  const atual: VinculoView | undefined = lista.find((v) => v.id === sel) ?? lista[0];

  useEffect(() => { setAcao(null); setJust(''); setErro(''); }, [atual?.id]);

  const falhas = atual ? exigeJustificativaParaAprovar(atual.conferencias) : false;
  const nFalhas = atual ? atual.conferencias.filter((c) => !c.ok).length : 0;

  async function decidir(decisao: 'aprovar' | 'rejeitar') {
    if (!atual) return;
    setSalvando(true); setErro('');
    try {
      await api.vinculos.decidir({ id: atual.id, decisao, justificativa: just });
      avisar({ tom: decisao === 'aprovar' ? 'verde' : 'ambar', texto: `Vínculo de ${atual.pessoaNome} (${atual.unidadeId}) ${decisao === 'aprovar' ? 'aprovado' : 'rejeitado'}. A decisão e a justificativa ficam registradas.` });
      setAcao(null); setJust(''); setSel(null);
      await todos.recarregar();
    } catch (e) { setErro(mensagemErro(e)); } finally { setSalvando(false); }
  }

  const justOk = acao === 'rejeitar' ? just.trim().length > 0 : justificativaValida(just);
  const rot = 'text-[13px] text-[#56616B]';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader titulo="Vínculos pendentes" descricao={`${pend.length} ${pend.length === 1 ? 'solicitação aguardando' : 'solicitações aguardando'} decisão da administração.`} />
      <div className="flex items-center gap-[10px] rounded-lg border border-[#A9D2D8] bg-[#E3F0F2] px-4 py-3 font-medium text-[#0B4450]">
        <Info className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
        Vínculo pendente não dá acesso de morador. Documento apresentado na portaria não substitui esta aprovação.
      </div>
      {todos.error && <Alert tom="vermelho" role="alert">{todos.error}</Alert>}

      <div className="grid grid-cols-[340px_minmax(0,1fr)] items-start gap-4">
        <div className="flex flex-col gap-2">
          <Tabs rotulo="Fila de vínculos" ativa={aba} onChange={(a) => { setAba(a); setSel(null); }}
            abas={[{ id: 'pendentes', rotulo: `Pendentes (${pend.length})` }, { id: 'decididos', rotulo: `Decididos (${decid.length})` }]} />
          <ul className="flex flex-col gap-2" aria-label="Fila">
            {lista.length === 0 && <li className="rounded-[10px] border border-dashed border-[#C5CDD3] bg-white p-4 text-[#56616B]">Nenhum vínculo nesta lista.</li>}
            {lista.map((v) => (
              <li key={v.id}>
                <button type="button" aria-current={atual?.id === v.id} onClick={() => setSel(v.id)}
                  className={`flex w-full flex-col gap-1.5 rounded-[10px] border-2 px-4 py-[14px] text-left ${atual?.id === v.id ? 'border-[#0B5563] bg-[#F0F8F9]' : 'border-[#DCE1E5] bg-white'}`}>
                  <span className="flex items-center justify-between gap-2"><span className="font-semibold">{v.pessoaNome}</span><SeloVinculo status={v.status} tamanho="sm" /></span>
                  <span className="text-[14px]"><span className="font-mono font-semibold">{v.unidadeId}</span> · {ROTULO_VINCULO[v.tipo]}</span>
                  <span className="text-[13px] text-[#56616B]">Solicitado em {fmtDataHora(v.solicitadoEm)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {atual && (
          <div className="flex flex-col gap-[18px] rounded-[10px] border border-[#DCE1E5] bg-white px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[22px] font-semibold">{atual.pessoaNome} — {ROTULO_VINCULO[atual.tipo]}</h2>
                <Link to={`/unidades/${atual.unidadeId}`} className="mt-1 block font-mono text-[22px] font-semibold !text-[#0B3F49] hover:underline">{rotuloUnidade(atual.unidadeId)}</Link>
              </div>
              {nFalhas > 0 && (
                <span className="inline-flex h-[30px] items-center gap-1.5 rounded-md border border-[#FDA29B] bg-[#FEE4E2] px-[10px] text-[13px] font-semibold text-[#B42318]">
                  <TriangleAlert className="h-[14px] w-[14px]" strokeWidth={2.4} aria-hidden />{nFalhas} {nFalhas === 1 ? 'item não confere' : 'itens não conferem'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-4 gap-[14px]">
              <div className="flex flex-col gap-0.5"><span className={rot}>CPF</span><span className="font-mono">{atual.pessoaDocumento}</span></div>
              <div className="flex flex-col gap-0.5"><span className={rot}>Vigência</span><span>{atual.vigenciaInicio ? fmtData(atual.vigenciaInicio) : '—'} a {atual.vigenciaFim ? fmtData(atual.vigenciaFim) : 'indeterminada'}</span></div>
              <div className="flex flex-col gap-0.5"><span className={rot}>Solicitado em</span><span>{fmtDataHora(atual.solicitadoEm)}</span></div>
              <div className="flex flex-col gap-0.5"><span className={rot}>Solicitado por</span><span>{atual.solicitadoPor}</span></div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <div className="rounded-lg bg-[#E9ECEE] p-[18px]">
                <div className="flex min-h-[380px] flex-col gap-3 bg-[#FFFEFA] px-[26px] py-6 text-[#2A2A2A] shadow-[0_1px_3px_rgba(0,0,0,0.18)]" style={{ fontFamily: "Georgia,'Times New Roman',serif" }} aria-label="Pré-visualização do documento">
                  {atual.documento ? (
                    <>
                      <div className="text-center text-[14px] font-bold tracking-[0.06em]">{atual.documento.titulo}</div>
                      <div className="h-[6px] rounded-sm bg-[#ECE9E0]" />
                      {atual.documento.linhas.map(([k, val]) => (
                        <div key={k} className="flex flex-col gap-px text-[13px]"><span className="font-bold">{k}</span><span>{val}</span></div>
                      ))}
                      <div className="mt-1.5 flex flex-col gap-1.5"><div className="h-[6px] rounded-sm bg-[#ECE9E0]" /><div className="h-[6px] w-[85%] rounded-sm bg-[#ECE9E0]" /><div className="h-[6px] w-[70%] rounded-sm bg-[#ECE9E0]" /></div>
                      <div className="mt-auto grid grid-cols-2 gap-5 text-center text-[11px]"><div className="border-t border-[#555] pt-1">Assinatura 1</div><div className="border-t border-[#555] pt-1">Assinatura 2</div></div>
                    </>
                  ) : <p className="font-sans text-[#56616B]">Nenhum documento anexado. O anexo não é exigido; a decisão é da administração.</p>}
                </div>
                <div className="mt-2 text-center text-[12px] text-[#56616B]">Documento anexado à solicitação · visualização</div>
              </div>

              <div className="flex flex-col gap-[14px]">
                <h3 className="text-[15px] font-semibold">Conferência com o cadastro</h3>
                {atual.conferencias.map((c) => (
                  <div key={c.rotulo} className={`flex items-start gap-[10px] ${c.ok ? 'text-[#05603A]' : 'text-[#B42318]'}`}>
                    {c.ok ? <Check className="mt-0.5 h-[18px] w-[18px] shrink-0" strokeWidth={2.6} aria-hidden /> : <X className="mt-0.5 h-[18px] w-[18px] shrink-0" strokeWidth={2.6} aria-hidden />}
                    <div className="flex flex-col"><span className="font-semibold"><span className="sr-only">{c.ok ? 'Confere: ' : 'Não confere: '}</span>{c.rotulo}</span><span className="text-[14px] text-[#33424B]">{c.detalhe}</span></div>
                  </div>
                ))}
                {atual.conferencias.length === 0 && <span className="text-[#56616B]">Nenhuma conferência registrada.</span>}
                {atual.nota && <div className="rounded-lg border border-[#FEC84B] bg-[#FEF0C7] px-3 py-[10px] text-[14px] text-[#7A2E0E]">{atual.nota}</div>}
                <div className="h-px bg-[#E6EAED]" />

                {atual.status === 'pendente' && (
                  <>
                    {falhas && <div role="note" className="rounded-lg border border-[#FDA29B] bg-[#FEE4E2] px-3 py-[10px] text-[14px] text-[#912018]"><strong>Há itens que não conferem.</strong> Recomenda-se rejeitar. Aprovar só é possível com justificativa de no mínimo {MIN_JUSTIFICATIVA} caracteres, gravada junto da decisão.</div>}
                    {!atual.pessoaCadastroCompleto && <Alert tom="ambar">Cadastro incompleto: a pessoa precisa ter CPF válido (não “sem CPF”) e telefone para o vínculo ser aprovado. Complete o cadastro ou rejeite.</Alert>}
                    {acao ? (
                      <div className="flex flex-col gap-[10px]">
                        <label htmlFor="just-vinc" className="flex flex-col gap-1.5 text-[14px] font-medium">{acao === 'rejeitar' ? 'Justificativa da rejeição (obrigatória)' : `Justificativa da aprovação (mínimo ${MIN_JUSTIFICATIVA} caracteres)`}
                          <textarea id="just-vinc" data-autofocus autoFocus className="input font-normal" rows={3} value={just} onChange={(e) => setJust(e.target.value)}
                            placeholder={acao === 'rejeitar' ? 'Ex.: Locador não é o proprietário registrado; proprietária não confirmou a locação.' : undefined} />
                        </label>
                        <span className="text-[13px] text-[#56616B]">{acao === 'rejeitar' ? `${just.trim().length} caracteres` : `${just.trim().length} de ${MIN_JUSTIFICATIVA} caracteres`}</span>
                        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
                        <div className="flex gap-[10px]">
                          <Button variante={acao === 'rejeitar' ? 'perigo' : 'primario'} grande className="flex-1" disabled={!justOk || (acao === 'aprovar' && !atual.pessoaCadastroCompleto)} carregando={salvando} onClick={() => void decidir(acao)}>
                            {acao === 'rejeitar' ? 'Confirmar rejeição' : falhas ? 'Aprovar mesmo assim' : 'Confirmar aprovação'}
                          </Button>
                          <Button grande onClick={() => { setAcao(null); setJust(''); setErro(''); }}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-[10px]">
                          {/* Com item que não confere, Rejeitar é a ação primária e Aprovar é secundário */}
                          {falhas ? (
                            <>
                              <Button variante="perigo" grande className="flex-1" onClick={() => setAcao('rejeitar')}>Rejeitar</Button>
                              <Button grande className="flex-1" disabled={!atual.pessoaCadastroCompleto} onClick={() => setAcao('aprovar')}>Aprovar com justificativa…</Button>
                            </>
                          ) : (
                            <>
                              <Button variante="primario" grande className="flex-1" disabled={!atual.pessoaCadastroCompleto} onClick={() => void decidir('aprovar')} carregando={salvando}>Aprovar</Button>
                              <button type="button" onClick={() => setAcao('rejeitar')} className="h-12 flex-1 rounded-lg border-2 border-[#B42318] bg-white font-semibold text-[#B42318] hover:bg-[#FEF3F2]">Rejeitar</button>
                            </>
                          )}
                        </div>
                        {erro && <span role="alert" className="text-[14px] font-medium text-[#B42318]">{erro}</span>}
                      </div>
                    )}
                  </>
                )}
                {atual.decididoEm && (
                  <div className={`rounded-lg border px-[14px] py-3 font-medium ${atual.status === 'rejeitado' ? 'border-[#FDA29B] bg-[#FEE4E2] text-[#B42318]' : 'border-[#75E0A7] bg-[#DCFAE6] text-[#05603A]'}`}>
                    <Badge tom={atual.status === 'rejeitado' ? 'vermelho' : 'verde'} tamanho="xs">{atual.status === 'rejeitado' ? 'Rejeitado' : 'Aprovado'}</Badge>{' '}
                    por {atual.decididoPorNome} em {fmtDataHora(atual.decididoEm)}{atual.justificativa && <><br />Justificativa: {atual.justificativa}</>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
