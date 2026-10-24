import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi, type PessoaBusca } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Gaveta } from '../../components/Modal';
import { PessoaPicker } from '../../components/PessoaPicker';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, type EventoView, type ValoresCorrecao } from '@portaria/domain/types';
import { MIN_JUSTIFICATIVA, justificativaValida } from '@portaria/domain/rules';
import { fmtData, fmtDataHora, fmtHora, fromInput } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { APOS_EVENTO, CHAVES, useInvalidar } from '../../app/consultas';
import { useCatalogo } from '../../app/catalogo';
import { textoAutorizacao, textoMeioLongo } from '../common/evento';
import { baixarArquivo } from './download';

/** Gaveta de detalhe do evento (prototipo: painel lateral de 560px com integridade e linha do tempo). */
export function EventoGaveta({ ev, onClose, onCorrigido }: { ev: EventoView; onClose: () => void; onCorrigido?: () => void }) {
  const api = useApi();
  const { avisar } = useToast();
  const podeCorrigir = useCan('evento.corrigir');
  const podeExportar = useCan('auditoria.exportar');
  const podeSaida = useCan('evento.registrar');
  const catalogo = useCatalogo();
  const fmt = (campo: keyof ValoresCorrecao, v: unknown) => formatarValor(campo, v, catalogo.codigo);
  const [corrigindo, setCorrigindo] = useState(false);
  const [just, setJust] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  // Valores corrigidos (todos opcionais): só o que for preenchido substitui o original
  const [vUnidade, setVUnidade] = useState('');
  const [vData, setVData] = useState('');
  const [vHora, setVHora] = useState('');
  const [vPessoa, setVPessoa] = useState<PessoaBusca | null>(null);
  const [vAutorizador, setVAutorizador] = useState<PessoaBusca | null>(null);
  // Selo por registro: íntegro se a cadeia está válida ou se o primeiro registro inválido vem depois dele
  const invalidar = useInvalidar();
  // A verificação percorre a cadeia inteira: na API real, o resultado vale por 30 s para as próximas gavetas
  const integ = useQuery({ queryKey: CHAVES.integridade, queryFn: () => api.auditoria.verificarIntegridade().catch(() => null), staleTime: 30_000 });
  const correcoes = useQuery({ queryKey: CHAVES.correcoes(ev.id), queryFn: () => api.eventos.correcoesDe(ev.id), enabled: ev.tipo !== 'correcao' });
  const r = integ.data;
  const ok = r ? r.valido || (r.primeiroSeqInvalido ?? 0) > ev.seq : null;

  // Linha do tempo: entrada, saída, correções e retroativo
  const passos: { quando: number; texto: string }[] = [];
  if (ev.retroativo) passos.push({ quando: ev.ocorridoEm, texto: `Acesso real (${ev.tipo}), anotado no formulário de contingência` });
  else passos.push({ quando: ev.ocorridoEm, texto: ev.tipo === 'entrada' ? 'Entrada registrada' : ev.tipo === 'saida' ? 'Saída registrada' : ev.tipo === 'negado' ? 'Entrada negada por restrição' : ev.tipo === 'recusado' ? 'Visita recusada pelo morador' : 'Correção registrada' });
  if (ev.retroativo) passos.push({ quando: ev.registradoEm, texto: 'Lançamento retroativo gravado na trilha' });
  if (ev.saida) passos.push({ quando: ev.saida.em, texto: `Saída registrada (${ev.saida.codigo}), ligada a esta entrada` });
  for (const c of correcoes.data ?? []) passos.push({ quando: c.ocorridoEm, texto: `Correção por ${c.operadorNome}: ${c.justificativa} (${c.codigo})` });
  if (ev.entradaCodigo) passos.push({ quando: ev.ocorridoEm, texto: `Vinculado à entrada ${ev.entradaCodigo}` });
  passos.sort((a, b) => a.quando - b.quando);

  // RF-32: arquivo verificável só com este evento (manifesto + evento + resumo)
  async function exportarEvento() {
    try {
      const p = await api.auditoria.exportar({ eventoId: ev.id });
      baixarArquivo(p.nomeArquivo, p.conteudo);
      avisar({ titulo: 'Evento exportado', texto: `${ev.codigo} com hashes em ${p.nomeArquivo}.` });
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  async function corrigir() {
    try {
      const valores: Partial<ValoresCorrecao> = {};
      if (vUnidade.trim()) {
        const un = catalogo.porTexto(vUnidade);
        if (!un) { setErro('Unidade inexistente. Use o formato D-32.'); return; }
        valores.unidadeDestinoId = un.id;
      }
      if (vData || vHora) {
        const t = vData && vHora ? fromInput(vData, vHora) : null;
        if (t === null) { setErro('Informe data e hora juntas para corrigir o horário.'); return; }
        valores.ocorridoEm = t;
      }
      if (vPessoa) valores.pessoaId = vPessoa.id;
      if (vAutorizador) valores.autorizadoPorPessoaId = vAutorizador.id; // autorizador é pessoa (id), não nome livre
      const novo = await api.eventos.corrigir(ev.id, { justificativa: just, observacao: obs, valores: Object.keys(valores).length ? valores : undefined });
      avisar({ texto: `Correção ${novo.codigo} registrada. O registro original permanece inalterado.` });
      void invalidar(APOS_EVENTO);
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
      <div className="font-mono text-[28px] font-semibold text-[#0B3F49]">{ev.unidadeDestinoId ? catalogo.rotulo(ev.unidadeDestinoId) : ev.areaComumNome ? `ÁREA COMUM · ${ev.areaComumNome.toUpperCase()}` : 'Condomínio'}</div>
      {(ev.empresa || ev.servico) && <div className="text-[14px] text-[#33424B]">Prestador: {[ev.empresa, ev.servico].filter(Boolean).join(' · ')}</div>}

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

      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        <div className="flex flex-col gap-0.5"><span className={rot}>Registrado por</span><span className="font-semibold">{ev.operadorNome}</span></div>
        <div className="flex flex-col gap-0.5"><span className={rot}>Autorizado por</span><span className="font-semibold">{textoAutorizacao(ev)}</span></div>
        <div className="flex flex-col gap-0.5"><span className={rot}>Meio de autorização</span><span className="font-medium">{textoMeioLongo(ev)}</span></div>
        <div className="flex flex-col gap-0.5"><span className={rot}>Saída</span>
          <span className="font-medium">{ev.saida ? `${fmtHora(ev.saida.em)} (${ev.saida.codigo})` : ev.tipo === 'entrada' && ev.dentro ? 'Ainda no condomínio' : '—'}</span>
          {/* Atalho para a tela de saída já com esta entrada escolhida (lá a saída ainda é confirmada) */}
          {podeSaida && ev.tipo === 'entrada' && ev.dentro && !ev.saida && (
            <Link to={`/saida?entrada=${ev.id}`} className="mt-1 inline-flex h-[44px] w-fit items-center rounded-lg border border-[#0B5563] bg-white px-3 text-[14px] font-semibold !text-[#0B5563] hover:bg-[#F0F8F9] lg:h-10">Registrar saída</Link>
          )}</div>
      </div>

      {ev.valoresOriginais && ev.correcao && (
        <div className="flex flex-col gap-2 rounded-lg border border-[#A9D2D8] bg-[#E3F0F2] px-[14px] py-3 text-[14px] text-[#0B4450]">
          <div className="font-semibold">Corrigido por {ev.correcao.operadorNome} ({ev.correcao.codigo}). Os valores acima já são os corrigidos; o registro original permanece inalterado.</div>
          <table className="w-full break-words text-left">
            <thead><tr className="text-[13px] text-[#56616B]"><th className="font-semibold">Campo</th><th className="font-semibold">Original</th><th className="font-semibold">Corrigido</th></tr></thead>
            <tbody>
              {linhasCorrecao(ev, catalogo.codigo).map(([campo, antes, depois]) => <tr key={campo}><td className="pr-2 align-top">{campo}</td><td className="pr-2 align-top line-through">{antes}</td><td className="align-top font-semibold">{depois}</td></tr>)}
            </tbody>
          </table>
          {ev.correcao.justificativa && <div>Justificativa: {ev.correcao.justificativa}</div>}
        </div>
      )}
      {ev.tipo === 'correcao' && ev.valoresCorrigidos && (
        <div className="rounded-lg border border-[#A9D2D8] bg-[#E3F0F2] px-[14px] py-3 text-[14px] text-[#0B4450]">
          <div className="font-semibold">Valores corrigidos por este registro</div>
          <ul className="list-disc pl-5">
            {Object.entries(ev.valoresCorrigidos).map(([k, v]) => <li key={k}>{ROTULO_CAMPO[k as keyof ValoresCorrecao]}: {k === 'pessoaId' ? ev.pessoaNomeCorrigida ?? String(v) : k === 'autorizadoPorPessoaId' ? ev.autorizadoPorNomeCorrigido ?? '—' : fmt(k as keyof ValoresCorrecao, v)}</li>)}
          </ul>
        </div>
      )}
      {ev.formularioContingencia && <div className="text-[14px]"><span className={rot}>Formulário de contingência</span><div className="font-mono">nº {ev.formularioContingencia}</div></div>}

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
            <fieldset className="flex flex-col gap-3 rounded-lg border border-dashed border-[#C5CDD3] p-3">
              <legend className="px-1 text-[13px] font-medium text-[#56616B]">Valores corretos (preencha só o que mudou)</legend>
              <Field label="Unidade de destino"><input className="input font-mono" placeholder="D-32" value={vUnidade} onChange={(e) => setVUnidade(e.target.value)} /></Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Data real"><input type="date" className="input" value={vData} onChange={(e) => setVData(e.target.value)} /></Field>
                <Field label="Hora real"><input type="time" className="input" value={vHora} onChange={(e) => setVHora(e.target.value)} /></Field>
              </div>
              <PessoaPicker rotulo="Pessoa correta" valor={vPessoa} onChange={setVPessoa} />
              {ev.autorizadoPorTipo && <PessoaPicker rotulo="Quem autorizou (pessoa correta)" valor={vAutorizador} onChange={setVAutorizador} />}
            </fieldset>
            {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
            <div className="flex flex-wrap gap-[10px]"><Button variante="primario" disabled={!justificativaValida(just)} onClick={() => void corrigir()}>Gravar correção</Button><Button onClick={() => setCorrigindo(false)}>Cancelar</Button></div>
          </div>
        ) : <Button pequeno className="self-start" onClick={() => setCorrigindo(true)}>Registrar correção…</Button>
      )}

      {podeExportar && <Button pequeno className="self-start" onClick={() => void exportarEvento()}>Exportar este evento</Button>}

      <div className="border-t border-[#E6EAED] pt-2 text-[13px] text-[#56616B]">
        Registros de acesso não podem ser editados ou excluídos. Correções são feitas por novo registro com justificativa. Sequência {ev.seq} · hash anterior <span className="break-all font-mono text-[12px]">{ev.hashAnterior}</span>
      </div>
    </Gaveta>
  );
}

const ROTULO_CAMPO: Record<keyof ValoresCorrecao, string> = {
  unidadeDestinoId: 'Unidade', ocorridoEm: 'Data e hora', pessoaId: 'Pessoa', autorizadoPorPessoaId: 'Autorizado por',
};
function formatarValor(campo: keyof ValoresCorrecao, v: unknown, codigo: (id: string) => string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (campo === 'ocorridoEm') return fmtDataHora(Number(v));
  if (campo === 'unidadeDestinoId') return codigo(String(v));
  return String(v);
}
/** [campo, original, corrigido] para os campos que a última correção substituiu. Nomes vêm resolvidos pela view. */
function linhasCorrecao(ev: EventoView, codigo: (id: string) => string): [string, string, string][] {
  const orig = ev.valoresOriginais ?? {};
  return (Object.keys(orig) as (keyof ValoresCorrecao)[]).map((k) => [
    ROTULO_CAMPO[k],
    k === 'pessoaId' ? ev.pessoaNomeOriginal ?? String(orig[k]) : k === 'autorizadoPorPessoaId' ? ev.autorizadoPorNomeOriginal ?? '—' : formatarValor(k, orig[k], codigo),
    k === 'pessoaId' ? ev.pessoaNome : k === 'autorizadoPorPessoaId' ? ev.autorizadoPorNome ?? '—' : formatarValor(k, ev[k], codigo),
  ]);
}
