// Saída (UC07, RF-12): confirmação e contingência, usadas pela tela "Registrar saída" (/saida) e por "Presentes agora".
// A saída é um NOVO evento ligado à entrada; a entrada original não é alterada (RN-04). Por isso a saída comum pede
// confirmação: um clique errado só se desfaz com evento de correção na trilha.
import { useState } from 'react';
import { useApi } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, type EventoView } from '@portaria/domain/types';
import { agora as agoraSim, fmtDataHora, fmtHora, fromInput, toInputDate } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { APOS_EVENTO, CHAVES, useInvalidar } from '../../app/consultas';
import { chipDoEvento, quandoCurto, textoAutorizacao } from '../common/evento';
import { CelPermanencia } from './presentes';

/** Destino da entrada: código da unidade ou nome da área comum. */
export const destinoDe = (e: EventoView) => e.unidadeRotulo ?? e.areaComumNome ?? '—';

/**
 * Confirmação da saída: resumo da entrada e "Confirmar saída" com o foco (Enter confirma, Esc volta). Enter mantido
 * pressionado (repetição da tecla que escolheu a pessoa) não confirma. Em caso de sucesso avisa (toast com o código
 * da saída ligado à entrada), invalida APOS_EVENTO e chama `onFeito`; erro fica no modal.
 */
export function ConfirmarSaidaModal({ entrada, agora, onClose, onFeito, onRetroativa }: {
  entrada: EventoView; agora: number; onClose: () => void; onFeito: (saida: EventoView) => void;
  /** Mostra "Saída retroativa" (quem tem `evento.retroativo`). */
  onRetroativa?: () => void;
}) {
  const api = useApi();
  const { avisar } = useToast();
  const invalidar = useInvalidar();
  const podeRetroativo = useCan('evento.retroativo');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    if (salvando) return;
    setSalvando(true); setErro('');
    try {
      const ev = await api.eventos.registrarSaida(entrada.id);
      avisar({ texto: `Saída de ${entrada.pessoaNome} registrada às ${fmtHora(ev.ocorridoEm)} (${ev.codigo}, ligada à entrada ${ev.entradaCodigo ?? entrada.codigo}).` });
      void invalidar(APOS_EVENTO);
      onFeito(ev);
    } catch (e) {
      setErro(mensagemErro(e)); setSalvando(false);
      void invalidar([CHAVES.presentes]); // ex.: 409 SAIDA_JA_REGISTRADA por outro posto
    }
  }

  const chip = chipDoEvento(entrada);
  const linha = 'grid grid-cols-[132px_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-[7px] max-sm:grid-cols-1';
  return (
    <Modal titulo={`Registrar saída · ${entrada.pessoaNome}`} tituloId="saida-titulo" largura={520} gap={14} tom="petroleo" onClose={onClose}
      rodape={<>
        <Button variante="primario" grande className="flex-1" data-autofocus carregando={salvando}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); }}
          onClick={() => void confirmar()}>Confirmar saída</Button>
        <Button grande onClick={onClose}>Voltar</Button>
        {onRetroativa && podeRetroativo && <Button grande variante="fantasma" className="w-full" onClick={onRetroativa}
          title="A saída aconteceu antes e foi anotada no papel">Saída retroativa</Button>}
      </>}>
      <dl className="flex flex-col divide-y divide-[#EEF1F3] text-[15px]">
        <div className={linha}><dt className="text-[#56616B]">Pessoa</dt><dd className="font-semibold">{entrada.pessoaNome} <span className="font-normal text-[#56616B]">· {ROTULO_CATEGORIA[entrada.categoriaPessoa]}</span></dd></div>
        <div className={linha}><dt className="text-[#56616B]">Destino</dt><dd className="font-mono font-semibold">{destinoDe(entrada)}</dd></div>
        <div className={linha}><dt className="text-[#56616B]">Entrada</dt><dd>Entrou às <span className="font-mono">{quandoCurto(entrada.ocorridoEm, agora)}</span> <span className="text-[#56616B]">({entrada.codigo})</span></dd></div>
        <div className={linha}><dt className="text-[#56616B]">Permanência</dt><dd><CelPermanencia entradaEm={entrada.ocorridoEm} permanencia={entrada.permanencia ?? null} agora={agora} /></dd></div>
        <div className={linha}><dt className="text-[#56616B]">Autorizado por</dt><dd>{textoAutorizacao(entrada)} <span className="text-[#56616B]">· {chip.texto}</span></dd></div>
      </dl>
      <p className="text-[13px] text-[#56616B]">A saída é gravada agora, como um novo registro ligado à entrada. Enter confirma, Esc volta.</p>
      {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
    </Modal>
  );
}

/**
 * Contingência: a saída aconteceu antes e foi anotada no papel. Hora real >= entrada e < agora, mais o nº do formulário.
 * Em caso de sucesso avisa, invalida APOS_EVENTO e chama `onFeito`.
 */
export function SaidaRetroativaModal({ entrada, onClose, onFeito }: { entrada: EventoView; onClose: () => void; onFeito: (ev: EventoView) => void }) {
  const api = useApi();
  const { avisar } = useToast();
  const invalidar = useInvalidar();
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
    try {
      const ev = await api.eventos.registrarSaida(entrada.id, { retroativo: true, ocorridoEm: quando, formularioContingencia: formulario, observacao: obs });
      avisar({ texto: `Saída retroativa de ${entrada.pessoaNome} registrada: hora real ${fmtDataHora(ev.ocorridoEm)} (${ev.codigo}).` });
      void invalidar(APOS_EVENTO);
      onFeito(ev);
    } catch (err) { setErro(mensagemErro(err)); setSalvando(false); }
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
