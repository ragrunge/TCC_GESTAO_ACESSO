import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApi, type NovaPessoaInput } from '../../api';
import { type Pessoa } from '@portaria/domain/types';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { type CategoriaPessoa } from '@portaria/domain/types';
import { mensagemErro } from '../../app/useAsync';

export const ID_FORM_PESSOA = 'f-pessoa';
const AVISO_PADRAO = 'Morador cadastrado aqui ainda não tem acesso: peça o vínculo na tela da unidade.';

/** Formulário de cadastro de pessoa (sem moldura): quem o usa põe o botão `type=submit form={ID_FORM_PESSOA}`. */
export function NovaPessoaForm({ onFeito, nomeInicial, aviso = AVISO_PADRAO }: { onFeito: (p: Pessoa) => void; nomeInicial?: string; aviso?: ReactNode }) {
  const api = useApi();
  const [f, setF] = useState<NovaPessoaInput>({ nome: nomeInicial ?? '', documento: '', telefone: '', categoria: 'morador', semCpf: false, menorIdade: false });
  const [erro, setErro] = useState('');
  const criar = useMutation({ mutationFn: (i: NovaPessoaInput) => api.pessoas.criar(i) });
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try { const p = await criar.mutateAsync(f); onFeito(p); } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <form id={ID_FORM_PESSOA} onSubmit={salvar} className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
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
        <div className="sm:col-span-2 rounded-lg bg-[#E3F0F2] px-3 py-[10px] text-[14px] text-[#0B4450]">{aviso}</div>
        {erro && <Alert tom="vermelho" role="alert" className="sm:col-span-2">{erro}</Alert>}
      </form>
  );
}

export function NovaPessoaModal({ onClose, onFeito }: { onClose: () => void; onFeito: (p: Pessoa) => void }) {
  return (
    <Modal titulo="Nova pessoa" largura={560} gap={14} onClose={onClose}
      rodape={<><Button type="submit" form={ID_FORM_PESSOA} variante="primario" grande className="flex-1">Cadastrar</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <NovaPessoaForm onFeito={onFeito} />
    </Modal>
  );
}
