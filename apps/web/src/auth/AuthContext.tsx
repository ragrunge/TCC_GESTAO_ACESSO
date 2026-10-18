// Sessão (mock) e guarda de rota por papel, conforme a matriz RBAC (spec seção 5.2).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useApi } from '../api';
import type { UsuarioSistema } from '@portaria/domain/types';
import { pode, ROTAS, rotaInicial, type Acao, type Rota } from '@portaria/domain/rbac';

interface AuthCtx {
  usuario: UsuarioSistema | null;
  pronto: boolean;
  // 2FA fica para a fase de segurança (pós-MVP): login é só usuário + senha.
  entrar: (login: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [usuario, setUsuario] = useState<UsuarioSistema | null>(null);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.auth.me().then((u) => { if (vivo) { setUsuario(u); setPronto(true); } }).catch(() => vivo && setPronto(true));
    return () => { vivo = false; };
  }, [api]);

  const entrar = useCallback(async (login: string, senha: string) => {
    setUsuario(await api.auth.login({ login, senha }));
  }, [api]);
  const sair = useCallback(async () => { await api.auth.logout(); setUsuario(null); }, [api]);

  const valor = useMemo(() => ({ usuario, pronto, entrar, sair }), [usuario, pronto, entrar, sair]);
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

/** Guarda de rota: sem sessão -> login; sem papel -> página inicial do perfil. */
export function RequireRole({ rota, children }: { rota: Rota; children: ReactNode }) {
  const { usuario, pronto } = useAuth();
  if (!pronto) return <p className="p-8">Carregando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;
  if (!ROTAS[rota].includes(usuario.papel)) return <Navigate to={`/${rotaInicial(usuario.papel)}`} replace />;
  return <>{children}</>;
}

/** Guarda de sessão: sem sessão -> login. Usada no layout (cada rota aplica seu próprio papel). */
export function RequireSession({ children }: { children: ReactNode }) {
  const { usuario, pronto } = useAuth();
  if (!pronto) return <p className="p-8">Carregando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
