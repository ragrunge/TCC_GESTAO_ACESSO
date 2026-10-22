import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useApi, type ResultadoAnonimizacao } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Avatar } from '../../components/UnitTag';
import { ROTULO_CATEGORIA, ROTULO_VINCULO, type Pessoa } from '@portaria/domain/types';
import { formatarTelefone } from '@portaria/domain/cpf';
import { agora, fmtData, fmtDataHora } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { APOS_LGPD, APOS_PESSOA, CHAVES, useInvalidar } from '../../app/consultas';
import { chipDoEvento, quandoCurto, textoAutorizacao } from '../common/evento';
import { baixarArquivo } from '../historico/download';

/**
 * Ficha da pessoa. Para síndico e administração: correção do cadastro (LGPD art. 18 e RN-09), exportação dos dados do
 * titular (spec 9.3). Para o síndico: anonimização a pedido (art. 18, VI). A API decide; a UI só oculta.
 */
export function FichaPessoaModal({ id, onClose }: { id: string; onClose: () => void }) {
  const api = useApi();
  const { avisar } = useToast();
  const podeEditar = useCan('pessoa.editar');
  const podeExportar = useCan('lgpd.exportar');
  const podeAnonimizar = useCan('lgpd.anonimizar');
  const invalidar = useInvalidar();
  const ficha = useQuery({ queryKey: CHAVES.ficha(id), queryFn: () => api.pessoas.ficha(id), staleTime: 0 });
  const [editando, setEditando] = useState(false);
  const [anonimizando, setAnonimizando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoAnonimizacao | null>(null);
  const [erro, setErro] = useState('');
  const f = ficha.data;
  const anonimizada = !!f?.pessoa.anonimizadaEm;

  async function exportar() {
    try {
      const p = await api.lgpd.exportarPessoa(id);
      baixarArquivo(p.nomeArquivo, p.conteudo, 'application/json');
      avisar({ titulo: 'Dados exportados', texto: `Arquivo ${p.nomeArquivo} gerado. A exportação fica registrada na trilha.` });
      void invalidar([['auditoria', 'alteracoes']]); // a exportação entra na trilha (lgpd.exportar)
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }
  async function anonimizar() {
    setErro('');
    try {
      const r = await api.lgpd.anonimizar(id);
      setResultado(r); setAnonimizando(false);
      avisar({ tom: 'ambar', titulo: 'Pessoa anonimizada', texto: `Dados pessoais removidos; ${r.registrosRedigidos} registro(s) da trilha redigido(s).` });
      void invalidar(APOS_LGPD);
    } catch (e) { setErro(mensagemErro(e)); }
  }

  return (
    <Modal titulo="Ficha da pessoa" largura={720} onClose={onClose} rodape={<>
      {f && !anonimizada && podeEditar && !editando && <Button onClick={() => setEditando(true)}>Editar cadastro</Button>}
      {f && podeExportar && <Button onClick={() => void exportar()}>Exportar dados (LGPD)</Button>}
      {f && !anonimizada && podeAnonimizar && !anonimizando && <Button variante="perigo" onClick={() => { setAnonimizando(true); setErro(''); }}>Anonimizar…</Button>}
      <Button className="ml-auto" data-autofocus onClick={onClose}>Fechar</Button>
    </>}>
      {ficha.error && <Alert tom="vermelho" role="alert">{mensagemErro(ficha.error)}</Alert>}
      {f && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-[14px]">
            <Avatar nome={f.pessoa.nome} tamanho={44} />
            <div className="min-w-0 flex-1">
              <p className="text-[18px] font-semibold">{f.pessoa.nome}</p>
              <p className="text-[14px] text-[#33424B]"><span className="font-mono">{f.pessoa.documentoMascarado}</span>{f.pessoa.telefone ? <> · {formatarTelefone(f.pessoa.telefone)}</> : f.pessoa.telefoneMascarado ? <> · {f.pessoa.telefoneMascarado}</> : null}{f.pessoa.empresa && <> · {f.pessoa.empresa}{f.pessoa.servico ? ` (${f.pessoa.servico})` : ''}</>}</p>
            </div>
            <Badge tom="neutro">{ROTULO_CATEGORIA[f.pessoa.categoria]}</Badge>
          </div>
          {anonimizada && <Alert tom="neutro" role="status">Cadastro anonimizado em {fmtDataHora(f.pessoa.anonimizadaEm!)}. Os eventos de acesso continuam na trilha só pelo id, até o fim do prazo de retenção.</Alert>}
          {resultado && (
            <Alert tom="ambar" titulo="O que fica retido" role="status">
              {resultado.eventosRetidos !== undefined && (
                <p className="mb-1">
                  {resultado.eventosRetidos === 0 ? 'Nenhum evento de acesso desta pessoa fica retido.'
                    : <>{resultado.eventosRetidos} evento(s) de acesso ficam retidos só pelo id{resultado.retidoAte ? <> até {fmtData(resultado.retidoAte)}</> : null}.</>}
                  {resultado.documentosEliminados ? <> {resultado.documentosEliminados} arquivo(s) da pessoa eliminado(s) do armazenamento.</> : null}
                </p>
              )}
              <ul className="list-disc pl-5">{resultado.retido.map((r) => <li key={r}>{r}</li>)}</ul>
            </Alert>
          )}
          {anonimizando && (
            <div className="flex flex-col gap-3 rounded-[10px] border-2 border-[#B42318] bg-[#FEF3F2] p-4 text-[#912018]">
              <p className="font-semibold">Anonimizar {f.pessoa.nome}? Nome, CPF, telefone, empresa e serviço serão removidos, e a trilha de alterações dessa pessoa será redigida. Não há como desfazer.</p>
              <p className="text-[14px]">O texto livre ligado a ela é substituído e o nome completo é trocado por “[anonimizado]” em encomendas, ocorrências e na trilha. Ficam retidos os eventos de acesso até completar 3 anos, por exercício regular de direitos, inclusive o texto livre deles (que faz parte do selo de integridade). Pessoa com vínculo válido não pode ser anonimizada.</p>
              {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
              <div className="flex flex-wrap gap-[10px]"><Button variante="perigo" onClick={() => void anonimizar()}>Confirmar anonimização</Button><Button onClick={() => setAnonimizando(false)}>Cancelar</Button></div>
            </div>
          )}
          {editando && <EditarCadastro pessoa={f.pessoa} onCancelar={() => setEditando(false)}
            onSalvo={() => { setEditando(false); avisar({ texto: 'Cadastro atualizado. Antes e depois ficam na trilha de alterações.' }); void invalidar(APOS_PESSOA); }} />}
          {f.funcionario && <Alert tom="petroleo">Funcionário do condomínio: {f.funcionario.funcao}. Escala {f.funcionario.escala.horaInicio}–{f.funcionario.escala.horaFim}.</Alert>}
          <section>
            <h3 className="mb-2 text-[15px] font-semibold">Vínculos com unidades</h3>
            {f.vinculos.length === 0 ? <p className="text-[#56616B]">Sem vínculos.</p> : (
              <div className="rounded-[10px] border border-[#DCE1E5]">
                {f.vinculos.map((v) => (
                  <div key={v.id} className="grid min-h-12 grid-cols-1 gap-1 sm:grid-cols-[100px_minmax(0,1fr)_120px] sm:items-center sm:gap-3 border-b border-[#EEF1F3] px-4 py-2 last:border-b-0">
                    <span className="font-mono font-semibold">{v.unidadeCodigo}</span><span className="text-[14px]">{ROTULO_VINCULO[v.tipo]}</span><SeloVinculo status={v.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-[15px] font-semibold">Últimos acessos</h3>
            {f.eventos === null ? (
              <p className="flex items-start gap-2 text-[14px] text-[#56616B]" role="note" aria-label="Últimos acessos: disponível em breve">
                <Info className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />Disponível em breve na API real.
              </p>
            ) : f.eventos.length === 0 ? <p className="text-[#56616B]">Sem acessos registrados.</p> : (
              <div className="rounded-[10px] border border-[#DCE1E5]" title={`Atualizado em ${fmtDataHora(agora())}`}>
                {f.eventos.map((e) => (
                  <div key={e.id} className="grid min-h-12 grid-cols-1 gap-1 sm:grid-cols-[110px_120px_minmax(0,1fr)] sm:items-center sm:gap-3 border-b border-[#EEF1F3] px-4 py-2 last:border-b-0">
                    <span className="font-mono text-[14px]">{quandoCurto(e.ocorridoEm, agora())}</span>
                    <span className="truncate font-mono font-semibold">{e.unidadeRotulo ?? '—'}</span>
                    <span className="flex min-w-0 items-center gap-2"><Badge tom={chipDoEvento(e).tom} icone={chipDoEvento(e).icone}>{chipDoEvento(e).texto}</Badge><span className="truncate text-[14px]">{textoAutorizacao(e)}</span></span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

/** Correção do cadastro (pessoa.editar): nome, telefone, CPF (tira de "sem CPF"), empresa e serviço. */
function EditarCadastro({ pessoa, onCancelar, onSalvo }: { pessoa: Pessoa; onCancelar: () => void; onSalvo: () => void }) {
  const api = useApi();
  const [nome, setNome] = useState(pessoa.nome);
  const [telefone, setTelefone] = useState(pessoa.telefone ? formatarTelefone(pessoa.telefone) : '');
  const [cpf, setCpf] = useState('');
  const [empresa, setEmpresa] = useState(pessoa.empresa ?? '');
  const [servico, setServico] = useState(pessoa.servico ?? '');
  const [deixouDeSerMenor, setDeixouDeSerMenor] = useState(false);
  const [erro, setErro] = useState('');
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      await api.pessoas.editar({
        // Telefone em branco não é enviado (importado sem telefone pode corrigir só o nome)
        id: pessoa.id, nome, ...(telefone.trim() ? { telefone } : {}), ...(cpf.trim() ? { documento: cpf } : {}),
        ...(pessoa.categoria === 'prestador' ? { empresa, servico } : {}),
        ...(pessoa.menorIdade && deixouDeSerMenor ? { menorIdade: false } : {}),
      });
      onSalvo();
    } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <form onSubmit={salvar} aria-label="Editar cadastro" className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 rounded-[10px] border border-[#DCE1E5] p-4">
      <Field label="Nome completo" className="sm:col-span-2"><input className="input" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
      <Field label={pessoa.semCpf ? 'CPF (informar tira a pessoa de “sem CPF”)' : 'Novo CPF (só para corrigir)'} dica={`Atual: ${pessoa.documentoMascarado}. O número não é guardado.`}>
        <input className="input font-mono" inputMode="numeric" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} />
      </Field>
      <Field label="Telefone"><input className="input" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} /></Field>
      {pessoa.menorIdade && (
        <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-lg border border-[#B9C3CA] p-3">
          <input type="checkbox" className="mt-1" checked={deixouDeSerMenor} onChange={(e) => setDeixouDeSerMenor(e.target.checked)} />
          <span><span className="font-medium">Deixou de ser menor de idade</span><span className="block text-[13px] text-[#56616B]">A partir daqui CPF e telefone passam a ser obrigatórios.</span></span>
        </label>
      )}
      {pessoa.categoria === 'prestador' && (
        <>
          <Field label="Empresa"><input className="input" value={empresa} onChange={(e) => setEmpresa(e.target.value)} /></Field>
          <Field label="Serviço"><input className="input" value={servico} onChange={(e) => setServico(e.target.value)} /></Field>
        </>
      )}
      {erro && <Alert tom="vermelho" role="alert" className="sm:col-span-2">{erro}</Alert>}
      <div className="flex flex-wrap gap-[10px] sm:col-span-2"><Button type="submit" variante="primario">Salvar correção</Button><Button onClick={onCancelar}>Cancelar</Button></div>
    </form>
  );
}
