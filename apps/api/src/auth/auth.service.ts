import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { setTimeout as esperar } from 'node:timers/promises';
import { AuditoriaService, type Ator } from '../auditoria/auditoria.service';
import { erroApi } from '../comum/erros';
import { RELOGIO, type Relogio } from '../comum/relogio';
import { DB, type Db } from '../database/database.module';
import { usuarioSistema } from '../db/schema';
import { LimiteLoginService, normalizarLogin, type Reserva } from './limite-login.service';
import { problemasDaSenha, SenhaService } from './senha.service';
import { SessaoService } from './sessao.service';
import type { Contexto } from './tipos';

/** Visão pública do usuário (sem hash). `ultimoAcesso` em ms, como `UsuarioSistema` de @portaria/domain/types. */
export interface UsuarioPublico {
  id: string;
  nome: string;
  login: string;
  papel: Ator['papel'];
  ativo: boolean;
  ultimoAcesso: number | null;
  deveTrocarSenha: boolean;
}

export const colunasPublicas = {
  id: usuarioSistema.id, nome: usuarioSistema.nome, login: usuarioSistema.login, papel: usuarioSistema.papel,
  ativo: usuarioSistema.ativo, ultimoAcesso: usuarioSistema.ultimoAcesso, deveTrocarSenha: usuarioSistema.deveTrocarSenha,
};

export const paraPublico = (u: { ultimoAcesso: Date | null } & Omit<UsuarioPublico, 'ultimoAcesso'>): UsuarioPublico => ({
  id: u.id, nome: u.nome, login: u.login, papel: u.papel, ativo: u.ativo,
  ultimoAcesso: u.ultimoAcesso ? u.ultimoAcesso.getTime() : null, deveTrocarSenha: u.deveTrocarSenha,
});

export type ResultadoLogin =
  | { ok: true; token: string; expiraEm: Date; usuario: UsuarioPublico }
  | { ok: false; motivo: 'credenciais' }
  | { ok: false; motivo: 'bloqueado'; ate: Date };

/** Mensagem ÚNICA para usuário inexistente, inativo e senha errada (spec §5.1). */
export const MENSAGEM_CREDENCIAIS = 'Usuário ou senha inválidos.';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(SenhaService) private readonly senhas: SenhaService,
    @Inject(SessaoService) private readonly sessoes: SessaoService,
    @Inject(LimiteLoginService) private readonly limite: LimiteLoginService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  private fimDoBloqueio(rs: (Reserva | null)[], agora: Date): Date {
    const fins = rs.filter((r): r is Reserva => !!r && !!r.bloqueadoAte && r.bloqueadoAte > agora).map((r) => r.bloqueadoAte!.getTime());
    // Passou do máximo por concorrência, antes de o bloqueio ser gravado: no mínimo um bloqueio inteiro a partir de agora.
    return new Date(fins.length ? Math.max(...fins) : agora.getTime() + this.limite.bloqueioMs());
  }

  async login(loginDigitado: string, senha: string, ip: string | null, userAgent: string | undefined): Promise<ResultadoLogin> {
    const agora = this.relogio.agora();
    const chLogin = this.limite.chave('login', loginDigitado);
    const chIp = ip ? this.limite.chave('ip', ip) : null;
    const rLogin = await this.limite.reservar(chLogin, agora);
    const rIp = chIp ? await this.limite.reservar(chIp, agora) : null;

    const [u] = await this.db.select({ ...colunasPublicas, senhaHash: usuarioSistema.senhaHash }).from(usuarioSistema)
      .where(sql`lower(${usuarioSistema.login}) = ${normalizarLogin(loginDigitado)}`).limit(1);
    const ator: Ator | null = u ? { id: u.id, nome: u.nome, papel: u.papel } : null;
    const falha = (motivo: string) => this.auditoria.registrar(this.db, {
      ator, nomeInformado: loginDigitado, acao: 'auth.login_falha', entidade: 'sessao', ip, depois: { login: loginDigitado.trim(), motivo },
    });

    if (this.limite.estaBloqueada(rLogin, agora) || (rIp && this.limite.estaBloqueada(rIp, agora))) {
      await falha('bloqueado'); // sem verificar a senha: bloqueado não gasta argon2
      return { ok: false, motivo: 'bloqueado', ate: this.fimDoBloqueio([rLogin, rIp], agora) };
    }

    let ok = false;
    if (u && u.ativo) ok = await this.senhas.verificar(u.senhaHash, senha);
    else await this.senhas.verificarFicticio(senha); // mesmo custo: o tempo de resposta não revela se o login existe

    if (!ok) {
      await falha(!u ? 'login_inexistente' : !u.ativo ? 'usuario_inativo' : 'senha_incorreta');
      for (const r of [rLogin, rIp]) {
        if (!r) continue;
        const ate = await this.limite.bloquearSeAtingiu(r, agora);
        if (ate) {
          await this.auditoria.registrar(this.db, {
            ator: r.chave.tipo === 'login' ? ator : null, nomeInformado: r.chave.tipo === 'login' ? loginDigitado : '(ip)',
            acao: 'auth.bloqueio', entidade: 'login_limite', ip, depois: { tipo: r.chave.tipo, falhas: r.falhas, bloqueado_ate: ate },
          });
        }
      }
      await esperar(this.limite.atraso(rLogin.falhas));
      return { ok: false, motivo: 'credenciais' };
    }

    const user = u!;
    const criada = await this.db.transaction(async (tx) => {
      const s = await this.sessoes.criar(tx, user.id, agora, ip, userAgent);
      await tx.update(usuarioSistema).set({ ultimoAcesso: agora }).where(eq(usuarioSistema.id, user.id));
      await this.auditoria.registrar(tx, {
        ator, acao: 'auth.login', entidade: 'sessao', registroId: s.sessaoId, ip, depois: { login: user.login, expira_em: s.expiraEm },
      });
      return s;
    });
    await this.limite.sucesso(chLogin, chIp, agora);
    return { ok: true, token: criada.token, expiraEm: criada.expiraEm, usuario: paraPublico({ ...user, ultimoAcesso: agora }) };
  }

  async logout(ctx: Contexto): Promise<void> {
    const agora = this.relogio.agora();
    await this.db.transaction(async (tx) => {
      await this.sessoes.revogar(tx, ctx.sessaoId, 'logout', agora);
      await this.auditoria.registrar(tx, {
        ator: ctx.ator, acao: 'auth.logout', entidade: 'sessao', registroId: ctx.sessaoId, ip: ctx.ip, depois: { login: ctx.ator.login },
      });
    });
  }

  async me(ctx: Contexto): Promise<UsuarioPublico> {
    const [u] = await this.db.select(colunasPublicas).from(usuarioSistema).where(eq(usuarioSistema.id, ctx.ator.id));
    if (!u) throw erroApi(401, 'SESSAO_INVALIDA', 'Sua sessão expirou. Entre novamente.');
    return paraPublico(u);
  }

  async trocarSenha(ctx: Contexto, senhaAtual: string, novaSenha: string): Promise<UsuarioPublico> {
    const problemas = problemasDaSenha(novaSenha, { login: ctx.ator.login });
    if (problemas.length) throw erroApi(422, 'SENHA_FRACA', problemas[0]!, problemas.map((m) => ({ field: 'novaSenha', message: m })));
    const agora = this.relogio.agora();
    // A senha atual é um segredo sendo adivinhado (sessão roubada): conta no mesmo limite do login.
    const chLogin = this.limite.chave('login', ctx.ator.login);
    const r = await this.limite.reservar(chLogin, agora);
    if (this.limite.estaBloqueada(r, agora)) throw erroApi(429, 'LOGIN_BLOQUEADO', 'Muitas tentativas. Aguarde e tente novamente.');

    const [u] = await this.db.select({ senhaHash: usuarioSistema.senhaHash }).from(usuarioSistema).where(eq(usuarioSistema.id, ctx.ator.id));
    if (!u || !(await this.senhas.verificar(u.senhaHash, senhaAtual))) {
      await this.auditoria.registrar(this.db, {
        ator: ctx.ator, acao: 'auth.trocar_senha_falha', entidade: 'usuario_sistema', registroId: ctx.ator.id, ip: ctx.ip,
      });
      const ate = await this.limite.bloquearSeAtingiu(r, agora);
      if (ate) {
        await this.auditoria.registrar(this.db, {
          ator: ctx.ator, acao: 'auth.bloqueio', entidade: 'login_limite', ip: ctx.ip, depois: { tipo: 'login', falhas: r.falhas, bloqueado_ate: ate },
        });
      }
      throw erroApi(422, 'SENHA_ATUAL_INCORRETA', 'A senha atual não confere.');
    }
    if (novaSenha === senhaAtual) throw erroApi(422, 'SENHA_FRACA', 'A nova senha precisa ser diferente da atual.');

    const novoHash = await this.senhas.gerarHash(novaSenha); // fora da transação: argon2 leva ~250 ms
    return this.db.transaction(async (tx) => {
      const [depois] = await tx.update(usuarioSistema)
        .set({ senhaHash: novoHash, deveTrocarSenha: false, senhaAlteradaEm: agora, atualizadoEm: agora })
        .where(eq(usuarioSistema.id, ctx.ator.id)).returning(colunasPublicas);
      const revogadas = await this.sessoes.revogarDoUsuario(tx, ctx.ator.id, 'troca_senha', agora, ctx.sessaoId);
      await this.limite.zerar(tx, chLogin, agora);
      await this.auditoria.registrar(tx, {
        ator: ctx.ator, acao: 'auth.trocar_senha', entidade: 'usuario_sistema', registroId: ctx.ator.id, ip: ctx.ip,
        antes: { deve_trocar_senha: ctx.ator.deveTrocarSenha }, depois: { deve_trocar_senha: false, sessoes_revogadas: revogadas },
      });
      return paraPublico(depois!);
    });
  }
}
