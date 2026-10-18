import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Info } from 'lucide-react';
import { useApi, type VinculoView } from '../../api';
import { Alert } from '../../components/Alert';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { useToast } from '../../components/Toast';
import { Field } from '../../components/Field';
import { ROTULO_COMPROVANTE, ROTULO_VINCULO, type TipoComprovante } from '@portaria/domain/types';
import { MAX_DESCRICAO_COMPROVANTE, MAX_OBSERVACAO_CONFERENCIA, temNumeroDePessoa } from '@portaria/domain/rules';
import { fmtData, fmtDataHora, fromInput } from '@portaria/domain/time';
import { mensagemErro, useAsync } from '../../app/useAsync';
import { useCatalogo } from '../../app/catalogo';
import { useCan } from '../../auth/AuthContext';
import { FichaPessoaModal } from '../cadastro/FichaPessoaModal';

export function VinculosPage() {
  const api = useApi();
  const { avisar } = useToast();
  const { rotulo } = useCatalogo();
  const podeDecidir = useCan('vinculo.decidir');
  const [aba, setAba] = useState<'pendentes' | 'decididos' | 'legados'>('pendentes');
  const [ficha, setFicha] = useState<string | null>(null);
  const [fimInquilino, setFimInquilino] = useState('');
  const todos = useAsync(() => api.vinculos.listar(), []);
  const [sel, setSel] = useState<string | null>(null);
  const [rejeitando, setRejeitando] = useState(false);
  const [just, setJust] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const pend = (todos.data ?? []).filter((v) => v.status === 'pendente');
  const decid = (todos.data ?? []).filter((v) => v.status === 'aprovado' && v.decididoEm || v.status === 'rejeitado').sort((a, b) => (b.decididoEm ?? 0) - (a.decididoEm ?? 0));
  // RN-09: legados da planilha, com os de prazo vencido primeiro (em destaque) para revisão da administração
  const legados = (todos.data ?? []).filter((v) => v.status === 'legado')
    .sort((a, b) => Number(b.legadoVencido) - Number(a.legadoVencido) || a.unidadeCodigo.localeCompare(b.unidadeCodigo, 'pt-BR', { numeric: true }));
  const nVencidos = legados.filter((v) => v.legadoVencido).length;
  const lista = aba === 'pendentes' ? pend : aba === 'legados' ? legados : decid;
  const atual: VinculoView | undefined = lista.find((v) => v.id === sel) ?? lista[0];

  useEffect(() => { setRejeitando(false); setJust(''); setErro(''); setFimInquilino(''); }, [atual?.id]);

  async function regularizar() {
    if (!atual) return;
    setSalvando(true); setErro('');
    try {
      await api.vinculos.regularizar(atual.id, fimInquilino ? { vigenciaFim: fromInput(fimInquilino) } : undefined);
      avisar({ texto: `Vínculo legado de ${atual.pessoaNome} (${atual.unidadeCodigo}) regularizado: agora está aprovado.` });
      setSel(null);
      await todos.recarregar();
    } catch (e) { setErro(mensagemErro(e)); } finally { setSalvando(false); }
  }

  const conferido = !!atual?.conferencia;

  async function decidir(decisao: 'aprovar' | 'rejeitar') {
    if (!atual) return;
    setSalvando(true); setErro('');
    try {
      await api.vinculos.decidir({ id: atual.id, decisao, justificativa: just });
      avisar({ tom: decisao === 'aprovar' ? 'verde' : 'ambar', texto: `Vínculo de ${atual.pessoaNome} (${atual.unidadeCodigo}) ${decisao === 'aprovar' ? 'aprovado' : 'rejeitado'}. A decisão e a justificativa ficam registradas.` });
      setRejeitando(false); setJust(''); setSel(null);
      await todos.recarregar();
    } catch (e) { setErro(mensagemErro(e)); } finally { setSalvando(false); }
  }

  const justOk = just.trim().length > 0;
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
            abas={[{ id: 'pendentes', rotulo: `Pendentes (${pend.length})` }, { id: 'legados', rotulo: `Legados (${legados.length})` }, { id: 'decididos', rotulo: `Decididos (${decid.length})` }]} />
          {aba === 'legados' && (
            <p className="text-[13px] text-[#56616B]">Importados da planilha (RN-09). Valem até o prazo de regularização; {nVencidos} com prazo vencido, em destaque.</p>
          )}
          <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto" aria-label="Fila">
            {lista.length === 0 && <li className="rounded-[10px] border border-dashed border-[#C5CDD3] bg-white p-4 text-[#56616B]">Nenhum vínculo nesta lista.</li>}
            {lista.map((v) => (
              <li key={v.id}>
                <button type="button" aria-current={atual?.id === v.id} onClick={() => setSel(v.id)}
                  className={`flex w-full flex-col gap-1.5 rounded-[10px] border-2 px-4 py-[14px] text-left ${atual?.id === v.id ? 'border-[#0B5563] bg-[#F0F8F9]' : v.legadoVencido ? 'border-[#FDA29B] bg-[#FEF3F2]' : 'border-[#DCE1E5] bg-white'}`}>
                  <span className="flex items-center justify-between gap-2"><span className="font-semibold">{v.pessoaNome}</span><SeloVinculo status={v.status} tamanho="sm" /></span>
                  <span className="text-[14px]"><span className="font-mono font-semibold">{v.unidadeCodigo}</span> · {ROTULO_VINCULO[v.tipo]}</span>
                  {v.status === 'legado' && v.prazoRegularizacao
                    ? <span className={`text-[13px] ${v.legadoVencido ? 'font-semibold text-[#B42318]' : 'text-[#56616B]'}`}>{v.legadoVencido ? 'Prazo vencido em' : 'Regularizar até'} {fmtData(v.prazoRegularizacao)}</span>
                    : <span className="text-[13px] text-[#56616B]">Solicitado em {fmtDataHora(v.solicitadoEm)}</span>}
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
                <Link to={`/unidades/${atual.unidadeId}`} className="mt-1 block font-mono text-[22px] font-semibold !text-[#0B3F49] hover:underline">{rotulo(atual.unidadeId)}</Link>
              </div>
              {(atual.status === 'pendente' || atual.status === 'legado') && (
                <Badge tom={conferido ? 'verde' : 'ambar'} tamanho="sm">{conferido ? 'Comprovante conferido' : 'Comprovante não conferido'}</Badge>
              )}
            </div>

            <div className="grid grid-cols-4 gap-[14px]">
              <div className="flex flex-col gap-0.5"><span className={rot}>CPF</span><span className="font-mono">{atual.pessoaDocumento}</span></div>
              <div className="flex flex-col gap-0.5"><span className={rot}>Vigência</span><span>{atual.vigenciaInicio ? fmtData(atual.vigenciaInicio) : '—'} a {atual.vigenciaFim ? fmtData(atual.vigenciaFim) : 'indeterminada'}</span></div>
              <div className="flex flex-col gap-0.5"><span className={rot}>Solicitado em</span><span>{fmtDataHora(atual.solicitadoEm)}</span></div>
              <div className="flex flex-col gap-0.5"><span className={rot}>Solicitado por</span><span>{atual.solicitadoPor}</span></div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <ConferenciaComprovanteBloco key={atual.id} vinculo={atual} podeRegistrar={podeDecidir && (atual.status === 'pendente' || atual.status === 'legado')}
                onRegistrado={async () => { await todos.recarregar(); }} />

              <div className="flex flex-col gap-[14px]">
                <h3 className="text-[15px] font-semibold">Decisão</h3>
                {atual.nota && <div className="rounded-lg border border-[#FEC84B] bg-[#FEF0C7] px-3 py-[10px] text-[14px] text-[#7A2E0E]">{atual.nota}</div>}
                <div className="h-px bg-[#E6EAED]" />

                {atual.status === 'pendente' && (
                  <>
                    {!conferido && <Alert tom="ambar">Registre a conferência do comprovante (ao lado) para aprovar o vínculo (RN-02).</Alert>}
                    {!atual.pessoaCadastroCompleto && <Alert tom="ambar">Cadastro incompleto: a pessoa precisa ter CPF válido (não “sem CPF”) e telefone para o vínculo ser aprovado. Complete o cadastro ou rejeite.</Alert>}
                    {rejeitando ? (
                      <div className="flex flex-col gap-[10px]">
                        <label htmlFor="just-vinc" className="flex flex-col gap-1.5 text-[14px] font-medium">Justificativa da rejeição (obrigatória)
                          <textarea id="just-vinc" data-autofocus autoFocus className="input font-normal" rows={3} value={just} onChange={(e) => setJust(e.target.value)}
                            placeholder="Ex.: Comprovante apresentado não corresponde à unidade; proprietária não confirmou a locação." />
                        </label>
                        <span className="text-[13px] text-[#56616B]">{just.trim().length} caracteres</span>
                        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
                        <div className="flex gap-[10px]">
                          <Button variante="perigo" grande className="flex-1" disabled={!justOk} carregando={salvando} onClick={() => void decidir('rejeitar')}>Confirmar rejeição</Button>
                          <Button grande onClick={() => { setRejeitando(false); setJust(''); setErro(''); }}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-[10px]">
                          <Button variante="primario" grande className="flex-1" disabled={!atual.pessoaCadastroCompleto || !conferido} onClick={() => void decidir('aprovar')} carregando={salvando}>Aprovar</Button>
                          <button type="button" onClick={() => setRejeitando(true)} className="h-12 flex-1 rounded-lg border-2 border-[#B42318] bg-white font-semibold text-[#B42318] hover:bg-[#FEF3F2]">Rejeitar</button>
                        </div>
                        {erro && <span role="alert" className="text-[14px] font-medium text-[#B42318]">{erro}</span>}
                      </div>
                    )}
                  </>
                )}
                {atual.status === 'legado' && (
                  <div className="flex flex-col gap-[10px]">
                    <div className={`rounded-lg border px-3 py-[10px] text-[14px] ${atual.legadoVencido ? 'border-[#FDA29B] bg-[#FEE4E2] text-[#912018]' : 'border-[#D5DDE2] bg-[#EEF2F4] text-[#33424B]'}`}>
                      {atual.legadoVencido ? <strong>Prazo de regularização vencido em {fmtData(atual.prazoRegularizacao!)}.</strong> : <>Legado válido até {fmtData(atual.prazoRegularizacao!)}.</>}{' '}
                      Regularizar passa o vínculo a aprovado; exige o comprovante conferido (RF-05) e cadastro completo (CPF e telefone).
                    </div>
                    {!conferido && <Alert tom="ambar">Registre a conferência do comprovante (ao lado) antes de regularizar.</Alert>}
                    {!atual.pessoaCadastroCompleto && <Alert tom="ambar">Cadastro incompleto: complete CPF e telefone pela ficha da pessoa antes de regularizar.</Alert>}
                    {atual.tipo === 'inquilino' && !atual.vigenciaFim && (
                      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Fim da vigência (obrigatório para inquilino)
                        <input type="date" className="input font-normal" value={fimInquilino} onChange={(e) => setFimInquilino(e.target.value)} /></label>
                    )}
                    {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
                    {podeDecidir && (
                      <div className="flex gap-[10px]">
                        <Button variante="primario" grande className="flex-1" disabled={!conferido} carregando={salvando} onClick={() => void regularizar()}>Regularizar</Button>
                        <Button grande onClick={() => setFicha(atual.pessoaId)}>Abrir ficha / completar cadastro</Button>
                      </div>
                    )}
                  </div>
                )}
                {atual.decididoEm && (
                  <div className={`rounded-lg border px-[14px] py-3 font-medium ${atual.status === 'rejeitado' ? 'border-[#FDA29B] bg-[#FEE4E2] text-[#B42318]' : 'border-[#75E0A7] bg-[#DCFAE6] text-[#05603A]'}`}>
                    <Badge tom={atual.status === 'rejeitado' ? 'vermelho' : atual.status === 'encerrado' ? 'neutro' : 'verde'} tamanho="xs">{atual.status === 'rejeitado' ? 'Rejeitado' : atual.status === 'encerrado' ? 'Encerrado' : 'Aprovado'}</Badge>{' '}
                    por {atual.decididoPorNome} em {fmtDataHora(atual.decididoEm)}{atual.justificativa && <><br />Justificativa: {atual.justificativa}</>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {ficha && <FichaPessoaModal id={ficha} onClose={() => { setFicha(null); void todos.recarregar(); }} />}
    </div>
  );
}

/**
 * RF-05: conferência do comprovante de vínculo. A administração confere o documento (que chega por e-mail ou em mãos)
 * e registra só o tipo, a data e quem conferiu. O arquivo não entra no sistema (LGPD, art. 6º, III).
 */
function ConferenciaComprovanteBloco({ vinculo, podeRegistrar, onRegistrado }: {
  vinculo: VinculoView; podeRegistrar: boolean; onRegistrado: () => Promise<void>;
}) {
  const api = useApi();
  const { avisar } = useToast();
  const c = vinculo.conferencia;
  const [editando, setEditando] = useState(!c);
  const [tipo, setTipo] = useState<TipoComprovante | ''>('');
  const [descricao, setDescricao] = useState('');
  const [observacao, setObservacao] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const numeroPessoal = temNumeroDePessoa(`${tipo === 'outro' ? descricao : ''} ${observacao}`);
  const ok = !!tipo && confirmado && (tipo !== 'outro' || descricao.trim().length > 0) && !numeroPessoal;

  async function registrar() {
    if (!tipo) return;
    setSalvando(true); setErro('');
    try {
      await api.vinculos.registrarConferencia(vinculo.id, {
        tipo, ...(tipo === 'outro' ? { descricao } : {}), ...(observacao.trim() ? { observacao } : {}),
      });
      avisar({ tom: 'verde', texto: `Conferência do comprovante de ${vinculo.pessoaNome} registrada. O arquivo não é guardado no sistema.` });
      setEditando(false); setConfirmado(false);
      await onRegistrado();
    } catch (e) { setErro(mensagemErro(e)); } finally { setSalvando(false); }
  }

  const rot = 'text-[13px] text-[#56616B]';
  return (
    <section aria-labelledby={`conf-${vinculo.id}`} className="flex flex-col gap-[14px] rounded-lg border border-[#DCE1E5] bg-[#F7F9FA] p-[18px]">
      <h3 id={`conf-${vinculo.id}`} className="text-[15px] font-semibold">Conferência do comprovante</h3>
      <p className="text-[13px] text-[#56616B]">O comprovante (escritura ou contrato) é conferido pela administração e não é anexado: o sistema registra só o tipo, a data e quem conferiu.</p>
      {c && !editando && (
        <div className="flex flex-col gap-[10px]">
          <div className="flex items-start gap-[10px] text-[#05603A]">
            <Check className="mt-0.5 h-[18px] w-[18px] shrink-0" strokeWidth={2.6} aria-hidden />
            <span className="font-semibold">Comprovante conferido</span>
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <div className="flex flex-col gap-0.5"><span className={rot}>Documento</span><span>{ROTULO_COMPROVANTE[c.tipoDocumento]}{c.descricao ? ` — ${c.descricao}` : ''}</span></div>
            <div className="flex flex-col gap-0.5"><span className={rot}>Data da conferência</span><span>{fmtData(c.data)}</span></div>
            <div className="flex flex-col gap-0.5"><span className={rot}>Conferido por</span><span>{vinculo.conferidoPorNome ?? '—'}</span></div>
            {c.observacao && <div className="col-span-2 flex flex-col gap-0.5"><span className={rot}>Observação</span><span>{c.observacao}</span></div>}
          </div>
          {podeRegistrar && <div><Button pequeno onClick={() => setEditando(true)}>Refazer conferência</Button></div>}
        </div>
      )}
      {!c && !podeRegistrar && <span className="text-[#56616B]">Nenhuma conferência registrada.</span>}
      {podeRegistrar && editando && (
        <div className="flex flex-col gap-3">
          <Field label="Tipo do documento conferido">
            <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value as TipoComprovante | '')}>
              <option value="">Selecione…</option>
              {(Object.keys(ROTULO_COMPROVANTE) as TipoComprovante[]).map((t) => <option key={t} value={t}>{ROTULO_COMPROVANTE[t]}</option>)}
            </select>
          </Field>
          {tipo === 'outro' && (
            <Field label="Descrição do documento" dica="Só o tipo do documento (ex.: formal de partilha). Sem nomes ou números.">
              <input className="input" maxLength={MAX_DESCRICAO_COMPROVANTE} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </Field>
          )}
          <Field label="Observação (opcional)" erro={numeroPessoal ? 'Não escreva CPF, telefone ou outro número pessoal.' : undefined}
            dica={`Curta e sem dado pessoal: não escreva CPF, telefone ou nomes. Até ${MAX_OBSERVACAO_CONFERENCIA} caracteres.`}>
            <textarea className="input" rows={2} maxLength={MAX_OBSERVACAO_CONFERENCIA} value={observacao} onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: recebido por e-mail; firma reconhecida." />
          </Field>
          <label className="flex items-center gap-2 text-[14px] font-medium">
            <input type="checkbox" className="h-[18px] w-[18px]" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
            Conferi o comprovante apresentado
          </label>
          {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
          <div className="flex gap-[10px]">
            <Button variante="primario" disabled={!ok} carregando={salvando} onClick={() => void registrar()}>Registrar conferência</Button>
            {c && <Button onClick={() => { setEditando(false); setErro(''); }}>Cancelar</Button>}
          </div>
        </div>
      )}
    </section>
  );
}
