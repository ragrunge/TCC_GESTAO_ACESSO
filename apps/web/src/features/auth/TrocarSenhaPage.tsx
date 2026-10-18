// Troca da própria senha (spec §5.1). Obrigatória depois de senha temporária (criação ou redefinição pela
// administração): enquanto `deveTrocarSenha` estiver ligado, os guards mandam toda rota para cá.
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../../api';
import { destinoDe, useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { mensagemErro } from '../../app/useAsync';
import { useTituloPagina } from '../../app/titulo';

const SENHA_MIN = 12;

/** SENHA_FRACA traz em `details` a lista de problemas da política ({ field, message }); os demais, só a mensagem. */
function problemasDe(e: unknown): string[] {
  if (e instanceof ApiError && e.code === 'SENHA_FRACA' && Array.isArray(e.detalhes)) {
    const msgs = e.detalhes.map((d) => (d as { message?: unknown } | null)?.message).filter((m): m is string => typeof m === 'string');
    if (msgs.length) return msgs;
  }
  return [mensagemErro(e)];
}

export function TrocarSenhaPage() {
  const { usuario, pronto, trocarSenha, sair } = useAuth();
  const { avisar } = useToast();
  const nav = useNavigate();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erroLocal, setErroLocal] = useState('');
  // Senhas lidas do estado do formulário (sem `variables`) e gcTime 0: nada de senha no cache de mutations.
  const troca = useMutation({
    mutationFn: () => trocarSenha({ senhaAtual, novaSenha }),
    gcTime: 0,
    onSuccess: (u) => {
      avisar({ texto: 'Senha alterada. As outras sessões abertas com este usuário foram encerradas.' });
      nav(destinoDe(u), { replace: true });
    },
  });

  useTituloPagina('Trocar senha');

  if (!pronto) return <p className="p-8">Carregando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;
  const obrigatoria = usuario.deveTrocarSenha;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (troca.isPending) return;
    setErroLocal('');
    troca.reset();
    if (!senhaAtual) return setErroLocal('Informe a senha atual.');
    if (novaSenha.length < SENHA_MIN) return setErroLocal(`A nova senha precisa ter pelo menos ${SENHA_MIN} caracteres.`);
    if (novaSenha !== confirmacao) return setErroLocal('A confirmação não confere com a nova senha.');
    troca.mutate();
  }

  const problemas = erroLocal ? [erroLocal] : troca.error ? problemasDe(troca.error) : [];

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-12">
      <div className="flex w-full max-w-[440px] flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[9px] bg-[#0B5563] font-bold text-white" aria-hidden>RP</div>
          <div className="leading-[1.25]">
            <div className="font-semibold">Portaria Parque</div>
            <div className="text-[13px] text-[#56616B]">{usuario.nome} · <span className="font-mono">{usuario.login}</span></div>
          </div>
        </div>

        <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
          <h1 className="mb-1 text-[28px] font-semibold">Trocar senha</h1>
          {obrigatoria && (
            <Alert tom="ambar" titulo="Troca obrigatória">
              Você entrou com uma senha temporária. Defina uma senha pessoal para continuar.
            </Alert>
          )}
          <Field label="Senha atual">
            <input className="input !h-[46px] !px-[14px]" type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)}
              autoComplete="current-password" required autoFocus />
          </Field>
          <Field label="Nova senha" dica={`Mínimo de ${SENHA_MIN} caracteres. Não use o seu login nem senhas comuns.`}>
            <input className="input !h-[46px] !px-[14px]" type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)}
              autoComplete="new-password" required minLength={SENHA_MIN} />
          </Field>
          <Field label="Confirmar nova senha">
            <input className="input !h-[46px] !px-[14px]" type="password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="new-password" required />
          </Field>
          {problemas.length > 0 && (
            <div role="alert" className="text-[14px] font-medium text-[#B42318]">
              {problemas.length === 1 ? problemas[0] : <ul className="list-disc pl-5">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
            </div>
          )}
          <div className="flex gap-[10px]">
            <Button type="submit" variante="primario" grande className="flex-1" carregando={troca.isPending}>Trocar senha</Button>
            {obrigatoria
              ? <Button type="button" grande onClick={() => { void sair().then(() => nav('/login', { replace: true })); }}>Sair</Button>
              : <Button type="button" grande onClick={() => nav(destinoDe(usuario))}>Cancelar</Button>}
          </div>
        </form>

        <div className="flex items-start gap-[10px] rounded-lg bg-[#E3F0F2] px-[14px] py-3 text-[14px] text-[#0B4450]">
          <KeyRound className="mt-px h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
          <span>A senha é pessoal. Ninguém da administração precisa dela para ajudar você.</span>
        </div>
      </div>
    </main>
  );
}
