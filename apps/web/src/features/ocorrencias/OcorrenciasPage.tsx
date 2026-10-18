import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { useApi, type OcorrenciaView } from '../../api';
import { useAuth, useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { SeloOcorrencia } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_STATUS_OCORRENCIA, ROTULO_TIPO_OCORRENCIA, type Ocorrencia, type StatusOcorrencia, type TipoOcorrencia } from '@portaria/domain/types';
import { agora as agoraSim, fmtDataHora } from '@portaria/domain/time';
import { useCatalogo } from '../../app/catalogo';
import { mensagemErro, useAsync } from '../../app/useAsync';
import { chipDoEvento, quandoCurto, textoAutorizacao } from '../common/evento';

const COLUNAS = '120px 140px 250px 90px minmax(0,1fr) 110px 120px';

export function OcorrenciasPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const { avisar } = useToast();
  const podeOperar = useCan('ocorrencia.operar');
  const { usuario } = useAuth();
  const lista = useAsync(() => api.ocorrencias.listar(), []);
  const [nova, setNova] = useState<Record<string, string> | null>(null);
  const [aberta, setAberta] = useState<OcorrenciaView | null>(null);
  const { codigo } = useCatalogo();

  // F4 (ou fluxo de restrição) abre o formulário já preenchido
  useEffect(() => {
    if (params.get('novo') === '1' && podeOperar) {
      setNova(Object.fromEntries(params.entries()));
      setParams(new URLSearchParams(), { replace: true });
    }
  }, [params, podeOperar, setParams]);

  async function mudarStatus(o: OcorrenciaView, status: StatusOcorrencia) {
    try {
      await api.ocorrencias.alterarStatus(o.id, status);
      setAberta((await api.ocorrencias.listar()).find((x) => x.id === o.id) ?? null); // view com os nomes resolvidos
      void lista.recarregar(); avisar({ texto: `${o.codigo} agora está “${status === 'encerrada' ? 'Encerrada' : 'Em andamento'}”.` }); }
    catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  const dados = lista.data ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Ocorrências" descricao="Fatos do turno com envolvidos e eventos de acesso vinculados."
        acoes={podeOperar && <Button variante="primario" atalho="F4" onClick={() => setNova({})}>Nova ocorrência</Button>} />
      {lista.error && <Alert tom="vermelho" role="alert">{lista.error}</Alert>}
      <Lista legenda="Ocorrências registradas" colunas={COLUNAS}>
        <ListaCab rotulos={['Código', 'Data', 'Tipo', 'Unidade', 'Descrição', 'Status', 'Registrado por']} />
        {dados.map((o) => (
          <ListaLinha key={o.id} minH={56} padY={10} onClick={() => setAberta(o)} ariaLabel={`Abrir ocorrência ${o.codigo}`}>
            <Cel className="font-mono text-[13.5px]">{o.codigo}</Cel>
            <Cel className="text-[14px]">{fmtDataHora(o.abertaEm)}</Cel>
            <Cel className="font-medium">{ROTULO_TIPO_OCORRENCIA[o.tipo]}</Cel>
            <Cel className={o.unidadeId ? 'font-mono font-semibold' : 'text-[14px]'}>{o.unidadeId ? codigo(o.unidadeId) : 'Área comum'}</Cel>
            <Cel className="truncate text-[14px] text-[#33424B]">{o.descricao}</Cel>
            <Cel><SeloOcorrencia status={o.status} /></Cel>
            <Cel className="text-[14px]">{o.abertaPorNome}</Cel>
          </ListaLinha>
        ))}
        {!lista.loading && dados.length === 0 && <Vazio>Nenhuma ocorrência registrada.</Vazio>}
      </Lista>
      {nova && <NovaOcorrenciaModal inicial={nova} onClose={() => setNova(null)} onFeito={(o) => { setNova(null); avisar({ texto: `Ocorrência ${o.codigo} registrada.` }); void lista.recarregar(); }} />}
      {aberta && <DetalheModal o={aberta} podeOperar={podeOperar && (usuario?.papel !== 'porteiro' || aberta.abertaPorId === usuario.id)} onClose={() => setAberta(null)} onStatus={mudarStatus} />}
    </div>
  );
}

function DetalheModal({ o, podeOperar, onClose, onStatus }: { o: OcorrenciaView; podeOperar: boolean; onClose: () => void; onStatus: (o: OcorrenciaView, s: StatusOcorrencia) => void }) {
  const api = useApi();
  const { codigo } = useCatalogo();
  const eventos = useAsync(async () => Promise.all(o.eventoIds.map((id) => api.eventos.obter(id))), [o.id]);
  const rot = 'text-[13px] text-[#56616B]';
  return (
    <Modal titulo={`${ROTULO_TIPO_OCORRENCIA[o.tipo]} · ${o.unidadeId ? codigo(o.unidadeId) : 'Área comum'}`} largura={640} gap={14} onClose={onClose}
      rodape={<>
        {/* Fluxo único: aberta, em andamento, encerrada. Encerrada é final; porteiro só mexe nas que abriu. */}
        {podeOperar && o.status === 'aberta' && <Button onClick={() => onStatus(o, 'em_andamento')}>Marcar em andamento</Button>}
        {podeOperar && o.status === 'em_andamento' && <Button onClick={() => onStatus(o, 'encerrada')}>Encerrar ocorrência</Button>}
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
      <div className="flex flex-col"><span className={rot}>Anexos</span><span>{o.anexos.length > 0 ? o.anexos.join(', ') : 'Nenhum anexo'}</span></div>
      {o.eventoIds.length > 0 && (
        <div className="flex flex-col gap-1.5"><span className={rot}>Eventos de acesso vinculados</span>
          {(eventos.data ?? []).map((e) => (
            <div key={e.id} className="flex min-h-11 items-center gap-[10px] rounded-lg border border-[#E1E6EA] bg-white px-3 py-1.5 text-[14px]">
              <span className="font-mono">{e.codigo}</span>
              <span>{quandoCurto(e.ocorridoEm, agoraSim())} · {e.pessoaNome} · {e.unidadeRotulo ?? 'Condomínio'} · {chipDoEvento(e).texto} · {textoAutorizacao(e)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

const TIPOS = Object.keys(ROTULO_TIPO_OCORRENCIA) as TipoOcorrencia[];

function NovaOcorrenciaModal({ inicial, onClose, onFeito }: { inicial: Record<string, string>; onClose: () => void; onFeito: (o: Ocorrencia) => void }) {
  const api = useApi();
  const [tipo, setTipo] = useState<TipoOcorrencia>((TIPOS as string[]).includes(inicial.tipo) ? (inicial.tipo as TipoOcorrencia) : 'outro');
  const [descricao, setDescricao] = useState('');
  const [unidade, setUnidade] = useState(inicial.unidade ?? '');
  const [envolvidos, setEnvolvidos] = useState(inicial.envolvidos ?? '');
  const [anexos, setAnexos] = useState<string[]>([]);
  const [vinc, setVinc] = useState<string[]>(inicial.evento ? [inicial.evento] : []);
  const [mostrarEventos, setMostrarEventos] = useState(!!inicial.evento);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const recentes = useAsync(() => api.eventos.listar().then((l) => l.slice(0, 25)), []);

  const catalogo = useCatalogo();
  const unidadeNorm = unidade.trim() ? catalogo.porTexto(unidade)?.id ?? null : null;
  const unidadeInvalida = unidade.trim() !== '' && !unidadeNorm;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (unidadeInvalida) { setErro('Unidade inexistente. Use o formato T4-32 ou deixe em branco para área comum.'); return; }
    setSalvando(true); setErro('');
    try { onFeito(await api.ocorrencias.criar({ tipo, descricao, unidadeId: unidadeNorm, envolvidos, anexos, eventoIds: vinc })); }
    catch (err) { setErro(mensagemErro(err)); setSalvando(false); }
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
            <input className="input font-mono" value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="T4-32" />
          </Field>
          <Field label="Envolvidos"><input className="input" value={envolvidos} onChange={(e) => setEnvolvidos(e.target.value)} placeholder="Nomes das pessoas envolvidas" /></Field>
        </div>
        <Field label="Descrição"><textarea className="input" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Field>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="anexos-oc" className="sr-only">Adicionar anexo</label>
          <input id="anexos-oc" type="file" multiple className="text-[14px]" onChange={(e) => setAnexos(Array.from(e.target.files ?? []).map((f) => f.name))} />
        </div>
        <div className="rounded-[10px] border border-[#DCE1E5]">
          <div className="flex items-center justify-between px-[14px] py-[10px]">
            <span className="text-[14px] font-medium">Eventos de acesso vinculados{vinc.length > 0 ? ` (${vinc.length})` : ''}</span>
            <button type="button" aria-expanded={mostrarEventos} onClick={() => setMostrarEventos((v) => !v)}
              className="h-10 rounded-lg border border-[#0B5563] bg-white px-[14px] text-[14px] font-semibold text-[#0B5563]">{mostrarEventos ? 'Ocultar' : 'Vincular eventos'}</button>
          </div>
          {mostrarEventos && (
            <fieldset className="flex max-h-56 flex-col gap-1 overflow-y-auto px-[10px] pb-[10px]">
              <legend className="sr-only">Movimentações recentes</legend>
              {(recentes.data ?? []).map((ev) => {
                const on = vinc.includes(ev.id);
                return (
                  <label key={ev.id} className={`grid min-h-11 cursor-pointer grid-cols-[22px_70px_minmax(0,1fr)_70px_minmax(0,1fr)] items-center gap-[10px] rounded-lg border bg-white px-[10px] py-1 text-[14px] ${on ? 'border-[#0B5563]' : 'border-[#E1E6EA]'}`}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setVinc(e.target.checked ? [...vinc, ev.id] : vinc.filter((x) => x !== ev.id))} />
                    <span aria-hidden className={`grid h-5 w-5 place-items-center rounded border-2 text-white ${on ? 'border-[#0B5563] bg-[#0B5563]' : 'border-[#9AA7B0] bg-white'}`}>{on && <Check className="h-3 w-3" strokeWidth={3.4} />}</span>
                    <span className="font-mono">{quandoCurto(ev.ocorridoEm, agoraSim())}</span>
                    <span className="truncate font-medium">{ev.pessoaNome}</span>
                    <span className="font-mono font-semibold">{ev.unidadeDestinoId ?? '—'}</span>
                    <span className="truncate text-[#33424B]">{chipDoEvento(ev).texto} · {ev.operadorNome}</span>
                  </label>
                );
              })}
            </fieldset>
          )}
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
