import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, useApi, type NovaPessoaInput } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { type Pessoa } from '@portaria/domain/types';
import { Alert } from '../../components/Alert';
import { InputMascara } from '../../components/InputMascara';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { type CategoriaPessoa } from '@portaria/domain/types';
import { mensagemErro } from '../../app/useAsync';
import { mascaraCpf } from '@portaria/domain/cpf';

export const ID_FORM_PESSOA = 'f-pessoa';

/** Termo buscado num seletor -> pré-preenchimento do cadastro: só dígitos (e pontuação de CPF) vão para o CPF; texto sem dígito, para o nome. */
export function prefillDoTermo(texto: string): { nome?: string; documento?: string } {
  const t = texto.trim();
  if (/^[\d.\-\s]+$/.test(t)) { const d = t.replace(/\D/g, ''); return d.length <= 11 ? { documento: d } : {}; }
  return /\d/.test(t) ? {} : { nome: t };
}

const AVISO_PADRAO = 'Morador cadastrado aqui ainda não tem acesso: peça o vínculo na tela da unidade.';

/**
 * 409 PESSOA_DUPLICADA com o id: a API só o devolve a quem já acharia a pessoa pela busca (ativa: pessoa.ver; desativada:
 * só quem pode reativar). Sem id (porteiro diante de um desativado), fica só a mensagem.
 */
function duplicataDe(err: unknown): { pessoaId: string; desativada: boolean } | null {
  if (!(err instanceof ApiError) || err.status !== 409 || err.code !== 'PESSOA_DUPLICADA') return null;
  const d = err.detalhes as { pessoaId?: unknown; desativada?: unknown } | undefined;
  return d && typeof d.pessoaId === 'string' ? { pessoaId: d.pessoaId, desativada: d.desativada === true } : null;
}

/**
 * Formulário de cadastro de pessoa (sem moldura): quem o usa põe o botão `type=submit form={ID_FORM_PESSOA}`.
 * `onExistente`: no CPF já cadastrado, oferece "Usar o cadastro existente" (ou "Reativar e usar", se desativado e o
 * perfil puder reativar) e entrega o id da pessoa a quem abriu o formulário (o seletor a escolhe; o Cadastro abre a ficha).
 */
export function NovaPessoaForm({ onFeito, nomeInicial, documentoInicial, aviso = AVISO_PADRAO, categoriaInicial = 'morador', onExistente, rotuloExistente = 'Usar o cadastro existente' }: {
  onFeito: (p: Pessoa) => void; nomeInicial?: string; /** Dígitos do CPF (o campo aplica a máscara). */ documentoInicial?: string; aviso?: ReactNode; categoriaInicial?: CategoriaPessoa;
  onExistente?: (pessoaId: string) => void | Promise<void>; rotuloExistente?: string;
}) {
  const api = useApi();
  const podeReativar = useCan('pessoa.desativar');
  const [f, setF] = useState<NovaPessoaInput>({ nome: nomeInicial ?? '', documento: documentoInicial ? mascaraCpf(documentoInicial) : '', telefone: '', categoria: categoriaInicial, semCpf: false, menorIdade: false });
  const [erro, setErro] = useState('');
  const [existente, setExistente] = useState<{ pessoaId: string; desativada: boolean } | null>(null);
  const [reativando, setReativando] = useState(false);
  const criar = useMutation({ mutationFn: (i: NovaPessoaInput) => api.pessoas.criar(i) });
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(''); setExistente(null);
    try { const p = await criar.mutateAsync(f); onFeito(p); } catch (err) { setErro(mensagemErro(err)); setExistente(duplicataDe(err)); }
  }
  async function usarExistente() {
    if (!existente || !onExistente) return;
    setReativando(true);
    try {
      if (existente.desativada) await api.pessoas.reativar(existente.pessoaId);
      await onExistente(existente.pessoaId);
    } catch (err) { setErro(mensagemErro(err)); setReativando(false); }
  }
  return (
    <form id={ID_FORM_PESSOA} onSubmit={salvar} className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        <Field label="Nome completo" className="sm:col-span-2"><input data-autofocus className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
        <Field label={f.menorIdade ? 'CPF (opcional para menor)' : 'CPF'} dica="Só o CPF é aceito. Fica guardado mascarado, com um hash para busca.">
          <InputMascara tipo="cpf" className="input font-mono" disabled={f.semCpf} required={!f.semCpf && !f.menorIdade} value={f.documento ?? ''} onChange={(documento) => setF({ ...f, documento })} />
        </Field>
        <Field label={f.menorIdade ? 'Telefone (opcional para menor)' : 'Telefone (obrigatório)'}><InputMascara tipo="telefone" required={!f.menorIdade} value={f.telefone} onChange={(telefone) => setF({ ...f, telefone })} /></Field>
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
        <div className="sm:col-span-2 rounded-lg bg-[#E3F0F2] px-3 py-[10px] text-[14px] text-[#0B4450]">{aviso}</div>
        {erro && <Alert tom="vermelho" role="alert" className="sm:col-span-2">{erro}</Alert>}
        {existente && onExistente && (!existente.desativada || podeReativar) && (
          <div className="sm:col-span-2"><Button carregando={reativando} onClick={() => void usarExistente()}>
            {existente.desativada ? `Reativar e ${rotuloExistente.charAt(0).toLowerCase()}${rotuloExistente.slice(1)}` : rotuloExistente}
          </Button></div>
        )}
      </form>
  );
}

export function NovaPessoaModal({ onClose, onFeito, onExistente }: { onClose: () => void; onFeito: (p: Pessoa) => void; onExistente?: (pessoaId: string) => void | Promise<void> }) {
  return (
    <Modal titulo="Nova pessoa" onClose={onClose}
      rodape={<><Button type="submit" form={ID_FORM_PESSOA} variante="primario" grande className="flex-1">Cadastrar</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <NovaPessoaForm onFeito={onFeito} onExistente={onExistente} rotuloExistente="Abrir o cadastro existente" />
    </Modal>
  );
}
