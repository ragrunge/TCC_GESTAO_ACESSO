// Troca de senha obrigatória (senha temporária da CLI). A API valida a política (mínimo SENHA_MIN_MASTER = 16, maior que
// os 12 do condomínio porque o Master entra sem segundo fator; lista de comuns; sem o e-mail); aqui só o mínimo e a
// confirmação, para não gastar ida.
import { SENHA_MIN_MASTER } from '@portaria/domain/rbac-plataforma';
import { useState, type FormEvent } from 'react';
import { ApiError, errosDeCampo } from '../api/cliente';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { useSessao } from '../sessao/SessaoMaster';

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
    if (nova.length < SENHA_MIN_MASTER) { setCampos({ novaSenha: `A senha precisa ter pelo menos ${SENHA_MIN_MASTER} caracteres.` }); return; }
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
      <Card className="w-full max-w-[460px]">
        <form onSubmit={enviar} noValidate aria-labelledby="titulo-troca" className="flex flex-col gap-4 p-6 sm:p-8">
          <div>
            <h1 id="titulo-troca" className="text-[22px] font-semibold">Troque a senha provisória</h1>
            <p className="text-[14px] text-ink-suave">
              {estado.fase === 'logado' ? `${estado.usuario.email}: ` : ''}a senha temporária vale uma vez. Escolha uma senha sua, com pelo menos {SENHA_MIN_MASTER} caracteres, e guarde-a num gerenciador de senhas.
            </p>
          </div>
          <Field label="Senha atual (temporária)" erro={campos.senhaAtual}>
            <Input type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} />
          </Field>
          <Field label="Nova senha" erro={campos.novaSenha} dica={`Mínimo de ${SENHA_MIN_MASTER} caracteres. Uma frase longa é mais fácil de lembrar.`}>
            <Input type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} />
          </Field>
          <Field label="Confirme a nova senha" erro={campos.confirmacao}>
            <Input type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} />
          </Field>
          {erro && <Alert variant="vermelho" role="alert">{erro}</Alert>}
          <div className="flex flex-wrap gap-[10px]">
            <Button type="submit" variant="default" loading={enviando} className="flex-1">Trocar senha</Button>
            <Button variant="secondary" onClick={() => void sair()}>Sair</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
