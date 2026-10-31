import { useState } from 'react';
import { useApi } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { BotaoLink, Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, ROTULO_TIPO_VISITA, type EventoView, type PermanenciaView } from '@portaria/domain/types';
import { proximaProrrogacao } from '@portaria/domain/rules';
import { agora as agoraSim, fmtHora } from '@portaria/domain/time';
import { mensagemErro, useAgora } from '../../app/useAsync';
import { CHAVES, useInvalidar } from '../../app/consultas';
import { chipDoEvento, descreverVeiculo, textoAutorizacao } from '../common/evento';
import { CelPermanencia, destaquePresente, usePresentes } from './presentes';
import { ConfirmarSaidaModal, SaidaRetroativaModal } from './saida';
import { ErroCarregar } from '../../components/Carregando';

const COLUNAS = 'minmax(0,1.4fr) 110px 80px 80px 190px minmax(0,1.3fr) 340px';
const BOTAO_LINHA = 'h-[44px] rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium hover:border-[#0B5563] hover:text-[#0B5563] lg:h-10';

export function PessoasDentroPage() {
  const { avisar } = useToast();
  const agora = useAgora(15000);
  const podeRegistrar = useCan('evento.registrar');
  const podeRetroativo = useCan('evento.retroativo');
  const [saindo, setSaindo] = useState<EventoView | null>(null);
  const [retro, setRetro] = useState<EventoView | null>(null);
  const [prorrogando, setProrrogando] = useState<EventoView | null>(null);
  const invalidar = useInvalidar();
  const lista = usePresentes();

  const dados = lista.data ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Presentes agora"
        descricao={`${dados.length} ${dados.length === 1 ? 'pessoa entrou' : 'pessoas entraram'} e ainda não ${dados.length === 1 ? 'teve' : 'tiveram'} a saída registrada.`}
        acoes={podeRegistrar && <>
          <BotaoLink to="/saida" variante="contorno" atalho="F8">Registrar saída</BotaoLink>
          <BotaoLink to="/entrada" variante="primario" atalho="F2">Nova entrada</BotaoLink>
        </>} />
      {lista.error && <ErroCarregar mensagem={mensagemErro(lista.error)} onTentar={() => lista.refetch()} />}
      <Lista legenda="Pessoas atualmente no condomínio" colunas={COLUNAS} empilhar carregando={lista.isLoading}>
        <ListaCab rotulos={['Nome', 'Tipo', 'Unidade', 'Entrada', 'Permanência', 'Autorizado por', '']} />
        {dados.map((e) => {
          const pz = e.permanencia ?? null;
          const podeMais = !!pz && proximaProrrogacao({ entradaEm: e.ocorridoEm, ...pz }, agora).ok;
          return (
            <ListaLinha key={e.id} destaque={destaquePresente(e, agora)} minH={56} padY={8}>
              <Cel className="min-w-0">
                <span className="block truncate font-medium">{e.pessoaNome}</span>
                {e.veiculo && <span className="block truncate font-mono text-[13px] text-[#56616B]"><span className="sr-only">Veículo </span>{descreverVeiculo(e.veiculo)}</span>}
              </Cel>
              <Cel className="text-[14px]">{ROTULO_CATEGORIA[e.categoriaPessoa]}</Cel>
              <CelUnidade id={e.unidadeDestinoId} texto={e.unidadeRotulo} />
              <Cel className="font-mono">{fmtHora(e.ocorridoEm)}</Cel>
              <Cel><CelPermanencia entradaEm={e.ocorridoEm} permanencia={pz} agora={agora} /></Cel>
              <Cel className="text-[14px]">{textoAutorizacao(e)}<span className="text-[#56616B]"> · {chipDoEvento(e).texto}</span></Cel>
              <Cel className="col-span-2 flex flex-wrap gap-2 md:col-span-1">{podeRegistrar && pz && (
                <button type="button" onClick={() => setProrrogando(e)} disabled={!podeMais}
                  aria-label={`Prorrogar a permanência de ${e.pessoaNome} em 1 hora`}
                  title={podeMais ? undefined : 'Limite de prorrogações ou de 12 h desde a entrada'}
                  className={`${BOTAO_LINHA} disabled:cursor-not-allowed disabled:bg-[#EEF2F4] disabled:text-[#6B7780]`}>+1h</button>
              )}{podeRegistrar && (
                <button type="button" onClick={() => setSaindo(e)} className={BOTAO_LINHA}>Registrar saída</button>
              )}{podeRetroativo && (
                <button type="button" onClick={() => setRetro(e)} className={BOTAO_LINHA}>Saída retroativa</button>
              )}</Cel>
            </ListaLinha>
          );
        })}
        {!lista.isPending && !lista.error && dados.length === 0 && <Vazio>Ninguém no condomínio no momento.</Vazio>}
      </Lista>
      {prorrogando?.permanencia && <ProrrogarModal entrada={prorrogando} permanencia={prorrogando.permanencia} onClose={() => setProrrogando(null)}
        onFeito={(p) => { avisar({ texto: `Permanência de ${prorrogando.pessoaNome} prorrogada até ${fmtHora(p.prazoAte)} (${p.prorrogacoes}ª prorrogação).` }); setProrrogando(null); void invalidar([CHAVES.presentes]); }}
        onErro={() => void invalidar([CHAVES.presentes])} />}
      {saindo && <ConfirmarSaidaModal entrada={saindo} agora={agora} onClose={() => setSaindo(null)} onFeito={() => setSaindo(null)} />}
      {retro && <SaidaRetroativaModal entrada={retro} onClose={() => setRetro(null)} onFeito={() => setRetro(null)} />}
    </div>
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
    <Modal titulo={`Prorrogar permanência · ${entrada.pessoaNome}`} tamanho="p" onClose={onClose}
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
