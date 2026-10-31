import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../../api';
import { destinoDe, useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { CampoSenha } from '../../components/CampoSenha';
import { mensagemErro } from '../../app/useAsync';
import { useTituloPagina } from '../../app/titulo';
import { Marca } from '../../components/Marca';
import { mostrarAberturaAoEntrar } from '../../components/Carregando';

export function LoginPage() {
  const { usuario, pronto, entrar } = useAuth();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  // Sempre desmarcado ao abrir (não é lembrado): a escolha é por login. A API ignora para o porteiro, cujo papel a tela
  // não conhece antes de entrar.
  const [manter, setManter] = useState(false);
  // Sem `variables`: login e senha vêm do estado do formulário, então a senha não fica guardada no cache de
  // mutations; gcTime 0 descarta o resultado assim que a tela sai.
  const entrada = useMutation({
    mutationFn: () => entrar(login, senha, manter),
    onSuccess: (u) => {
      // Quem ainda vai trocar a senha temporária só "entra" depois da troca
      if (!u.deveTrocarSenha) mostrarAberturaAoEntrar();
    },
    gcTime: 0,
  });
  const erroEntrada = entrada.error;
  const bloqueado = erroEntrada instanceof ApiError && erroEntrada.status === 429;
  // Só sai com a senha certa (a API não revela o motivo a quem não a conhece): a saída é pedir nova senha à administração.
  const temporariaVencida = erroEntrada instanceof ApiError && erroEntrada.code === 'SENHA_TEMPORARIA_EXPIRADA';

  useTituloPagina('Entrar');

  if (pronto && usuario) return <Navigate to={destinoDe(usuario)} replace />;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (entrada.isPending) return;
    entrada.mutate();
  }

  return (
    <div className="grid min-h-screen grid-cols-[minmax(0,1fr)] bg-canvas lg:grid-cols-[minmax(0,1fr)_560px]">
      <div className="sobre-escuro flex flex-col justify-between gap-6 bg-[#10262C] px-6 py-8 text-white lg:gap-10 lg:px-16 lg:py-14">
        <div className="flex items-center gap-3">
          <Marca tamanho={40} />
          <div className="leading-[1.25]">
            <div className="font-semibold">Gestão de Acesso</div>
            <div className="text-[13px] text-[#9FB1B7]">Controle de acesso e portaria</div>
          </div>
        </div>
        <div className="max-w-[540px]">
          <div className="text-[28px] font-semibold leading-[1.15] sm:text-[34px] lg:text-[42px] lg:leading-[1.12] tracking-[-0.02em] [text-wrap:pretty]">Controle de acesso para condomínios</div>
          <div className="mt-3 text-[16px] leading-[1.5] lg:mt-4 lg:text-[17px] lg:leading-[1.55] text-[#C8D3D7] [text-wrap:pretty]">Cada entrada fica registrada com quem autorizou e quem registrou.</div>
        </div>
        <div className="hidden text-[13px] text-[#8DA2A9] lg:block">Projeto acadêmico · TCC de Sistemas de Informação</div>
      </div>

      <main className="flex items-center justify-center bg-canvas px-4 py-8 sm:p-12">
        <div className="flex w-full max-w-[400px] flex-col gap-5">
          <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
            <h1 className="mb-1 text-[28px] font-semibold">Entrar</h1>
            <Field label="Usuário"><input className="input !h-[46px] !px-[14px]" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></Field>
            <Field label="Senha">
              <CampoSenha value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
            </Field>
            <div className="flex flex-col gap-1">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-[14px] font-medium">
                <input type="checkbox" className="h-[18px] w-[18px] accent-[#0B5563]" checked={manter} onChange={(e) => setManter(e.target.checked)}
                  aria-describedby="manter-conectado-dica" />
                Manter conectado neste computador
              </label>
              <p id="manter-conectado-dica" className="text-[13px] text-[#56616B]">Não marque em computador compartilhado, como o da portaria.</p>
            </div>
            {erroEntrada && (bloqueado
              ? <Alert tom="ambar" role="alert" titulo="Acesso temporariamente bloqueado">{mensagemErro(erroEntrada)}</Alert>
              : temporariaVencida
              ? <Alert tom="ambar" role="alert" titulo="Senha temporária vencida">{mensagemErro(erroEntrada)}</Alert>
              : <div role="alert" className="text-[14px] font-medium text-[#B42318]">{mensagemErro(erroEntrada)}</div>)}
            <div className="flex gap-[10px]">
              <Button type="submit" variante="primario" grande className="flex-1" carregando={entrada.isPending}>Entrar</Button>
            </div>
          </form>

          <div className="flex items-start gap-[10px] rounded-lg bg-[#E3F0F2] px-[14px] py-3 text-[14px] text-[#0B4450]">
            <Info className="mt-px h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
            <span>Cada operador usa o próprio login. Não compartilhe sua senha.</span>
          </div>

        </div>
      </main>
    </div>
  );
}
