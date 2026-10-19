// Sessão (spec §5.1): token opaco de 256 bits no cookie; no banco só o SHA-256 dele. Expira por tempo absoluto
// (expira_em, gravado na criação) e por inatividade (ultimo_uso_em + SESSAO_INATIVIDADE_MIN, calculado aqui).
import { Inject, Injectable } from '@nestjs/common';
import { senhaTemporariaVencida } from '@portaria/domain/rules';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { CONFIG, type Config } from '../config/config';
import { RELOGIO, type Relogio } from '../comum/relogio';
import { DB, type Db, type Executor } from '../database/database.module';
import { sessao, usuarioSistema } from '../db/schema';
import { ipOuNulo } from '../auditoria/auditoria.service';
import type { AuthDaRequisicao } from './tipos';

export type MotivoRevogacao = 'logout' | 'desativacao' | 'troca_senha' | 'redefinicao_senha';

export const hashDoToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** Formato do token emitido (base64url de 32 bytes). Outro formato nem vai ao banco. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class SessaoService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /** Cria a sessão na transação do login. Devolve o token em claro: ele só existe na resposta (cookie). */
  async criar(tx: Executor, usuarioId: string, agora: Date, ip: string | null, userAgent: string | undefined) {
    const token = randomBytes(32).toString('base64url');
    const expiraEm = new Date(agora.getTime() + this.config.sessao.absolutaMin * 60_000);
    const [s] = await tx.insert(sessao).values({
      tokenHash: hashDoToken(token), usuarioId, criadaEm: agora, ultimoUsoEm: agora, expiraEm,
      ip: ipOuNulo(ip), userAgent: userAgent ? userAgent.slice(0, 300) : null,
    }).returning({ id: sessao.id });
    return { token, sessaoId: s!.id, expiraEm };
  }

  /**
   * null = sem sessão válida (inexistente, revogada, expirada, inativa, usuário desativado, ou troca de senha pendente
   * com a senha temporária vencida).
   */
  async validar(token: string): Promise<AuthDaRequisicao | null> {
    if (!TOKEN.test(token)) return null;
    const agora = this.relogio.agora();
    const [l] = await this.db.select({
      id: sessao.id, ultimoUsoEm: sessao.ultimoUsoEm, expiraEm: sessao.expiraEm, revogadaEm: sessao.revogadaEm,
      usuarioId: usuarioSistema.id, nome: usuarioSistema.nome, login: usuarioSistema.login, papel: usuarioSistema.papel,
      ativo: usuarioSistema.ativo, deveTrocarSenha: usuarioSistema.deveTrocarSenha,
      senhaTemporariaExpiraEm: usuarioSistema.senhaTemporariaExpiraEm,
    }).from(sessao).innerJoin(usuarioSistema, eq(usuarioSistema.id, sessao.usuarioId))
      .where(eq(sessao.tokenHash, hashDoToken(token))).limit(1);
    if (!l || l.revogadaEm || !l.ativo) return null;
    if (l.expiraEm <= agora) return null;
    // Sessão aberta com a temporária ainda válida não sobrevive ao prazo dela (a sessão dura até 12 h): sem isso, a
    // senha vencida ainda serviria de "senha atual" em /auth/trocar-senha. Decidido aqui, no estado lido a cada
    // requisição, sem gravar revogação: vale para as 3 rotas liberadas e não precisa de motivo novo no CHECK da sessão.
    if (senhaTemporariaVencida({ deveTrocarSenha: l.deveTrocarSenha, senhaTemporariaExpiraEm: l.senhaTemporariaExpiraEm?.getTime() ?? null }, agora.getTime())) return null;
    const inatividadeMs = this.config.sessao.inatividadeMin * 60_000;
    if (agora.getTime() - l.ultimoUsoEm.getTime() >= inatividadeMs) return null;
    // Uma escrita por minuto por sessão, não uma por requisição.
    if (agora.getTime() - l.ultimoUsoEm.getTime() >= this.config.sessao.toqueSeg * 1000) {
      await this.db.update(sessao).set({ ultimoUsoEm: agora }).where(and(eq(sessao.id, l.id), isNull(sessao.revogadaEm)));
    }
    return {
      sessaoId: l.id,
      expiraEm: l.expiraEm,
      usuario: { id: l.usuarioId, nome: l.nome, login: l.login, papel: l.papel, deveTrocarSenha: l.deveTrocarSenha },
    };
  }

  async revogar(exec: Executor, sessaoId: string, motivo: MotivoRevogacao, agora: Date): Promise<void> {
    await exec.update(sessao).set({ revogadaEm: agora, motivoRevogacao: motivo })
      .where(and(eq(sessao.id, sessaoId), isNull(sessao.revogadaEm)));
  }

  /** Revoga todas as sessões abertas do usuário, exceto `excetoSessaoId` (troca de senha mantém a atual). */
  async revogarDoUsuario(exec: Executor, usuarioId: string, motivo: MotivoRevogacao, agora: Date, excetoSessaoId?: string) {
    const filtro = and(eq(sessao.usuarioId, usuarioId), isNull(sessao.revogadaEm), excetoSessaoId ? ne(sessao.id, excetoSessaoId) : undefined);
    const r = await exec.update(sessao).set({ revogadaEm: agora, motivoRevogacao: motivo }).where(filtro).returning({ id: sessao.id });
    return r.length;
  }
}
