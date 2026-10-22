import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useApi, type NovaPessoaInput, type PessoaBusca, type PessoaLista } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, ROTULO_VINCULO, type CategoriaPessoa } from '@portaria/domain/types';
import { mensagemErro } from '../../app/useAsync';
import { APOS_PESSOA, CHAVES, useDebounce, useInvalidar } from '../../app/consultas';
import { FichaPessoaModal } from './FichaPessoaModal';

const POR_PAGINA = 50;
/** Busca da tela: até 50 resultados (texto livre vai no corpo do POST, nunca na URL: pode ser CPF). */
const LIMITE_BUSCA = 50;
const COLUNAS = 'minmax(0,1.4fr) minmax(0,1fr) 100px 170px';

export function CadastroPage() {
  const api = useApi();
  const { avisar } = useToast();
  const podeCriar = useCan('pessoa.cadastrar_morador');
  const invalidar = useInvalidar();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'todas' | CategoriaPessoa>('todas');
  const [ficha, setFicha] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const termo = useDebounce(q.trim(), 200);
  const buscando = termo.length >= 2;

  // Sem texto: a lista inteira, paginada no servidor (categoria filtra lá).
  const lista = useInfiniteQuery({
    queryKey: CHAVES.pessoasLista(cat),
    queryFn: ({ pageParam }) => api.pessoas.listarPagina({ categoria: cat === 'todas' ? undefined : cat, cursor: pageParam, limite: POR_PAGINA }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => (p.temMais && p.cursor ? p.cursor : undefined),
    enabled: !buscando,
    staleTime: 0,
  });
  // Com texto: a mesma busca da portaria (nome, CPF, unidade, placa); a categoria filtra o resultado.
  const busca = useQuery({
    queryKey: CHAVES.pessoasBusca(termo),
    queryFn: () => api.pessoas.buscar(termo, { limite: LIMITE_BUSCA }),
    enabled: buscando,
    staleTime: 0,
    gcTime: 30_000,
  });

  const linhas: (PessoaBusca | PessoaLista)[] = buscando
    ? (busca.data ?? []).filter((p) => cat === 'todas' || p.categoria === cat)
    : (lista.data?.pages.flatMap((p) => p.itens) ?? []);
  const carregando = buscando ? busca.isLoading : lista.isLoading;
  const erro = buscando ? busca.error : lista.error;

  function linhaDe(p: PessoaBusca | PessoaLista) {
    const v = 'vinculoPrincipal' in p ? p.vinculoPrincipal : null;
    return {
      tipo: v ? ROTULO_VINCULO[v.tipo] : ROTULO_CATEGORIA[p.categoria],
      unidade: v?.unidadeId ?? p.unidadesVinculadas[0] ?? null,
      status: v ? <SeloVinculo status={v.status} /> : <Badge tom="neutro">{ROTULO_CATEGORIA[p.categoria]}</Badge>,
    };
  }

  const contagem = buscando
    ? `${linhas.length} pessoa(s)${(busca.data?.length ?? 0) >= LIMITE_BUSCA ? ' (refine a busca)' : ''}`
    : `${linhas.length} pessoa(s)${lista.hasNextPage ? ' carregada(s)' : ''}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Pessoas" descricao="Moradores com vínculo e pessoas cadastradas na portaria. Clique para abrir a ficha da pessoa."
        acoes={podeCriar && <Button variante="primario" onClick={() => setNovo(true)}>Nova pessoa</Button>} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Buscar por nome, documento ou unidade" className="w-full sm:w-96"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="Tipo"><select className="input" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)}>
          <option value="todas">Todos</option>{(Object.keys(ROTULO_CATEGORIA) as CategoriaPessoa[]).map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}
        </select></Field>
        <p className="pb-2.5 text-[14px] text-[#56616B]" aria-live="polite">{contagem}</p>
      </div>
      {erro && <Alert tom="vermelho" role="alert">{mensagemErro(erro)}</Alert>}
      <Lista legenda="Pessoas cadastradas" colunas={COLUNAS} empilhar>
        <ListaCab rotulos={['Nome', 'Vínculo ou tipo', 'Unidade', 'Status']} />
        {linhas.map((p) => {
          const l = linhaDe(p);
          return (
            <ListaLinha key={p.id} padY={8} onClick={() => setFicha(p.id)} ariaLabel={`Abrir ficha de ${p.nome}`}>
              <Cel className="truncate font-medium">{p.nome}</Cel>
              <Cel className="text-[14px]">{l.tipo}</Cel>
              <CelUnidade id={l.unidade} />
              <Cel>{l.status}</Cel>
            </ListaLinha>
          );
        })}
        {!carregando && linhas.length === 0 && <Vazio>Nenhuma pessoa encontrada.</Vazio>}
      </Lista>
      {!buscando && lista.hasNextPage && (
        <Button className="self-start" carregando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>Carregar mais</Button>
      )}
      {ficha && <FichaPessoaModal id={ficha} onClose={() => setFicha(null)} />}
      {novo && <NovaPessoaModal onClose={() => setNovo(false)} onFeito={(n) => { setNovo(false); avisar({ texto: `${n} cadastrado(a).` }); void invalidar(APOS_PESSOA); }} />}
    </div>
  );
}

function NovaPessoaModal({ onClose, onFeito }: { onClose: () => void; onFeito: (nome: string) => void }) {
  const api = useApi();
  const [f, setF] = useState<NovaPessoaInput>({ nome: '', documento: '', telefone: '', categoria: 'morador', semCpf: false, menorIdade: false });
  const [erro, setErro] = useState('');
  const criar = useMutation({ mutationFn: (i: NovaPessoaInput) => api.pessoas.criar(i) });
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try { const p = await criar.mutateAsync(f); onFeito(p.nome); } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <Modal titulo="Nova pessoa" largura={560} gap={14} onClose={onClose}
      rodape={<><Button type="submit" form="f-pessoa" variante="primario" grande className="flex-1">Cadastrar</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <form id="f-pessoa" onSubmit={salvar} className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        <Field label="Nome completo" className="sm:col-span-2"><input data-autofocus className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
        <Field label={f.menorIdade ? 'CPF (opcional para menor)' : 'CPF'} dica="Só o CPF é aceito. Fica guardado mascarado, com um hash para busca.">
          <input className="input font-mono" inputMode="numeric" placeholder="000.000.000-00" disabled={f.semCpf} required={!f.semCpf && !f.menorIdade} value={f.documento ?? ''} onChange={(e) => setF({ ...f, documento: e.target.value })} />
        </Field>
        <Field label={f.menorIdade ? 'Telefone (opcional para menor)' : 'Telefone (obrigatório)'}><input className="input" inputMode="tel" required={!f.menorIdade} placeholder="(11) 9____-____" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></Field>
        <Field label="Tipo"><select className="input" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value as CategoriaPessoa, semCpf: e.target.value === 'morador' ? false : f.semCpf, menorIdade: e.target.value === 'morador' ? f.menorIdade : false })}><option value="morador">Morador</option><option value="visitante">Visitante</option><option value="prestador">Prestador</option></select></Field>
        {f.categoria === 'prestador' && <><Field label="Empresa"><input className="input" value={f.empresa ?? ''} onChange={(e) => setF({ ...f, empresa: e.target.value })} /></Field><Field label="Serviço"><input className="input" value={f.servico ?? ''} onChange={(e) => setF({ ...f, servico: e.target.value })} /></Field></>}
        {f.categoria === 'morador' && (
          <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-lg border border-[#B9C3CA] p-3">
            <input type="checkbox" className="mt-1" checked={!!f.menorIdade} onChange={(e) => setF({ ...f, menorIdade: e.target.checked })} />
            <span><span className="font-medium">Dependente menor de idade</span><span className="block text-[13px] text-[#56616B]">Documento e telefone ficam opcionais (LGPD, art. 14). Vale para o vínculo de dependente; proprietário e inquilino continuam exigindo os dois.</span></span>
          </label>
        )}
        {f.categoria !== 'morador' && (
          <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-lg border border-[#B9C3CA] p-3">
            <input type="checkbox" className="mt-1" checked={!!f.semCpf} onChange={(e) => setF({ ...f, semCpf: e.target.checked, documento: '' })} />
            <span><span className="font-medium">Pessoa sem CPF</span><span className="block text-[13px] text-[#56616B]">Exceção: só entra por exceção do porteiro, com justificativa. Nome e telefone continuam obrigatórios.</span></span>
          </label>
        )}
        <div className="sm:col-span-2 rounded-lg bg-[#E3F0F2] px-3 py-[10px] text-[14px] text-[#0B4450]">Morador cadastrado aqui ainda não tem acesso: peça o vínculo na tela da unidade. Foto é opcional e a recusa não impede o cadastro (RN-10).</div>
        {erro && <Alert tom="vermelho" role="alert" className="sm:col-span-2">{erro}</Alert>}
      </form>
    </Modal>
  );
}
