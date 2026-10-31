import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi, type FuncionarioView } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { InputMascara } from '../../components/InputMascara';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { SeletorDias } from '../../components/SeletorDias';
import { Interruptor } from '../../components/Interruptor';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import type { Escala } from '@portaria/domain/types';
import { descreverJanela, hhmmAtravessaMeiaNoite, validarEscala } from './escala';
import { mensagemErro } from '../../app/useAsync';
import { APOS_FUNCIONARIO, CHAVES, useInvalidar } from '../../app/consultas';
import { ErroCarregar } from '../../components/Carregando';

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
      {lista.error && <ErroCarregar mensagem={mensagemErro(lista.error)} onTentar={() => lista.refetch()} />}
      <Lista legenda="Funcionários do condomínio" colunas={COLUNAS} empilhar carregando={lista.isLoading}>
        <ListaCab rotulos={['Nome', 'Função', 'Escala', 'Situação', '']} />
        {dados.map((f) => (
          <ListaLinha key={f.pessoaId} minH={56} padY={8}>
            <Cel className="flex flex-col"><span className="font-medium">{f.pessoa.nome}</span><span className="font-mono text-[13px] text-[#56616B]">{f.pessoa.documentoMascarado} · {f.pessoa.telefoneMascarado ?? '—'}</span></Cel>
            <Cel className="text-[14px]">{f.funcao}</Cel>
            <Cel className="text-[14px]">{descreverJanela(f.escala)}{hhmmAtravessaMeiaNoite(f.escala) ? ' (atravessa a meia-noite)' : ''}</Cel>
            <Cel className="flex flex-wrap gap-1">
              <Badge tom={f.ativo ? 'verde' : 'neutro'} tamanho="sm">{f.ativo ? 'Ativo' : 'Inativo'}</Badge>
              {f.ativo && f.emEscalaAgora && <Badge tom="petroleo" tamanho="sm">Em escala agora</Badge>}
            </Cel>
            <Cel className="col-span-2 md:col-span-1">{podeGerenciar && <Button pequeno aria-label={`Editar ${f.pessoa.nome}`} onClick={() => setEditando(f)}>Editar</Button>}</Cel>
          </ListaLinha>
        ))}
        {!lista.isLoading && !lista.error && dados.length === 0 && <Vazio>Nenhum funcionário cadastrado.</Vazio>}
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
  return (
    <Modal titulo={atual ? `Editar ${atual.pessoa.nome}` : 'Novo funcionário'} onClose={onClose}
      rodape={<><Button type="submit" form="f-func" variante="primario" grande className="flex-1">{atual ? 'Salvar' : 'Cadastrar funcionário'}</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <form id="f-func" onSubmit={salvar} className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        {!atual && (
          <>
            <Field label="Nome completo" className="sm:col-span-2"><input data-autofocus className="input" value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
            <Field label="CPF" dica="Obrigatório; guardado mascarado."><InputMascara tipo="cpf" className="input font-mono" value={cpf} onChange={setCpf} /></Field>
            <Field label="Telefone"><InputMascara tipo="telefone" value={telefone} onChange={setTelefone} /></Field>
          </>
        )}
        <Field label="Função" className="sm:col-span-2"><input {...(atual ? { 'data-autofocus': true } : {})} className="input" value={funcao} onChange={(e) => setFuncao(e.target.value)} placeholder="Zelador, vigia, jardineiro…" /></Field>
        <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-[14px] font-medium">Dias da escala</legend>
          <SeletorDias valor={escala.diasSemana} onChange={(d) => setEscala({ ...escala, diasSemana: d })} />
        </fieldset>
        {/* Turno com campos estreitos lado a lado (Claude Design); o aviso de meia-noite fica embaixo dos dois, não espremido em 140 px */}
        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-3">
            <Field label="Início do turno" className="w-[140px]"><input type="time" className="input font-mono" value={escala.horaInicio} onChange={(e) => setEscala({ ...escala, horaInicio: e.target.value })} /></Field>
            <Field label="Fim do turno" className="w-[140px]"><input type="time" className="input font-mono" value={escala.horaFim} onChange={(e) => setEscala({ ...escala, horaFim: e.target.value })} /></Field>
          </div>
          {hhmmAtravessaMeiaNoite(escala) && <p className="text-[13px] text-[#56616B]">Atravessa a meia-noite: a madrugada conta como o dia do início.</p>}
        </div>
        <Interruptor className="sm:col-span-2" ligado={ativo} onChange={setAtivo} rotulo="Ativo" dica="Inativo não entra por escala; o histórico é mantido." />
        {erroEscala && <Alert tom="ambar" className="sm:col-span-2">{erroEscala}</Alert>}
        {erro && <Alert tom="vermelho" role="alert" className="sm:col-span-2">{erro}</Alert>}
      </form>
    </Modal>
  );
}
