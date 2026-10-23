// Troca de senha obrigatória (senha temporária da CLI). A API valida a política (mínimo 12, lista de comuns, sem o
// e-mail); aqui só o mínimo e a confirmação, para não gastar ida.
import { useState, type FormEvent } from 'react';
import { ApiError, errosDeCampo } from '../api/cliente';
import { useSessao } from '../sessao/SessaoMaster';
import { Alert, Button, Field } from '../ui/ui';

export function TrocarSenha() {
  const { trocarSenha, sair, estado } = useSessao();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nova.length < 12) { setCampos({ novaSenha: 'A senha precisa ter pelo menos 12 caracteres.' }); return; }
    if (nova !== confirma) { setCampos({ confirmacao: 'A confirmação não confere com a nova senha.' }); return; }
    setCampos({});
    setEnviando(true);
    try {
      await trocarSenha(atual, nova);
    } catch (err) {
      const c = errosDeCampo(err);
      if (Object.keys(c).length) setCampos(c);
      else if (err instanceof ApiError && err.code === 'SENHA_ATUAL_INCORRETA') setCampos({ senhaAtual: err.message });
      else setErro(err instanceof ApiError ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={enviar} noValidate aria-labelledby="titulo-troca"
        className="flex w-full max-w-[460px] flex-col gap-4 rounded-xl border border-linha bg-white p-6 shadow-cartao sm:p-8">
        <div>
          <h1 id="titulo-troca" className="text-[22px] font-semibold">Troque a senha provisória</h1>
          <p className="text-[14px] text-ink-suave">
            {estado.fase === 'logado' ? `${estado.usuario.email}: ` : ''}a senha temporária vale uma vez. Escolha uma senha sua, com pelo menos 12 caracteres.
          </p>
        </div>
        <Field label="Senha atual (temporária)" erro={campos.senhaAtual}>
          <input className="input" type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} />
        </Field>
        <Field label="Nova senha" erro={campos.novaSenha} dica="Mínimo de 12 caracteres. Uma frase longa é mais fácil de lembrar.">
          <input className="input" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} />
        </Field>
        <Field label="Confirme a nova senha" erro={campos.confirmacao}>
          <input className="input" type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
        </Field>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
        <div className="flex flex-wrap gap-[10px]">
          <Button type="submit" variante="primario" carregando={enviando} className="flex-1">Trocar senha</Button>
          <Button variante="secundario" onClick={() => void sair()}>Sair</Button>
        </div>
      </form>
    </main>
  );
}
