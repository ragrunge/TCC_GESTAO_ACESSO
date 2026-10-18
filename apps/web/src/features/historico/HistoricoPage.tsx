import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Check, ShieldCheck } from 'lucide-react';
import { useApi, type FiltroEventos } from '../../api';
import type { ResultadoIntegridade } from '@portaria/domain/hashChain';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Tabs } from '../../components/Tabs';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_MEIO, ROTULO_CATEGORIA, type EventoView, type MeioAutorizacao } from '@portaria/domain/types';
import { DIA, agora, fimDoDia, fromInput, inicioDoDia, toInputDate } from '@portaria/domain/time';
import { useCatalogo } from '../../app/catalogo';
import { mensagemErro } from '../../app/useAsync';
import { APOS_EVENTO, CHAVES, useInvalidar } from '../../app/consultas';
import { AutorizacaoEvento, destaqueEvento, quandoCurto } from '../common/evento';
import { EventoGaveta } from './EventoGaveta';
import { baixarArquivo } from './download';
import { TrilhaAlteracoes } from './TrilhaAlteracoes';

/** Eventos por página (a lista cresce com "Carregar mais"; a trilha inteira não vem de uma vez). */
const POR_PAGINA = 50;
const COLUNAS = '110px minmax(0,1.2fr) 80px 100px minmax(0,1.9fr) 120px 140px';

export function HistoricoPage() {
  const api = useApi();
  const { avisar } = useToast();
  const podeVerificar = useCan('auditoria.verificar');
  const podeExportar = useCan('auditoria.exportar');
  const [de, setDe] = useState(toInputDate(agora() - 7 * DIA));
  const [ate, setAte] = useState(toInputDate(agora()));
  const [unidade, setUnidade] = useState('');
  const [pessoa, setPessoa] = useState('');
  const [operadorId, setOperadorId] = useState('');
  const [tipo, setTipo] = useState('');
  const [meio, setMeio] = useState('');
  const [exc, setExc] = useState(false);
  const [retro, setRetro] = useState(false);
  const [aba, setAba] = useState<'acessos' | 'alteracoes'>('acessos');
  const [aberto, setAberto] = useState<EventoView | null>(null);
  const [integ, setInteg] = useState<ResultadoIntegridade | null>(null);
  const [verificando, setVerificando] = useState(false);

  const catalogo = useCatalogo();
  const un = unidade.trim() ? catalogo.porTexto(unidade)?.id ?? null : null;
  const filtro: FiltroEventos = useMemo(() => ({
    de: de ? fromInput(de) ?? undefined : undefined, ate: ate ? fimDoDia(fromInput(ate) ?? 0) : undefined,
    unidadeId: un ?? undefined, pessoa: pessoa || undefined, operadorId: operadorId || undefined,
    tipo: (tipo || undefined) as FiltroEventos['tipo'], meio: (meio || undefined) as MeioAutorizacao | undefined,
    somenteExcecoes: exc || undefined, somenteRetroativos: retro || undefined,
  }), [de, ate, un, pessoa, operadorId, tipo, meio, exc, retro]);

  const invalidar = useInvalidar();
  const lista = useInfiniteQuery({
    queryKey: CHAVES.eventosLista(JSON.stringify(filtro)),
    queryFn: ({ pageParam }) => api.eventos.listarPagina({ ...filtro, cursor: pageParam, limite: POR_PAGINA }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    staleTime: 0,
  });
  // Porteiros para o filtro: quem registrou nos últimos 40 dias (uma página de até 100 eventos basta para a lista)
  const operadores = useQuery({
    queryKey: CHAVES.operadores,
    queryFn: async () => {
      const p = await api.eventos.listarPagina({ de: inicioDoDia(agora()) - 40 * DIA, limite: 100 });
      return [...new Map(p.itens.map((e) => [e.operadorId, e.operadorNome])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    },
  });

  async function verificar() {
    setVerificando(true);
    try {
      const r = await api.auditoria.verificarIntegridade();
      setInteg(r);
      void invalidar([CHAVES.integridade]);
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
  const limpar = () => { setDe(toInputDate(agora() - 7 * DIA)); setAte(toInputDate(agora())); setUnidade(''); setPessoa(''); setOperadorId(''); setTipo(''); setMeio(''); setExc(false); setRetro(false); };
  const campo = 'flex flex-col gap-1 text-[13px] font-medium';
  const entrada = 'input !h-10 !px-[10px] !text-[14px]';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader titulo="Histórico e auditoria" descricao="Trilha somente leitura. Cada registro é encadeado ao anterior por hash. Correção é um novo registro, com justificativa."
        acoes={<>
          {podeVerificar && <Button variante="contorno" carregando={verificando} onClick={() => void verificar()}>Verificar integridade da trilha</Button>}
          {podeExportar && <Button variante="primario" onClick={() => void exportar()}>Exportar trilha (arquivo verificável)</Button>}
        </>} />

      {podeVerificar && (
        <Tabs rotulo="Trilhas" ativa={aba} onChange={setAba}
          abas={[{ id: 'acessos', rotulo: 'Trilha de acessos' }, { id: 'alteracoes', rotulo: 'Trilha de alterações' }]} />
      )}
      {aba === 'alteracoes' && podeVerificar ? <TrilhaAlteracoes /> : <>
      {verificando && <div role="status" className="rounded-lg border border-[#D5DDE2] bg-[#EEF2F4] px-4 py-3 text-[#33424B]">Verificando a cadeia de hashes…</div>}
      {integ && (integ.valido
        ? <div role="status" className="flex items-center gap-[10px] rounded-lg border border-[#75E0A7] bg-[#DCFAE6] px-4 py-3 font-medium text-[#05603A]">
            <ShieldCheck className="h-[22px] w-[22px] shrink-0" aria-hidden />
            <span>Integridade verificada: {integ.verificados} registros em ordem de sequência. Último registro: seq {integ.ultimoSeq}, hash <span className="font-mono text-[13px]">{integ.ultimoHash.slice(0, 16)}…</span></span>
          </div>
        : <Alert tom="vermelho" role="alert" titulo="ADULTERAÇÃO DETECTADA NA TRILHA">
            O primeiro registro inconsistente é o de sequência <strong>{integ.primeiroSeqInvalido}</strong> ({integ.motivo === 'hash_divergente' ? 'o conteúdo não bate com o hash gravado' : integ.motivo === 'hash_anterior_incoerente' ? 'o encadeamento com o registro anterior está quebrado' : integ.motivo === 'selo_divergente' ? 'a cadeia não bate com o selo diário: foi recalculada depois de alterada' : 'há lacuna na sequência'}). Os {integ.verificados} registros anteriores estão íntegros. Preserve o arquivo exportado e acione o síndico.
          </Alert>)}

      <form className="grid grid-cols-4 items-end gap-x-4 gap-y-3 rounded-[10px] border border-[#DCE1E5] bg-white px-5 py-4" onSubmit={(e) => e.preventDefault()} aria-label="Filtros">
        <div className={campo}>Período
          <span className="flex gap-1.5">
            <input type="date" aria-label="De" className={`${entrada} min-w-0 flex-1`} value={de} onChange={(e) => setDe(e.target.value)} />
            <input type="date" aria-label="Até" className={`${entrada} min-w-0 flex-1`} value={ate} onChange={(e) => setAte(e.target.value)} />
          </span>
        </div>
        <label className={campo}>Unidade
          <input className={`${entrada} font-sans`} placeholder="Ex.: T4-32" value={unidade} onChange={(e) => setUnidade(e.target.value)} aria-invalid={!!unidade && !un} />
          {unidade && !un && <span className="text-[12px] font-normal text-[#B42318]">Use T4-32.</span>}
        </label>
        <label className={campo}>Pessoa<input className={entrada} placeholder="Nome" value={pessoa} onChange={(e) => setPessoa(e.target.value)} /></label>
        <label className={campo}>Porteiro
          <select className={entrada} value={operadorId} onChange={(e) => setOperadorId(e.target.value)}><option value="">Todos</option>{(operadores.data ?? []).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select>
        </label>
        <label className={campo}>Tipo de registro
          <select className={entrada} value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="negado">Negado</option><option value="recusado">Recusado</option><option value="correcao">Correção</option></select>
        </label>
        <label className={campo}>Meio de autorização
          <select className={entrada} value={meio} onChange={(e) => setMeio(e.target.value)}><option value="">Todos</option>{(Object.keys(ROTULO_MEIO) as MeioAutorizacao[]).map((m) => <option key={m} value={m}>{ROTULO_MEIO[m]}</option>)}</select>
        </label>
        <div className="col-span-2 flex h-10 items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[14px] font-medium"><input type="checkbox" className="h-[18px] w-[18px] accent-[#0B5563]" checked={exc} onChange={(e) => setExc(e.target.checked)} />Somente exceções</label>
          <label className="flex cursor-pointer items-center gap-2 text-[14px] font-medium"><input type="checkbox" className="h-[18px] w-[18px] accent-[#0B5563]" checked={retro} onChange={(e) => setRetro(e.target.checked)} />Somente retroativos</label>
          <button type="button" onClick={limpar} className="ml-auto h-10 px-3 text-[14px] font-semibold text-[#0B5563] hover:underline">Limpar filtros</button>
        </div>
      </form>

      {lista.error && <Alert tom="vermelho" role="alert">{mensagemErro(lista.error)}</Alert>}
      <div className="overflow-hidden rounded-[10px] border border-[#DCE1E5] bg-white">
        <div className="border-b border-[#E6EAED] px-5 py-3 text-[14px] text-[#56616B]">
          {dados.length} {dados.length === 1 ? 'evento' : 'eventos'} nos filtros escolhidos{lista.hasNextPage ? ' (há mais: carregue abaixo)' : ''}
        </div>
        <Lista legenda="Eventos de acesso" colunas={COLUNAS} className="!rounded-none !border-0">
          <ListaCab padY={10} rotulos={['Data e hora', 'Pessoa', 'Unidade', 'Tipo', 'Autorização', 'Registrado por', 'Código']} />
          {dados.map((e) => {
            const ruim = invalidoSeq !== undefined && e.seq === invalidoSeq;
            return (
              <ListaLinha key={e.id} minH={50} destaque={ruim ? 'vermelho' : destaqueEvento(e) ?? (e.retroativo ? 'novo' : undefined)} onClick={() => setAberto(e)} ariaLabel={`Abrir evento ${e.codigo}`}>
                <Cel className="font-mono text-[14px]">{quandoCurto(e.ocorridoEm, agora())}</Cel>
                <Cel className="truncate font-medium">{e.pessoaNome}</Cel>
                <CelUnidade id={e.unidadeDestinoId} texto={e.unidadeRotulo} />
                <Cel className="text-[14px]">{ROTULO_CATEGORIA[e.categoriaPessoa]}</Cel>
                <Cel><AutorizacaoEvento ev={e} detalheRetro /></Cel>
                <Cel className="text-[14px]">{e.operadorNome}</Cel>
                <Cel className="font-mono text-[12.5px] text-[#56616B]">
                  {ruim ? <Badge tom="vermelho" tamanho="xs">Adulterado</Badge> : <span className="inline-flex items-center gap-1">{e.codigo}{integ?.valido && <Check className="h-3.5 w-3.5 text-[#05603A]" strokeWidth={2.6} aria-label="Verificado" />}</span>}
                </Cel>
              </ListaLinha>
            );
          })}
        </Lista>
        {!lista.isPending && dados.length === 0 && <Vazio>Nenhum evento com estes filtros.</Vazio>}
      </div>
      {lista.hasNextPage && <div><Button carregando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>Carregar mais</Button></div>}

      </>}

      {aberto && <EventoGaveta ev={aberto} onClose={() => setAberto(null)} onCorrigido={() => { setAberto(null); void invalidar(APOS_EVENTO); }} />}
    </div>
  );
}
