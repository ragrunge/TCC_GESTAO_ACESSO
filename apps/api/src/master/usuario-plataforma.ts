// Bootstrap e manutenção dos usuários da plataforma pela CLI do operador (src/cli/criar-usuario-plataforma.ts). Não há
// tela para isso de propósito: o primeiro Master não tem quem o crie pela tela, e reemitir o segundo fator pela tela
// seria o caminho de quem roubou a senha. Roda como app_plataforma (INSERT/UPDATE em master_usuario e master_sessao,
// INSERT em plataforma_audit); a senha temporária e o segredo TOTP saem SÓ no resultado, para o terminal.
import { randomUUID } from 'node:crypto';
import { SENHA_TEMPORARIA_VALIDADE_MS } from '@portaria/domain/rules';
import { PAPEIS_PLATAFORMA, type PapelPlataforma } from '@portaria/domain/rbac-plataforma';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ChaveMestra } from '../saas/chave-mestra';
import type { DbPlataforma } from '../saas/plataforma-db';
import { masterSessao, masterUsuario } from '../saas/schema-plataforma';
import { cifrarSegredoTotp } from './segredo-totp';
import { base32, novoSegredoTotp, uriOtpauth } from './totp';
import { registrarPlataforma } from './trilha-plataforma';

export class ErroUsuarioPlataforma extends Error {}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface Ferramentas {
  hashSenha(senha: string): Promise<string>;
  gerarSenha(): string;
  agora?: () => Date;
}

export interface Credenciais {
  id: string;
  email: string;
  /** Só quando gerada nesta execução. */
  senhaTemporaria?: string;
  senhaExpiraEm?: string;
  /** Só quando gerado nesta execução: base32 (digitação manual) e a URI otpauth:// (QR / link). */
  totp?: { segredo: string; uri: string };
}

export function validarCadastro(o: { email?: string; nome?: string; papel?: string }): { email: string; nome: string; papel: PapelPlataforma } {
  const email = (o.email ?? '').trim().toLowerCase();
  const nome = (o.nome ?? '').trim();
  const papel = (o.papel ?? 'master').trim();
  if (!EMAIL.test(email) || email.length > 254) throw new ErroUsuarioPlataforma('--email inválido');
  if (nome.length < 3 || nome.length > 120) throw new ErroUsuarioPlataforma('--nome precisa de 3 a 120 caracteres');
  if (!(PAPEIS_PLATAFORMA as readonly string[]).includes(papel)) throw new ErroUsuarioPlataforma(`--papel deve ser ${PAPEIS_PLATAFORMA.join(' ou ')}`);
  return { email, nome, papel: papel as PapelPlataforma };
}

const porEmail = (email: string) => sql`lower(${masterUsuario.email}) = ${email.trim().toLowerCase()}`;

/** Cria o usuário com senha temporária (72 h, troca obrigatória) e segredo TOTP novo. E-mail já cadastrado: recusa. */
export async function criarUsuario(db: DbPlataforma, mestra: ChaveMestra, f: Ferramentas, c: { email: string; nome: string; papel: PapelPlataforma }): Promise<Credenciais> {
  const agora = (f.agora ?? (() => new Date()))();
  const [existe] = await db.select({ id: masterUsuario.id }).from(masterUsuario).where(porEmail(c.email));
  if (existe) throw new ErroUsuarioPlataforma('já existe usuário da plataforma com este e-mail: nada foi alterado (para reemitir: --reemitir-totp e/ou --nova-senha)');
  const id = randomUUID();
  const senha = f.gerarSenha();
  const senhaHash = await f.hashSenha(senha);
  const segredo = novoSegredoTotp();
  try {
    const expira = new Date(agora.getTime() + SENHA_TEMPORARIA_VALIDADE_MS);
    await db.transaction(async (tx) => {
      await tx.insert(masterUsuario).values({
        id, nome: c.nome, email: c.email, senhaHash, papel: c.papel, ativo: true, criadoEm: agora,
        ...cifrarSegredoTotp(mestra, id, segredo), deveTrocarSenha: true, senhaTemporariaExpiraEm: expira,
      });
      await registrarPlataforma(tx, { masterUsuarioId: null, acao: 'master.criar', detalhes: { origem: 'cli', usuario_id: id, papel: c.papel } });
    });
    return { id, email: c.email, senhaTemporaria: senha, senhaExpiraEm: expira.toISOString(), totp: { segredo: base32(segredo), uri: uriOtpauth(segredo, c.email) } };
  } finally {
    segredo.fill(0);
  }
}

/**
 * Reemite o segundo fator (celular perdido) e/ou a senha (esquecida). Revoga todas as sessões do usuário e zera o
 * anti-replay do TOTP (o segredo é outro). A senha nova é temporária (troca obrigatória).
 */
export async function reemitir(db: DbPlataforma, mestra: ChaveMestra, f: Ferramentas, email: string, o: { totp: boolean; senha: boolean }): Promise<Credenciais> {
  if (!o.totp && !o.senha) throw new ErroUsuarioPlataforma('nada a reemitir');
  const agora = (f.agora ?? (() => new Date()))();
  const [u] = await db.select({ id: masterUsuario.id, email: masterUsuario.email, ativo: masterUsuario.ativo }).from(masterUsuario).where(porEmail(email));
  if (!u) throw new ErroUsuarioPlataforma('e-mail não encontrado entre os usuários da plataforma');
  if (!u.ativo) throw new ErroUsuarioPlataforma('usuário desativado: nada foi reemitido');
  const senha = o.senha ? f.gerarSenha() : null;
  const senhaHash = senha ? await f.hashSenha(senha) : null;
  const segredo = o.totp ? novoSegredoTotp() : null;
  try {
    const expira = new Date(agora.getTime() + SENHA_TEMPORARIA_VALIDADE_MS);
    await db.transaction(async (tx) => {
      await tx.update(masterUsuario).set({
        ...(segredo ? { ...cifrarSegredoTotp(mestra, u.id, segredo), totpUltimoPasso: null } : {}),
        ...(senhaHash ? { senhaHash, deveTrocarSenha: true, senhaTemporariaExpiraEm: expira } : {}),
      }).where(eq(masterUsuario.id, u.id));
      const revogadas = await tx.update(masterSessao).set({ revogadaEm: agora, motivoRevogacao: 'credencial_reemitida' })
        .where(and(eq(masterSessao.masterUsuarioId, u.id), isNull(masterSessao.revogadaEm))).returning({ id: masterSessao.id });
      await registrarPlataforma(tx, {
        masterUsuarioId: null, acao: 'master.reemitir_credencial',
        detalhes: { origem: 'cli', usuario_id: u.id, totp: !!segredo, senha: !!senha, sessoes_revogadas: revogadas.length },
      });
    });
    return {
      id: u.id, email: u.email,
      ...(senha ? { senhaTemporaria: senha, senhaExpiraEm: expira.toISOString() } : {}),
      ...(segredo ? { totp: { segredo: base32(segredo), uri: uriOtpauth(segredo, u.email) } } : {}),
    };
  } finally {
    segredo?.fill(0);
  }
}
