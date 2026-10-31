import { useEffect, useState, type FormEvent } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Check, Download, Paperclip, X } from 'lucide-react';
import { useApi, type Autorizador, type OcorrenciaView } from '../../api';
import { useAuth, useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { SeloOcorrencia } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { Tabs } from '../../components/Tabs';
import { TowerUnitPicker } from '../../components/TowerUnitPicker';
import { useToast } from '../../components/Toast';
import { ROTULO_VINCULO, ROTULO_STATUS_OCORRENCIA, ROTULO_TIPO_OCORRENCIA, type Ocorrencia, type StatusOcorrencia, type TipoOcorrencia } from '@portaria/domain/types';
import { ANEXO_MAX_BYTES, ANEXO_MAX_POR_OCORRENCIA, ehMimeAnexo } from '@portaria/domain/rules';
import { agora as agoraSim, fmtDataHora } from '@portaria/domain/time';
import { useCatalogo } from '../../app/catalogo';
import { oAgrupamento } from '@portaria/domain/units';
import { mensagemErro } from '../../app/useAsync';
import { APOS_OCORRENCIA, CHAVES, useInvalidar } from '../../app/consultas';
import { chipDoEvento, quandoCurto, textoAutorizacao } from '../common/evento';
import { baixarBlob } from '../historico/download';
import { CarregandoLinha, ErroCarregar } from '../../components/Carregando';
import { BarraFiltros, CampoFiltro, CONTROLE, ContagemResultado, FiltroUnidade, lerOpcao, naUrl, useFiltrosUrl, useFiltroUnidade } from '../../components/Filtros';

// Cabe sem rolagem lateral com o menu aberto em 1280 px (área útil ~972 px; ver larguraMinima em Table.tsx)
const COLUNAS = '100px 130px 170px 80px minmax(0,1fr) 110px 130px';
/** Parâmetros dos filtros na URL: aba, unidade (código) e tipo. Não confundir com os de pré-preenchimento do formulário (novo=1). */
const PARAMS_FILTRO = ['aba', 'un', 'tp'];
const TIPOS_OCORRENCIA = Object.keys(ROTULO_TIPO_OCORRENCIA) as TipoOcorrencia[];
const POR_PAGINA = 50;
type Filtro = 'todas' | 'abertas' | 'encerradas';
const STATUS_DO_FILTRO: Record<Filtro, StatusOcorrencia[] | undefined> = { todas: undefined, abertas: ['aberta', 'em_andamento'], encerradas: ['encerrada'] };
const ACEITOS = 'image/jpeg,image/png,application/pdf';
const MB = ANEXO_MAX_BYTES / 1024 / 1024;

/** Mesmas regras da API (tipo, tamanho), checadas antes de enviar; a API decide de novo pelo conteúdo. */
export function problemaDoArquivo(f: File): string | null {
  if (f.size === 0) return `${f.name}: arquivo vazio.`;
  if (f.size > ANEXO_MAX_BYTES) return `${f.name}: passa de ${MB} MB.`;
  if (!ehMimeAnexo(f.type)) return `${f.name}: envie foto (JPEG ou PNG) ou PDF.`;
  return null;
}
const tamanho = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function OcorrenciasPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const { avisar } = useToast();
  const podeOperar = useCan('ocorrencia.operar');
  const { usuario } = useAuth();
  const { gravar } = useFiltrosUrl();
  const filtro = lerOpcao(params.get('aba'), ['todas', 'abertas', 'encerradas'] as const, 'todas');
  const tipoFiltro = lerOpcao(params.get('tp'), ['', ...TIPOS_OCORRENCIA] as ('' | TipoOcorrencia)[], '');
  const unid = useFiltroUnidade();
  const [nova, setNova] = useState<Record<string, string> | null>(null);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const { codigo } = useCatalogo();
  const invalidar = useInvalidar();

  const lista = useInfiniteQuery({
    queryKey: CHAVES.ocorrenciasLista(filtro, tipoFiltro, unid.unidadeId),
    queryFn: ({ pageParam }) => api.ocorrencias.listarPagina({ status: STATUS_DO_FILTRO[filtro], tipo: tipoFiltro || undefined, unidadeId: unid.unidadeId, cursor: pageParam, limite: POR_PAGINA }),
    enabled: !unid.pendente,
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    staleTime: 0,
  });

  // F4 (ou o fluxo de restrição na entrada) abre o formulário já preenchido
  useEffect(() => {
    if (params.get('novo') === '1' && podeOperar) {
      // Os filtros da lista ficam na URL; o resto (tipo, unidade, evento...) pré-preenche o formulário e sai
      setNova(Object.fromEntries([...params.entries()].filter(([k]) => !PARAMS_FILTRO.includes(k))));
      setParams(new URLSearchParams([...params.entries()].filter(([k]) => PARAMS_FILTRO.includes(k))), { replace: true });
    }
  }, [params, podeOperar, setParams]);

  const dados = lista.data?.pages.flatMap((p) => p.itens) ?? [];
  const daLista = dados.find((o) => o.id === abertaId);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Ocorrências" descricao="Fatos do turno com envolvidos e eventos de acesso vinculados."
        acoes={podeOperar && <Button variante="primario" atalho="F4" onClick={() => setNova({})}>Nova ocorrência</Button>} />
      <BarraFiltros ativos={(unid.texto.trim() ? 1 : 0) + (tipoFiltro ? 1 : 0)} principalAtivo={!!unid.texto.trim()}
        onLimpar={() => { unid.limpar(); gravar({ tp: undefined }); }}
        principal={<FiltroUnidade f={unid} />}>
        <CampoFiltro rotulo="Tipo" largura="md:w-64">
          <select className={CONTROLE} value={tipoFiltro} onChange={(e) => gravar({ tp: naUrl(e.target.value, '') })}>
            <option value="">Todos</option>{TIPOS_OCORRENCIA.map((t) => <option key={t} value={t}>{ROTULO_TIPO_OCORRENCIA[t]}</option>)}
          </select>
        </CampoFiltro>
      </BarraFiltros>
      {(unid.unidadeId || tipoFiltro) && <ContagemResultado n={dados.length} singular="ocorrência" plural="ocorrências" className="-mb-3 px-1" />}
      <div className="rounded-[10px] border border-[#DCE1E5] bg-white">
        <Tabs rotulo="Situação das ocorrências" ativa={filtro} onChange={(a) => gravar({ aba: naUrl(a, 'todas') })}
          abas={[{ id: 'todas', rotulo: 'Todas' }, { id: 'abertas', rotulo: 'Abertas e em andamento' }, { id: 'encerradas', rotulo: 'Encerradas' }]} />
        {lista.error && <div className="p-4"><ErroCarregar mensagem={mensagemErro(lista.error)} onTentar={() => lista.refetch()} /></div>}
        <Lista legenda="Ocorrências registradas" colunas={COLUNAS} empilhar className="!rounded-none !border-0" carregando={lista.isLoading}>
          <ListaCab rotulos={['Código', 'Data', 'Tipo', 'Unidade', 'Descrição', 'Status', 'Registrado por']} />
          {dados.map((o) => (
            <ListaLinha key={o.id} minH={56} padY={10} onClick={() => setAbertaId(o.id)} ariaLabel={`Abrir ocorrência ${o.codigo}`}>
              <Cel className="font-mono text-[13.5px]">{o.codigo}</Cel>
              <Cel className="text-[14px]">{fmtDataHora(o.abertaEm)}</Cel>
              <Cel className="font-medium">{ROTULO_TIPO_OCORRENCIA[o.tipo]}</Cel>
              <Cel className={o.unidadeId ? 'font-mono font-semibold' : 'text-[14px]'}>{o.unidadeId ? codigo(o.unidadeId) : 'Área comum'}</Cel>
              <Cel className="col-span-2 truncate text-[14px] text-[#33424B] md:col-span-1">{o.descricao}</Cel>
              <Cel><SeloOcorrencia status={o.status} /></Cel>
              <Cel className="text-[14px]">{o.abertaPorNome}</Cel>
            </ListaLinha>
          ))}
        </Lista>
        {!lista.isLoading && !lista.error && dados.length === 0 && <Vazio>Nenhuma ocorrência nesta lista.</Vazio>}
        {lista.hasNextPage && (
          <div className="border-t border-[#E6EAED] p-3">
            <Button carregando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>Carregar mais ocorrências</Button>
          </div>
        )}
      </div>
      {nova && (
        <NovaOcorrenciaModal inicial={nova} onClose={() => setNova(null)} onFeito={(o, falhas) => {
          setNova(null);
          if (falhas.length) avisar({ tom: 'ambar', titulo: `Ocorrência ${o.codigo} registrada`, texto: `Anexo não enviado: ${falhas.join(' ')} Abra a ocorrência para tentar de novo.`, duracao: 12000 });
          else avisar({ texto: `Ocorrência ${o.codigo} registrada.` });
          void invalidar(APOS_OCORRENCIA);
        }} />
      )}
      {abertaId && (
        <DetalheModal id={abertaId} inicial={daLista} onClose={() => setAbertaId(null)}
          podeOperarDe={(o) => podeOperar && (usuario?.papel !== 'porteiro' || o.abertaPorId === usuario.id)} />
      )}
    </div>
  );
}

function DetalheModal({ id, inicial, onClose, podeOperarDe }: {
  id: string; inicial?: OcorrenciaView; onClose: () => void; podeOperarDe: (o: OcorrenciaView) => boolean;
}) {
  const api = useApi();
  const { avisar } = useToast();
  const { codigo } = useCatalogo();
  const invalidar = useInvalidar();
  const podeBaixar = useCan('documento.ver');
  const podeVincular = useCan('ocorrencia.operar');
  const [enviando, setEnviando] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  // O detalhe é relido da API depois de cada escrita (status, anexo, eventos): a view volta com os nomes resolvidos
  const q = useQuery({ queryKey: CHAVES.ocorrencia(id), queryFn: () => api.ocorrencias.obter(id), placeholderData: inicial, staleTime: 0 });
  const o = q.data;
  const eventos = useQuery({
    queryKey: ['eventos', 'ocorrencia', id, o?.eventoIds.join(',') ?? ''],
    queryFn: () => Promise.all((o?.eventoIds ?? []).map((eid) => api.eventos.obter(eid))),
    enabled: !!o && o.eventoIds.length > 0,
  });
  const rot = 'text-[13px] text-[#56616B]';

  async function escrever(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); avisar({ texto: ok }); await invalidar(APOS_OCORRENCIA); return true; } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); return false; }
  }
  if (!o) {
    return (
      <Modal titulo="Ocorrência" tamanho="g" onClose={onClose} rodape={<Button grande className="ml-auto" data-autofocus onClick={onClose}>Fechar</Button>}>
        {q.error ? <Alert tom="vermelho" role="alert">{mensagemErro(q.error)}</Alert> : <CarregandoLinha>Abrindo a ocorrência…</CarregandoLinha>}
      </Modal>
    );
  }
  const podeOperar = podeOperarDe(o);
  const aberta = o.status !== 'encerrada';
  const docs = o.documentos ?? [];
  const nAnexos = Math.max(docs.length, o.anexos.length);
  const podeAnexar = podeOperar && aberta && nAnexos < ANEXO_MAX_POR_OCORRENCIA;

  async function anexar(f: File | undefined) {
    if (!f) return;
    const p = problemaDoArquivo(f);
    if (p) { avisar({ tom: 'vermelho', texto: p }); return; }
    setEnviando(true);
    await escrever(() => api.ocorrencias.anexar(o!.id, f), `Anexo adicionado à ${o!.codigo}.`);
    setEnviando(false);
  }
  async function baixar(docId: string) {
    try { const a = await api.ocorrencias.baixarAnexo(o!.id, docId); baixarBlob(a.nome, a.conteudo); } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  return (
    <Modal titulo={`${ROTULO_TIPO_OCORRENCIA[o.tipo]} · ${o.unidadeId ? codigo(o.unidadeId) : 'Área comum'}`} tamanho="g" onClose={onClose}
      rodape={<>
        {/* Fluxo único: aberta, em andamento, encerrada. Encerrada é final; porteiro só mexe nas que abriu. */}
        {podeOperar && o.status === 'aberta' && <Button grande onClick={() => void escrever(() => api.ocorrencias.alterarStatus(o.id, 'em_andamento'), `${o.codigo} agora está “Em andamento”.`)}>Marcar em andamento</Button>}
        {podeOperar && o.status === 'em_andamento' && <Button grande onClick={() => void escrever(() => api.ocorrencias.alterarStatus(o.id, 'encerrada'), `${o.codigo} agora está “Encerrada”.`)}>Encerrar ocorrência</Button>}
        <Button grande className="ml-auto" data-autofocus onClick={onClose}>Fechar</Button>
      </>}>
      <div className="font-mono text-[13px] text-[#56616B]">{o.codigo} · {fmtDataHora(o.abertaEm)}</div>
      <p>{o.descricao}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col"><span className={rot}>Envolvidos</span><span>{o.envolvidos || '—'}</span></div>
        <div className="flex flex-col"><span className={rot}>Registrado por</span><span>{o.abertaPorNome}</span></div>
        <div className="flex flex-col items-start"><span className={rot}>Status</span><SeloOcorrencia status={o.status} /></div>
      </div>
      {o.historicoStatus.length > 0 && (
        <div className="flex flex-col gap-1"><span className={rot}>Mudanças de status</span>
          {o.historicoStatus.map((h, i) => (
            <span key={i} className="text-[14px]">{fmtDataHora(h.em)} · {ROTULO_STATUS_OCORRENCIA[h.de]} para {ROTULO_STATUS_OCORRENCIA[h.para]} · {h.porNome}</span>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5"><span className={rot}>Anexos</span>
        {docs.length > 0 ? (
          <ul className="flex flex-col gap-1" aria-label="Anexos da ocorrência">
            {docs.map((d) => (
              <li key={d.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-[#E1E6EA] bg-white px-3 py-1.5 text-[14px]">
                <Paperclip className="h-4 w-4 shrink-0 text-[#56616B]" aria-hidden />
                <span className="font-mono">{d.nome}</span>
                <span className="text-[#56616B]">{tamanho(d.tamanhoBytes)} · {d.enviadoPorNome} · {fmtDataHora(d.enviadoEm)}</span>
                {podeBaixar && (
                  <Button pequeno className="ml-auto" icone={Download} aria-label={`Baixar ${d.nome}`} onClick={() => void baixar(d.id)}>Baixar</Button>
                )}
              </li>
            ))}
          </ul>
        ) : <span>{o.anexos.length > 0 ? o.anexos.join(', ') : 'Nenhum anexo'}</span>}
        {docs.length > 0 && !podeBaixar && <span className="text-[13px] text-[#56616B]">O conteúdo dos anexos é aberto pela administração ou pelo síndico.</span>}
        {podeAnexar && (
          <label className="flex items-center gap-2 text-[14px]">
            <span className="font-medium">Adicionar anexo</span>
            <input type="file" accept={ACEITOS} disabled={enviando} className="text-[14px]" aria-label="Adicionar anexo"
              onChange={(e) => { void anexar(e.target.files?.[0]); e.target.value = ''; }} />
            <span className="text-[13px] text-[#56616B]">JPEG, PNG ou PDF até {MB} MB</span>
          </label>
        )}
      </div>
      <div className="flex flex-col gap-1.5"><span className={rot}>Eventos de acesso vinculados</span>
        {o.eventoIds.length === 0 && <span>Nenhum evento vinculado</span>}
        {(eventos.data ?? []).map((e) => (
          <div key={e.id} className="flex min-h-11 items-center gap-[10px] rounded-lg border border-[#E1E6EA] bg-white px-3 py-1.5 text-[14px]">
            <span className="font-mono">{e.codigo}</span>
            <span>{quandoCurto(e.ocorridoEm, agoraSim())} · {e.pessoaNome} · {e.unidadeRotulo ?? 'Condomínio'} · {chipDoEvento(e).texto} · {textoAutorizacao(e)}</span>
          </div>
        ))}
        {podeVincular && aberta && (
          vinculando ? (
            <div className="flex flex-col gap-2">
              <SeletorEventos selecionados={selecionados} onChange={setSelecionados} ocultar={o.eventoIds} />
              <div className="flex flex-wrap gap-2">
                <Button variante="primario" pequeno disabled={selecionados.length === 0} onClick={async () => {
                  if (await escrever(() => api.ocorrencias.vincularEventos(o.id, selecionados), `${selecionados.length} evento(s) vinculado(s) à ${o.codigo}.`)) {
                    setSelecionados([]); setVinculando(false);
                  }
                }}>Vincular selecionados</Button>
                <Button pequeno onClick={() => { setVinculando(false); setSelecionados([]); }}>Cancelar</Button>
              </div>
            </div>
          ) : <Button pequeno className="self-start" onClick={() => setVinculando(true)}>Vincular eventos</Button>
        )}
      </div>
    </Modal>
  );
}

/** Movimentações recentes para marcar (RF-28): a primeira página do histórico, sem as correções. */
function SeletorEventos({ selecionados, onChange, ocultar = [], unidadePrimeiro }: {
  selecionados: string[]; onChange: (ids: string[]) => void; ocultar?: string[];
  /** Código da unidade ("D-32") cujos eventos sobem para o topo, na ordem de horário. */ unidadePrimeiro?: string | null;
}) {
  const api = useApi();
  const recentes = useQuery({
    queryKey: ['eventos', 'recentes-ocorrencia'],
    queryFn: async () => (await api.eventos.listarPagina({ limite: 25, excluirTipos: ['correcao'] })).itens,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const visiveis = (recentes.data ?? []).filter((e) => !ocultar.includes(e.id));
  const lista = unidadePrimeiro
    ? [...visiveis.filter((e) => e.unidadeRotulo === unidadePrimeiro), ...visiveis.filter((e) => e.unidadeRotulo !== unidadePrimeiro)]
    : visiveis;
  return (
    <fieldset className="flex max-h-56 flex-col gap-1 overflow-y-auto px-[10px] pb-[10px]">
      <legend className="sr-only">Movimentações recentes</legend>
      {lista.length === 0 && !recentes.isLoading && <span className="text-[14px] text-[#56616B]">Nenhuma movimentação recente.</span>}
      {lista.map((ev) => {
        const on = selecionados.includes(ev.id);
        return (
          <label key={ev.id} className={`grid min-h-[44px] shrink-0 cursor-pointer grid-cols-[22px_96px_minmax(0,1fr)] items-center md:grid-cols-[22px_96px_minmax(0,1fr)_70px_minmax(0,1fr)] gap-[10px] rounded-lg border bg-white px-[10px] py-1 text-[14px] focus-within:ring-2 focus-within:ring-[#0B5563] ${on ? 'border-[#0B5563]' : 'border-[#E1E6EA]'}`}>
            <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onChange(e.target.checked ? [...selecionados, ev.id] : selecionados.filter((x) => x !== ev.id))} />
            <span aria-hidden className={`grid h-5 w-5 place-items-center rounded border-2 text-white ${on ? 'border-[#0B5563] bg-[#0B5563]' : 'border-[#9AA7B0] bg-white'}`}>{on && <Check className="h-3 w-3" strokeWidth={3.4} />}</span>
            <span className="whitespace-nowrap font-mono">{quandoCurto(ev.ocorridoEm, agoraSim())}</span>
            <span className="truncate font-medium">{ev.pessoaNome}</span>
            <span className="col-start-2 font-mono font-semibold md:col-start-auto">{ev.unidadeRotulo ?? '—'}</span>
            <span className="truncate text-[#33424B]">{chipDoEvento(ev).texto} · {ev.operadorNome}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

const TIPOS = Object.keys(ROTULO_TIPO_OCORRENCIA) as TipoOcorrencia[];

function NovaOcorrenciaModal({ inicial, onClose, onFeito }: { inicial: Record<string, string>; onClose: () => void; onFeito: (o: Ocorrencia, falhas: string[]) => void }) {
  const api = useApi();
  const catalogo = useCatalogo();
  // O tipo começa vazio (o porteiro escolhe; tudo virar "Outro" estraga o relatório), exceto quando o link já traz um
  const [tipo, setTipo] = useState<TipoOcorrencia | null>((TIPOS as string[]).includes(inicial.tipo) ? (inicial.tipo as TipoOcorrencia) : null);
  const [descricao, setDescricao] = useState('');
  // Local: unidade pelo mesmo seletor de bloco e apartamento da encomenda, ou área comum (escolha explícita)
  const daUnidadeInicial = inicial.unidade ? catalogo.porTexto(inicial.unidade, true) : undefined;
  const [local, setLocal] = useState<'unidade' | 'comum'>('unidade');
  const [bloco, setBloco] = useState<string | null>(daUnidadeInicial?.bloco ?? null);
  const [numero, setNumero] = useState<string | null>(daUnidadeInicial?.numero ?? null);
  const [envolvidos, setEnvolvidos] = useState(inicial.envolvidos ?? '');
  const [moradores, setMoradores] = useState<Autorizador[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [vinc, setVinc] = useState<string[]>(inicial.evento ? [inicial.evento] : []);
  const [mostrarEventos, setMostrarEventos] = useState(!!inicial.evento);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const unidadeId = local === 'unidade' && bloco && numero ? catalogo.porBlocoNumero(bloco, numero)?.id ?? null : null;
  const problemas = [
    ...arquivos.map(problemaDoArquivo).filter((x): x is string => !!x),
    ...(arquivos.length > ANEXO_MAX_POR_OCORRENCIA ? [`No máximo ${ANEXO_MAX_POR_OCORRENCIA} anexos.`] : []),
  ];

  // Envolvidos sugeridos: moradores com vínculo válido na unidade (o campo continua livre)
  useEffect(() => {
    if (!unidadeId) { setMoradores([]); return; }
    let vivo = true;
    api.vinculos.autorizadores(unidadeId).then((r) => vivo && setMoradores(r)).catch(() => undefined);
    return () => { vivo = false; };
  }, [unidadeId, api]);

  // Erro de validação some assim que o porteiro corrige
  useEffect(() => { setErro(''); }, [tipo, local, unidadeId, descricao, arquivos]);

  const nomesEnvolvidos = envolvidos.split(',').map((n) => n.trim()).filter(Boolean);
  function alternarEnvolvido(nome: string) {
    const ja = nomesEnvolvidos.includes(nome);
    setEnvolvidos((ja ? nomesEnvolvidos.filter((n) => n !== nome) : [...nomesEnvolvidos, nome]).join(', '));
  }
  function adicionarArquivos(lista: FileList | null) {
    const novos = Array.from(lista ?? []).filter((f) => !arquivos.some((a) => a.name === f.name && a.size === f.size));
    setArquivos([...arquivos, ...novos]);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!tipo) { setErro('Escolha o tipo da ocorrência.'); return; }
    if (local === 'unidade' && !unidadeId) { setErro(`Escolha ${oAgrupamento(catalogo.agrupamento).toLowerCase()} e a unidade, ou marque Área comum.`); return; }
    if (!descricao.trim()) { setErro('Descreva o que aconteceu.'); return; }
    if (problemas.length) { setErro(problemas.join(' ')); return; }
    setSalvando(true); setErro('');
    let o: Ocorrencia;
    try { o = await api.ocorrencias.criar({ tipo, descricao, unidadeId, envolvidos, eventoIds: vinc }); }
    catch (err) { setErro(mensagemErro(err)); setSalvando(false); return; }
    // Anexos depois de criada, um por vez (cada um é cifrado e auditado na API). A ocorrência fica registrada mesmo se um falhar.
    const falhas: string[] = [];
    for (const f of arquivos) {
      try { await api.ocorrencias.anexar(o.id, f); } catch (err) { falhas.push(`${f.name}: ${mensagemErro(err)}`); }
    }
    onFeito(o, falhas);
  }

  const chip = (on: boolean) => `h-[44px] rounded-full border px-[14px] text-[14px] lg:h-10 ${on ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`;
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const resumo = [
    tipo ? ROTULO_TIPO_OCORRENCIA[tipo] : 'Tipo não escolhido',
    local === 'comum' ? 'Área comum' : unidadeId ? catalogo.codigo(unidadeId) : 'Unidade não escolhida',
    plural(vinc.length, 'evento vinculado', 'eventos vinculados'),
    plural(arquivos.length, 'anexo', 'anexos'),
  ];

  return (
    <Modal titulo="Nova ocorrência" tamanho="g" onClose={onClose}
      rodape={<><Button type="submit" form="form-ocorrencia" variante="primario" grande className="flex-1" carregando={salvando}>Registrar ocorrência</Button><Button grande atalho="Esc" onClick={onClose}>Cancelar</Button></>}>
      <form id="form-ocorrencia" onSubmit={salvar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span id="rot-tipo-oc" className="text-[14px] font-medium">Tipo</span>
          <div role="radiogroup" aria-labelledby="rot-tipo-oc" className="flex flex-wrap gap-1.5">
            {TIPOS.map((t, i) => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t} {...((tipo ? tipo === t : i === 0) ? { 'data-autofocus': true } : {})}
                onClick={() => setTipo(t)} className={chip(tipo === t)}>{ROTULO_TIPO_OCORRENCIA[t]}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-[10px]">
          <div className="flex flex-wrap items-center gap-2">
            <span id="rot-local-oc" className="w-14 shrink-0 text-[14px] font-medium">Local</span>
            <div role="radiogroup" aria-labelledby="rot-local-oc" className="flex flex-wrap gap-1.5">
              <button type="button" role="radio" aria-checked={local === 'unidade'} onClick={() => setLocal('unidade')} className={chip(local === 'unidade')}>Unidade</button>
              <button type="button" role="radio" aria-checked={local === 'comum'} onClick={() => setLocal('comum')} className={chip(local === 'comum')}>Área comum</button>
            </div>
          </div>
          {local === 'unidade' && (
            <TowerUnitPicker variante="modal" bloco={bloco} numero={numero} onChange={(b, n) => { setBloco(b); setNumero(n); }} />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Field label="Envolvidos"><input className="input" value={envolvidos} onChange={(e) => setEnvolvidos(e.target.value)} placeholder="Nomes das pessoas envolvidas, separados por vírgula" /></Field>
          {moradores.length > 0 && (
            <div role="group" aria-label="Moradores da unidade" className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-[#56616B]">Moradores da unidade:</span>
              {moradores.map((m) => {
                const on = nomesEnvolvidos.includes(m.pessoa.nome);
                return (
                  <button key={m.pessoa.id} type="button" aria-pressed={on} onClick={() => alternarEnvolvido(m.pessoa.nome)}
                    className={`flex h-[44px] items-center gap-2 rounded-lg border-2 px-[12px] lg:h-10 ${on ? 'border-[#0B5563] bg-[#F0F8F9]' : 'border-[#DCE1E5] bg-white hover:border-[#9AA7B0]'}`}>
                    {on && <Check className="h-4 w-4 text-[#0B5563]" strokeWidth={2.6} aria-hidden />}
                    <span className="font-medium">{m.pessoa.nome}</span><span className="text-[13px] text-[#56616B]">{ROTULO_VINCULO[m.vinculo.tipo]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Field label="Descrição"><textarea className="input" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="O que aconteceu, onde e quando" /></Field>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[14px] font-medium">Anexos</span>
            <label htmlFor="anexos-oc"
              className="flex h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium hover:bg-[#EEF2F4] focus-within:outline focus-within:outline-2 focus-within:outline-[#0B5563] lg:h-10">
              <Paperclip className="h-4 w-4" aria-hidden />Adicionar foto ou PDF
              <input id="anexos-oc" type="file" multiple accept={ACEITOS} aria-label="Anexos" className="sr-only"
                onChange={(e) => { adicionarArquivos(e.target.files); e.target.value = ''; }} />
            </label>
            <span className="text-[13px] text-[#56616B]">JPEG, PNG ou PDF, até {MB} MB cada, no máximo {ANEXO_MAX_POR_OCORRENCIA}</span>
          </div>
          {arquivos.length > 0 && (
            <ul aria-label="Arquivos escolhidos" className="flex flex-col gap-1">
              {arquivos.map((f, i) => (
                <li key={`${f.name}-${f.size}`} className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-[#E1E6EA] bg-white px-3 py-1 text-[14px]">
                  <span className="min-w-0 truncate">{f.name} <span className="text-[#56616B]">· {tamanho(f.size)}</span></span>
                  <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setArquivos(arquivos.filter((_, j) => j !== i))}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[#56616B] hover:bg-[#EEF2F4] hover:text-ink"><X className="h-4 w-4" aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
          {problemas.length > 0 && <Alert tom="ambar">{problemas.join(' ')}</Alert>}
        </div>

        <div className="rounded-[10px] border border-[#DCE1E5]">
          <div className="flex flex-wrap items-center justify-between gap-2 px-[14px] py-[10px]">
            <span className="text-[14px] font-medium">Eventos de acesso vinculados{vinc.length > 0 ? ` (${vinc.length})` : ''}</span>
            <button type="button" aria-expanded={mostrarEventos} onClick={() => setMostrarEventos((v) => !v)}
              className="h-[44px] shrink-0 rounded-lg border border-[#0B5563] bg-white px-[14px] lg:h-10 text-[14px] font-semibold text-[#0B5563]">{mostrarEventos ? 'Ocultar' : 'Vincular eventos'}</button>
          </div>
          {mostrarEventos && <SeletorEventos selecionados={vinc} onChange={setVinc} unidadePrimeiro={unidadeId ? catalogo.codigo(unidadeId) : null} />}
        </div>

        <p aria-live="polite" className="rounded-lg bg-[#F3F5F6] px-[14px] py-[10px] text-[14px] text-[#33424B]">
          <span className="text-[#56616B]">Vai registrar: </span>
          {resumo.map((r, i) => <span key={i}>{i > 0 && ' · '}<span className={i < 2 ? 'font-semibold text-ink' : ''}>{r}</span></span>)}
        </p>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
      </form>
    </Modal>
  );
}
