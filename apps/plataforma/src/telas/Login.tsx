// Login do Master: e-mail e senha (sem segundo fator desde 2026-10-23, SAAS-08). Erro único vindo da API.
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/cliente';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { useSessao } from '../sessao/SessaoMaster';

export function Login({ aviso }: { aviso?: string }) {
  const { entrar } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), senha);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-[420px]">
        <form onSubmit={enviar} noValidate aria-labelledby="titulo-login" className="flex flex-col gap-4 p-6 sm:p-8">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-suave">Portaria Parque</p>
            <h1 id="titulo-login" className="text-[24px] font-semibold">Plataforma</h1>
            <p className="text-[14px] text-ink-suave">Acesso restrito à administração do serviço.</p>
          </div>
          {aviso && <Alert variant="ambar" role="status">{aviso}</Alert>}
          <Field label="E-mail">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Senha">
            <Input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          </Field>
          {erro && <Alert variant="vermelho" role="alert">{erro}</Alert>}
          <Button type="submit" variant="default" loading={enviando}>Entrar</Button>
        </form>
      </Card>
    </main>
  );
}
