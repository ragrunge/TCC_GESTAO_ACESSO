import { useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useApi } from '../../api';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Gaveta } from '../../components/Modal';
import { Cel, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { ROTULO_PAPEL, type RegistroAlteracao } from '@portaria/domain/types';
import { fmtDataHora } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { CHAVES } from '../../app/consultas';

const COLUNAS = '150px minmax(0,1fr) 120px 190px minmax(0,1fr)';
const POR_PAGINA = 50;

/** Trilha de alterações do sistema (quem mudou o quê e quando), só leitura. Dados pessoais já vêm mascarados. */
export function TrilhaAlteracoes() {
  const api = useApi();
  const [acao, setAcao] = useState('');
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
      <div className="flex flex-wrap items-end gap-3 rounded-[10px] border border-[#DCE1E5] bg-white px-4 py-4 sm:px-5">
        <label className="flex flex-col gap-1 text-[13px] font-medium">Ação
          <select className="input !h-[44px] !px-[10px] !text-[14px] lg:!h-10" value={acao} onChange={(e) => setAcao(e.target.value)}>
            <option value="">Todas</option>{acoes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <span className="pb-2 text-[14px] text-[#56616B]">{filtrados.length} {filtrados.length === 1 ? 'alteração' : 'alterações'}{lista.hasNextPage ? ' carregadas' : ''} · mais recentes primeiro</span>
      </div>
      {lista.error && <Alert tom="vermelho" role="alert">{mensagemErro(lista.error)}</Alert>}
      <Lista legenda="Trilha de alterações" colunas={COLUNAS}>
        <ListaCab padY={10} rotulos={['Data e hora', 'Usuário', 'Papel', 'Ação', 'Registro']} />
        {filtrados.map((r) => (
          <ListaLinha key={r.id} minH={48} onClick={() => setAberto(r)} ariaLabel={`Abrir alteração ${r.seq}`}>
            <Cel className="font-mono text-[14px]">{fmtDataHora(r.em)}</Cel>
            <Cel className="truncate font-medium">{r.usuarioNome}</Cel>
            <Cel className="text-[14px]">{r.usuarioPapel ? ROTULO_PAPEL[r.usuarioPapel] : '—'}</Cel>
            <Cel className="font-mono text-[13px]">{r.acao}</Cel>
            <Cel className="truncate font-mono text-[13px] text-[#56616B]">{r.entidade} · {r.registroId}</Cel>
          </ListaLinha>
        ))}
      </Lista>
      {!lista.isPending && filtrados.length === 0 && <Vazio>Nenhuma alteração registrada com este filtro.</Vazio>}
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
