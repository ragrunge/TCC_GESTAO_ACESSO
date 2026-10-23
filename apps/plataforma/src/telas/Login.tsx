// Login do Master em UM envio: e-mail, senha e código do aplicativo autenticador (TOTP). Erro único vindo da API.
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/cliente';
import { useSessao } from '../sessao/SessaoMaster';
import { Alert, Button, Field } from '../ui/ui';

export function Login({ aviso }: { aviso?: string }) {
  const { entrar } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(codigo)) { setErro('Informe o código de 6 dígitos do aplicativo autenticador.'); return; }
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), senha, codigo);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
      setCodigo(''); // o código é de uso único: o próximo envio precisa de outro
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={enviar} noValidate aria-labelledby="titulo-login"
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-xl border border-linha bg-white p-6 shadow-cartao sm:p-8">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-suave">Portaria Parque</p>
          <h1 id="titulo-login" className="text-[24px] font-semibold">Plataforma</h1>
          <p className="text-[14px] text-ink-suave">Acesso restrito à administração do serviço.</p>
        </div>
        {aviso && <Alert tom="ambar" role="status">{aviso}</Alert>}
        <Field label="E-mail">
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha">
          <input className="input" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Field>
        <Field label="Código do autenticador" dica="6 dígitos do aplicativo (Google Authenticator, Authy e similares).">
          <input className="input font-mono tracking-[0.2em]" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
            required value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
        <Button type="submit" variante="primario" carregando={enviando}>Entrar</Button>
      </form>
    </main>
  );
}
