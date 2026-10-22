import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../../api';
import { destinoDe, useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { mensagemErro } from '../../app/useAsync';
import { useTituloPagina } from '../../app/titulo';
import { codigoCondominioValido, normalizarCodigoCondominio } from '@portaria/domain/condominio';
import { lembrarCodigo, lerCodigoLembrado } from '../../auth/preferenciaCondominio';

const ERRO_FORMATO_CODIGO = 'Use de 3 a 31 caracteres: letras, números e hífen, começando por letra.';

export function LoginPage() {
  const { usuario, pronto, entrar } = useAuth();
  // Código do condomínio (SAAS-05): pré-preenchido com o lembrado neste navegador, sem valor fixo no bundle. Vazio
  // entra no piloto enquanto a API estiver na transição; a resposta do login traz o código certo, que fica lembrado.
  const [codigo, setCodigo] = useState(lerCodigoLembrado);
  const [erroCodigo, setErroCodigo] = useState<string | null>(null);
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  // Sem `variables`: login e senha vêm do estado do formulário, então a senha não fica guardada no cache de
  // mutations; gcTime 0 descarta o resultado assim que a tela sai.
  const entrada = useMutation({
    mutationFn: () => entrar(login, senha, normalizarCodigoCondominio(codigo)),
    // Só depois de entrar: código com erro de digitação nunca é lembrado. Preferência = o código canônico da API.
    onSuccess: (u) => lembrarCodigo(u.condominio?.codigo ?? normalizarCodigoCondominio(codigo)),
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
    // Só o formato (o mesmo da API). Se o código existe, só a API sabe, e responde como credencial inválida.
    const c = normalizarCodigoCondominio(codigo);
    setCodigo(c);
    if (c && !codigoCondominioValido(c)) {
      setErroCodigo(ERRO_FORMATO_CODIGO);
      return;
    }
    setErroCodigo(null);
    entrada.mutate();
  }

  return (
    <div className="grid min-h-screen grid-cols-[minmax(0,1fr)] bg-canvas lg:grid-cols-[minmax(0,1fr)_560px]">
      <div className="sobre-escuro flex flex-col justify-between gap-6 bg-[#10262C] px-6 py-8 text-white lg:gap-10 lg:px-16 lg:py-14">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[9px] bg-[#0B5563] font-bold" aria-hidden>RP</div>
          <div className="leading-[1.25]">
            <div className="font-semibold">Portaria Parque</div>
            <div className="text-[13px] text-[#9FB1B7]">Controle de acesso e portaria</div>
          </div>
        </div>
        <div className="max-w-[540px]">
          <div className="text-[28px] font-semibold leading-[1.15] sm:text-[34px] lg:text-[42px] lg:leading-[1.12] tracking-[-0.02em] [text-wrap:pretty]">Condomínio Residencial do Parque</div>
          <div className="mt-3 text-[16px] leading-[1.5] lg:mt-4 lg:text-[17px] lg:leading-[1.55] text-[#C8D3D7] [text-wrap:pretty]">Cada entrada fica registrada com quem autorizou e quem registrou.</div>
        </div>
        <div className="hidden text-[13px] text-[#8DA2A9] lg:block">Projeto acadêmico · TCC de Sistemas de Informação</div>
      </div>

      <main className="flex items-center justify-center bg-canvas px-4 py-8 sm:p-12">
        <div className="flex w-full max-w-[400px] flex-col gap-5">
          <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
            <h1 className="mb-1 text-[28px] font-semibold">Entrar</h1>
            <Field label="Código do condomínio" erro={erroCodigo} dica="Informado pela administração. Fica lembrado neste navegador.">
              <input className="input !h-[46px] !px-[14px]" value={codigo} onChange={(e) => { setCodigo(e.target.value); setErroCodigo(null); }}
                autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} aria-invalid={erroCodigo ? true : undefined} />
            </Field>
            <Field label="Usuário"><input className="input !h-[46px] !px-[14px]" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></Field>
            <Field label="Senha">
              <input className="input !h-[46px] !px-[14px]" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
            </Field>
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
