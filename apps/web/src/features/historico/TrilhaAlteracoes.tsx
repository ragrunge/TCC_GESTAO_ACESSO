import { useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useApi } from '../../api';
import { Button } from '../../components/Button';
import { Gaveta } from '../../components/Modal';
import { Cel, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { ROTULO_PAPEL, type RegistroAlteracao } from '@portaria/domain/types';
import { fmtDataHora } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { CHAVES } from '../../app/consultas';
import { ErroCarregar } from '../../components/Carregando';
import { BarraFiltros, CampoFiltro, CONTROLE, ContagemResultado, naUrl, useFiltrosUrl } from '../../components/Filtros';

const COLUNAS = '150px minmax(0,1fr) 120px 190px minmax(0,1fr)';
const POR_PAGINA = 50;

/** Trilha de alterações do sistema (quem mudou o quê e quando), só leitura. Dados pessoais já vêm mascarados. */
export function TrilhaAlteracoes() {
  const api = useApi();
  // Ação na URL (nome de ação do sistema, sem dado pessoal); valor fora do formato volta ao padrão
  const { params, gravar } = useFiltrosUrl();
  const acaoUrl = params.get('acao') ?? '';
  const acao = /^[\w.:-]{1,64}$/.test(acaoUrl) ? acaoUrl : '';
  const [aberto, setAberto] = useState<RegistroAlteracao | null>(null);
  // Paginada no servidor (a trilha cresce sem parar); o filtro por ação também é aplicado lá
  const lista = useInfiniteQuery({
    queryKey: CHAVES.alteracoes(acao),
    queryFn: ({ pageParam }) => api.auditoria.alteracoesPagina({ acao: acao || undefined, cursor: pageParam, limite: POR_PAGINA }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    staleTime: 0,
  });
  const filtrados = useMemo(() => (lista.data?.pages ?? []).flatMap((p) => p.itens), [lista.data]);
  // Ações conhecidas: todas as já vistas nesta tela (o filtro não as esconde do select)
  const vistas = useRef(new Set<string>());
  for (const r of filtrados) vistas.current.add(r.acao);
  if (acao) vistas.current.add(acao);
  const acoes = [...vistas.current].sort();

  return (
    <div className="flex flex-col gap-4">
      <BarraFiltros ativos={acao ? 1 : 0} onLimpar={() => gravar({ acao: undefined })}>
        <CampoFiltro rotulo="Ação" largura="md:w-72">
          <select className={CONTROLE} value={acao} onChange={(e) => gravar({ acao: naUrl(e.target.value, '') })}>
            <option value="">Todas</option>{acoes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </CampoFiltro>
      </BarraFiltros>
      <ContagemResultado n={filtrados.length} singular="alteração" plural="alterações" sufixo={`${lista.hasNextPage ? (filtrados.length === 1 ? 'carregada' : 'carregadas') : 'nos filtros escolhidos'} · mais recentes primeiro`} className="-mb-2 px-1" />
      {lista.error && <ErroCarregar mensagem={mensagemErro(lista.error)} onTentar={() => lista.refetch()} />}
      <Lista legenda="Trilha de alterações" colunas={COLUNAS} empilhar carregando={lista.isLoading}>
        <ListaCab padY={10} rotulos={['Data e hora', 'Usuário', 'Papel', 'Ação', 'Registro']} />
        {filtrados.map((r) => (
          <ListaLinha key={r.id} minH={48} onClick={() => setAberto(r)} ariaLabel={`Abrir alteração ${r.seq}`}>
            <Cel className="font-mono text-[14px]">{fmtDataHora(r.em)}</Cel>
            <Cel className="truncate font-medium">{r.usuarioNome}</Cel>
            <Cel className="text-[14px]">{r.usuarioPapel ? ROTULO_PAPEL[r.usuarioPapel] : '—'}</Cel>
            <Cel className="font-mono text-[13px]">{r.acao}</Cel>
            <Cel className="col-span-2 truncate font-mono text-[13px] text-[#56616B] md:col-span-1">{r.entidade} · {r.registroId}</Cel>
          </ListaLinha>
        ))}
      </Lista>
      {!lista.isPending && !lista.error && filtrados.length === 0 && <Vazio>Nenhuma alteração registrada com este filtro.</Vazio>}
      {lista.hasNextPage && <div><Button carregando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>Carregar mais</Button></div>}
      {aberto && (
        <Gaveta titulo={`Alteração ${aberto.seq}`} onClose={() => setAberto(null)}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[13px] text-[#56616B]">#{aberto.seq} · {fmtDataHora(aberto.em)}</div>
              <div className="mt-0.5 text-[20px] font-semibold">{aberto.acao}</div>
              <div className="text-[#33424B]">{aberto.usuarioNome}{aberto.usuarioPapel ? ` (${ROTULO_PAPEL[aberto.usuarioPapel]})` : ''}</div>
              <div className="font-mono text-[13px] text-[#56616B]">{aberto.entidade} · {aberto.registroId}</div>
            </div>
            <Button pequeno data-autofocus onClick={() => setAberto(null)}>Fechar</Button>
          </div>
          <Bloco titulo="Antes" valor={aberto.antes} />
          <Bloco titulo="Depois" valor={aberto.depois} />
          <p className="border-t border-[#E6EAED] pt-2 text-[13px] text-[#56616B]">CPF e telefone aparecem mascarados. Esta trilha é só de acréscimo: registros não são alterados nem removidos.</p>
        </Gaveta>
      )}
    </div>
  );
}

function Bloco({ titulo, valor }: { titulo: string; valor: Record<string, unknown> | null }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[15px] font-semibold">{titulo}</h3>
      {valor ? <pre className="max-h-80 overflow-auto rounded-lg bg-[#F3F5F6] p-3 font-mono text-[12.5px] leading-[1.5] whitespace-pre-wrap break-words">{JSON.stringify(valor, null, 2)}</pre>
        : <span className="text-[14px] text-[#56616B]">—</span>}
    </div>
  );
}
