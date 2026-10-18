import type { Papel } from '@portaria/domain/types';
import type { Ator } from '../auditoria/auditoria.service';

export interface UsuarioAutenticado extends Ator {
  login: string;
  papel: Papel;
  deveTrocarSenha: boolean;
}

/** Preenchido pelo SessaoGuard em `req.auth` (só em rota não pública com sessão válida). */
export interface AuthDaRequisicao {
  sessaoId: string;
  usuario: UsuarioAutenticado;
  expiraEm: Date;
}

/** Contexto passado EXPLICITAMENTE aos serviços (sem AsyncLocalStorage: nada vaza entre requisições). */
export interface Contexto {
  ator: UsuarioAutenticado;
  sessaoId: string;
  ip: string | null;
}
