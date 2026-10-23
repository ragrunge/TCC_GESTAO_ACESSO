// Sessão do Master no front: só o usuário (nome, e-mail, papel, troca pendente) em memória. O token está no cookie
// HttpOnly da plataforma e o front nunca o vê; nada de sessão em storage. No boot, `GET /plataforma/auth/me` decide.
// 401 numa rota autenticada -> volta ao login com aviso; 403 TROCA_DE_SENHA_OBRIGATORIA -> tela de troca.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/cliente';
import type { ApiPlataforma, UsuarioPlataforma } from '../api/plataforma';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'deslogado'; aviso?: string }
  | { fase: 'logado'; usuario: UsuarioPlataforma };

interface Valor {
  api: ApiPlataforma;
  estado: Estado;
  entrar(email: string, senha: string, codigo: string): Promise<void>;
  sair(): Promise<void>;
  trocarSenha(atual: string, nova: string): Promise<void>;
}

const Ctx = createContext<Valor | null>(null);

export function useSessao(): Valor {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessao fora do SessaoProvider');
  return v;
}

export function SessaoProvider({ api, children }: { api: ApiPlataforma; children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const qc = useQueryClient();

  const deslogar = useCallback((aviso?: string) => {
    qc.clear(); // nada de dado da sessão anterior no cache
    setEstado({ fase: 'deslogado', aviso });
  }, [qc]);

  useEffect(() => {
    let vivo = true;
    api.me().then(
      (r) => { if (vivo) setEstado({ fase: 'logado', usuario: r.usuario }); },
      (e: unknown) => { if (vivo) setEstado({ fase: 'deslogado', aviso: e instanceof ApiError && e.status === 0 ? e.message : undefined }); },
    );
    return () => { vivo = false; };
  }, [api]);

  useEffect(() => api.cliente.aoEvento((ev) => {
    if (ev === 'expirada') deslogar('Sua sessão expirou. Entre novamente.');
    else setEstado((s) => (s.fase === 'logado' ? { fase: 'logado', usuario: { ...s.usuario, deveTrocarSenha: true } } : s));
  }), [api, deslogar]);

  const valor = useMemo<Valor>(() => ({
    api,
    estado,
    async entrar(email, senha, codigo) {
      const r = await api.login(email, senha, codigo);
      setEstado({ fase: 'logado', usuario: r.usuario });
    },
    async sair() {
      try { await api.logout(); } catch { /* sessão já encerrada: o resultado é o mesmo */ }
      deslogar();
    },
    async trocarSenha(atual, nova) {
      const usuario = await api.trocarSenha(atual, nova);
      setEstado({ fase: 'logado', usuario });
    },
  }), [api, estado, deslogar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
