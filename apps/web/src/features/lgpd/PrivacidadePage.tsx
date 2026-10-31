// "Privacidade (LGPD)": o que é obrigação de LGPD do condomínio num lugar só. Duas abas:
// - Pedidos do titular: como atender (a exportação e a anonimização ficam na ficha da pessoa, no Cadastro) e o
//   registro do que já foi atendido, lido da trilha de alterações (`lgpd.anonimizar` e `lgpd.exportar`, sem dado
//   pessoal: motivo e contagens).
// - Retenção: a rotina diária de prazos (só o síndico).
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useApi } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { Cel, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { ErroCarregar } from '../../components/Carregando';
import { ContagemResultado, lerOpcao, naUrl, useFiltrosUrl } from '../../components/Filtros';
import { ROTULO_PAPEL, type RegistroAlteracao } from '@portaria/domain/types';
import { fmtDataHora } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { CHAVES } from '../../app/consultas';
import { RetencaoLgpd } from './RetencaoLgpd';

const POR_PAGINA = 50;
const COLUNAS = '150px minmax(0,1fr) 120px minmax(0,1.6fr)';
const TIPOS = { anonimizacoes: 'lgpd.anonimizar', exportacoes: 'lgpd.exportar' } as const;
type TipoPedido = keyof typeof TIPOS;

/** Rótulos das contagens que a exportação grava na trilha (só números). */
const ITENS_EXPORTACAO: Record<string, [string, string]> = {
  vinculos: ['vínculo', 'vínculos'], veiculos: ['veículo', 'veículos'], eventos: ['acesso', 'acessos'],
  encomendas: ['encomenda', 'encomendas'], documentos: ['documento', 'documentos'], ocorrencias: ['ocorrência', 'ocorrências'],
  restricoes: ['restrição', 'restrições'], autorizacoesPrevias: ['autorização prévia', 'autorizações prévias'],
};

function detalhe(r: RegistroAlteracao): string {
  const d = r.depois ?? {};
  if (r.acao === TIPOS.anonimizacoes) {
    const motivo = typeof d.motivo === 'string' && d.motivo.trim() ? d.motivo.trim() : 'sem motivo registrado';
    return `Motivo: ${motivo}${d.reaplicacao ? ' (refeita após restaurar backup)' : ''}`;
  }
  const partes = Object.entries(ITENS_EXPORTACAO)
    .map(([k, [um, varios]]) => (typeof d[k] === 'number' && (d[k] as number) > 0 ? `${d[k]} ${(d[k] as number) === 1 ? um : varios}` : null))
    .filter(Boolean);
  return partes.length ? `Entregue: ${partes.join(', ')}` : 'Entregue: só o cadastro';
}

function PedidosTitular() {
  const api = useApi();
  const { params, gravar } = useFiltrosUrl();
  const tipo = lerOpcao(params.get('tipo'), ['anonimizacoes', 'exportacoes'] as const, 'anonimizacoes') as TipoPedido;
  const lista = useInfiniteQuery({
    queryKey: CHAVES.alteracoes(TIPOS[tipo]),
    queryFn: ({ pageParam }) => api.auditoria.alteracoesPagina({ acao: TIPOS[tipo], cursor: pageParam, limite: POR_PAGINA }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
  });
  const itens = useMemo(() => (lista.data?.pages ?? []).flatMap((p) => p.itens), [lista.data]);
  const pilula = (on: boolean) => `h-[44px] rounded-full border px-[14px] text-[14px] font-medium md:h-9 ${on ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`;

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="como-atender" className="flex flex-col gap-3 rounded-[10px] border border-[#DCE1E5] bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="como-atender" className="text-[16px] font-semibold">Como atender um pedido do titular</h2>
            <p className="max-w-[760px] text-[13px] text-[#56616B]">
              Morador, visitante ou prestador pode pedir a cópia dos próprios dados ou a anonimização (LGPD, art. 18). A resposta
              completa deve sair em até 15 dias do pedido (art. 19, II).
            </p>
          </div>
          <Link to="/cadastro" className="inline-flex h-[44px] shrink-0 items-center rounded-lg bg-[#0B5563] px-4 text-[14px] font-semibold !text-white hover:bg-[#08434E] lg:h-10">
            Buscar a pessoa no Cadastro
          </Link>
        </div>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-[14px] text-[#33424B]">
          <li>Confira a identidade de quem pede (documento com foto). Pedido de terceiro só com procuração.</li>
          <li>Abra a ficha da pessoa em Cadastro de pessoas.</li>
          <li><strong>Exportar dados</strong> gera o arquivo para entregar ao titular. <strong>Anonimizar</strong> (só o síndico) apaga nome, documento, telefone e foto, e não pode ser desfeito.</li>
          <li>Acessos e alterações continuam guardados por 3 anos, sem a identidade da pessoa: o condomínio precisa deles para se defender (exercício regular de direitos, art. 7º, VI).</li>
        </ol>
      </section>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[16px] font-semibold">Pedidos atendidos</h2>
          <div role="radiogroup" aria-label="Tipo de pedido" className="flex flex-wrap gap-1.5">
            <button type="button" role="radio" aria-checked={tipo === 'anonimizacoes'} className={pilula(tipo === 'anonimizacoes')} onClick={() => gravar({ tipo: naUrl('anonimizacoes', 'anonimizacoes') })}>Anonimizações</button>
            <button type="button" role="radio" aria-checked={tipo === 'exportacoes'} className={pilula(tipo === 'exportacoes')} onClick={() => gravar({ tipo: naUrl('exportacoes', 'anonimizacoes') })}>Exportações</button>
          </div>
        </div>
        {lista.error && <ErroCarregar mensagem={mensagemErro(lista.error)} onTentar={() => lista.refetch()} />}
        {!lista.isLoading && !lista.error && itens.length > 0 && <ContagemResultado n={itens.length} singular="registro" plural="registros" sufixo={lista.hasNextPage ? 'carregados · mais recentes primeiro' : '· mais recentes primeiro'} className="px-1" />}
        <Lista legenda={tipo === 'anonimizacoes' ? 'Anonimizações feitas' : 'Exportações feitas'} colunas={COLUNAS} empilhar carregando={lista.isLoading}>
          <ListaCab padY={10} rotulos={['Data e hora', 'Quem fez', 'Registro', 'Detalhe']} />
          {itens.map((r) => (
            <ListaLinha key={r.id} minH={48}>
              <Cel className="font-mono text-[14px]">{fmtDataHora(r.em)}</Cel>
              <Cel className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{r.usuarioNome}</span>
                <span className="text-[13px] text-[#56616B]">{r.usuarioPapel ? ROTULO_PAPEL[r.usuarioPapel] : '—'}</span>
              </Cel>
              {/* Só o id: depois de anonimizada, a pessoa não tem mais nome */}
              <Cel className="font-mono text-[13px] text-[#56616B]" >{r.registroId.slice(0, 8)}</Cel>
              <Cel className="col-span-2 text-[14px] [overflow-wrap:anywhere] md:col-span-1">{detalhe(r)}</Cel>
            </ListaLinha>
          ))}
        </Lista>
        {!lista.isPending && !lista.error && itens.length === 0 && (
          <Vazio>{tipo === 'anonimizacoes' ? 'Nenhuma anonimização feita até agora.' : 'Nenhuma exportação feita até agora.'}</Vazio>
        )}
        {lista.hasNextPage && <div><Button carregando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>Carregar mais</Button></div>}
      </div>
    </div>
  );
}

export function PrivacidadePage() {
  const podeRetencao = useCan('lgpd.retencao');
  const { params, gravar } = useFiltrosUrl();
  const abaUrl = lerOpcao(params.get('aba'), ['pedidos', 'retencao'] as const, 'pedidos');
  const aba = abaUrl === 'retencao' && !podeRetencao ? 'pedidos' : abaUrl;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader titulo="Privacidade (LGPD)" descricao="Pedidos dos titulares de dados e prazos de guarda do condomínio." />
      <Tabs rotulo="Privacidade" ativa={aba} onChange={(a) => gravar({ aba: naUrl(a, 'pedidos'), tipo: undefined })}
        abas={[
          { id: 'pedidos' as const, rotulo: 'Pedidos do titular' },
          ...(podeRetencao ? [{ id: 'retencao' as const, rotulo: 'Retenção' }] : []),
        ]} />
      {aba === 'retencao' ? <RetencaoLgpd /> : <PedidosTitular />}
    </div>
  );
}
