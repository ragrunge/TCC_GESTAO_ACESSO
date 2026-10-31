// Sessão e guarda de rota por papel, conforme a matriz RBAC (spec seção 5.2). No modo http a sessão é o cookie
// HttpOnly da API: aqui fica só o usuário em memória (nada em storage), reconstruído por /auth/me ao recarregar.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApi, type TrocarSenhaInput, type UsuarioSessao } from '../api';
import { useToast } from '../components/Toast';
import { pode, ROTAS, rotaInicial, type Acao, type Rota } from '@portaria/domain/rbac';
import { Splash } from '../components/Carregando';

interface AuthCtx {
  usuario: UsuarioSessao | null;
  pronto: boolean;
  // 2FA fica para a fase de segurança (pós-MVP): login é só usuário + senha.
  entrar: (login: string, senha: string, manterConectado?: boolean) => Promise<UsuarioSessao>;
  /** Encerra a sessão no servidor. `false`: o logout falhou e a sessão continua (local e no servidor); tente de novo. */
  sair: () => Promise<boolean>;
  trocarSenha: (i: TrocarSenhaInput) => Promise<UsuarioSessao>;
}
const Ctx = createContext<AuthCtx | null>(null);

/** Destino depois de entrar (ou de qualquer guarda): a troca obrigatória vem antes de tudo. */
export const destinoDe = (u: UsuarioSessao) => (u.deveTrocarSenha ? '/trocar-senha' : `/${rotaInicial(u.papel)}`);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const qc = useQueryClient();
  const { avisar } = useToast();
  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null);
  const [pronto, setPronto] = useState(false);
  const usuarioRef = useRef(usuario);
  usuarioRef.current = usuario;

  useEffect(() => {
    let vivo = true;
    api.auth.me().then((u) => { if (vivo) { setUsuario(u); setPronto(true); } }).catch(() => { if (vivo) setPronto(true); });
    return () => { vivo = false; };
  }, [api]);

  // Avisos da camada HTTP. A navegação é consequência do estado (os guards abaixo), então N avisos não geram N
  // navegações; e o cliente já emite no máximo um "expirada" por sessão.
  useEffect(() => api.aoEventoSessao?.((e) => {
    if (e === 'expirada') {
      // Fora do updater do setState: o StrictMode chama updaters duas vezes (seria toast em dobro).
      if (usuarioRef.current) avisarRef.current({ tom: 'ambar', texto: 'Sua sessão expirou. Entre novamente.' });
      setUsuario(null);
      qc.removeQueries(); // dado pessoal do usuário anterior não fica em cache
    } else if (usuarioRef.current) {
      setUsuario((atual) => (atual ? { ...atual, deveTrocarSenha: true } : atual));
    } else {
      // 403 de troca sem usuário em memória: a sessão existe, então o /auth/me traz o usuário (com a marca).
      api.auth.me().then(setUsuario).catch(() => undefined);
    }
  }), [api, qc]);

  const entrar = useCallback(async (login: string, senha: string, manterConectado?: boolean) => {
    const u = await api.auth.login({ login, senha, manterConectado });
    qc.removeQueries();
    setUsuario(u);
    return u;
  }, [api, qc]);

  const sair = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Sem limpar a tela: o cookie httpOnly continua e a sessão segue válida no servidor. Ir para o login daria a
      // impressão de saída, e um recarregar traria o operador anterior de volta (RN-05: autoria de cada registro).
      avisarRef.current({ tom: 'vermelho', texto: 'Não foi possível encerrar a sessão. Verifique a conexão e tente de novo.' });
      return false;
    }
    qc.removeQueries();
    setUsuario(null);
    return true;
  }, [api, qc]);

  const trocarSenha = useCallback(async (i: TrocarSenhaInput) => {
    const u = await api.auth.trocarSenha(i);
    // trocar-senha não devolve o condomínio: mantém o que login/me trouxeram.
    setUsuario((atual) => ({ condominio: atual?.condominio, ...u }));
    return u;
  }, [api]);

  const valor = useMemo(() => ({ usuario, pronto, entrar, sair, trocarSenha }), [usuario, pronto, entrar, sair, trocarSenha]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora de <AuthProvider>');
  return c;
}

/** A UI só oculta/desabilita: quem decide de verdade é a API. */
export function useCan(acao: Acao): boolean {
  const { usuario } = useAuth();
  return pode(usuario?.papel, acao);
}

/** Rota disponível para o usuário, pelo papel (ROTAS). */
export const rotaDisponivel = (u: UsuarioSessao, rota: Rota) => ROTAS[rota].includes(u.papel);

/** Guarda de rota: sem sessão -> login; troca pendente -> troca; sem papel -> página inicial do perfil. */
export function RequireRole({ rota, children }: { rota: Rota; children: ReactNode }) {
  const { usuario, pronto } = useAuth();
  if (!pronto) return <Splash />;
  if (!usuario) return <Navigate to="/login" replace />;
  if (usuario.deveTrocarSenha) return <Navigate to="/trocar-senha" replace />;
  if (!rotaDisponivel(usuario, rota)) return <Navigate to={`/${rotaInicial(usuario.papel)}`} replace />;
  return <>{children}</>;
}

/** Guarda de sessão: sem sessão -> login; troca pendente -> /trocar-senha. Usada no layout. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { usuario, pronto } = useAuth();
  if (!pronto) return <Splash />;
  if (!usuario) return <Navigate to="/login" replace />;
  if (usuario.deveTrocarSenha) return <Navigate to="/trocar-senha" replace />;
  return <>{children}</>;
}
