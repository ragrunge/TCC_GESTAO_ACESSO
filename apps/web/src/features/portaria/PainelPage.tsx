import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../../api';
import { useAuth, useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, ROTULO_PAPEL, type EventoView } from '@portaria/domain/types';
import { descreverJanela } from '@portaria/domain/rules';
import { fmtHora, partes } from '@portaria/domain/time';
import { mensagemErro, useAgora } from '../../app/useAsync';
import { CHAVES, useInvalidar } from '../../app/consultas';
import { AutorizacaoEvento, destaqueEvento, quandoCurto } from '../common/evento';
import { EventoGaveta } from '../historico/EventoGaveta';

const COLUNAS = '90px minmax(0,1.5fr) 80px 110px minmax(0,1.8fr) minmax(0,1fr)';
const TECLA = 'rounded-md border px-[10px] py-[6px] font-mono text-[16px] font-semibold';

export function PainelPage() {
  const api = useApi();
  const nav = useNavigate();
  const { usuario, sair } = useAuth();
  const { avisar } = useToast();
  const agora = useAgora(30000);
  const podeRegistrar = useCan('evento.registrar');
  const podeRetro = useCan('evento.retroativo');
  const podeAprovar = useCan('restricao.aprovar');
  const [turno, setTurno] = useState(false);
  const [previasAbertas, setPreviasAbertas] = useState(false);
  const [evento, setEvento] = useState<EventoView | null>(null);

  const invalidar = useInvalidar();
  const suporta = (op: string) => api.suporta?.(op) ?? true;
  // React Query: registrar entrada, saída ou correção em outra tela invalida estas chaves (APOS_EVENTO)
  const resumo = useQuery({ queryKey: CHAVES.turno, queryFn: () => api.turno.resumo(), staleTime: 0 });
  const eventos = useQuery({
    queryKey: CHAVES.eventosUltimos, staleTime: 0,
    queryFn: async () => (await api.eventos.listarPagina({ limite: 10, excluirTipos: ['saida'] })).itens,
  });
  const previas = useQuery({ queryKey: CHAVES.autorizacoesHoje, queryFn: () => api.autorizacoes.hoje(), staleTime: 0 });
  // Atrasadas pela contagem da API (sem carregar a fila); sem o módulo, nada de 501 em loop: o cartão mostra só o total do turno
  const encs = useQuery({ queryKey: CHAVES.encomendasResumo, queryFn: () => api.encomendas.resumo(), enabled: suporta('encomendas.resumo'), staleTime: 0 });
  const pendentes = useQuery({ queryKey: CHAVES.restricoesPendentes, queryFn: () => api.restricoes.pendentes(), staleTime: 0 });

  async function aprovar(id: string) {
    try {
      await api.restricoes.aprovar(id);
      avisar({ texto: 'Restrição para todo o condomínio aprovada.' });
      void invalidar([CHAVES.restricoes, CHAVES.turno, CHAVES.unidades]);
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  const r = resumo.data;
  const hh = partes(agora).hh;
  const turnoTxt = hh >= 6 && hh < 18 ? 'Turno diurno · 06:00 às 18:00' : 'Turno noturno · 18:00 às 06:00';
  const cartoes = [
    { rotulo: 'Pessoas no condomínio', valor: r?.pessoasDentro, sub: 'Ver lista →', para: '/pessoas' },
    { rotulo: 'Encomendas aguardando', valor: r?.encomendasPendentes, sub: (() => { const n = encs.data?.atrasadas ?? 0; return n > 0 ? `${n} há mais de ${encs.data!.diasAtraso} dias →` : 'Ver encomendas →'; })(), para: '/encomendas' },
    { rotulo: 'Ocorrências abertas', valor: r?.ocorrenciasAbertas, sub: 'Ver ocorrências →', para: '/ocorrencias' },
  ];
  const cartaoCls = 'flex flex-col gap-1.5 rounded-[10px] border border-[#DCE1E5] bg-white px-5 py-[18px] text-left text-ink hover:border-[#0B5563]';
  const acaoCls = 'flex h-[112px] items-center justify-between rounded-xl px-7 text-left';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader titulo="Painel da portaria"
        descricao={`${turnoTxt} · ${ROTULO_PAPEL[usuario!.papel]} ${usuario!.nome}`}
        acoes={<>
          {podeRetro && <Button pequeno onClick={() => nav('/entrada?retroativo=1')} title="Para acessos anotados no papel durante uma queda do sistema">Lançar registro retroativo</Button>}
          {podeRegistrar && <Button className="font-semibold" onClick={() => setTurno(true)}>Passar turno</Button>}
        </>} />

      {podeRegistrar && (
        <div className="grid grid-cols-3 gap-4">
          <Link to="/entrada" className={`${acaoCls} bg-[#0B5563] !text-white hover:bg-[#08434E]`}>
            <span className="flex flex-col gap-1"><span className="text-[22px] font-semibold">Nova entrada</span><span className="text-[14px] text-[#CFE6EA]">Visitante, prestador ou funcionário</span></span>
            <kbd className={`${TECLA} border-white/45`}>F2</kbd>
          </Link>
          <Link to="/encomendas?novo=1" className={`${acaoCls} border border-[#C5CDD3] bg-white !text-ink hover:border-[#0B5563]`}>
            <span className="flex flex-col gap-1"><span className="text-[22px] font-semibold">Encomenda</span><span className="text-[14px] text-[#56616B]">Receber ou entregar</span></span>
            <kbd className={`${TECLA} border-[#B9C3CA]`}>F3</kbd>
          </Link>
          <Link to="/ocorrencias?novo=1" className={`${acaoCls} border border-[#C5CDD3] bg-white !text-ink hover:border-[#0B5563]`}>
            <span className="flex flex-col gap-1"><span className="text-[22px] font-semibold">Ocorrência</span><span className="text-[14px] text-[#56616B]">Registrar fato do turno</span></span>
            <kbd className={`${TECLA} border-[#B9C3CA]`}>F4</kbd>
          </Link>
        </div>
      )}

      {podeAprovar && (pendentes.data?.length ?? 0) > 0 && (
        <div role="region" aria-label="Pendências do síndico" className="flex flex-col gap-2 rounded-lg border border-[#FEC84B] bg-[#FEF0C7] px-4 py-3 text-[#7A2E0E]">
          <div className="font-semibold">Restrições para todo o condomínio aguardando sua aprovação</div>
          {pendentes.data!.map((p) => (
            <div key={p.id} className="flex items-center gap-3 text-[14px]">
              <span className="flex-1"><strong>{p.pessoaNome}</strong> · {p.motivo} <span className="text-[13px]">— pedido por {p.solicitadaPorNome}, cadastrada por {p.cadastradaPorNome}</span></span>
              <Button pequeno variante="primario" onClick={() => aprovar(p.id)}>Aprovar</Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {cartoes.map((c) => (
          <Link key={c.rotulo} to={c.para} className={cartaoCls}>
            <span className="text-[14px] text-[#56616B]">{c.rotulo}</span>
            <span className="font-mono text-[34px] font-semibold leading-[1.1]">{c.valor ?? '…'}</span>
            <span className="text-[13px] font-medium text-[#0B5563]">{c.sub}</span>
          </Link>
        ))}
        <button type="button" className={cartaoCls} onClick={() => setPreviasAbertas(true)}>
          <span className="text-[14px] text-[#56616B]">Autorizações prévias hoje</span>
          <span className="font-mono text-[34px] font-semibold leading-[1.1]">{r?.autorizacoesHoje ?? '…'}</span>
          <span className="text-[13px] font-medium text-[#0B5563]">{(() => { const n = (previas.data ?? []).filter((a) => !a.utilizadaEm).length; return n > 0 ? `${n} ainda não utilizadas →` : 'Ver autorizações →'; })()}</span>
        </button>
      </div>

      <section className="rounded-[10px] border border-[#DCE1E5] bg-white">
        <div className="flex items-center justify-between border-b border-[#E6EAED] px-5 py-4">
          <h2 className="text-[17px] font-semibold">Últimas movimentações</h2>
          <span className="text-[13px] text-[#56616B]">Clique em uma linha para ver o registro completo</span>
        </div>
        {eventos.error && <div className="p-4"><Alert tom="vermelho">{mensagemErro(eventos.error)}</Alert></div>}
        <Lista legenda="Últimas movimentações de acesso" colunas={COLUNAS} className="!rounded-none !border-0">
          <ListaCab padY={10} rotulos={['Hora', 'Nome', 'Unidade', 'Tipo', 'Autorização', 'Registrado por']} />
          {(eventos.data ?? []).map((e) => (
            <ListaLinha key={e.id} destaque={destaqueEvento(e)} onClick={() => setEvento(e)}>
              <Cel className="font-mono text-[14px]">{quandoCurto(e.ocorridoEm, agora)}</Cel>
              <Cel className="truncate font-medium">{e.pessoaNome}</Cel>
              <CelUnidade id={e.unidadeDestinoId} texto={e.unidadeRotulo} />
              <Cel className="text-[14px] text-[#33424B]">{ROTULO_CATEGORIA[e.categoriaPessoa]}</Cel>
              <Cel><AutorizacaoEvento ev={e} /></Cel>
              <Cel className="text-[14px] text-[#33424B]">{e.operadorNome}</Cel>
            </ListaLinha>
          ))}
        </Lista>
        {eventos.data?.length === 0 && <Vazio>Nenhuma movimentação registrada.</Vazio>}
      </section>

      {evento && <EventoGaveta ev={evento} onClose={() => setEvento(null)} />}

      {previasAbertas && (
        <Modal titulo="Autorizações prévias de hoje" largura={640} gap={14} onClose={() => setPreviasAbertas(false)}
          rodape={<Button className="ml-auto" data-autofocus onClick={() => setPreviasAbertas(false)}>Fechar</Button>}>
          <div className="flex flex-col">
            {(previas.data ?? []).map((a) => (
              <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_80px_150px_100px] items-center gap-3 border-b border-[#EEF1F3] py-[10px]">
                <span className="flex flex-col"><span className="font-medium">{a.pessoaNome}</span><span className="text-[13px] text-[#56616B]">Autorizado por {a.solicitadaPorNome}</span></span>
                <span className="font-mono font-semibold">{a.unidadeRotulo}</span>
                <span className="text-[14px]">{descreverJanela(a)}</span>
                <span className={`text-[13px] font-semibold ${a.utilizadaEm ? 'text-[#05603A]' : a.estado === 'valida' ? 'text-[#0B4450]' : 'text-[#93370D]'}`}>
                  {a.utilizadaEm ? `Utilizada ${fmtHora(a.utilizadaEm)}` : a.estado === 'valida' ? 'Vale agora' : 'Aguardando'}
                </span>
              </div>
            ))}
            {previas.data?.length === 0 && <p className="py-2 text-[#56616B]">Nenhuma autorização prévia para hoje.</p>}
          </div>
        </Modal>
      )}

      {turno && (
        <Modal titulo="Passar turno" largura={560} onClose={() => setTurno(false)}
          rodape={<>
            <Button variante="primario" grande className="flex-1" data-autofocus onClick={() => { void sair().then(() => { avisar({ tom: 'neutro', texto: 'Turno passado. O próximo operador deve entrar com o próprio login (RN-05).' }); nav('/login'); }); }}>
              Confirmar passagem de turno
            </Button>
            <Button grande onClick={() => setTurno(false)}>Cancelar</Button>
          </>}>
          <p className="text-[#56616B]">Resumo do turno de {usuario!.nome} até {fmtHora(agora)}. Cada operador usa o próprio login: ao confirmar, sua sessão é encerrada.</p>
          <div className="grid grid-cols-2 gap-[10px]">
            {[
              ['Pessoas ainda no condomínio', r?.pessoasDentro], ['Encomendas aguardando', r?.encomendasPendentes],
              ['Ocorrências abertas', r?.ocorrenciasAbertas], ['Exceções hoje', r?.excecoesHoje],
              ['Autorizações prévias hoje', r?.autorizacoesHoje], ['Restrições pendentes', r?.restricoesPendentes],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-center justify-between rounded-lg border border-[#DCE1E5] px-[14px] py-3"><span className="text-[14px]">{k}</span><span className="font-mono text-[20px] font-semibold">{v ?? '…'}</span></div>
            ))}
          </div>
          {(r?.pessoasDentro ?? 0) > 0 && <Alert tom="ambar" titulo="Confira quem ainda está dentro"><Link className="underline" to="/pessoas" onClick={() => setTurno(false)}>Abrir pessoas no condomínio</Link></Alert>}
        </Modal>
      )}
    </div>
  );
}
