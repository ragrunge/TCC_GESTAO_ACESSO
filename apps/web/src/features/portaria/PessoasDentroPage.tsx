import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, ROTULO_TIPO_VISITA, type EventoView, type PermanenciaView } from '@portaria/domain/types';
import { proximaProrrogacao } from '@portaria/domain/rules';
import { agora as agoraSim, fmtHora } from '@portaria/domain/time';
import { mensagemErro, useAgora } from '../../app/useAsync';
import { CHAVES, useInvalidar } from '../../app/consultas';
import { chipDoEvento, textoAutorizacao } from '../common/evento';
import { CelPermanencia, destaquePresente, usePresentes } from './presentes';
import { ConfirmarSaidaModal, SaidaRetroativaModal } from './saida';

const COLUNAS = 'minmax(0,1.4fr) 110px 80px 80px 190px minmax(0,1.3fr) 340px';
const BOTAO_LINHA = 'h-[44px] rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium hover:border-[#0B5563] hover:text-[#0B5563] lg:h-10';
const TECLA_CLS = 'rounded-[5px] border px-[7px] py-0.5 font-mono text-[13px]';

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
          <Link to="/saida" className="inline-flex h-11 items-center gap-[10px] rounded-lg border border-[#0B5563] bg-white max-lg:h-[44px] px-[18px] font-semibold !text-[#0B5563] hover:bg-[#E3F0F2]">Registrar saída <kbd className={`${TECLA_CLS} border-[#0B5563]/50`}>F8</kbd></Link>
          <Link to="/entrada" className="inline-flex h-11 items-center gap-[10px] rounded-lg bg-[#0B5563] max-lg:h-[44px] px-[18px] font-semibold !text-white hover:bg-[#08434E]">Nova entrada <kbd className={`${TECLA_CLS} border-white/50`}>F2</kbd></Link>
        </>} />
      {lista.error && <Alert tom="vermelho" role="alert">{mensagemErro(lista.error)}</Alert>}
      <Lista legenda="Pessoas atualmente no condomínio" colunas={COLUNAS} empilhar>
        <ListaCab rotulos={['Nome', 'Tipo', 'Unidade', 'Entrada', 'Permanência', 'Autorizado por', '']} />
        {dados.map((e) => {
          const pz = e.permanencia ?? null;
          const podeMais = !!pz && proximaProrrogacao({ entradaEm: e.ocorridoEm, ...pz }, agora).ok;
          return (
            <ListaLinha key={e.id} destaque={destaquePresente(e, agora)} minH={56} padY={8}>
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
                  className={`${BOTAO_LINHA} disabled:cursor-not-allowed disabled:bg-[#EEF2F4] disabled:text-[#6B7780]`}>+1h</button>
              )}{podeRegistrar && (
                <button type="button" onClick={() => setSaindo(e)} className={BOTAO_LINHA}>Registrar saída</button>
              )}{podeRetroativo && (
                <button type="button" onClick={() => setRetro(e)} className={BOTAO_LINHA}>Saída retroativa</button>
              )}</Cel>
            </ListaLinha>
          );
        })}
        {!lista.isPending && dados.length === 0 && <Vazio>Ninguém no condomínio no momento.</Vazio>}
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
