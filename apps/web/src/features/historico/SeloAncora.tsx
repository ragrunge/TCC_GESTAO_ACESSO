import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stamp } from 'lucide-react';
import { useApi, type ConferenciaAncora, type EstadoSelos } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { fmtData, fmtDataHora } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { CHAVES, useInvalidar } from '../../app/consultas';

const HASH = /^[0-9a-f]{64}$/;

function statusAncora(e: EstadoSelos): { tom: 'verde' | 'ambar' | 'vermelho'; texto: string } {
  const s = e.ultimo;
  if (s?.enviadoEm) return { tom: 'verde', texto: `Âncora enviada para ${s.enviadoPara ?? 'destino externo'} em ${fmtDataHora(s.enviadoEm)}` };
  if (e.destinos.length === 0) return { tom: 'vermelho', texto: 'Sem destino configurado para a âncora externa' };
  return { tom: 'ambar', texto: 'Envio da âncora pendente (o agendador tenta de novo)' };
}

const MOTIVO: Record<ConferenciaAncora['motivo'], string> = {
  confere: 'O hash recebido é o mesmo do banco nesse seq.',
  hash_divergente: 'O hash do banco nesse seq é OUTRO: a trilha foi reescrita depois do envio da âncora. Preserve o e-mail e acione o síndico e o conselho.',
  seq_descartado: 'O evento desse seq já saiu pela retenção; a comparação foi feita com o selo guardado no banco.',
  seq_inexistente: 'Esse seq ainda não existe na cadeia (confira o número colado).',
};

/**
 * Selo diário e âncora externa (spec 4.6). Sem âncora fora do banco, quem tem superusuário recalcula a cadeia inteira e a
 * verificação interna não percebe; o hash enviado por e-mail ao síndico e ao conselho é o que denuncia a reescrita.
 */
export function SeloAncora() {
  const api = useApi();
  const { avisar } = useToast();
  const invalidar = useInvalidar();
  const podeSelar = useCan('auditoria.selar');
  const estado = useQuery({ queryKey: CHAVES.selos, queryFn: () => api.auditoria.selos(), staleTime: 30_000 });
  const [selando, setSelando] = useState(false);
  const [seq, setSeq] = useState('');
  const [hash, setHash] = useState('');
  const [conferindo, setConferindo] = useState(false);
  const [conf, setConf] = useState<ConferenciaAncora | null>(null);
  const [erroConf, setErroConf] = useState('');

  async function selar() {
    setSelando(true);
    try {
      const r = await api.auditoria.selar();
      const envio = r.ancora === 'enviada' ? 'âncora enviada' : r.ancora === 'pendente' ? 'envio da âncora pendente' : 'sem destino para a âncora';
      avisar({
        tom: r.ancora === 'enviada' ? 'verde' : 'ambar',
        titulo: r.novo ? 'Cadeia selada' : 'Nada novo para selar',
        texto: `${r.novo ? 'Selo' : 'Último selo'} no seq ${r.selo.ultimoSeq}; ${envio}.`,
      });
      void invalidar([CHAVES.selos, CHAVES.integridade]);
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); } finally { setSelando(false); }
  }

  const hashLimpo = hash.trim().toLowerCase();
  const seqNum = /^\d+$/.test(seq.trim()) ? Number(seq.trim()) : NaN;
  async function conferir(e: FormEvent) {
    e.preventDefault();
    setErroConf(''); setConf(null);
    if (!Number.isInteger(seqNum) || !HASH.test(hashLimpo)) { setErroConf('Informe o seq (número) e o hash de 64 caracteres hexadecimais, como vieram no e-mail.'); return; }
    setConferindo(true);
    try { setConf(await api.auditoria.conferirAncora({ seq: seqNum, hash: hashLimpo })); } catch (x) { setErroConf(mensagemErro(x)); } finally { setConferindo(false); }
  }

  const e = estado.data;
  const st = e ? statusAncora(e) : null;
  return (
    <section aria-label="Selo e âncora externa" className="flex flex-col gap-3 rounded-[10px] border border-[#DCE1E5] bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold"><Stamp className="h-5 w-5" aria-hidden />Selo e âncora externa</h2>
        {podeSelar && <Button variante="contorno" carregando={selando} onClick={() => void selar()}>Selar agora</Button>}
      </div>
      {estado.error && <Alert tom="vermelho" role="alert">{mensagemErro(estado.error)}</Alert>}
      {estado.isPending && <p className="text-[14px] text-[#56616B]">Carregando o último selo…</p>}
      {e && (
        <div className="flex flex-col gap-2 text-[14px]" role="status" aria-label="Último selo">
          {e.ultimo ? (
            <p>
              Último selo: <strong>{fmtData(e.ultimo.data)}</strong> ({e.ultimo.tipo === 'diario' ? 'diário' : 'manual'}), seq <strong>{e.ultimo.ultimoSeq}</strong>,
              hash <span className="font-mono text-[13px]" title={e.ultimo.ultimoHash}>{e.ultimo.ultimoHash.slice(0, 16)}…</span>
            </p>
          ) : <p>A cadeia ainda não foi selada.</p>}
          <p className="flex flex-wrap items-center gap-2">
            {st && <Badge tom={st.tom}>{st.texto}</Badge>}
            {e.pendentesEnvio > 0 && <span className="text-[#7A2E0E]">{e.pendentesEnvio} selo(s) com envio pendente.</span>}
            {!e.agendador && <span className="text-[#56616B]">Agendador diário desligado nesta API.</span>}
          </p>
        </div>
      )}
      <details className="text-[14px]">
        <summary className="cursor-pointer font-medium">Conferir âncora recebida</summary>
        <form className="mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-[140px_minmax(0,1fr)_auto]" onSubmit={(x) => void conferir(x)} aria-label="Conferir âncora recebida">
          <Field label="Seq"><input className="input font-mono" inputMode="numeric" value={seq} onChange={(x) => setSeq(x.target.value)} /></Field>
          <Field label="Hash recebido"><input className="input font-mono text-[13px]" value={hash} onChange={(x) => setHash(x.target.value)} spellCheck={false} /></Field>
          <Button type="submit" carregando={conferindo}>Conferir</Button>
        </form>
        {erroConf && <Alert className="mt-3" tom="vermelho" role="alert">{erroConf}</Alert>}
        {conf && (
          <Alert className="mt-3" tom={conf.confere ? 'verde' : 'vermelho'} role="status" titulo={conf.confere ? 'Âncora confere' : 'Âncora NÃO confere'}>
            {MOTIVO[conf.motivo]}
          </Alert>
        )}
        <p className="mt-2 text-[13px] text-[#56616B]">
          Esta conferência é feita pelo próprio servidor, que pode ter sido adulterado. A conferência definitiva é a offline: exporte a trilha
          (arquivo verificável), rode o verificar.js e compare o hash do seq selado com o do e-mail.
        </p>
      </details>
    </section>
  );
}
