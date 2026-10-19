import { useEffect, useState, type FormEvent } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Check, Download, Paperclip } from 'lucide-react';
import { useApi, type OcorrenciaView } from '../../api';
import { useAuth, useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { SeloOcorrencia } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { Tabs } from '../../components/Tabs';
import { useToast } from '../../components/Toast';
import { ROTULO_STATUS_OCORRENCIA, ROTULO_TIPO_OCORRENCIA, type Ocorrencia, type StatusOcorrencia, type TipoOcorrencia } from '@portaria/domain/types';
import { ANEXO_MAX_BYTES, ANEXO_MAX_POR_OCORRENCIA, ehMimeAnexo } from '@portaria/domain/rules';
import { agora as agoraSim, fmtDataHora } from '@portaria/domain/time';
import { useCatalogo } from '../../app/catalogo';
import { mensagemErro } from '../../app/useAsync';
import { APOS_OCORRENCIA, CHAVES, useInvalidar } from '../../app/consultas';
import { chipDoEvento, quandoCurto, textoAutorizacao } from '../common/evento';
import { baixarBlob } from '../historico/download';

const COLUNAS = '120px 140px 250px 90px minmax(0,1fr) 110px 120px';
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
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [nova, setNova] = useState<Record<string, string> | null>(null);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const { codigo } = useCatalogo();
  const invalidar = useInvalidar();

  const lista = useInfiniteQuery({
    queryKey: CHAVES.ocorrenciasLista(filtro),
    queryFn: ({ pageParam }) => api.ocorrencias.listarPagina({ status: STATUS_DO_FILTRO[filtro], cursor: pageParam, limite: POR_PAGINA }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    staleTime: 0,
  });

  // F4 (ou o fluxo de restrição na entrada) abre o formulário já preenchido
  useEffect(() => {
    if (params.get('novo') === '1' && podeOperar) {
      setNova(Object.fromEntries(params.entries()));
      setParams(new URLSearchParams(), { replace: true });
    }
  }, [params, podeOperar, setParams]);

  const dados = lista.data?.pages.flatMap((p) => p.itens) ?? [];
  const daLista = dados.find((o) => o.id === abertaId);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Ocorrências" descricao="Fatos do turno com envolvidos e eventos de acesso vinculados."
        acoes={podeOperar && <Button variante="primario" atalho="F4" onClick={() => setNova({})}>Nova ocorrência</Button>} />
      <div className="rounded-[10px] border border-[#DCE1E5] bg-white">
        <Tabs rotulo="Situação das ocorrências" ativa={filtro} onChange={setFiltro}
          abas={[{ id: 'todas', rotulo: 'Todas' }, { id: 'abertas', rotulo: 'Abertas e em andamento' }, { id: 'encerradas', rotulo: 'Encerradas' }]} />
        {lista.error && <div className="p-4"><Alert tom="vermelho" role="alert">{mensagemErro(lista.error)}</Alert></div>}
        <Lista legenda="Ocorrências registradas" colunas={COLUNAS} className="!rounded-none !border-0">
          <ListaCab rotulos={['Código', 'Data', 'Tipo', 'Unidade', 'Descrição', 'Status', 'Registrado por']} />
          {dados.map((o) => (
            <ListaLinha key={o.id} minH={56} padY={10} onClick={() => setAbertaId(o.id)} ariaLabel={`Abrir ocorrência ${o.codigo}`}>
              <Cel className="font-mono text-[13.5px]">{o.codigo}</Cel>
              <Cel className="text-[14px]">{fmtDataHora(o.abertaEm)}</Cel>
              <Cel className="font-medium">{ROTULO_TIPO_OCORRENCIA[o.tipo]}</Cel>
              <Cel className={o.unidadeId ? 'font-mono font-semibold' : 'text-[14px]'}>{o.unidadeId ? codigo(o.unidadeId) : 'Área comum'}</Cel>
              <Cel className="truncate text-[14px] text-[#33424B]">{o.descricao}</Cel>
              <Cel><SeloOcorrencia status={o.status} /></Cel>
              <Cel className="text-[14px]">{o.abertaPorNome}</Cel>
            </ListaLinha>
          ))}
        </Lista>
        {!lista.isLoading && dados.length === 0 && <Vazio>Nenhuma ocorrência nesta lista.</Vazio>}
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
  const suporta = (op: string) => api.suporta?.(op) ?? true;
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
      <Modal titulo="Ocorrência" largura={640} onClose={onClose} rodape={<Button className="ml-auto" data-autofocus onClick={onClose}>Fechar</Button>}>
        {q.error ? <Alert tom="vermelho" role="alert">{mensagemErro(q.error)}</Alert> : <p className="text-[#56616B]">Carregando…</p>}
      </Modal>
    );
  }
  const podeOperar = podeOperarDe(o);
  const aberta = o.status !== 'encerrada';
  const docs = o.documentos ?? [];
  const nAnexos = Math.max(docs.length, o.anexos.length);
  const podeAnexar = podeOperar && aberta && nAnexos < ANEXO_MAX_POR_OCORRENCIA && suporta('ocorrencias.anexar');

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
    <Modal titulo={`${ROTULO_TIPO_OCORRENCIA[o.tipo]} · ${o.unidadeId ? codigo(o.unidadeId) : 'Área comum'}`} largura={680} gap={14} onClose={onClose}
      rodape={<>
        {/* Fluxo único: aberta, em andamento, encerrada. Encerrada é final; porteiro só mexe nas que abriu. */}
        {podeOperar && o.status === 'aberta' && <Button onClick={() => void escrever(() => api.ocorrencias.alterarStatus(o.id, 'em_andamento'), `${o.codigo} agora está “Em andamento”.`)}>Marcar em andamento</Button>}
        {podeOperar && o.status === 'em_andamento' && <Button onClick={() => void escrever(() => api.ocorrencias.alterarStatus(o.id, 'encerrada'), `${o.codigo} agora está “Encerrada”.`)}>Encerrar ocorrência</Button>}
        <Button className="ml-auto" data-autofocus onClick={onClose}>Fechar</Button>
      </>}>
      <div className="-mt-[10px] font-mono text-[13px] text-[#56616B] order-first">{o.codigo} · {fmtDataHora(o.abertaEm)}</div>
      <p>{o.descricao}</p>
      <div className="grid grid-cols-3 gap-3">
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
                {podeBaixar && suporta('ocorrencias.baixarAnexo') && (
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
        {podeVincular && aberta && suporta('ocorrencias.vincularEventos') && (
          vinculando ? (
            <div className="flex flex-col gap-2">
              <SeletorEventos selecionados={selecionados} onChange={setSelecionados} ocultar={o.eventoIds} />
              <div className="flex gap-2">
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
function SeletorEventos({ selecionados, onChange, ocultar = [] }: { selecionados: string[]; onChange: (ids: string[]) => void; ocultar?: string[] }) {
  const api = useApi();
  const recentes = useQuery({
    queryKey: ['eventos', 'recentes-ocorrencia'],
    queryFn: async () => (await api.eventos.listarPagina({ limite: 25, excluirTipos: ['correcao'] })).itens,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const lista = (recentes.data ?? []).filter((e) => !ocultar.includes(e.id));
  return (
    <fieldset className="flex max-h-56 flex-col gap-1 overflow-y-auto px-[10px] pb-[10px]">
      <legend className="sr-only">Movimentações recentes</legend>
      {lista.length === 0 && !recentes.isLoading && <span className="text-[14px] text-[#56616B]">Nenhuma movimentação recente.</span>}
      {lista.map((ev) => {
        const on = selecionados.includes(ev.id);
        return (
          <label key={ev.id} className={`grid min-h-11 cursor-pointer grid-cols-[22px_70px_minmax(0,1fr)_70px_minmax(0,1fr)] items-center gap-[10px] rounded-lg border bg-white px-[10px] py-1 text-[14px] focus-within:ring-2 focus-within:ring-[#0B5563] ${on ? 'border-[#0B5563]' : 'border-[#E1E6EA]'}`}>
            <input type="checkbox" className="sr-only" checked={on} onChange={(e) => onChange(e.target.checked ? [...selecionados, ev.id] : selecionados.filter((x) => x !== ev.id))} />
            <span aria-hidden className={`grid h-5 w-5 place-items-center rounded border-2 text-white ${on ? 'border-[#0B5563] bg-[#0B5563]' : 'border-[#9AA7B0] bg-white'}`}>{on && <Check className="h-3 w-3" strokeWidth={3.4} />}</span>
            <span className="font-mono">{quandoCurto(ev.ocorridoEm, agoraSim())}</span>
            <span className="truncate font-medium">{ev.pessoaNome}</span>
            <span className="font-mono font-semibold">{ev.unidadeRotulo ?? '—'}</span>
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
  const suporta = (op: string) => api.suporta?.(op) ?? true;
  const [tipo, setTipo] = useState<TipoOcorrencia>((TIPOS as string[]).includes(inicial.tipo) ? (inicial.tipo as TipoOcorrencia) : 'outro');
  const [descricao, setDescricao] = useState('');
  const [unidade, setUnidade] = useState(inicial.unidade ?? '');
  const [envolvidos, setEnvolvidos] = useState(inicial.envolvidos ?? '');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [vinc, setVinc] = useState<string[]>(inicial.evento ? [inicial.evento] : []);
  const [mostrarEventos, setMostrarEventos] = useState(!!inicial.evento);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const catalogo = useCatalogo();
  const unidadeNorm = unidade.trim() ? catalogo.porTexto(unidade)?.id ?? null : null;
  const unidadeInvalida = unidade.trim() !== '' && !unidadeNorm;
  const problemas = [
    ...arquivos.map(problemaDoArquivo).filter((x): x is string => !!x),
    ...(arquivos.length > ANEXO_MAX_POR_OCORRENCIA ? [`No máximo ${ANEXO_MAX_POR_OCORRENCIA} anexos.`] : []),
  ];

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (unidadeInvalida) { setErro('Unidade inexistente. Use o formato D-32 ou deixe em branco para área comum.'); return; }
    if (problemas.length) { setErro(problemas.join(' ')); return; }
    setSalvando(true); setErro('');
    let o: Ocorrencia;
    try { o = await api.ocorrencias.criar({ tipo, descricao, unidadeId: unidadeNorm, envolvidos, eventoIds: vinc }); }
    catch (err) { setErro(mensagemErro(err)); setSalvando(false); return; }
    // Anexos depois de criada, um por vez (cada um é cifrado e auditado na API). A ocorrência fica registrada mesmo se um falhar.
    const falhas: string[] = [];
    for (const f of arquivos) {
      try { await api.ocorrencias.anexar(o.id, f); } catch (err) { falhas.push(`${f.name}: ${mensagemErro(err)}`); }
    }
    onFeito(o, falhas);
  }

  return (
    <Modal titulo="Nova ocorrência" largura={760} onClose={onClose}>
      <form id="form-ocorrencia" onSubmit={salvar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span id="rot-tipo-oc" className="text-[14px] font-medium">Tipo</span>
          <div role="radiogroup" aria-labelledby="rot-tipo-oc" className="flex flex-wrap gap-1.5">
            {TIPOS.map((t, i) => (
              <button key={t} type="button" role="radio" aria-checked={tipo === t} {...(i === 0 ? { 'data-autofocus': true } : {})} onClick={() => setTipo(t)}
                className={`h-10 rounded-full border px-[14px] text-[14px] ${tipo === t ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>{ROTULO_TIPO_OCORRENCIA[t]}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3">
          <Field label="Unidade" erro={unidadeInvalida ? 'Unidade inexistente.' : undefined}>
            <input className="input font-mono" value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="D-32" />
          </Field>
          <Field label="Envolvidos"><input className="input" value={envolvidos} onChange={(e) => setEnvolvidos(e.target.value)} placeholder="Nomes das pessoas envolvidas" /></Field>
        </div>
        <Field label="Descrição"><textarea className="input" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
        {suporta('ocorrencias.anexar') && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="anexos-oc" className="text-[14px] font-medium">Anexos</label>
            <input id="anexos-oc" type="file" multiple accept={ACEITOS} className="text-[14px]" onChange={(e) => setArquivos(Array.from(e.target.files ?? []))} />
            <span className="text-[13px] text-[#56616B]">JPEG, PNG ou PDF, até {MB} MB cada, no máximo {ANEXO_MAX_POR_OCORRENCIA}</span>
            {problemas.length > 0 && <Alert tom="ambar">{problemas.join(' ')}</Alert>}
          </div>
        )}
        <div className="rounded-[10px] border border-[#DCE1E5]">
          <div className="flex items-center justify-between px-[14px] py-[10px]">
            <span className="text-[14px] font-medium">Eventos de acesso vinculados{vinc.length > 0 ? ` (${vinc.length})` : ''}</span>
            <button type="button" aria-expanded={mostrarEventos} onClick={() => setMostrarEventos((v) => !v)}
              className="h-10 rounded-lg border border-[#0B5563] bg-white px-[14px] text-[14px] font-semibold text-[#0B5563]">{mostrarEventos ? 'Ocultar' : 'Vincular eventos'}</button>
          </div>
          {mostrarEventos && <SeletorEventos selecionados={vinc} onChange={setVinc} />}
        </div>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
        <div className="flex gap-[10px]">
          <Button type="submit" variante="primario" grande className="flex-1" carregando={salvando}>Registrar ocorrência</Button>
          <Button grande atalho="Esc" onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}
