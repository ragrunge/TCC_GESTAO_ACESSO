import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useApi, type ResultadoRetencao } from '../../api';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useToast } from '../../components/Toast';
import { fmtDataHora } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { APOS_LGPD, CHAVES, useInvalidar } from '../../app/consultas';
import { CarregandoLinha, ErroCarregar } from '../../components/Carregando';

/**
 * Itens do resultado em linguagem do síndico. `alerta`: pede atenção (fica sempre à mostra, mesmo zerado não sai).
 * Só entram os campos que a API mandou.
 */
function linhasDoResultado(r: ResultadoRetencao): { rotulo: string; valor: number | string; alerta?: boolean }[] {
  const l: { rotulo: string; valor: number | string; alerta?: boolean }[] = [
    { rotulo: 'Visitantes e prestadores anonimizados (3 anos sem acesso)', valor: r.visitantesPrestadores },
    { rotulo: 'Ex-moradores anonimizados (3 anos sem vínculo)', valor: r.moradores },
    { rotulo: 'Nomes retirados de registros antigos da trilha', valor: r.registrosRedigidos },
  ];
  if (r.eventosDescartados !== undefined) l.push({ rotulo: 'Entradas e saídas com mais de 3 anos apagadas', valor: r.eventosDescartados });
  if (r.eventosVencidosSemSelo) l.push({ rotulo: 'Entradas e saídas vencidas mantidas até o próximo selo diário', valor: r.eventosVencidosSemSelo, alerta: true });
  if (r.trilhaDescartada !== undefined) l.push({ rotulo: 'Registros da trilha de alterações com mais de 3 anos apagados', valor: r.trilhaDescartada });
  if (r.fotosEliminadas !== undefined) l.push({ rotulo: 'Fotos apagadas', valor: r.fotosEliminadas });
  if (r.prazoAnexosDefinido !== undefined) {
    // Prazo dos anexos ainda não decidido pelo condomínio (spec §14): nada é apagado, e a tela diz isso sem jargão
    l.push(r.prazoAnexosDefinido
      ? { rotulo: 'Anexos de ocorrência apagados', valor: r.anexosEliminados ?? 0 }
      : { rotulo: 'Anexos de ocorrência', valor: 'mantidos até o condomínio definir o prazo' });
  }
  if (r.arquivosOrfaosRemovidos !== undefined) l.push({ rotulo: 'Arquivos sem registro correspondente removidos', valor: r.arquivosOrfaosRemovidos });
  if (r.registrosSemArquivo) l.push({ rotulo: 'Documentos cujo arquivo não foi encontrado (avise o suporte)', valor: r.registrosSemArquivo, alerta: true });
  if (r.veiculosEliminados !== undefined) l.push({ rotulo: 'Veículos desativados há mais de 3 anos apagados', valor: r.veiculosEliminados });
  if (r.operadoresAnonimizados !== undefined) l.push({ rotulo: 'Usuários desativados há mais de 3 anos anonimizados', valor: r.operadoresAnonimizados });
  if (r.sessoesLimpas !== undefined) l.push({ rotulo: 'IP e navegador de logins com mais de 90 dias apagados', valor: r.sessoesLimpas });
  if (r.anonimizacoesReaplicadas) l.push({ rotulo: 'Anonimizações refeitas depois de restaurar um backup', valor: r.anonimizacoesReaplicadas, alerta: true });
  if (r.reaplicadasComVinculoValido?.length) l.push({ rotulo: 'Refeitas com vínculo ainda válido (conferir)', valor: r.reaplicadasComVinculoValido.length, alerta: true });
  if (r.registroExterno === 'falhou') l.push({ rotulo: 'Registro das anonimizações fora do banco', valor: 'falhou (tenta de novo amanhã)', alerta: true });
  return l;
}

/** O que mudou (ou pede atenção) fica à mostra; os itens zerados ficam numa lista recolhida. */
function Contagens({ r }: { r: ResultadoRetencao }) {
  const todas = linhasDoResultado(r);
  const vistas = todas.filter((x) => x.alerta || typeof x.valor === 'string' || x.valor > 0);
  const zeradas = todas.filter((x) => !vistas.includes(x));
  const lista = (itens: typeof todas) => (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 text-[14px]">
      {itens.map((x) => (
        <div key={x.rotulo} className="contents">
          <dt className={x.alerta ? 'font-medium text-[#7A2E0E]' : 'text-[#33424B]'}>{x.rotulo}</dt>
          <dd className={`text-right ${typeof x.valor === 'number' ? 'font-mono font-semibold' : 'text-[#56616B]'}`}>{x.valor}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className="flex flex-col gap-2">
      {!vistas.some((x) => x.alerta || typeof x.valor === 'number') && <p className="text-[14px] text-[#33424B]">Nada passou do prazo nesta execução.</p>}
      {vistas.length > 0 && lista(vistas)}
      {zeradas.length > 0 && (
        <details className="group text-[14px]">
          <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 font-semibold text-[#0B5563] hover:underline md:min-h-0 [&::-webkit-details-marker]:hidden">
            {zeradas.length === 1 ? 'Ver 1 item sem alteração' : `Ver os ${zeradas.length} itens sem alteração`}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-2">{lista(zeradas)}</div>
        </details>
      )}
    </div>
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
        <p className="max-w-[860px] text-[14px] text-[#33424B]">
          Todo dia, de madrugada, o sistema apaga ou anonimiza o que passou do prazo de guarda: pessoas sem acesso ou sem vínculo
          há mais de 3 anos, entradas, saídas e registros da trilha com mais de 3 anos, e dados técnicos de login com mais de 90 dias.
          A verificação de integridade da trilha continua valendo. O botão só antecipa a rotina do dia; rodar de novo não repete nada.
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
        {ultima.error && <ErroCarregar mensagem={mensagemErro(ultima.error)} onTentar={() => ultima.refetch()} />}
        {ultima.isLoading && <CarregandoLinha>Lendo a última execução…</CarregandoLinha>}
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
