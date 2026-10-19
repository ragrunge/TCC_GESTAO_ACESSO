// Textos da senha temporária (spec §5.1: vale 72 h). Funções puras: a tela de Usuários usa, os testes conferem.
import { senhaTemporariaVencida } from '@portaria/domain/rules';
import { fmtDataCurta, fmtHora } from '@portaria/domain/time';
import type { UsuarioSistema } from '@portaria/domain/types';

/** "dd/mm às HH:MM" (horário de São Paulo). */
export const validadeTexto = (ts: number) => `${fmtDataCurta(ts)} às ${fmtHora(ts)}`;

/** Texto pronto para colar no WhatsApp/e-mail. Sem prazo informado, a linha de validade não sai (nunca inventa um). */
export function mensagemAcesso(i: { login: string; senhaTemporaria: string; expiraEm?: number | null; origem: string }): string {
  return `Acesso ao sistema da portaria\nLogin: ${i.login}\nSenha temporária: ${i.senhaTemporaria}\n`
    + (i.expiraEm != null ? `Válida até ${validadeTexto(i.expiraEm)}\n` : '')
    + `Entre em ${i.origem} e troque a senha no primeiro acesso.`;
}

/** Aviso da lista para quem tem troca pendente; null para os demais (e para inativos, que nem entram). */
export function avisoSenhaTemporaria(u: UsuarioSistema, agora: number): { texto: string; vencida: boolean } | null {
  if (!u.ativo || !u.deveTrocarSenha) return null;
  if (senhaTemporariaVencida(u, agora)) return { texto: 'Senha temporária vencida — redefina', vencida: true };
  const fim = u.senhaTemporariaExpiraEm!;
  return { texto: `Senha temporária vence em ${fmtDataCurta(fim)} ${fmtHora(fim)}`, vencida: false };
}
