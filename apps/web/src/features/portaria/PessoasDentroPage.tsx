import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, ROTULO_TIPO_VISITA, type EventoView, type PermanenciaView } from '@portaria/domain/types';
import { descreverPermanencia, estadoPermanencia, permanenciaExcedida, proximaProrrogacao } from '@portaria/domain/rules';
import { agora as agoraSim, fmtDataHora, fmtHora, fromInput, toInputDate } from '@portaria/domain/time';
import { mensagemErro, useAgora } from '../../app/useAsync';
import { APOS_EVENTO, CHAVES, useInvalidar } from '../../app/consultas';
import { chipDoEvento, textoAutorizacao } from '../common/evento';

const COLUNAS = 'minmax(0,1.4fr) 110px 80px 80px 190px minmax(0,1.3fr) 340px';

export function PessoasDentroPage() {
  const api = useApi();
  const { avisar } = useToast();
  const agora = useAgora(15000);
  const podeRegistrar = useCan('evento.registrar');
  const podeRetroativo = useCan('evento.retroativo');
  const [retro, setRetro] = useState<EventoView | null>(null);
  const [prorrogando, setProrrogando] = useState<EventoView | null>(null);
  const invalidar = useInvalidar();
  const lista = useQuery({ queryKey: CHAVES.presentes, queryFn: () => api.eventos.presentes(), staleTime: 0 });

  async function saida(id: string, nome: string) {
    try {
      // A saída é um NOVO evento ligado à entrada; a entrada original não é alterada (RN-04)
      const ev = await api.eventos.registrarSaida(id);
      avisar({ texto: `Saída de ${nome} registrada às ${fmtHora(ev.ocorridoEm)} (${ev.codigo}, ligada à entrada ${ev.entradaCodigo}).` });
      void invalidar(APOS_EVENTO);
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); void invalidar([CHAVES.presentes]); }
  }

  const dados = lista.data ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Presentes agora"
        descricao={`${dados.length} ${dados.length === 1 ? 'pessoa entrou' : 'pessoas entraram'} e ainda não ${dados.length === 1 ? 'teve' : 'tiveram'} a saída registrada.`}
        acoes={podeRegistrar && <Link to="/entrada" className="inline-flex h-11 items-center gap-[10px] rounded-lg bg-[#0B5563] max-lg:h-[44px] px-[18px] font-semibold !text-white hover:bg-[#08434E]">Nova entrada <kbd className="rounded-[5px] border border-white/50 px-[7px] py-0.5 font-mono text-[13px]">F2</kbd></Link>} />
      {lista.error && <Alert tom="vermelho" role="alert">{mensagemErro(lista.error)}</Alert>}
      <Lista legenda="Pessoas atualmente no condomínio" colunas={COLUNAS} empilhar>
        <ListaCab rotulos={['Nome', 'Tipo', 'Unidade', 'Entrada', 'Permanência', 'Autorizado por', '']} />
        {dados.map((e) => {
          const pz = e.permanencia ?? null;
          const estado = pz ? estadoPermanencia(pz.prazoAte, agora) : null;
          // Sem prazo gravado (morador, funcionário, entrada de antes do controle de prazo): o alerta antigo de 8 h
          const destaque = estado === 'expirado' ? 'vermelho' : estado === 'vence_em_breve' || (!pz && permanenciaExcedida(e.ocorridoEm, agora)) ? 'ambar' : undefined;
          const podeMais = !!pz && proximaProrrogacao({ entradaEm: e.ocorridoEm, ...pz }, agora).ok;
          return (
            <ListaLinha key={e.id} destaque={destaque} minH={56} padY={8}>
              <Cel className="truncate font-medium">{e.pessoaNome}</Cel>
              <Cel className="text-[14px]">{ROTULO_CATEGORIA[e.categoriaPessoa]}</Cel>
              <CelUnidade id={e.unidadeDestinoId} texto={e.unidadeRotulo} />
              <Cel className="font-mono">{fmtHora(e.ocorridoEm)}</Cel>
              <Cel><CelPermanencia entradaEm={e.ocorridoEm} permanencia={pz} agora={agora} /></Cel>
              <Cel className="text-[14px]">{textoAutorizacao(e)}<span className="text-[#56616B]"> · {chipDoEvento(e).texto}</span></Cel>
              <Cel className="col-span-2 flex flex-wrap gap-2 md:col-span-1">{podeRegistrar && pz && (
                <button type="button" onClick={() => setProrrogando(e)} disabled={!podeMais}
                  aria-label={`Prorrogar a permanência de ${e.pessoaNome} em 1 hora`}
                  title={podeMais ? undefined : 'Limite de prorrogações ou de 12 h desde a entrada'}
                  className="h-[44px] rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium hover:border-[#0B5563] hover:text-[#0B5563] disabled:cursor-not-allowed disabled:bg-[#EEF2F4] disabled:text-[#6B7780] lg:h-10">+1h</button>
              )}{podeRegistrar && (
                <button type="button" onClick={() => void saida(e.id, e.pessoaNome)}
                  className="h-[44px] rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium hover:border-[#0B5563] hover:text-[#0B5563] lg:h-10">Registrar saída</button>
              )}{podeRetroativo && (
                <button type="button" onClick={() => setRetro(e)}
                  className="h-[44px] rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium hover:border-[#0B5563] hover:text-[#0B5563] lg:h-10">Saída retroativa</button>
              )}</Cel>
            </ListaLinha>
          );
        })}
        {!lista.isPending && dados.length === 0 && <Vazio>Ninguém no condomínio no momento.</Vazio>}
      </Lista>
      {prorrogando?.permanencia && <ProrrogarModal entrada={prorrogando} permanencia={prorrogando.permanencia} onClose={() => setProrrogando(null)}
        onFeito={(p) => { avisar({ texto: `Permanência de ${prorrogando.pessoaNome} prorrogada até ${fmtHora(p.prazoAte)} (${p.prorrogacoes}ª prorrogação).` }); setProrrogando(null); void invalidar([CHAVES.presentes]); }}
        onErro={() => void invalidar([CHAVES.presentes])} />}
      {retro && <SaidaRetroativaModal entrada={retro} onClose={() => setRetro(null)}
        onFeito={(ev) => { setRetro(null); avisar({ texto: `Saída retroativa de ${retro.pessoaNome} registrada: hora real ${fmtDataHora(ev.ocorridoEm)} (${ev.codigo}).` }); void invalidar(APOS_EVENTO); }} />}
    </div>
  );
}

/**
 * Coluna Permanência: tempo decorrido e, quando há prazo (visitante/prestador), o tipo de visita e o estado. O estado
 * nunca é só cor: vem em texto ("Vence em 12min", "Expirado há 20min") e com ícone.
 */
export function CelPermanencia({ entradaEm, permanencia, agora }: { entradaEm: number; permanencia: PermanenciaView | null; agora: number }) {
  const min = Math.max(0, Math.floor((agora - entradaEm) / 60000));
  const dur = `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  if (!permanencia) {
    const excedeu = permanenciaExcedida(entradaEm, agora);
    return (
      <span className={`flex items-center gap-1.5 font-mono ${excedeu ? 'font-semibold text-[#93370D]' : ''}`}>
        {excedeu && <TriangleAlert className="h-4 w-4" strokeWidth={2.4} aria-hidden />}
        {dur}{excedeu && <span className="font-sans text-[12px]">acima de 8h</span>}
      </span>
    );
  }
  const estado = estadoPermanencia(permanencia.prazoAte, agora);
  const cor = estado === 'expirado' ? 'font-semibold text-[#B42318]' : estado === 'vence_em_breve' ? 'font-semibold text-[#93370D]' : 'text-[#56616B]';
  const Icone = estado === 'expirado' ? TriangleAlert : estado === 'vence_em_breve' ? Clock : null;
  return (
    <span className="flex flex-col gap-0.5 leading-tight">
      <span className="font-mono">{dur} <span className="font-sans text-[12px] text-[#56616B]">· {ROTULO_TIPO_VISITA[permanencia.tipoVisita]}</span></span>
      <span className={`flex items-center gap-1 text-[13px] ${cor}`}>
        {Icone && <Icone className="h-4 w-4 shrink-0" strokeWidth={2.4} aria-hidden />}
        {descreverPermanencia(permanencia.prazoAte, agora)}
        {permanencia.prorrogacoes > 0 && <span className="font-normal text-[#56616B]">· prorrogado {permanencia.prorrogacoes}×</span>}
      </span>
    </span>
  );
}

/** "+1h" com confirmação: mostra o novo prazo calculado pela mesma regra do servidor (o servidor é quem decide). */
function ProrrogarModal({ entrada, permanencia, onClose, onFeito, onErro }: {
  entrada: EventoView; permanencia: PermanenciaView; onClose: () => void; onFeito: (p: PermanenciaView) => void; onErro: () => void;
}) {
  const api = useApi();
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const previsto = proximaProrrogacao({ entradaEm: entrada.ocorridoEm, ...permanencia }, agoraSim());
  async function confirmar() {
    setSalvando(true); setErro('');
    try { onFeito(await api.eventos.prorrogarPermanencia(entrada.id)); }
    catch (err) { setErro(mensagemErro(err)); setSalvando(false); onErro(); }
  }
  return (
    <Modal titulo={`Prorrogar permanência · ${entrada.pessoaNome}`} largura={480} gap={14} onClose={onClose}
      rodape={<><Button variante="primario" grande className="flex-1" carregando={salvando} disabled={!previsto.ok} onClick={() => void confirmar()}>Prorrogar +1h</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <p className="text-[14px]">
        {ROTULO_TIPO_VISITA[permanencia.tipoVisita]}, prazo atual até {fmtHora(permanencia.prazoAte)}.
        {previsto.ok ? <> Novo prazo: <strong>até {fmtHora(previsto.prazoAte)}</strong>.</> : <> {previsto.erro.message}</>}
      </p>
      <p className="text-[13px] text-[#56616B]">A prorrogação fica registrada na trilha de alterações. O registro de entrada não muda.</p>
      {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
    </Modal>
  );
}

/** Contingência: a saída aconteceu antes e foi anotada no papel. Hora real >= entrada e < agora, mais o nº do formulário. */
function SaidaRetroativaModal({ entrada, onClose, onFeito }: { entrada: EventoView; onClose: () => void; onFeito: (ev: EventoView) => void }) {
  const api = useApi();
  const [data, setData] = useState(toInputDate(agoraSim()));
  const [hora, setHora] = useState('');
  const [formulario, setFormulario] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const quando = hora ? fromInput(data, hora) : null;
  const dataOk = quando !== null && quando >= entrada.ocorridoEm && quando < agoraSim();
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!dataOk || quando === null) { setErro('Informe a hora real da saída: depois da entrada e antes do momento atual.'); return; }
    setSalvando(true); setErro('');
    try { onFeito(await api.eventos.registrarSaida(entrada.id, { retroativo: true, ocorridoEm: quando, formularioContingencia: formulario, observacao: obs })); }
    catch (err) { setErro(mensagemErro(err)); setSalvando(false); }
  }
  return (
    <Modal titulo={`Saída retroativa · ${entrada.pessoaNome}`} largura={560} gap={14} onClose={onClose}
      rodape={<><Button type="submit" form="f-saida-retro" variante="primario" grande className="flex-1" carregando={salvando}>Registrar saída retroativa</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <p className="text-[14px] text-[#56616B]">Entrada em {fmtDataHora(entrada.ocorridoEm)} ({entrada.codigo}). A hora do lançamento é definida pelo sistema e gravada junto, com a etiqueta Retroativo.</p>
      <form id="f-saida-retro" onSubmit={salvar} className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        <Field label="Data real da saída"><input type="date" className="input" value={data} min={toInputDate(entrada.ocorridoEm)} max={toInputDate(agoraSim())} onChange={(e) => setData(e.target.value)} /></Field>
        <Field label="Hora real da saída" erro={hora && !dataOk ? 'Depois da entrada e antes de agora.' : undefined}><input type="time" className="input" value={hora} onChange={(e) => setHora(e.target.value)} /></Field>
        <Field label="Nº do formulário de papel (obrigatório)" className="sm:col-span-2"><input className="input" value={formulario} onChange={(e) => setFormulario(e.target.value)} /></Field>
        <Field label="Observação (opcional)" className="sm:col-span-2"><input className="input" value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        {erro && <Alert tom="vermelho" role="alert" className="sm:col-span-2">{erro}</Alert>}
      </form>
    </Modal>
  );
}
