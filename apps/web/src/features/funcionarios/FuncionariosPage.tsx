import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi, type FuncionarioView } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import type { Escala } from '@portaria/domain/types';
import { descreverJanela, hhmmAtravessaMeiaNoite, validarEscala } from './escala';
import { DIAS_SEMANA_ABREV } from '@portaria/domain/time';
import { formatarTelefone } from '@portaria/domain/cpf';
import { mensagemErro } from '../../app/useAsync';
import { APOS_FUNCIONARIO, CHAVES, useInvalidar } from '../../app/consultas';

const COLUNAS = 'minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.3fr) 150px 120px';
const ESCALA_PADRAO: Escala = { diasSemana: [1, 2, 3, 4, 5], horaInicio: '07:00', horaFim: '16:00' };

/** RF-09: funcionários do condomínio (pessoa + função + escala). Entram pelo meio "Escala" no horário da escala. */
export function FuncionariosPage() {
  const api = useApi();
  const { avisar } = useToast();
  const podeGerenciar = useCan('funcionario.gerenciar');
  const invalidar = useInvalidar();
  const lista = useQuery({ queryKey: CHAVES.funcionarios, queryFn: () => api.funcionarios.listar() });
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<FuncionarioView | null>(null);
  const dados = lista.data ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Funcionários" descricao="Funcionários do condomínio entram por Escala, só nos dias e horários cadastrados. Turno que atravessa a meia-noite vale no dia do início."
        acoes={podeGerenciar && <Button variante="primario" onClick={() => setNovo(true)}>Novo funcionário</Button>} />
      {lista.error && <Alert tom="vermelho" role="alert">{mensagemErro(lista.error)}</Alert>}
      <Lista legenda="Funcionários do condomínio" colunas={COLUNAS} empilhar>
        <ListaCab rotulos={['Nome', 'Função', 'Escala', 'Situação', '']} />
        {dados.map((f) => (
          <ListaLinha key={f.pessoaId} minH={56} padY={8}>
            <Cel className="flex flex-col"><span className="font-medium">{f.pessoa.nome}</span><span className="font-mono text-[13px] text-[#56616B]">{f.pessoa.documentoMascarado} · {f.pessoa.telefone ? formatarTelefone(f.pessoa.telefone) : f.pessoa.telefoneMascarado ?? '—'}</span></Cel>
            <Cel className="text-[14px]">{f.funcao}</Cel>
            <Cel className="text-[14px]">{descreverJanela(f.escala)}{hhmmAtravessaMeiaNoite(f.escala) ? ' (atravessa a meia-noite)' : ''}</Cel>
            <Cel className="flex flex-wrap gap-1">
              <Badge tom={f.ativo ? 'verde' : 'neutro'} tamanho="sm">{f.ativo ? 'Ativo' : 'Inativo'}</Badge>
              {f.ativo && f.emEscalaAgora && <Badge tom="petroleo" tamanho="sm">Em escala agora</Badge>}
            </Cel>
            <Cel className="col-span-2 md:col-span-1">{podeGerenciar && <Button pequeno aria-label={`Editar ${f.pessoa.nome}`} onClick={() => setEditando(f)}>Editar</Button>}</Cel>
          </ListaLinha>
        ))}
        {!lista.isLoading && dados.length === 0 && <Vazio>Nenhum funcionário cadastrado.</Vazio>}
      </Lista>
      {novo && <FuncionarioModal onClose={() => setNovo(false)} onFeito={(f) => { setNovo(false); avisar({ texto: `${f.pessoa.nome} cadastrado(a) como ${f.funcao}.` }); void invalidar(APOS_FUNCIONARIO); }} />}
      {editando && <FuncionarioModal atual={editando} onClose={() => setEditando(null)} onFeito={(f) => { setEditando(null); avisar({ texto: `Cadastro de ${f.pessoa.nome} atualizado.` }); void invalidar(APOS_FUNCIONARIO); }} />}
    </div>
  );
}

function FuncionarioModal({ atual, onClose, onFeito }: { atual?: FuncionarioView; onClose: () => void; onFeito: (f: FuncionarioView) => void }) {
  const api = useApi();
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [funcao, setFuncao] = useState(atual?.funcao ?? '');
  const [escala, setEscala] = useState<Escala>(atual?.escala ?? ESCALA_PADRAO);
  const [ativo, setAtivo] = useState(atual?.ativo ?? true);
  const [erro, setErro] = useState('');
  const erroEscala = validarEscala(escala);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      onFeito(atual
        ? await api.funcionarios.editar({ pessoaId: atual.pessoaId, funcao, escala, ativo })
        : await api.funcionarios.criar({ nome, documento: cpf, telefone, funcao, escala, ativo }));
    } catch (err) { setErro(mensagemErro(err)); }
  }
  const dia = (i: number) => escala.diasSemana.includes(i);
  return (
    <Modal titulo={atual ? `Editar ${atual.pessoa.nome}` : 'Novo funcionário'} largura={640} gap={14} onClose={onClose}
      rodape={<><Button type="submit" form="f-func" variante="primario" grande className="flex-1">{atual ? 'Salvar' : 'Cadastrar funcionário'}</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <form id="f-func" onSubmit={salvar} className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        {!atual && (
          <>
            <Field label="Nome completo" className="sm:col-span-2"><input data-autofocus className="input" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
            <Field label="CPF" dica="Obrigatório; guardado mascarado."><input className="input font-mono" inputMode="numeric" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} /></Field>
            <Field label="Telefone"><input className="input" inputMode="tel" placeholder="(11) 9____-____" value={telefone} onChange={(e) => setTelefone(e.target.value)} /></Field>
          </>
        )}
        <Field label="Função" className="sm:col-span-2"><input {...(atual ? { 'data-autofocus': true } : {})} className="input" value={funcao} onChange={(e) => setFuncao(e.target.value)} placeholder="Zelador, vigia, jardineiro…" /></Field>
        <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-[14px] font-medium">Dias da escala</legend>
          <div className="flex flex-wrap gap-2">{DIAS_SEMANA_ABREV.map((n, i) => (
            <label key={n} className={`flex h-[44px] cursor-pointer items-center gap-1.5 rounded-full border px-3 lg:h-10 text-[14px] ${dia(i) ? 'border-[#0B5563] bg-[#E3F0F2]' : 'border-[#B9C3CA] bg-white'}`}>
              <input type="checkbox" checked={dia(i)} onChange={(e) => setEscala({ ...escala, diasSemana: e.target.checked ? [...escala.diasSemana, i].sort() : escala.diasSemana.filter((x) => x !== i) })} />{n}
            </label>))}</div>
        </fieldset>
        <Field label="Início do turno"><input type="time" className="input" value={escala.horaInicio} onChange={(e) => setEscala({ ...escala, horaInicio: e.target.value })} /></Field>
        <Field label="Fim do turno" dica={hhmmAtravessaMeiaNoite(escala) ? 'Atravessa a meia-noite: a madrugada conta como o dia do início.' : undefined}>
          <input type="time" className="input" value={escala.horaFim} onChange={(e) => setEscala({ ...escala, horaFim: e.target.value })} />
        </Field>
        <label className="sm:col-span-2 flex cursor-pointer items-center gap-3 rounded-lg border border-[#B9C3CA] p-3">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span><span className="font-medium">Ativo</span><span className="block text-[13px] text-[#56616B]">Inativo não entra por escala; o histórico é mantido.</span></span>
        </label>
        {erroEscala && <Alert tom="ambar" className="sm:col-span-2">{erroEscala}</Alert>}
        {erro && <Alert tom="vermelho" role="alert" className="sm:col-span-2">{erro}</Alert>}
      </form>
    </Modal>
  );
}
