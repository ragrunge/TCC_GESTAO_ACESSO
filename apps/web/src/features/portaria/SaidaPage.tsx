// Registrar saída (UC07, RF-12; tela T06b). Busca rápida entre quem está DENTRO agora (a mesma consulta de "Presentes
// agora", GET /acessos/presentes), escolha por teclado (setas/Enter) ou toque, confirmação com o resumo da entrada e
// volta à busca para a próxima saída. `?entrada=<uuid>` abre já com a entrada escolhida (atalho da gaveta do evento).
//
// Filtro local por nome, categoria, tipo de visita, empresa/serviço e destino ("D-32", "d32", área comum). CPF: a
// lista de presentes não traz documento (minimização), então um termo só de dígitos (3+) também consulta a busca de
// pessoas que já existe (POST /pessoas/busca, termo no corpo) e cruza pelo id da pessoa.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, TriangleAlert } from 'lucide-react';
import { useApi } from '../../api';
import { Alert } from '../../components/Alert';
import { PageHeader } from '../../components/PageHeader';
import { Vazio } from '../../components/Table';
import { Badge } from '../../components/ui/badge';
import { Command, CommandItem, CommandList, CommandPrimitive } from '../../components/ui/command';
import { ROTULO_CATEGORIA, ROTULO_TIPO_VISITA, type EventoView } from '@portaria/domain/types';
import { mensagemErro, useAgora } from '../../app/useAsync';
import { CHAVES, useDebounce } from '../../app/consultas';
import { quandoCurto, textoAutorizacao } from '../common/evento';
import { CelPermanencia, destaquePresente, estadoDoPresente, ordenarParaSaida, usePresentes } from './presentes';
import { ConfirmarSaidaModal, destinoDe, SaidaRetroativaModal } from './saida';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUNAS = 'md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_90px_80px_minmax(0,1.3fr)_minmax(0,1.2fr)]';
const MIN_DIGITOS_CPF = 3;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const compacto = (s: string) => norm(s).replace(/[^a-z0-9]/g, '');

/** Termo só de dígitos e separadores de CPF ("123", "123.456", "***.456.789-**"). */
export function digitosCpf(q: string): string | null {
  if (!/^[\d.\-*\s]+$/.test(q.trim())) return null;
  const d = q.replace(/\D/g, '');
  return d.length >= MIN_DIGITOS_CPF ? d : null;
}

/** Filtro local: todas as palavras precisam aparecer (nome, categoria, tipo de visita, destino, empresa, serviço). */
export function casaPresente(e: EventoView, q: string): boolean {
  const termo = norm(q).trim();
  if (!termo) return true;
  const destino = destinoDe(e);
  const texto = norm([e.pessoaNome, ROTULO_CATEGORIA[e.categoriaPessoa], e.permanencia ? ROTULO_TIPO_VISITA[e.permanencia.tipoVisita] : '',
    destino, e.areaComumNome ?? '', e.empresa ?? '', e.servico ?? ''].join(' '));
  if (compacto(termo) && compacto(destino) === compacto(termo)) return true; // "d32", "D 32"
  return termo.split(/\s+/).every((t) => texto.includes(t));
}

export function SaidaPage() {
  const api = useApi();
  const agora = useAgora(15000);
  const [params, setParams] = useSearchParams();
  const lista = usePresentes();
  const [q, setQ] = useState('');
  const [selecionada, setSelecionada] = useState<EventoView | null>(null);
  const [retro, setRetro] = useState<EventoView | null>(null);
  const [avisoParam, setAvisoParam] = useState('');
  const buscaRef = useRef<HTMLInputElement>(null);

  // CPF parcial ou completo: a busca de pessoas existente, com o termo no corpo (a chave fica só na memória).
  const cpf = digitosCpf(q);
  const cpfDebounce = useDebounce(cpf, 200);
  const porCpf = useQuery({
    queryKey: CHAVES.pessoasSaida(cpfDebounce ?? ''),
    queryFn: () => api.pessoas.buscar(cpfDebounce!, { limite: 50 }),
    enabled: !!cpfDebounce && cpfDebounce === cpf,
    staleTime: 0, gcTime: 30_000, retry: false,
  });
  const docPorPessoa = useMemo(() => new Map((cpf && porCpf.data ? porCpf.data : []).map((p) => [p.id, p.documentoMascarado])), [cpf, porCpf.data]);

  const dados = lista.data ?? [];
  const achados = useMemo(
    () => ordenarParaSaida(dados.filter((e) => casaPresente(e, q) || docPorPessoa.has(e.pessoaId)), agora),
    [dados, q, docPorPessoa, agora],
  );
  const buscandoCpf = !!cpf && (cpfDebounce !== cpf || porCpf.isFetching);

  useEffect(() => { buscaRef.current?.focus(); }, []);
  // O cmdk fixa aria-expanded="true" no campo; aqui ele reflete se há resultados visíveis.
  useLayoutEffect(() => { buscaRef.current?.setAttribute('aria-expanded', String(achados.length > 0)); });

  // Voltou da confirmação (registrou ou desistiu): foco na busca para a próxima saída. Roda depois de o modal devolver
  // o foco ao elemento anterior (efeito do pai depois da limpeza do filho).
  const anterior = useRef<EventoView | null>(null);
  useEffect(() => {
    if (anterior.current && !selecionada && !retro) buscaRef.current?.focus();
    anterior.current = selecionada ?? retro;
  }, [selecionada, retro]);

  // ?entrada=<uuid>: abre a confirmação dessa entrada se ela ainda está entre os presentes. O parâmetro é consumido
  // (replace) para um reload não reabrir; inválido é ignorado.
  const paramFeito = useRef(false);
  useEffect(() => {
    if (paramFeito.current) return;
    const id = params.get('entrada');
    if (!id) { paramFeito.current = true; return; }
    if (!UUID.test(id)) { paramFeito.current = true; limparParam(); return; }
    if (!lista.data) return;
    paramFeito.current = true;
    limparParam();
    const e = lista.data.find((x) => x.id === id);
    if (e) setSelecionada(e);
    else setAvisoParam('Essa entrada não está mais entre os presentes: a saída pode já ter sido registrada.');
    function limparParam() { const p = new URLSearchParams(params); p.delete('entrada'); setParams(p, { replace: true }); }
  }, [params, setParams, lista.data]);

  function aposSaida() { setSelecionada(null); setRetro(null); setQ(''); }

  const total = dados.length;
  const status = lista.isPending ? 'Carregando quem está dentro…'
    : buscandoCpf ? 'Buscando pelo CPF…'
    : q.trim() ? `${achados.length} de ${total} ${total === 1 ? 'pessoa dentro' : 'pessoas dentro'}`
    : `${total} ${total === 1 ? 'pessoa dentro' : 'pessoas dentro'} agora`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Registrar saída"
        descricao="Busque quem está dentro, escolha com as setas e Enter, e confirme. A entrada não é alterada: a saída é um novo registro ligado a ela."
        acoes={<Link to="/pessoas" className="inline-flex h-11 items-center rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium !text-ink hover:border-[#0B5563]">Ver presentes agora</Link>} />
      {lista.error && <Alert tom="vermelho" role="alert">{mensagemErro(lista.error)}</Alert>}
      {avisoParam && <Alert tom="ambar" role="status">{avisoParam}</Alert>}
      {porCpf.isError && cpf && <Alert tom="vermelho" role="alert">{mensagemErro(porCpf.error)}</Alert>}

      <Command shouldFilter={false} loop label="Buscar quem está dentro" className="gap-3">
        <div className="flex flex-col gap-[6px]">
          {/* O cmdk dá ao campo o próprio id e o rotula pelo `label` do Command (texto visível só para quem enxerga) */}
          <span aria-hidden className="text-[14px] font-medium">Buscar quem está dentro</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#56616B]" strokeWidth={2} aria-hidden />
            <CommandPrimitive.Input ref={buscaRef} value={q} onValueChange={setQ} autoComplete="off"
              aria-describedby="busca-saida-status"
              placeholder="Nome, CPF, unidade (ex.: D-32) ou tipo de visita"
              onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); setQ(''); } }}
              className="input h-[52px] pl-10 text-[16px]" />
          </div>
          <p id="busca-saida-status" role="status" className="text-[13px] text-[#56616B]">{status}</p>
        </div>

        {!lista.isPending && total === 0 && !lista.error && <div className="rounded-[10px] border border-[#DCE1E5] bg-white"><Vazio>Ninguém dentro agora.</Vazio></div>}
        {total > 0 && (
          <div className="rounded-[10px] border border-[#DCE1E5] bg-white md:overflow-hidden">
            <div aria-hidden className={`hidden gap-3 border-b border-[#E6EAED] px-5 py-3 text-[13px] font-semibold text-[#56616B] md:grid ${COLUNAS}`}>
              <span>Nome</span><span>Tipo</span><span>Destino</span><span>Entrada</span><span>Permanência</span><span>Autorizado por</span>
            </div>
            <CommandList label="Quem está dentro" className="max-h-none p-2 md:p-0">
              {achados.length === 0 && !buscandoCpf && <Vazio>Ninguém dentro com “{q.trim()}”.</Vazio>}
              {achados.map((e) => {
                const estado = estadoDoPresente(e, agora);
                const fundo = destaquePresente(e, agora);
                return (
                  <CommandItem key={e.id} value={e.id} onSelect={() => setSelecionada(e)}
                    className={`mb-2 grid grid-cols-2 items-start gap-x-3 gap-y-1 rounded-[10px] border border-[#DCE1E5] px-4 py-3 md:mb-0 md:items-center md:rounded-none md:border-0 md:border-b md:border-[#EEF1F3] md:px-5 ${COLUNAS} ${
                      fundo === 'vermelho' ? 'bg-[#FEF3F2]' : fundo === 'ambar' ? 'bg-[#FFFAEB]' : 'bg-white'}`}>
                    <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 md:col-span-1">
                      <span className="truncate font-semibold">{e.pessoaNome}</span>
                      {estado === 'expirado' && <Badge variant="vermelho"><TriangleAlert className="h-3.5 w-3.5" aria-hidden />Expirado</Badge>}
                      {docPorPessoa.has(e.pessoaId) && <span className="font-mono text-[13px] text-[#56616B]">{docPorPessoa.get(e.pessoaId)}</span>}
                    </span>
                    <span className="text-[14px]">{ROTULO_CATEGORIA[e.categoriaPessoa]}{e.permanencia && <span className="text-[#56616B]"> · {ROTULO_TIPO_VISITA[e.permanencia.tipoVisita]}</span>}</span>
                    <span className="font-mono font-semibold"><span className="sr-only">Destino </span>{destinoDe(e)}</span>
                    <span className="font-mono text-[14px]"><span className="font-sans text-[#56616B] md:sr-only">Entrou </span>{quandoCurto(e.ocorridoEm, agora)}</span>
                    <span className="text-[14px]"><CelPermanencia entradaEm={e.ocorridoEm} permanencia={e.permanencia ?? null} agora={agora} /></span>
                    <span className="col-span-2 min-w-0 truncate text-[14px] text-[#33424B] md:col-span-1"><span className="text-[#56616B] md:sr-only">Autorizado por </span>{textoAutorizacao(e)}</span>
                  </CommandItem>
                );
              })}
            </CommandList>
          </div>
        )}
      </Command>

      {selecionada && <ConfirmarSaidaModal entrada={selecionada} agora={agora} onClose={() => setSelecionada(null)} onFeito={aposSaida}
        onRetroativa={() => { setRetro(selecionada); setSelecionada(null); }} />}
      {retro && <SaidaRetroativaModal entrada={retro} onClose={() => setRetro(null)} onFeito={aposSaida} />}
    </div>
  );
}
