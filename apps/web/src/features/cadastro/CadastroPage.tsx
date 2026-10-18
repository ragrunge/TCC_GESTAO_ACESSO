import { useMemo, useState, type FormEvent } from 'react';
import { useApi, type NovaPessoaInput, type PessoaBusca, type VinculoView } from '../../api';
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
import { mensagemErro, useAsync } from '../../app/useAsync';
import { FichaPessoaModal } from './FichaPessoaModal';

const LIMITE = 100;
const COLUNAS = 'minmax(0,1.4fr) minmax(0,1fr) 100px 170px';
const PRIORIDADE = ['aprovado', 'legado', 'pendente', 'rejeitado', 'encerrado'];

/** Vínculo que melhor representa a pessoa na lista (aprovado antes de legado, pendente...). */
function vinculoPrincipal(vs: VinculoView[]): VinculoView | undefined {
  return [...vs].sort((a, b) => PRIORIDADE.indexOf(a.status) - PRIORIDADE.indexOf(b.status))[0];
}

export function CadastroPage() {
  const api = useApi();
  const { avisar } = useToast();
  const podeCriar = useCan('pessoa.cadastrar_morador');
  const lista = useAsync(() => api.pessoas.listar(), []);
  const vinculos = useAsync(() => api.vinculos.listar(), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'todas' | CategoriaPessoa>('todas');
  const [ficha, setFicha] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  const porPessoa = useMemo(() => {
    const m = new Map<string, VinculoView[]>();
    for (const v of vinculos.data ?? []) m.set(v.pessoaId, [...(m.get(v.pessoaId) ?? []), v]);
    return m;
  }, [vinculos.data]);

  const filtrada = useMemo(() => {
    const nq = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return (lista.data ?? []).filter((p) => (cat === 'todas' || p.categoria === cat)
      && (!nq || p.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(nq) || p.documentoMascarado.includes(q.trim()) || p.unidadesVinculadasCodigos.some((u) => u.toLowerCase().includes(nq))));
  }, [lista.data, q, cat]);

  function linhaDe(p: PessoaBusca) {
    const v = vinculoPrincipal(porPessoa.get(p.id) ?? []);
    return {
      tipo: v ? ROTULO_VINCULO[v.tipo] : ROTULO_CATEGORIA[p.categoria],
      unidade: v?.unidadeId ?? p.unidadesVinculadas[0] ?? null,
      status: v ? <SeloVinculo status={v.status} /> : <Badge tom="neutro">{ROTULO_CATEGORIA[p.categoria]}</Badge>,
    };
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Pessoas" descricao="Moradores com vínculo e pessoas cadastradas na portaria. Clique para abrir a ficha da pessoa."
        acoes={podeCriar && <Button variante="primario" onClick={() => setNovo(true)}>Nova pessoa</Button>} />
      <div className="flex items-end gap-3">
        <Field label="Buscar por nome, documento ou unidade" className="w-96"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <Field label="Tipo"><select className="input" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)}>
          <option value="todas">Todos</option>{(Object.keys(ROTULO_CATEGORIA) as CategoriaPessoa[]).map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}
        </select></Field>
        <p className="pb-2.5 text-[14px] text-[#56616B]">{filtrada.length} pessoa(s)</p>
      </div>
      {lista.error && <Alert tom="vermelho" role="alert">{lista.error}</Alert>}
      <Lista legenda="Pessoas cadastradas" colunas={COLUNAS}>
        <ListaCab rotulos={['Nome', 'Vínculo ou tipo', 'Unidade', 'Status']} />
        {filtrada.slice(0, LIMITE).map((p) => {
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
        {!lista.loading && filtrada.length === 0 && <Vazio>Nenhuma pessoa encontrada.</Vazio>}
      </Lista>
      {filtrada.length > LIMITE && <p className="text-[#56616B]">Mostrando {LIMITE} de {filtrada.length}. Refine a busca.</p>}
      {ficha && <FichaPessoaModal id={ficha} onClose={() => setFicha(null)} />}
      {novo && <NovaPessoaModal onClose={() => setNovo(false)} onFeito={(n) => { setNovo(false); avisar({ texto: `${n} cadastrado(a).` }); void lista.recarregar(); }} />}
    </div>
  );
}

function NovaPessoaModal({ onClose, onFeito }: { onClose: () => void; onFeito: (nome: string) => void }) {
  const api = useApi();
  const [f, setF] = useState<NovaPessoaInput>({ nome: '', documento: '', telefone: '', categoria: 'morador', semCpf: false });
  const [erro, setErro] = useState('');
  async function salvar(e: FormEvent) {
    e.preventDefault();
    try { const p = await api.pessoas.criar(f); onFeito(p.nome); } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <Modal titulo="Nova pessoa" largura={560} gap={14} onClose={onClose}
      rodape={<><Button type="submit" form="f-pessoa" variante="primario" grande className="flex-1">Cadastrar</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <form id="f-pessoa" onSubmit={salvar} className="grid grid-cols-2 gap-[14px]">
        <Field label="Nome completo" className="col-span-2"><input data-autofocus className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
        <Field label="CPF" dica="Só o CPF é aceito. Fica guardado mascarado, com um hash para busca.">
          <input className="input font-mono" inputMode="numeric" placeholder="000.000.000-00" disabled={f.semCpf} required={!f.semCpf} value={f.documento ?? ''} onChange={(e) => setF({ ...f, documento: e.target.value })} />
        </Field>
        <Field label="Telefone (obrigatório)"><input className="input" inputMode="tel" required placeholder="(11) 9____-____" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></Field>
        <Field label="Tipo"><select className="input" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value as CategoriaPessoa, semCpf: e.target.value === 'morador' ? false : f.semCpf })}><option value="morador">Morador</option><option value="visitante">Visitante</option><option value="prestador">Prestador</option></select></Field>
        {f.categoria === 'prestador' && <><Field label="Empresa"><input className="input" value={f.empresa ?? ''} onChange={(e) => setF({ ...f, empresa: e.target.value })} /></Field><Field label="Serviço"><input className="input" value={f.servico ?? ''} onChange={(e) => setF({ ...f, servico: e.target.value })} /></Field></>}
        {f.categoria !== 'morador' && (
          <label className="col-span-2 flex cursor-pointer items-start gap-3 rounded-lg border border-[#B9C3CA] p-3">
            <input type="checkbox" className="mt-1" checked={!!f.semCpf} onChange={(e) => setF({ ...f, semCpf: e.target.checked, documento: '' })} />
            <span><span className="font-medium">Pessoa sem CPF</span><span className="block text-[13px] text-[#56616B]">Exceção: só entra por exceção do porteiro, com justificativa. Nome e telefone continuam obrigatórios.</span></span>
          </label>
        )}
        <div className="col-span-2 rounded-lg bg-[#E3F0F2] px-3 py-[10px] text-[14px] text-[#0B4450]">Morador cadastrado aqui ainda não tem acesso: peça o vínculo na tela da unidade. Foto é opcional e a recusa não impede o cadastro (RN-10).</div>
        {erro && <Alert tom="vermelho" role="alert" className="col-span-2">{erro}</Alert>}
      </form>
    </Modal>
  );
}
