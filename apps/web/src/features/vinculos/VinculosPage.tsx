import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Check, Info } from 'lucide-react';
import { useApi, type FiltroVinculos, type VinculoView } from '../../api';
import { Alert } from '../../components/Alert';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { useToast } from '../../components/Toast';
import { Field } from '../../components/Field';
import { ROTULO_COMPROVANTE, ROTULO_VINCULO, type TipoComprovante } from '@portaria/domain/types';
import { MAX_DESCRICAO_COMPROVANTE, MAX_OBSERVACAO_CONFERENCIA, MIN_JUSTIFICATIVA, temNumeroDePessoa } from '@portaria/domain/rules';
import { fmtData, fmtDataHora, fromInput } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { useCatalogo } from '../../app/catalogo';
import { APOS_VINCULO, CHAVES, useContagemPendentes, useInvalidar } from '../../app/consultas';
import { useCan } from '../../auth/AuthContext';
import { FichaPessoaModal } from '../cadastro/FichaPessoaModal';
import { ErroCarregar, Osso } from '../../components/Carregando';

type Aba = 'pendentes' | 'decididos' | 'legados';
const POR_PAGINA = 50;
/** Uma fila por aba, paginada no servidor. Legados por prazo: os vencidos vêm primeiro (RN-09). */
const FILAS: Record<Aba, Pick<FiltroVinculos, 'status' | 'ordem'>> = {
  pendentes: { status: ['pendente'], ordem: 'recentes' },
  legados: { status: ['legado'], ordem: 'prazo' },
  decididos: { status: ['aprovado', 'rejeitado', 'encerrado'], ordem: 'decisao' },
};

export function VinculosPage() {
  const api = useApi();
  const { avisar } = useToast();
  const { rotulo } = useCatalogo();
  const invalidar = useInvalidar();
  const podeDecidir = useCan('vinculo.decidir');
  const [aba, setAba] = useState<Aba>('pendentes');
  const [ficha, setFicha] = useState<string | null>(null);
  const [fimInquilino, setFimInquilino] = useState('');
  const fila = useInfiniteQuery({
    queryKey: CHAVES.vinculosFila(aba),
    queryFn: ({ pageParam }) => api.vinculos.listarPagina({ ...FILAS[aba], cursor: pageParam, limite: POR_PAGINA }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    staleTime: 0,
  });
  const nPend = useContagemPendentes(true).data;
  const nLeg = useQuery({ queryKey: CHAVES.vinculosContagem('legado'), queryFn: () => api.vinculos.contar('legado'), staleTime: 0 }).data;
  const [sel, setSel] = useState<string | null>(null);
  const [rejeitando, setRejeitando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [just, setJust] = useState('');
  const [motivo, setMotivo] = useState('');
  const [dataEnc, setDataEnc] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const lista = fila.data?.pages.flatMap((p) => p.itens) ?? [];
  const nVencidos = aba === 'legados' ? lista.filter((v) => v.legadoVencido).length : 0;
  const atual: VinculoView | undefined = lista.find((v) => v.id === sel) ?? lista[0];
  const recarregar = () => invalidar(APOS_VINCULO);
  // Abaixo de xl o detalhe fica embaixo da fila inteira: ao escolher um item, leva a pessoa até ele (e o foco, para o teclado)
  const titulo = useRef<HTMLHeadingElement>(null);
  function escolher(id: string) {
    setSel(id);
    if (window.matchMedia?.('(max-width: 1279px)').matches) {
      requestAnimationFrame(() => { titulo.current?.scrollIntoView({ block: 'start' }); titulo.current?.focus({ preventScroll: true }); });
    }
  }

  useEffect(() => { setRejeitando(false); setEncerrando(false); setJust(''); setMotivo(''); setDataEnc(''); setErro(''); setFimInquilino(''); }, [atual?.id]);

  async function executar(fn: () => Promise<unknown>, texto: string, tom?: 'verde' | 'ambar') {
    setSalvando(true); setErro('');
    try {
      await fn();
      avisar({ ...(tom ? { tom } : {}), texto });
      setRejeitando(false); setEncerrando(false); setJust(''); setMotivo(''); setSel(null);
      await recarregar();
    } catch (e) { setErro(mensagemErro(e)); } finally { setSalvando(false); }
  }

  const regularizar = () => atual && executar(
    () => api.vinculos.regularizar(atual.id, fimInquilino ? { vigenciaFim: fromInput(fimInquilino) } : undefined),
    `Vínculo legado de ${atual.pessoaNome} (${atual.unidadeCodigo}) regularizado: agora está aprovado.`);
  const decidir = (decisao: 'aprovar' | 'rejeitar') => atual && executar(
    () => api.vinculos.decidir({ id: atual.id, decisao, justificativa: just }),
    `Vínculo de ${atual.pessoaNome} (${atual.unidadeCodigo}) ${decisao === 'aprovar' ? 'aprovado' : 'rejeitado'}. A decisão e a justificativa ficam registradas.`,
    decisao === 'aprovar' ? 'verde' : 'ambar');
  const encerrar = () => atual && executar(
    () => api.vinculos.encerrar(atual.id, { motivo, ...(dataEnc ? { data: fromInput(dataEnc)! } : {}) }),
    `Vínculo de ${atual.pessoaNome} (${atual.unidadeCodigo}) encerrado. Deixa de valer para acesso; o histórico é mantido.`, 'ambar');

  const conferido = !!atual?.conferencia;
  const justOk = just.trim().length > 0;
  const motivoOk = motivo.trim().length >= MIN_JUSTIFICATIVA;
  const rot = 'text-[13px] text-[#56616B]';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader titulo="Vínculos pendentes" descricao={nPend === undefined ? 'Solicitações aguardando decisão da administração.' : `${nPend} ${nPend === 1 ? 'solicitação aguardando' : 'solicitações aguardando'} decisão da administração.`} />
      <div className="flex items-center gap-[10px] rounded-lg border border-[#A9D2D8] bg-[#E3F0F2] px-4 py-3 font-medium text-[#0B4450]">
        <Info className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
        Vínculo pendente não dá acesso de morador. Documento apresentado na portaria não substitui esta aprovação.
      </div>
      {fila.error && <ErroCarregar mensagem={mensagemErro(fila.error)} onTentar={() => fila.refetch()} />}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <Tabs compacta rotulo="Fila de vínculos" ativa={aba} onChange={(a) => { setAba(a); setSel(null); }}
            abas={[{ id: 'pendentes', rotulo: `Pendentes${nPend === undefined ? '' : ` (${nPend})`}` }, { id: 'legados', rotulo: `Legados${nLeg === undefined ? '' : ` (${nLeg})`}` }, { id: 'decididos', rotulo: 'Decididos' }]} />
          {aba === 'legados' && (
            <p className="text-[13px] text-[#56616B]">Importados da planilha (RN-09). Valem até o prazo de regularização; {nVencidos} com prazo vencido, em destaque.</p>
          )}
          <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto" aria-label="Fila" aria-busy={fila.isLoading || undefined}>
            {fila.isLoading && [0, 1, 2, 3].map((i) => (
              <li key={i} aria-hidden className="apos-espera flex flex-col gap-2.5 rounded-[10px] border-2 border-[#DCE1E5] bg-white px-4 py-[14px]">
                <Osso className="h-3.5 w-[60%]" /><Osso className="h-3 w-[40%]" />
              </li>
            ))}
            {!fila.isLoading && !fila.error && lista.length === 0 && <li className="rounded-[10px] border border-dashed border-[#C5CDD3] bg-white p-4 text-[#56616B]">Nenhum vínculo nesta lista.</li>}
            {lista.map((v) => (
              <li key={v.id}>
                <button type="button" aria-current={atual?.id === v.id} onClick={() => escolher(v.id)}
                  className={`flex w-full flex-col gap-1.5 rounded-[10px] border-2 px-4 py-[14px] text-left ${atual?.id === v.id ? 'border-[#0B5563] bg-[#F0F8F9]' : v.legadoVencido ? 'border-[#FDA29B] bg-[#FEF3F2]' : 'border-[#DCE1E5] bg-white'}`}>
                  <span className="flex items-center justify-between gap-2"><span className="font-semibold">{v.pessoaNome}</span><SeloVinculo status={v.status} tamanho="sm" /></span>
                  <span className="text-[14px]"><span className="font-mono font-semibold">{v.unidadeCodigo}</span> · {ROTULO_VINCULO[v.tipo]}</span>
                  {v.status === 'legado' && v.prazoRegularizacao
                    ? <span className={`text-[13px] ${v.legadoVencido ? 'font-semibold text-[#B42318]' : 'text-[#56616B]'}`}>{v.legadoVencido ? 'Prazo vencido em' : 'Regularizar até'} {fmtData(v.prazoRegularizacao)}</span>
                    : <span className="text-[13px] text-[#56616B]">Solicitado em {fmtData(v.solicitadoEm)}</span>}
                </button>
              </li>
            ))}
            {fila.hasNextPage && (
              <li><Button className="w-full" carregando={fila.isFetchingNextPage} onClick={() => void fila.fetchNextPage()}>Carregar mais</Button></li>
            )}
          </ul>
        </div>

        {atual && (
          <div className="flex flex-col gap-[18px] rounded-[10px] border border-[#DCE1E5] bg-white px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 ref={titulo} tabIndex={-1} className="scroll-mt-4 text-[22px] font-semibold outline-none">{atual.pessoaNome} · {ROTULO_VINCULO[atual.tipo]}</h2>
                <Link to={`/unidades/${atual.unidadeId}`} className="mt-1 flex min-h-[44px] items-center font-mono text-[22px] font-semibold !text-[#0B3F49] hover:underline lg:min-h-0">{rotulo(atual.unidadeId)}</Link>
              </div>
              {(atual.status === 'pendente' || atual.status === 'legado') && (
                <Badge tom={conferido ? 'verde' : 'ambar'} tamanho="sm">{conferido ? 'Comprovante conferido' : 'Comprovante não conferido'}</Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-[14px] md:grid-cols-4">
              <div className="flex flex-col gap-0.5"><span className={rot}>CPF</span><span className="font-mono">{atual.pessoaDocumento}</span></div>
              <div className="flex flex-col gap-0.5"><span className={rot}>Vigência</span><span className="font-mono sm:whitespace-nowrap">{atual.vigenciaFim ? `${atual.vigenciaInicio ? fmtData(atual.vigenciaInicio) : '—'} a ${fmtData(atual.vigenciaFim)}` : atual.vigenciaInicio ? `desde ${fmtData(atual.vigenciaInicio)}` : 'Indeterminada'}</span></div>
              <div className="flex flex-col gap-0.5"><span className={rot}>Solicitado em</span><span className="font-mono">{fmtDataHora(atual.solicitadoEm)}</span></div>
              <div className="flex flex-col gap-0.5"><span className={rot}>Solicitado por</span><span>{atual.solicitadoPor}</span></div>
            </div>

            <div className="flex flex-col gap-5">
              <ConferenciaComprovanteBloco key={atual.id} vinculo={atual} podeRegistrar={podeDecidir && (atual.status === 'pendente' || atual.status === 'legado')}
                onRegistrado={recarregar} />

              <div className="flex flex-col gap-[14px]">
                <h3 className="text-[15px] font-semibold">Decisão</h3>
                {atual.nota && <div className="rounded-lg border border-[#FEC84B] bg-[#FEF0C7] px-3 py-[10px] text-[14px] text-[#7A2E0E]">{atual.nota}</div>}
                <div className="h-px bg-[#E6EAED]" />

                {atual.status === 'pendente' && (
                  <>
                    
                    {!atual.pessoaCadastroCompleto && <Alert tom="ambar">Cadastro incompleto: a pessoa precisa ter CPF válido (não “sem CPF”) e telefone para o vínculo ser aprovado. Complete o cadastro ou rejeite.</Alert>}
                    {rejeitando ? (
                      <div className="flex flex-col gap-[10px]">
                        <label htmlFor="just-vinc" className="flex flex-col gap-1.5 text-[14px] font-medium">Justificativa da rejeição (obrigatória)
                          <textarea id="just-vinc" data-autofocus autoFocus className="input font-normal" rows={3} value={just} onChange={(e) => setJust(e.target.value)}
                            placeholder="Ex.: Comprovante apresentado não corresponde à unidade; proprietária não confirmou a locação." />
                        </label>
                        <span className="text-[13px] text-[#56616B]">{just.trim().length} caracteres</span>
                        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
                        <div className="flex flex-col gap-[10px] sm:flex-row">
                          <Button variante="perigo" grande className="sm:flex-1" disabled={!justOk} carregando={salvando} onClick={() => void decidir('rejeitar')}>Confirmar rejeição</Button>
                          <Button grande onClick={() => { setRejeitando(false); setJust(''); setErro(''); }}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-[10px] sm:flex-row">
                          <Button variante="primario" grande className="sm:flex-1" disabled={!atual.pessoaCadastroCompleto || !conferido} onClick={() => void decidir('aprovar')} carregando={salvando}>Aprovar</Button>
                          <button type="button" onClick={() => setRejeitando(true)} className="h-12 sm:flex-1 rounded-lg border-2 border-[#B42318] bg-white font-semibold text-[#B42318] hover:bg-[#FEF3F2]">Rejeitar</button>
                        </div>
                        {/* RN-02: o selo do topo já diz "não conferido"; aqui só o motivo do Aprovar desligado */}
                        {!conferido && <span className="text-[13px] text-[#56616B]">Para aprovar, registre antes a conferência do comprovante (RN-02).</span>}
                        {erro && <span role="alert" className="text-[14px] font-medium text-[#B42318]">{erro}</span>}
                      </div>
                    )}
                  </>
                )}
                {atual.status === 'legado' && !encerrando && (
                  <div className="flex flex-col gap-[10px]">
                    <div className={`rounded-lg border px-3 py-[10px] text-[14px] ${atual.legadoVencido ? 'border-[#FDA29B] bg-[#FEE4E2] text-[#912018]' : 'border-[#D5DDE2] bg-[#EEF2F4] text-[#33424B]'}`}>
                      {atual.legadoVencido ? <strong>Prazo de regularização vencido em {fmtData(atual.prazoRegularizacao!)}.</strong> : <>Legado válido até {fmtData(atual.prazoRegularizacao!)}.</>}{' '}
                      Regularizar passa o vínculo a aprovado; exige o comprovante conferido (RF-05) e cadastro completo (CPF e telefone).
                    </div>
                    {!conferido && <Alert tom="ambar">Registre a conferência do comprovante (acima) antes de regularizar.</Alert>}
                    {!atual.pessoaCadastroCompleto && <Alert tom="ambar">Cadastro incompleto: complete CPF e telefone pela ficha da pessoa antes de regularizar.</Alert>}
                    {atual.tipo === 'inquilino' && !atual.vigenciaFim && (
                      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Fim da vigência (obrigatório para inquilino)
                        <input type="date" className="input font-normal" value={fimInquilino} onChange={(e) => setFimInquilino(e.target.value)} /></label>
                    )}
                    {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
                    {podeDecidir && (
                      <div className="flex flex-col gap-[10px] sm:flex-row">
                        <Button variante="primario" grande className="sm:flex-1" disabled={!conferido} carregando={salvando} onClick={() => void regularizar()}>Regularizar</Button>
                        <Button grande onClick={() => setFicha(atual.pessoaId)}>Abrir ficha / completar cadastro</Button>
                      </div>
                    )}
                  </div>
                )}
                {atual.decididoEm && (
                  <div className={`rounded-lg border px-[14px] py-3 font-medium ${atual.status === 'rejeitado' ? 'border-[#FDA29B] bg-[#FEE4E2] text-[#B42318]' : 'border-[#75E0A7] bg-[#DCFAE6] text-[#05603A]'}`}>
                    <Badge tom={atual.status === 'rejeitado' ? 'vermelho' : 'verde'} tamanho="xs">{atual.status === 'rejeitado' ? 'Rejeitado' : 'Aprovado'}</Badge>{' '}
                    por {atual.decididoPorNome} em {fmtDataHora(atual.decididoEm)}{atual.justificativa && atual.status !== 'encerrado' && <><br />Justificativa: {atual.justificativa}</>}
                  </div>
                )}
                {atual.status === 'encerrado' && (
                  <div className="rounded-lg border border-[#D5DDE2] bg-[#EEF2F4] px-[14px] py-3 font-medium text-[#33424B]">
                    <Badge tom="neutro" tamanho="xs">Encerrado</Badge>{' '}
                    em {atual.encerradoEm ? fmtDataHora(atual.encerradoEm) : '—'}{atual.justificativa && <><br />Motivo: {atual.justificativa}</>}
                  </div>
                )}
                {/* RF-07: encerramento manual (aprovado ou legado). Pendente se rejeita; rejeitado e encerrado são finais. */}
                {podeDecidir && (atual.status === 'aprovado' || atual.status === 'legado') && (
                  encerrando ? (
                    <div className="flex flex-col gap-[10px] rounded-lg border border-[#D5DDE2] p-3">
                      <label htmlFor="motivo-enc" className="flex flex-col gap-1.5 text-[14px] font-medium">Motivo do encerramento (obrigatório)
                        <textarea id="motivo-enc" autoFocus className="input font-normal" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                          placeholder="Ex.: Locação encerrada; o inquilino entregou as chaves à administração." />
                      </label>
                      <span className="text-[13px] text-[#56616B]">{motivo.trim().length} de {MIN_JUSTIFICATIVA} caracteres no mínimo</span>
                      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Data do encerramento (opcional)
                        <input type="date" className="input font-normal" value={dataEnc} onChange={(e) => setDataEnc(e.target.value)} />
                        <span className="text-[13px] font-normal text-[#56616B]">Em branco: hoje, ou o fim da vigência se ele já passou. Não pode ser futura.</span>
                      </label>
                      {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
                      <div className="flex flex-col gap-[10px] sm:flex-row">
                        <Button variante="perigo" className="sm:flex-1" disabled={!motivoOk} carregando={salvando} onClick={() => void encerrar()}>Confirmar encerramento</Button>
                        <Button onClick={() => { setEncerrando(false); setErro(''); }}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <div><Button onClick={() => { setEncerrando(true); setErro(''); }}>Encerrar vínculo</Button></div>
                  )
                )}
                {erro && atual.status === 'aprovado' && !encerrando && <Alert tom="vermelho" role="alert">{erro}</Alert>}
              </div>
            </div>
          </div>
        )}
      </div>
      {ficha && <FichaPessoaModal id={ficha} onClose={() => { setFicha(null); void recarregar(); }} />}
    </div>
  );
}

/**
 * RF-05: conferência do comprovante de vínculo. A administração confere o documento (que chega por e-mail ou em mãos)
 * e registra só o tipo, a data e quem conferiu. O arquivo não entra no sistema (LGPD, art. 6º, III).
 */
function ConferenciaComprovanteBloco({ vinculo, podeRegistrar, onRegistrado }: {
  vinculo: VinculoView; podeRegistrar: boolean; onRegistrado: () => Promise<unknown>;
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
          <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
            <div className="flex flex-col gap-0.5"><span className={rot}>Documento</span><span>{ROTULO_COMPROVANTE[c.tipoDocumento]}{c.descricao ? ` — ${c.descricao}` : ''}</span></div>
            <div className="flex flex-col gap-0.5"><span className={rot}>Data da conferência</span><span>{fmtData(c.data)}</span></div>
            <div className="flex flex-col gap-0.5"><span className={rot}>Conferido por</span><span>{vinculo.conferidoPorNome ?? '—'}</span></div>
            {c.observacao && <div className="sm:col-span-2 flex flex-col gap-0.5"><span className={rot}>Observação</span><span>{c.observacao}</span></div>}
          </div>
          {podeRegistrar && <div><Button pequeno onClick={() => setEditando(true)}>Refazer conferência</Button></div>}
        </div>
      )}
      {!c && !podeRegistrar && <span className="text-[#56616B]">Nenhuma conferência registrada.</span>}
      {podeRegistrar && editando && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
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
            </div>
            <Field label="Observação (opcional)" erro={numeroPessoal ? 'Não escreva CPF, telefone ou outro número pessoal.' : undefined}
              dica={`Curta e sem dado pessoal: não escreva CPF, telefone ou nomes. Até ${MAX_OBSERVACAO_CONFERENCIA} caracteres.`}>
              <textarea className="input" rows={2} maxLength={MAX_OBSERVACAO_CONFERENCIA} value={observacao} onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex.: recebido por e-mail; firma reconhecida." />
            </Field>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-[14px] font-medium">
            <input type="checkbox" className="h-[18px] w-[18px]" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
            Conferi o comprovante apresentado
          </label>
          {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
          <div className="flex flex-col gap-[10px] sm:flex-row">
            <Button variante="primario" disabled={!ok} carregando={salvando} onClick={() => void registrar()}>Registrar conferência</Button>
            {c && <Button onClick={() => { setEditando(false); setErro(''); }}>Cancelar</Button>}
          </div>
        </div>
      )}
    </section>
  );
}
