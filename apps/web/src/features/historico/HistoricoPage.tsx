import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Ban, Check, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useApi, type FiltroEventos } from '../../api';
import type { ResultadoIntegridade } from '@portaria/domain/hashChain';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Tabs } from '../../components/Tabs';
import { Badge, type Tom } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_MEIO, ROTULO_MEIO_CURTO, type EventoView, type MeioAutorizacao } from '@portaria/domain/types';
import { DIA, agora, fimDoDia, fmtData, fmtHora, fromInput, inicioDoDia } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { APOS_EVENTO, CHAVES, useInvalidar } from '../../app/consultas';
import { destaqueEvento, textoAutorizacao } from '../common/evento';
import { EventoGaveta } from './EventoGaveta';
import { baixarArquivo } from './download';
import { SeloAncora } from './SeloAncora';
import { TrilhaAlteracoes } from './TrilhaAlteracoes';
import { ErroCarregar } from '../../components/Carregando';
import { BarraFiltros, CampoFiltro, CONTROLE, ContagemResultado, FiltroBusca, FiltroCheck, FiltroPeriodo, FiltroUnidade, lerOpcao, naUrl, useFiltrosUrl, useFiltroUnidade, usePeriodoUrl } from '../../components/Filtros';

/** Eventos por página (a lista cresce com "Carregar mais"; a trilha inteira não vem de uma vez). */
const POR_PAGINA = 50;
const TIPOS = ['', 'entrada', 'saida', 'negado', 'recusado', 'correcao'] as const;
const ROTULO_TIPO: Record<string, string> = { entrada: 'Entrada', saida: 'Saída', negado: 'Negado', recusado: 'Recusado', correcao: 'Correção' };
const MEIOS = ['', ...Object.keys(ROTULO_MEIO)] as ('' | MeioAutorizacao)[];
const COLUNAS = '150px 104px minmax(0,1.1fr) 64px minmax(0,1.5fr) 130px 124px';

/** Selo da coluna Evento: o tipo do registro (a autorização vai na coluna ao lado, em texto). */
const EVENTO: Record<EventoView['tipo'], { texto: string; tom: Tom; icone?: typeof Ban }> = {
  entrada: { texto: 'Entrada', tom: 'verde' },
  saida: { texto: 'Saída', tom: 'neutro' },
  negado: { texto: 'Negado', tom: 'vermelho', icone: Ban },
  recusado: { texto: 'Recusado', tom: 'ambar', icone: Ban },
  correcao: { texto: 'Correção', tom: 'petroleo' },
};

/** Autorização em texto ("Interfone · Ana Ribeiro"); exceção e entrada sem solicitante mantêm o selo âmbar, que é alerta. */
function Autorizacao({ ev }: { ev: EventoView }) {
  const alerta = ev.tipo === 'entrada' && (ev.autorizadoPorTipo === 'excecao_porteiro' || ev.autorizacaoSemSolicitante);
  const texto = ev.tipo === 'entrada' && ev.autorizadoPorTipo && !alerta && ev.autorizadoPorTipo !== 'escala'
    ? `${ROTULO_MEIO_CURTO[ev.autorizadoPorTipo]} · ${textoAutorizacao(ev)}`
    : ev.tipo === 'saida' && ev.entradaCodigo ? `Saída registrada · entrada ${ev.entradaCodigo}`
    : textoAutorizacao(ev);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      {alerta && <Badge tom="ambar" icone={TriangleAlert}>{ev.autorizadoPorTipo === 'excecao_porteiro' ? 'Exceção' : 'Sem solicitante'}</Badge>}
      <span className="min-w-0 text-[14px] [overflow-wrap:anywhere]">{texto}</span>
      {/* Quebra linha dentro da coluna em vez de invadir "Registrado por" */}
      {ev.retroativo && <Badge tom="petroleo" tamanho="sm" className="!h-auto max-w-full !whitespace-normal py-0.5">Retroativo · Hora real {fmtHora(ev.ocorridoEm)} · lançado às {fmtHora(ev.registradoEm)}</Badge>}
    </span>
  );
}

/**
 * Coluna Integridade: só diz "Verificado" depois de rodar a verificação, e só até onde ela chegou. Antes disso não
 * há resultado por registro (a API verifica a cadeia inteira, sob demanda), então a célula fica vazia.
 */
function Integridade({ seq, integ }: { seq: number; integ: ResultadoIntegridade | null }) {
  if (!integ) return <span className="text-[#8A97A0]" title="Use Verificar integridade da trilha">—<span className="sr-only">Não verificado</span></span>;
  if (!integ.valido && seq === integ.primeiroSeqInvalido) return <Badge tom="vermelho" tamanho="sm" icone={Ban}>Adulterado</Badge>;
  // Depois do primeiro registro quebrado a verificação para; registrado depois dela, ainda não foi conferido. Cadeia que
  // não bate com o selo (recalculada inteira) não tem primeiro inválido: nenhum registro pode ser dado como verificado.
  const ok = integ.valido ? seq <= integ.ultimoSeq : integ.primeiroSeqInvalido !== undefined && seq < integ.primeiroSeqInvalido;
  return ok ? <Badge tom="verde" tamanho="sm" icone={Check}>Verificado</Badge> : <span className="text-[13px] text-[#56616B]">Não conferido</span>;
}

export function HistoricoPage() {
  const api = useApi();
  const { avisar } = useToast();
  const podeVerificar = useCan('auditoria.verificar');
  const podeExportar = useCan('auditoria.exportar');
  const { params, gravar } = useFiltrosUrl();
  // Na URL: período, unidade, porteiro, tipo, meio, checkboxes e aba. A pessoa (nome) e a placa ficam só no estado (dado pessoal).
  const periodo = usePeriodoUrl(7);
  const { de, ate } = periodo;
  const unid = useFiltroUnidade();
  const [pessoa, setPessoa] = useState('');
  const [placa, setPlaca] = useState('');
  const tipo = lerOpcao(params.get('tipo'), TIPOS, '');
  const meio = lerOpcao(params.get('meio'), MEIOS, '');
  const exc = params.get('exc') === '1';
  const retro = params.get('retro') === '1';
  // Aba sem permissão (link copiado por outro perfil) volta para a trilha de acessos
  const abaUrl = lerOpcao(params.get('aba'), ['acessos', 'alteracoes'] as const, 'acessos');
  const aba = abaUrl === 'alteracoes' && !podeVerificar ? 'acessos' : abaUrl;
  const [aberto, setAberto] = useState<EventoView | null>(null);
  const [integ, setInteg] = useState<ResultadoIntegridade | null>(null);
  const [verificando, setVerificando] = useState(false);

  // Porteiros para o filtro: quem registrou nos últimos 40 dias (uma página de até 100 eventos basta para a lista)
  const operadores = useQuery({
    queryKey: CHAVES.operadores,
    queryFn: async () => {
      const p = await api.eventos.listarPagina({ de: inicioDoDia(agora()) - 40 * DIA, limite: 100 });
      return [...new Map(p.itens.map((e) => [e.operadorId, e.operadorNome])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    },
  });
  // Porteiro da URL que não existe na lista (link velho) volta ao padrão, depois que a lista carrega
  const opUrl = params.get('op') ?? '';
  const operadorId = operadores.data && !operadores.data.some(([id]) => id === opUrl) ? '' : opUrl;
  const un = unid.unidadeId ?? null;
  const filtro: FiltroEventos = useMemo(() => ({
    de: de ? fromInput(de) ?? undefined : undefined, ate: ate ? fimDoDia(fromInput(ate) ?? 0) : undefined,
    unidadeId: un ?? undefined, pessoa: pessoa || undefined, placa: placa || undefined, operadorId: operadorId || undefined,
    tipo: (tipo || undefined) as FiltroEventos['tipo'], meio: (meio || undefined) as MeioAutorizacao | undefined,
    somenteExcecoes: exc || undefined, somenteRetroativos: retro || undefined,
  }), [de, ate, un, pessoa, placa, operadorId, tipo, meio, exc, retro]);

  const invalidar = useInvalidar();
  const lista = useInfiniteQuery({
    queryKey: CHAVES.eventosLista(JSON.stringify(filtro)),
    queryFn: ({ pageParam }) => api.eventos.listarPagina({ ...filtro, cursor: pageParam, limite: POR_PAGINA }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    staleTime: 0,
  });
  async function verificar() {
    setVerificando(true);
    try {
      const r = await api.auditoria.verificarIntegridade();
      setInteg(r);
      void invalidar([CHAVES.integridade, CHAVES.selos]);
      if (r.valido) avisar({ titulo: 'Trilha íntegra', texto: `${r.verificados} registros verificados; a cadeia de hashes está consistente.` });
      else avisar({ tom: 'vermelho', titulo: 'Adulteração detectada', texto: `Primeiro registro divergente: seq ${r.primeiroSeqInvalido}.` });
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); } finally { setVerificando(false); }
  }

  async function exportar() {
    try {
      const p = await api.auditoria.exportar(filtro);
      baixarArquivo(p.nomeArquivo, p.conteudo);
      avisar({ titulo: 'Trilha exportada', texto: `${p.quantidade} eventos com hashes em ${p.nomeArquivo}. O arquivo traz as instruções de verificação.` });
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  const dados = useMemo(() => (lista.data?.pages ?? []).flatMap((p) => p.itens), [lista.data]);
  const invalidoSeq = integ && !integ.valido ? integ.primeiroSeqInvalido : undefined;
  const ativos = [periodo.ativo, !!unid.texto.trim(), !!pessoa, !!placa, !!operadorId, !!tipo, !!meio, exc, retro].filter(Boolean).length;
  const limpar = () => { periodo.limpar(); unid.limpar(); setPessoa(''); setPlaca(''); gravar({ op: undefined, tipo: undefined, meio: undefined, exc: undefined, retro: undefined }); };
  // Selo e âncora externa (spec 4.6): para quem verifica a integridade.
  const mostraSelo = podeVerificar;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader titulo="Histórico e auditoria" descricao="Trilha só de inclusão. Nada é editado: correções são novos registros ligados ao original."
        acoes={<>
          {podeVerificar && <Button variante="contorno" carregando={verificando} onClick={() => void verificar()} title="Confere se nenhum registro da trilha foi alterado ou removido">Verificar integridade da trilha</Button>}
          {podeExportar && <Button variante="contorno" onClick={() => void exportar()} title="Cada registro leva o hash que o liga ao anterior">Exportar trilha (arquivo verificável)</Button>}
        </>} />

      {podeVerificar && (
        <Tabs rotulo="Trilhas" ativa={aba} onChange={(a) => gravar({ aba: naUrl(a, 'acessos') })}
          abas={[
            { id: 'acessos' as const, rotulo: 'Trilha de acessos' },
            { id: 'alteracoes' as const, rotulo: 'Trilha de alterações' },
          ]} />
      )}
      {aba === 'alteracoes' ? <TrilhaAlteracoes /> : <>
      {verificando && <div role="status" className="rounded-lg border border-[#D5DDE2] bg-[#EEF2F4] px-4 py-3 text-[#33424B]">Verificando a cadeia de hashes…</div>}
      {integ && (integ.valido
        ? <div role="status" className="flex items-center gap-[10px] rounded-lg border border-[#75E0A7] bg-[#DCFAE6] px-4 py-3 font-medium text-[#05603A]">
            <ShieldCheck className="h-[22px] w-[22px] shrink-0" aria-hidden />
            <span>Integridade verificada: {integ.verificados} registros em ordem de sequência. Último registro: seq {integ.ultimoSeq}, hash <span className="font-mono text-[13px]">{integ.ultimoHash.slice(0, 16)}…</span></span>
          </div>
        : <Alert tom="vermelho" role="alert" titulo="ADULTERAÇÃO DETECTADA NA TRILHA">
            O primeiro registro inconsistente é o de sequência <strong>{integ.primeiroSeqInvalido}</strong> ({integ.motivo === 'hash_divergente' ? 'o conteúdo não bate com o hash gravado' : integ.motivo === 'hash_anterior_incoerente' ? 'o encadeamento com o registro anterior está quebrado' : integ.motivo === 'selo_divergente' ? 'a cadeia não bate com o selo diário: foi recalculada depois de alterada' : 'há lacuna na sequência'}). Os {integ.verificados} registros anteriores estão íntegros. Preserve o arquivo exportado e acione o síndico.
          </Alert>)}

      {mostraSelo && <SeloAncora />}

      <BarraFiltros ativos={ativos} onLimpar={limpar} principalAtivo={!!pessoa || !!placa}
        resultado={<ContagemResultado n={dados.length} singular="registro" plural="registros" sufixo={lista.hasNextPage ? '(há mais: carregue abaixo)' : ''} />}
        principal={<FiltroBusca rotulo="Pessoa" value={pessoa} onChange={setPessoa} placeholder="Nome" />}>
        <FiltroBusca rotulo="Placa" value={placa} onChange={setPlaca} placeholder="ABC1D23" largura="md:w-44" />
        <FiltroPeriodo de={de} ate={ate} onChange={periodo.alterar} atalhos />
        <FiltroUnidade f={unid} />
        <CampoFiltro rotulo="Porteiro" largura="md:w-48">
          <select className={CONTROLE} value={operadorId} onChange={(e) => gravar({ op: naUrl(e.target.value, '') })}><option value="">Todos</option>{(operadores.data ?? []).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select>
        </CampoFiltro>
        <CampoFiltro rotulo="Meio de autorização" largura="md:w-52">
          <select className={CONTROLE} value={meio} onChange={(e) => gravar({ meio: naUrl(e.target.value, '') })}><option value="">Todos</option>{(Object.keys(ROTULO_MEIO) as MeioAutorizacao[]).map((m) => <option key={m} value={m}>{ROTULO_MEIO[m]}</option>)}</select>
        </CampoFiltro>
        {/* Segunda linha no desktop (Claude Design): tipo em pílulas, os dois "Somente", a contagem e o Limpar */}
        <div aria-hidden className="hidden md:block md:h-0 md:basis-full" />
        <fieldset className="flex w-full flex-col gap-1.5 md:w-auto md:flex-row md:items-center md:gap-2 md:self-center">
          <legend className="float-left mb-1.5 text-[13px] font-medium text-[#33424B] md:mb-0 md:mr-1">Tipo de registro</legend>
          <div className="flex flex-wrap gap-1.5">
            {TIPOS.filter(Boolean).map((t) => (
              <button key={t} type="button" aria-pressed={tipo === t} onClick={() => gravar({ tipo: tipo === t ? undefined : t })}
                className={`h-[44px] rounded-full border px-[14px] text-[14px] font-medium md:h-9 ${tipo === t ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>
                {ROTULO_TIPO[t]}
              </button>
            ))}
          </div>
        </fieldset>
        <FiltroCheck rotulo="Somente exceções" checked={exc} onChange={(v) => gravar({ exc: v ? '1' : undefined })} />
        <FiltroCheck rotulo="Somente retroativos" checked={retro} onChange={(v) => gravar({ retro: v ? '1' : undefined })} />
      </BarraFiltros>

      {lista.error && <ErroCarregar mensagem={mensagemErro(lista.error)} onTentar={() => lista.refetch()} />}
      <div className="overflow-hidden rounded-[10px] border border-[#DCE1E5] bg-white">
        <Lista legenda="Eventos de acesso" colunas={COLUNAS} empilhar className="!rounded-none !border-0" carregando={lista.isLoading} linhasCarregando={8}>
          <ListaCab padY={10} rotulos={['Data e hora', 'Evento', 'Pessoa', 'Unid.', 'Autorização', 'Registrado por', 'Integridade']} />
          {dados.map((e) => {
            const ruim = invalidoSeq !== undefined && e.seq === invalidoSeq;
            return (
              <ListaLinha key={e.id} minH={50} destaque={ruim ? 'vermelho' : destaqueEvento(e) ?? (e.retroativo ? 'novo' : undefined)} onClick={() => setAberto(e)} ariaLabel={`Abrir evento ${e.codigo}`}>
                <Cel className="font-mono text-[14px]">{fmtData(e.ocorridoEm)} {fmtHora(e.ocorridoEm)}</Cel>
                <Cel><Badge tom={EVENTO[e.tipo].tom} icone={EVENTO[e.tipo].icone} tamanho="sm">{EVENTO[e.tipo].texto}</Badge></Cel>
                <Cel className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{e.pessoaNome}</span>
                  <span className="font-mono text-[12.5px] text-[#56616B]">{e.codigo}</span>
                </Cel>
                <CelUnidade id={e.unidadeDestinoId} texto={e.unidadeRotulo} />
                <Cel className="col-span-2 md:col-span-1"><Autorizacao ev={e} /></Cel>
                <Cel className="text-[14px]">{e.operadorNome}</Cel>
                <Cel><Integridade seq={e.seq} integ={integ} /></Cel>
              </ListaLinha>
            );
          })}
        </Lista>
        {!lista.isPending && !lista.error && dados.length === 0 && <Vazio>Nenhum evento com estes filtros.</Vazio>}
      </div>
      {lista.hasNextPage && <div><Button carregando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>Carregar mais</Button></div>}

      </>}

      {aberto && <EventoGaveta ev={aberto} onClose={() => setAberto(null)} onCorrigido={() => { setAberto(null); void invalidar(APOS_EVENTO); }} />}
    </div>
  );
}
