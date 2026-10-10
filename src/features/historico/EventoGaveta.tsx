import { useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useApi } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Gaveta } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, type EventoView } from '../../domain/types';
import { MIN_JUSTIFICATIVA, justificativaValida } from '../../domain/rules';
import { fmtData, fmtDataHora, fmtHora } from '../../domain/time';
import { rotuloUnidade } from '../../domain/units';
import { mensagemErro, useAsync } from '../../app/useAsync';
import { textoAutorizacao, textoMeioLongo } from '../common/evento';

/** Gaveta de detalhe do evento (prototipo: painel lateral de 560px com integridade e linha do tempo). */
export function EventoGaveta({ ev, onClose, onCorrigido }: { ev: EventoView; onClose: () => void; onCorrigido?: () => void }) {
  const api = useApi();
  const { avisar } = useToast();
  const podeCorrigir = useCan('evento.corrigir');
  const [corrigindo, setCorrigindo] = useState(false);
  const [just, setJust] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  // Selo por registro: íntegro se a cadeia está válida ou se o primeiro registro inválido vem depois dele
  const integ = useAsync(() => api.auditoria.verificarIntegridade().catch(() => null), [ev.id]);
  const todos = useAsync(() => api.eventos.listar(), []);
  const r = integ.data;
  const ok = r ? r.valido || (r.primeiroSeqInvalido ?? 0) > ev.seq : null;

  // Linha do tempo: entrada, saída, correções e retroativo
  const passos: { quando: number; texto: string }[] = [];
  if (ev.retroativo) passos.push({ quando: ev.ocorridoEm, texto: `Acesso real (${ev.tipo}), anotado no formulário de contingência` });
  else passos.push({ quando: ev.ocorridoEm, texto: ev.tipo === 'entrada' ? 'Entrada registrada' : ev.tipo === 'saida' ? 'Saída registrada' : ev.tipo === 'negado' ? 'Entrada negada por restrição' : 'Correção registrada' });
  if (ev.retroativo) passos.push({ quando: ev.registradoEm, texto: 'Lançamento retroativo gravado na trilha' });
  if (ev.saida) passos.push({ quando: ev.saida.em, texto: `Saída registrada (${ev.saida.codigo}), ligada a esta entrada` });
  for (const c of (todos.data ?? []).filter((x) => x.corrigeEventoId === ev.id)) passos.push({ quando: c.ocorridoEm, texto: `Correção por ${c.operadorNome}: ${c.justificativa} (${c.codigo})` });
  if (ev.entradaCodigo) passos.push({ quando: ev.ocorridoEm, texto: `Vinculado à entrada ${ev.entradaCodigo}` });
  passos.sort((a, b) => a.quando - b.quando);

  async function corrigir() {
    try {
      const novo = await api.eventos.corrigir(ev.id, { justificativa: just, observacao: obs });
      avisar({ texto: `Correção ${novo.codigo} registrada. O registro original permanece inalterado.` });
      onCorrigido?.(); onClose();
    } catch (e) { setErro(mensagemErro(e)); }
  }

  const rot = 'text-[13px] text-[#56616B]';
  return (
    <Gaveta titulo={`Evento ${ev.codigo}`} onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[13px] text-[#56616B]">{ev.codigo}</div>
          <div className="mt-0.5 text-[22px] font-semibold leading-tight">{ev.pessoaNome}</div>
          <div className="text-[#33424B]">{ROTULO_CATEGORIA[ev.categoriaPessoa]} · {fmtData(ev.ocorridoEm)} · {fmtHora(ev.ocorridoEm)}</div>
        </div>
        <Button pequeno data-autofocus onClick={onClose}>Fechar</Button>
      </div>
      <div className="font-mono text-[28px] font-semibold text-[#0B3F49]">{ev.unidadeDestinoId ? rotuloUnidade(ev.unidadeDestinoId) : 'Condomínio'}</div>

      {ok === null ? (
        <div className="rounded-[10px] border border-[#D5DDE2] bg-[#EEF2F4] px-[14px] py-3 text-[#33424B]">Verificando integridade…</div>
      ) : (
        <div role="status" className={`flex items-center gap-3 rounded-[10px] border px-[14px] py-3 ${ok ? 'border-[#75E0A7] bg-[#DCFAE6] text-[#05603A]' : 'border-[#FDA29B] bg-[#FEE4E2] text-[#B42318]'}`}>
          {ok ? <ShieldCheck className="h-[26px] w-[26px] shrink-0" aria-hidden /> : <ShieldAlert className="h-[26px] w-[26px] shrink-0" aria-hidden />}
          <div className="min-w-0">
            <div className="font-semibold">{ok ? 'Integridade verificada' : 'Integridade comprometida'}</div>
            <div className="break-all font-mono text-[12.5px]">{ev.codigo} · sha256 {ev.hash}</div>
          </div>
        </div>
      )}

      {ev.retroativo && (
        <div className="rounded-lg border border-[#A9D2D8] bg-[#E3F0F2] px-3 py-[10px] text-[14px] text-[#0B4450]">
          <strong>Retroativo.</strong> Hora real {fmtDataHora(ev.ocorridoEm)} · lançado às {fmtDataHora(ev.registradoEm)}. Lançado por contingência.
        </div>
      )}

      <div className="grid grid-cols-2 gap-[14px]">
        <div className="flex flex-col gap-0.5"><span className={rot}>Registrado por</span><span className="font-semibold">{ev.operadorNome}</span></div>
        <div className="flex flex-col gap-0.5"><span className={rot}>Autorizado por</span><span className="font-semibold">{textoAutorizacao(ev)}</span></div>
        <div className="flex flex-col gap-0.5"><span className={rot}>Meio de autorização</span><span className="font-medium">{textoMeioLongo(ev)}</span></div>
        <div className="flex flex-col gap-0.5"><span className={rot}>Saída</span>
          <span className="font-medium">{ev.saida ? `${fmtHora(ev.saida.em)} (${ev.saida.codigo})` : ev.tipo === 'entrada' && ev.dentro ? 'Ainda no condomínio' : '—'}</span></div>
      </div>

      {ev.justificativa && (
        <div className="rounded-lg border border-[#FEC84B] bg-[#FEF0C7] px-[14px] py-3 text-[#7A2E0E]"><div className="text-[13px] font-semibold">Justificativa</div><div>{ev.justificativa}</div></div>
      )}
      {ev.observacao && <div className="text-[14px]"><span className={rot}>Observação</span><div>{ev.observacao}</div></div>}

      <div>
        <h3 className="mb-[10px] text-[15px] font-semibold">Linha do tempo</h3>
        <ol className="flex flex-col">
          {passos.map((p, i) => (
            <li key={i} className="grid grid-cols-[56px_14px_minmax(0,1fr)] gap-[10px] pb-3">
              <span className="font-mono text-[13px] text-[#56616B]">{fmtHora(p.quando)}</span>
              <span className="mt-[5px] h-[10px] w-[10px] rounded-full bg-[#0B5563]" />
              <span className="text-[14px]">{p.texto}{p.quando - ev.ocorridoEm > 6 * 3600 * 1000 || ev.ocorridoEm - p.quando > 6 * 3600 * 1000 ? ` — ${fmtData(p.quando)}` : ''}</span>
            </li>
          ))}
        </ol>
      </div>

      {podeCorrigir && ev.tipo !== 'correcao' && (
        corrigindo ? (
          <div className="flex flex-col gap-3 rounded-[10px] border border-[#DCE1E5] p-4">
            <p className="font-semibold">Registrar correção (novo evento, o original não é alterado)</p>
            <Field label={`Justificativa (mínimo ${MIN_JUSTIFICATIVA} caracteres)`}><textarea className="input" rows={2} value={just} onChange={(e) => setJust(e.target.value)} /></Field>
            <Field label="O que deve ser corrigido (opcional)"><input className="input" value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
            {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
            <div className="flex gap-[10px]"><Button variante="primario" disabled={!justificativaValida(just)} onClick={() => void corrigir()}>Gravar correção</Button><Button onClick={() => setCorrigindo(false)}>Cancelar</Button></div>
          </div>
        ) : <Button pequeno className="self-start" onClick={() => setCorrigindo(true)}>Registrar correção…</Button>
      )}

      <div className="border-t border-[#E6EAED] pt-2 text-[13px] text-[#56616B]">
        Registros de acesso não podem ser editados ou excluídos. Correções são feitas por novo registro com justificativa. Sequência {ev.seq} · hash anterior <span className="break-all font-mono text-[12px]">{ev.hashAnterior}</span>
      </div>
    </Gaveta>
  );
}
