import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi, type ResultadoRetencao } from '../../api';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useToast } from '../../components/Toast';
import { fmtDataHora } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { APOS_LGPD, CHAVES, useInvalidar } from '../../app/consultas';

/** Contagens do resultado, só as presentes (pessoas, eventos, trilha e arquivos). */
function linhasDoResultado(r: ResultadoRetencao): [string, string][] {
  const l: [string, string][] = [
    ['Visitantes e prestadores anonimizados', String(r.visitantesPrestadores)],
    ['Ex-moradores anonimizados', String(r.moradores)],
    ['Registros da trilha redigidos', String(r.registrosRedigidos)],
  ];
  if (r.eventosDescartados !== undefined) l.push(['Eventos de acesso descartados (prefixo selado)', String(r.eventosDescartados)]);
  if (r.eventosVencidosSemSelo) l.push(['Eventos vencidos retidos por falta de selo no ponto de corte', String(r.eventosVencidosSemSelo)]);
  if (r.trilhaDescartada !== undefined) l.push(['Registros da trilha de alterações descartados (mais de 3 anos)', String(r.trilhaDescartada)]);
  if (r.fotosEliminadas !== undefined) l.push(['Fotos eliminadas', String(r.fotosEliminadas)]);
  if (r.prazoAnexosDefinido !== undefined) {
    l.push(['Anexos de ocorrência eliminados', r.prazoAnexosDefinido ? String(r.anexosEliminados ?? 0) : 'prazo não definido (decisão em aberto)']);
  }
  if (r.arquivosOrfaosRemovidos !== undefined) l.push(['Arquivos órfãos removidos do armazenamento', String(r.arquivosOrfaosRemovidos)]);
  if (r.registrosSemArquivo) l.push(['Registros de documento sem arquivo (ver log)', String(r.registrosSemArquivo)]);
  if (r.veiculosEliminados !== undefined) l.push(['Veículos desativados há mais de 3 anos apagados', String(r.veiculosEliminados)]);
  if (r.operadoresAnonimizados !== undefined) l.push(['Operadores desativados há mais de 3 anos anonimizados', String(r.operadoresAnonimizados)]);
  if (r.sessoesLimpas !== undefined) l.push(['Sessões com IP e navegador apagados (mais de 90 dias)', String(r.sessoesLimpas)]);
  if (r.anonimizacoesReaplicadas) l.push(['Anonimizações refeitas depois de restore', String(r.anonimizacoesReaplicadas)]);
  if (r.reaplicadasComVinculoValido?.length) l.push(['Refeitas com vínculo ainda válido (conferir)', String(r.reaplicadasComVinculoValido.length)]);
  if (r.registroExterno === 'falhou') l.push(['Registro das anonimizações fora do banco', 'falhou (tenta de novo amanhã)']);
  return l;
}

function Contagens({ r }: { r: ResultadoRetencao }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 text-[14px]">
      {linhasDoResultado(r).map(([k, v]) => (
        <div key={k} className="contents"><dt className="text-[#33424B]">{k}</dt><dd className="text-right font-mono font-semibold">{v}</dd></div>
      ))}
    </dl>
  );
}

/**
 * Retenção (LGPD, RNF-09, spec 9.1): última execução e execução sob demanda (síndico). O agendador da API roda a mesma
 * rotina uma vez por dia; rodar de novo é seguro (idempotente).
 */
export function RetencaoLgpd() {
  const api = useApi();
  const { avisar } = useToast();
  const invalidar = useInvalidar();
  const ultima = useQuery({ queryKey: CHAVES.retencao, queryFn: () => api.lgpd.ultimaRetencao() });
  const [confirmando, setConfirmando] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState('');

  async function aplicar() {
    setRodando(true); setErro('');
    try {
      const r = await api.lgpd.aplicarRetencao();
      setConfirmando(false);
      avisar({ tom: 'ambar', titulo: 'Retenção aplicada (RNF-09)', texto: `${r.visitantesPrestadores} visitante(s)/prestador(es) e ${r.moradores} ex-morador(es) anonimizados.` });
      void invalidar(APOS_LGPD);
    } catch (e) { setErro(mensagemErro(e)); } finally { setRodando(false); }
  }

  return (
    <Card titulo="Retenção (LGPD)" aria-label="Retenção (LGPD)"
      acoes={!confirmando && <Button onClick={() => { setConfirmando(true); setErro(''); }}>Aplicar retenção agora</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-[14px] text-[#33424B]">
          O agendador da API aplica a retenção uma vez por dia: anonimiza quem passou de 3 anos sem acesso ou sem vínculo, descarta
          eventos e registros da trilha com mais de 3 anos, apaga veículos e anonimiza operadores desativados há mais de 3 anos,
          apaga IP e navegador de sessões com mais de 90 dias e elimina arquivos vencidos. Eventos só saem até um selo da cadeia no ponto
          de corte. Rodar de novo é seguro.
        </p>
        {confirmando && (
          <div className="flex flex-col gap-3 rounded-[10px] border-2 border-[#B54708] bg-[#FFFAEB] p-4 text-[#7A2E0E]">
            <p className="font-semibold">Aplicar a retenção agora? A anonimização e os descartes não podem ser desfeitos.</p>
            {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
            <div className="flex flex-wrap gap-[10px]">
              <Button variante="perigo" carregando={rodando} onClick={() => void aplicar()}>Confirmar retenção</Button>
              <Button onClick={() => setConfirmando(false)}>Cancelar</Button>
            </div>
          </div>
        )}
        {ultima.error && <Alert tom="vermelho" role="alert">{mensagemErro(ultima.error)}</Alert>}
        {ultima.isPending && <p className="text-[14px] text-[#56616B]">Carregando a última execução…</p>}
        {ultima.data === null && <p className="text-[14px] text-[#56616B]" role="status">A retenção ainda não foi executada.</p>}
        {ultima.data && (
          <section aria-label="Última execução" className="flex flex-col gap-2">
            <p className="text-[14px] font-medium" role="status">Última execução: {fmtDataHora(ultima.data.em)}, por {ultima.data.porNome}.</p>
            <Contagens r={ultima.data.resultado} />
          </section>
        )}
      </div>
    </Card>
  );
}
