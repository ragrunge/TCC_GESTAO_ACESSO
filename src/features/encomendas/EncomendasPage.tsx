import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, Check, TriangleAlert } from 'lucide-react';
import { useApi, type Autorizador, type PessoaBusca } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { Tabs } from '../../components/Tabs';
import { TowerUnitPicker } from '../../components/TowerUnitPicker';
import { useToast } from '../../components/Toast';
import { UnitTag } from '../../components/UnitTag';
import { ROTULO_VINCULO, type Encomenda } from '../../domain/types';
import { diasDesde, encomendaAtrasada } from '../../domain/rules';
import { rotuloUnidade, unidadeId } from '../../domain/units';
import { fmtDataHora } from '../../domain/time';
import { mensagemErro, useAgora, useAsync } from '../../app/useAsync';

const TRANSPORTADORAS = ['Correios', 'Mercado Livre', 'Amazon', 'Shopee', 'Loggi', 'Jadlog', 'Outra'];
const COL_AGUARDANDO = '90px minmax(0,1.2fr) 120px minmax(0,1.2fr) 190px 120px 110px';
const COL_ENTREGUES = '90px minmax(0,1fr) 120px minmax(0,1.3fr) 170px 130px';

const idade = (dias: number) => (dias === 0 ? 'hoje' : dias === 1 ? 'há 1 dia' : `há ${dias} dias`);

export function EncomendasPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const { avisar } = useToast();
  const agora = useAgora(30000);
  const podeOperar = useCan('encomenda.operar');
  const [aba, setAba] = useState<'aguardando' | 'entregue'>('aguardando');
  const [receber, setReceber] = useState(false);
  const [entregando, setEntregando] = useState<Encomenda | null>(null);
  const lista = useAsync(() => api.encomendas.listar({ status: aba }), [aba]);
  const aguardando = useAsync(() => api.encomendas.listar({ status: 'aguardando' }), [aba, receber, entregando]);
  const entregues = useAsync(() => api.encomendas.listar({ status: 'entregue' }), [aba, receber, entregando]);

  // F3 abre o recebimento direto
  useEffect(() => {
    if (params.get('novo') === '1' && podeOperar) {
      setReceber(true);
      params.delete('novo'); setParams(params, { replace: true });
    }
  }, [params, podeOperar, setParams]);

  const dados = lista.data ?? [];
  const nAguardando = aguardando.data?.length ?? 0;
  const nAtrasadas = (aguardando.data ?? []).filter((e) => encomendaAtrasada(e.recebidaEm, agora)).length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Encomendas"
        descricao={`${nAguardando} aguardando retirada · ${nAtrasadas} há mais de 7 dias. Entrega só para pessoa com vínculo na unidade.`}
        acoes={podeOperar && <Button variante="primario" atalho="F3" onClick={() => setReceber(true)}>Receber encomenda</Button>} />

      <div className="rounded-[10px] border border-[#DCE1E5] bg-white">
        <Tabs rotulo="Situação das encomendas" ativa={aba} onChange={setAba}
          abas={[{ id: 'aguardando', rotulo: `Aguardando retirada (${nAguardando})` }, { id: 'entregue', rotulo: `Entregues (${entregues.data?.length ?? 0})` }]} />
        {lista.error && <div className="p-4"><Alert tom="vermelho" role="alert">{lista.error}</Alert></div>}
        {aba === 'aguardando' ? (
          <Lista legenda="Encomendas aguardando retirada" colunas={COL_AGUARDANDO} className="!rounded-none !border-0">
            <ListaCab rotulos={['Unidade', 'Destinatário', 'Transportadora', 'Rastreio', 'Recebida em', 'Recebida por', '']} />
            {dados.map((e) => {
              const dias = diasDesde(e.recebidaEm, agora);
              const atrasada = encomendaAtrasada(e.recebidaEm, agora);
              return (
                <ListaLinha key={e.id} destaque={atrasada ? 'ambar' : undefined} minH={56} padY={8}>
                  <CelUnidade id={e.unidadeId} className="text-[17px]" />
                  <Cel className="truncate font-medium">{e.destinatario}</Cel>
                  <Cel className="text-[14px]">{e.transportadora}</Cel>
                  <Cel className="truncate font-mono text-[13.5px] text-[#33424B]">{e.codigoRastreio}</Cel>
                  <Cel className="flex flex-col gap-0.5">
                    <span className="text-[14px]">{fmtDataHora(e.recebidaEm)}</span>
                    <span className={`inline-flex h-[22px] items-center gap-[5px] self-start rounded-[5px] border px-[7px] text-[12px] font-semibold ${
                      atrasada ? 'border-[#FEC84B] bg-[#FEF0C7] text-[#93370D]' : 'border-[#D5DDE2] bg-[#EEF2F4] text-[#33424B]'}`}>
                      {atrasada && <TriangleAlert className="h-3 w-3" strokeWidth={2.6} aria-hidden />}{idade(dias)}
                    </span>
                  </Cel>
                  <Cel className="text-[14px]">{e.recebidaPorNome}</Cel>
                  <Cel>{podeOperar && (
                    <button type="button" onClick={() => setEntregando(e)} aria-label={`Entregar encomenda ${e.codigo}`}
                      className="h-10 w-full rounded-lg border border-[#B9C3CA] bg-white text-[14px] font-medium hover:border-[#0B5563] hover:text-[#0B5563]">Entregar</button>
                  )}</Cel>
                </ListaLinha>
              );
            })}
          </Lista>
        ) : (
          <Lista legenda="Encomendas entregues" colunas={COL_ENTREGUES} className="!rounded-none !border-0">
            <ListaCab rotulos={['Unidade', 'Destinatário', 'Transportadora', 'Entregue a', 'Entregue em', 'Entregue por']} />
            {dados.map((e) => (
              <ListaLinha key={e.id} minH={52} padY={8}>
                <CelUnidade id={e.unidadeId} className="text-[17px]" />
                <Cel>{e.destinatario}</Cel>
                <Cel className="text-[14px]">{e.transportadora}</Cel>
                <Cel className="flex items-center gap-1.5 font-medium text-[#05603A]"><Check className="h-4 w-4" strokeWidth={2.6} aria-hidden />{e.retiradaPorNome}</Cel>
                <Cel className="text-[14px]">{e.retiradaEm && fmtDataHora(e.retiradaEm)}</Cel>
                <Cel className="text-[14px]">{e.retiradaRegistradaPorNome}</Cel>
              </ListaLinha>
            ))}
          </Lista>
        )}
        {!lista.loading && dados.length === 0 && <Vazio>Nenhuma encomenda nesta lista.</Vazio>}
      </div>

      {receber && <ReceberModal onClose={() => setReceber(false)} onFeito={(e) => { setReceber(false); avisar({ texto: `Encomenda ${e.codigo} registrada para ${e.unidadeId}. Avise a unidade pelo interfone.` }); void lista.recarregar(); }} />}
      {entregando && <EntregarModal encomenda={entregando} onClose={() => setEntregando(null)}
        onFeito={(e) => { setEntregando(null); avisar({ texto: `Encomenda ${e.codigo} entregue a ${e.retiradaPorNome}.` }); void lista.recarregar(); }} />}
    </div>
  );
}

function ReceberModal({ onClose, onFeito }: { onClose: () => void; onFeito: (e: Encomenda) => void }) {
  const api = useApi();
  const [torre, setTorre] = useState<number | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [f, setF] = useState({ destinatario: '', transportadora: '', codigoRastreio: '' });
  const [moradores, setMoradores] = useState<Autorizador[]>([]);
  const [etapa, setEtapa] = useState<'form' | 'confirmar'>('form');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const destRef = useRef<HTMLInputElement>(null);
  const unidade = torre && numero ? unidadeId(torre, numero) : null;

  // Destinatários sugeridos: moradores com vínculo válido na unidade (o campo continua editável)
  useEffect(() => {
    if (!unidade) { setMoradores([]); return; }
    let vivo = true;
    api.vinculos.autorizadores(unidade).then((r) => vivo && setMoradores(r)).catch(() => undefined);
    return () => { vivo = false; };
  }, [unidade, api]);

  // Erro de validação some assim que o porteiro corrige o campo
  useEffect(() => { setErro(''); }, [unidade, f.destinatario, f.transportadora]);

  function revisar(e: FormEvent) {
    e.preventDefault();
    if (!unidade) { setErro('Escolha a torre e a unidade.'); return; }
    if (!f.destinatario.trim()) { setErro('Informe o destinatário.'); return; }
    if (!f.transportadora) { setErro('Escolha a transportadora.'); return; }
    setErro(''); setEtapa('confirmar');
  }
  async function salvar() {
    if (!unidade) return;
    setSalvando(true);
    try { onFeito(await api.encomendas.receber({ ...f, unidadeId: unidade, unidadeConfirmada: true })); }
    catch (e) { setErro(mensagemErro(e)); setEtapa('form'); setSalvando(false); }
  }

  // Enter confirma na etapa de conferência mesmo se o foco não estiver no botão
  useEffect(() => {
    if (etapa !== 'confirmar') return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' || ev.defaultPrevented || salvando) return;
      if ((ev.target as HTMLElement | null)?.tagName === 'BUTTON') return; // o próprio botão já trata
      ev.preventDefault();
      void salvar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (etapa === 'confirmar' && unidade) {
    return (
      <Modal titulo="Conferir a unidade de destino" tituloOculto tom="petroleo" largura={620} gap={18} onClose={() => setEtapa('form')}>
        <div className="flex flex-col gap-[18px] text-center">
          <div className="text-[18px] text-[#33424B]">Confirma que a encomenda é para</div>
          <div className="font-mono text-[48px] font-bold tracking-[0.02em] text-[#0B3F49]">{rotuloUnidade(unidade)}?</div>
          <div className="text-[16px]">Destinatário: <strong>{f.destinatario}</strong> · {f.transportadora}</div>
          {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
          <div className="mt-2 flex gap-[10px]">
            <button type="button" data-autofocus disabled={salvando} onClick={() => void salvar()}
              className="flex h-[52px] flex-1 items-center justify-center gap-[10px] rounded-lg bg-[#0B5563] text-[16px] font-semibold text-white hover:bg-[#08434E]">
              Sim, registrar <kbd className="rounded-[5px] border border-white/50 px-[7px] py-0.5 font-mono text-[13px]">Enter</kbd>
            </button>
            <button type="button" onClick={() => setEtapa('form')}
              className="flex h-[52px] flex-1 items-center justify-center gap-[10px] rounded-lg border border-[#B9C3CA] bg-white text-[16px] hover:bg-[#EEF2F4]">
              Voltar e corrigir <kbd className="rounded-[5px] border border-[#B9C3CA] px-[7px] py-0.5 font-mono text-[13px]">Esc</kbd>
            </button>
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal titulo="Receber encomenda" largura={680} onClose={onClose}>
      <form id="form-encomenda" onSubmit={revisar} className="flex flex-col gap-4">
        <TowerUnitPicker autoFocusTorre variante="modal" torre={torre} numero={numero} onChange={(t, n) => { setTorre(t); setNumero(n); }} onComplete={() => setTimeout(() => destRef.current?.focus(), 0)} />
        {unidade && moradores.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[14px] font-medium">Destinatário (moradores da unidade)</span>
            <div className="flex flex-wrap gap-2">
              {moradores.map((m) => (
                <button key={m.pessoa.id} type="button" aria-pressed={f.destinatario === m.pessoa.nome} onClick={() => setF({ ...f, destinatario: m.pessoa.nome })}
                  className={`flex h-11 items-center gap-2 rounded-lg border-2 px-[14px] ${f.destinatario === m.pessoa.nome ? 'border-[#0B5563] bg-[#F0F8F9]' : 'border-[#DCE1E5] bg-white hover:border-[#9AA7B0]'}`}>
                  <span className="font-medium">{m.pessoa.nome}</span><span className="text-[13px] text-[#56616B]">{ROTULO_VINCULO[m.vinculo.tipo]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label="Destinatário"><input ref={destRef} className="input" value={f.destinatario} onChange={(e) => setF({ ...f, destinatario: e.target.value })} /></Field>
        <div className="flex flex-col gap-1.5">
          <span id="rot-transp" className="text-[14px] font-medium">Transportadora</span>
          <div role="radiogroup" aria-labelledby="rot-transp" className="flex flex-wrap gap-1.5">
            {TRANSPORTADORAS.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={f.transportadora === t} onClick={() => setF({ ...f, transportadora: t })}
                className={`h-10 rounded-full border px-[14px] text-[14px] ${f.transportadora === t ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>{t}</button>
            ))}
          </div>
        </div>
        <Field label="Código de rastreio"><input className="input font-mono" value={f.codigoRastreio} onChange={(e) => setF({ ...f, codigoRastreio: e.target.value })} /></Field>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
        <div className="flex gap-[10px]">
          <Button type="submit" variante="primario" grande className="flex-1" atalho="Enter">Continuar</Button>
          <Button grande atalho="Esc" onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  );
}

function EntregarModal({ encomenda, onClose, onFeito }: { encomenda: Encomenda; onClose: () => void; onFeito: (e: Encomenda) => void }) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [achados, setAchados] = useState<PessoaBusca[]>([]);
  const [escolhida, setEscolhida] = useState<PessoaBusca | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setAchados([]); return; }
    let vivo = true;
    const t = setTimeout(() => { api.pessoas.buscar(q).then((r) => vivo && setAchados(r)).catch(() => undefined); }, 150);
    return () => { vivo = false; clearTimeout(t); };
  }, [q, api]);

  // Mesma regra de vínculo válido (aprovado ou legado no prazo) usada no interfone; o servidor valida de novo
  const temVinculo = !!escolhida && escolhida.unidadesVinculadas.includes(encomenda.unidadeId);

  async function confirmar() {
    if (!escolhida) return;
    setSalvando(true);
    try { onFeito(await api.encomendas.entregar({ id: encomenda.id, pessoaId: escolhida.id })); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <Modal titulo={`Entregar encomenda ${encomenda.codigo}`} largura={620} onClose={onClose}>
      <div className="flex flex-col">
        <UnitTag id={encomenda.unidadeId} tamanho="lg" className="!text-[30px]" />
        <span className="text-[#33424B]">Destinatário: {encomenda.destinatario}</span>
        <span className="text-[14px] text-[#56616B]">{encomenda.transportadora} · <span className="font-mono">{encomenda.codigoRastreio}</span></span>
      </div>
      {!escolhida ? (
        <>
          <label className="flex flex-col gap-1.5 text-[14px] font-medium">Quem está retirando?
            <input data-autofocus className="h-12 rounded-lg border border-[#9AA7B0] bg-white px-[14px] text-[16px] font-normal" placeholder="Nome da pessoa" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </label>
          <div className="flex flex-col gap-1">
            {achados.map((p) => (
              <button key={p.id} type="button" className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-[#E1E6EA] bg-white px-3 py-1.5 text-left hover:bg-[#EEF5F6]" onClick={() => { setEscolhida(p); setErro(''); }}>
                <span className="font-medium">{p.nome}</span>
                <span className="text-[13px] text-[#56616B]">{p.unidadesVinculadas.length > 0 ? `Mora em ${p.unidadesVinculadas.join(', ')}` : p.documentoMascarado}</span>
              </button>
            ))}
          </div>
          <Button className="self-end" onClick={onClose}>Cancelar</Button>
        </>
      ) : (
        <>
          {temVinculo ? (
            <div role="status" className="flex items-start gap-3 rounded-[10px] border border-[#75E0A7] bg-[#DCFAE6] px-4 py-[14px] text-[#05603A]">
              <Check className="h-[22px] w-[22px] shrink-0" strokeWidth={2.4} aria-hidden />
              <div className="flex flex-col"><span className="text-[16px] font-semibold">{escolhida.nome}</span><span className="text-[14px]">Vínculo válido com a {rotuloUnidade(encomenda.unidadeId)}. A retirada fica registrada com o seu nome.</span></div>
            </div>
          ) : (
            <div role="alert" className="flex items-start gap-3 rounded-[10px] border-2 border-[#B42318] bg-[#FEE4E2] p-4 text-[#912018]">
              <Ban className="h-7 w-7 shrink-0" strokeWidth={2.2} aria-hidden />
              <div className="flex flex-col gap-1"><span className="text-[17px] font-bold">Esta pessoa não tem vínculo com a {encomenda.unidadeId}. Contate a unidade.</span>
                <span className="text-[14px]">{escolhida.nome} · {escolhida.documentoMascarado}</span></div>
            </div>
          )}
          {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
          <div className="flex gap-[10px]">
            {temVinculo
              ? <Button variante="primario" grande className="flex-1" atalho="Enter" data-autofocus carregando={salvando} onClick={() => void confirmar()}>Confirmar entrega</Button>
              : <Button grande className="flex-1" data-autofocus onClick={() => setEscolhida(null)}>Buscar outra pessoa</Button>}
            {temVinculo ? <Button grande onClick={() => setEscolhida(null)}>Trocar pessoa</Button> : <Button grande onClick={onClose}>Fechar</Button>}
          </div>
        </>
      )}
    </Modal>
  );
}
