import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useApi } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { useToast } from '../../components/Toast';
import { rotaInicial } from '@portaria/domain/rbac';
import { mensagemErro } from '../../app/useAsync';
import { useTituloPagina } from '../../app/titulo';

// Seletor de perfil de demonstração: apenas preenche o login do operador correspondente.
const PERFIS = [
  { id: 'porteiro', rotulo: 'Porteiro', nome: 'João Lima', login: 'joao.lima' },
  { id: 'administracao', rotulo: 'Administração', nome: 'Paula Nogueira', login: 'paula.nogueira' },
  { id: 'sindico', rotulo: 'Síndico', nome: 'Roberto Faria', login: 'roberto.faria' },
  { id: 'auditor', rotulo: 'Auditor', nome: 'Luíza Campos', login: 'luiza.campos' },
];

export function LoginPage() {
  const api = useApi();
  const { usuario, pronto, entrar } = useAuth();
  const { avisar } = useToast();
  const [login, setLogin] = useState('joao.lima');
  const [senha, setSenha] = useState('demonstracao');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  useTituloPagina('Entrar');

  if (pronto && usuario) return <Navigate to={`/${rotaInicial(usuario.papel)}`} replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(''); setCarregando(true);
    try {
      await entrar(login, senha);
    } catch (err) { setErro(mensagemErro(err)); }
    finally { setCarregando(false); }
  }

  async function restaurar() {
    if (!api.demo) return;
    if (!window.confirm('Restaurar os dados de demonstração? Tudo o que foi registrado nesta sessão será perdido.')) return;
    await api.demo.restaurar();
    setErro('');
    avisar({ tom: 'neutro', texto: 'Dados de demonstração restaurados. Relógio simulado: sexta-feira 09/10/2026 14:32.' });
  }

  return (
    <div className="grid min-h-screen grid-cols-[minmax(0,1fr)_560px] bg-canvas">
      <div className="sobre-escuro flex flex-col justify-between gap-10 bg-[#10262C] px-16 py-14 text-white">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[9px] bg-[#0B5563] font-bold" aria-hidden>RP</div>
          <div className="leading-[1.25]">
            <div className="font-semibold">Portaria Parque</div>
            <div className="text-[13px] text-[#9FB1B7]">Controle de acesso e portaria</div>
          </div>
        </div>
        <div className="max-w-[540px]">
          <div className="text-[42px] font-semibold leading-[1.12] tracking-[-0.02em] [text-wrap:pretty]">Condomínio Residencial do Parque</div>
          <div className="mt-4 text-[17px] leading-[1.55] text-[#C8D3D7] [text-wrap:pretty]">165 unidades em 9 torres. Cada entrada fica registrada com quem autorizou e quem registrou.</div>
        </div>
        <div className="text-[13px] text-[#8DA2A9]">Protótipo acadêmico · TCC de Sistemas de Informação · dados fictícios</div>
      </div>

      <main className="flex items-center justify-center bg-canvas p-12">
        <div className="flex w-full max-w-[400px] flex-col gap-5">
          <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
            <h1 className="mb-1 text-[28px] font-semibold">Entrar</h1>
            <Field label="Usuário"><input className="input !h-[46px] !px-[14px]" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></Field>
            <Field label="Senha" dica="Demonstração: qualquer senha é aceita.">
              <input className="input !h-[46px] !px-[14px]" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
            </Field>
            {erro && <div role="alert" className="text-[14px] font-medium text-[#B42318]">{erro}</div>}
            <div className="flex gap-[10px]">
              <Button type="submit" variante="primario" grande className="flex-1" carregando={carregando}>Entrar</Button>
            </div>
          </form>

          <div className="flex items-start gap-[10px] rounded-lg bg-[#E3F0F2] px-[14px] py-3 text-[14px] text-[#0B4450]">
            <Info className="mt-px h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
            <span>Cada operador usa o próprio login. Não compartilhe sua senha.</span>
          </div>

          {(
            <div className="mt-3 flex flex-col gap-2 border-t border-dashed border-[#C5CDD3] pt-5">
              <div className="text-[13px] font-medium text-[#56616B]">Perfil de demonstração</div>
              <div className="grid grid-cols-4 gap-[6px]">
                {PERFIS.map((p) => {
                  const ativo = login === p.login;
                  return (
                    <button key={p.id} type="button" aria-pressed={ativo} onClick={() => setLogin(p.login)}
                      className={`h-10 rounded-[7px] border text-[13px] font-medium ${ativo ? 'border-[#0B5563] bg-[#E3F0F2] text-[#0B4450]' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>
                      {p.rotulo}
                    </button>
                  );
                })}
              </div>
              {api.demo && (
                <button type="button" onClick={restaurar} className="mt-1 self-start text-[12.5px] text-[#56616B] underline hover:text-ink">
                  Restaurar dados de demonstração
                </button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
