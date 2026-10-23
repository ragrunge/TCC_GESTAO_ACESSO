// Login do Master em UM passo: e-mail + senha + código TOTP no mesmo envio (docs/05_arquitetura_saas.md §5.3).
// Por que um passo: em dois passos, o "senha certa, agora o código" confirma a senha a quem não tem o celular, e o meio
// do caminho exige um estado de pré-sessão (mais um token, mais uma tabela, mais uma rota). Aqui qualquer falha (e-mail
// inexistente, usuário inativo, senha errada, código errado ou reutilizado) dá a MESMA resposta, no mesmo custo de argon2
// (inexistente gasta o hash fictício), sob o mesmo limite de tentativas. A senha temporária vencida só é revelada a quem
// acerta senha E código (como no condomínio, que a revela a quem acerta a senha).
import { Inject, Injectable } from '@nestjs/common';
import { senhaTemporariaVencida } from '@portaria/domain/rules';
import type { PapelPlataforma } from '@portaria/domain/rbac-plataforma';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { erroApi } from '../comum/erros';
import { RELOGIO, type Relogio } from '../comum/relogio';
import { EsperaLogin } from '../auth/login-sem-condominio';
import { normalizarLogin } from '../auth/limite-login.service';
import { problemasDaSenha, SenhaService } from '../auth/senha.service';
import type { ChaveMestra } from '../saas/chave-mestra';
import { CHAVE_MESTRA, type DbPlataforma, PLATAFORMA_DB } from '../saas/plataforma-db';
import { masterUsuario } from '../saas/schema-plataforma';
import { LimiteMasterService, type ReservaMaster } from './limite-master.service';
import { decifrarSegredoTotp } from './segredo-totp';
import { SessaoMasterService } from './sessao-master.service';
import type { AuthMaster, UsuarioPlataforma } from './tipos';
import { verificarTotp } from './totp';
import { registrarPlataforma } from './trilha-plataforma';

export const MENSAGEM_CREDENCIAIS_MASTER = 'E-mail, senha ou código inválidos.';
export const MENSAGEM_TEMPORARIA_EXPIRADA_MASTER = 'Senha temporária vencida. Peça uma nova ao operador da plataforma.';

export type ResultadoLoginMaster =
  | { ok: true; token: string; expiraEm: Date; usuario: UsuarioPlataforma }
  | { ok: false; motivo: 'credenciais' | 'senha_temporaria_expirada' }
  | { ok: false; motivo: 'bloqueado'; ate: Date };

const colunas = {
  id: masterUsuario.id, nome: masterUsuario.nome, email: masterUsuario.email, papel: masterUsuario.papel,
  deveTrocarSenha: masterUsuario.deveTrocarSenha,
};
const publico = (u: { id: string; nome: string; email: string; papel: string; deveTrocarSenha: boolean }): UsuarioPlataforma =>
  ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel as PapelPlataforma, deveTrocarSenha: u.deveTrocarSenha });

class Reutilizado extends Error {}

@Injectable()
export class AuthMasterService {
  constructor(
    @Inject(PLATAFORMA_DB) private readonly db: DbPlataforma,
    @Inject(CHAVE_MESTRA) private readonly mestra: ChaveMestra,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(SenhaService) private readonly senhas: SenhaService,
    @Inject(SessaoMasterService) private readonly sessoes: SessaoMasterService,
    @Inject(LimiteMasterService) private readonly limite: LimiteMasterService,
    @Inject(EsperaLogin) private readonly espera: EsperaLogin,
  ) {}

  private fimDoBloqueio(rs: (ReservaMaster | null)[], agora: Date): Date {
    const fins = rs.filter((r): r is ReservaMaster => !!r?.bloqueadoAte && r.bloqueadoAte > agora).map((r) => r.bloqueadoAte!.getTime());
    return new Date(fins.length ? Math.max(...fins) : agora.getTime() + this.limite.bloqueioMs());
  }

  async login(email: string, senha: string, codigo: string, ip: string | null): Promise<ResultadoLoginMaster> {
    const agora = this.relogio.agora();
    const chLogin = this.limite.chave('master', email);
    const chPar = this.limite.chavePar(email, ip);
    const chIp = ip ? this.limite.chave('ip', ip) : null;
    const rLogin = await this.limite.reservar(chLogin, agora);
    const rPar = await this.limite.reservar(chPar, agora);
    const rIp = chIp ? await this.limite.reservar(chIp, agora) : null;

    const [u] = await this.db.select({
      ...colunas, ativo: masterUsuario.ativo, senhaHash: masterUsuario.senhaHash, totpCifrado: masterUsuario.totpCifrado,
      totpMestraVersao: masterUsuario.totpMestraVersao, totpUltimoPasso: masterUsuario.totpUltimoPasso,
      senhaTemporariaExpiraEm: masterUsuario.senhaTemporariaExpiraEm,
    }).from(masterUsuario).where(sql`lower(${masterUsuario.email}) = ${normalizarLogin(email)}`).limit(1);
    // O e-mail digitado NÃO vai para a trilha (append-only): login existente = o id do ator; inexistente = só o motivo.
    const falha = (motivo: string) => registrarPlataforma(this.db, {
      masterUsuarioId: u?.id ?? null, acao: 'auth.login_falha', detalhes: { motivo, ip },
    });

    if (this.limite.estaBloqueada(rPar, agora) || (rIp && this.limite.estaBloqueada(rIp, agora))) {
      await falha('bloqueado'); // sem argon2 nem TOTP
      return { ok: false, motivo: 'bloqueado', ate: this.fimDoBloqueio([rPar, rIp], agora) };
    }

    let senhaOk = false;
    if (u && u.ativo) senhaOk = await this.senhas.verificar(u.senhaHash, senha);
    else await this.senhas.verificarFicticio(senha);

    let passo: number | null = null;
    let reutilizado = false;
    if (senhaOk) {
      const segredo = decifrarSegredoTotp(this.mestra, u!.id, u!);
      try {
        passo = verificarTotp(segredo, codigo, agora, u!.totpUltimoPasso);
        reutilizado = passo === null && u!.totpUltimoPasso !== null && verificarTotp(segredo, codigo, agora, null) !== null;
      } finally {
        segredo.fill(0);
      }
    }
    const vencida = senhaOk && passo !== null
      && senhaTemporariaVencida({ deveTrocarSenha: u!.deveTrocarSenha, senhaTemporariaExpiraEm: u!.senhaTemporariaExpiraEm?.getTime() ?? null }, agora.getTime());

    if (!senhaOk || passo === null || vencida) {
      const motivo = !u ? 'login_inexistente' : !u.ativo ? 'usuario_inativo' : !senhaOk ? 'senha_incorreta'
        : reutilizado ? 'codigo_reutilizado' : passo === null ? 'codigo_incorreto' : 'senha_temporaria_expirada';
      return this.recusar(motivo, falha, u?.id ?? null, ip, [rPar, rIp], rLogin, agora, vencida);
    }

    const usuario = u!;
    let criada: Awaited<ReturnType<SessaoMasterService['criar']>>;
    try {
      criada = await this.db.transaction(async (tx) => {
        // Anti-replay atômico: só grava se o passo for maior que o último aceito. Dois logins com o mesmo código ao mesmo
        // tempo: um vence, o outro não acha a linha e vira falha.
        const marcado = await tx.update(masterUsuario).set({ totpUltimoPasso: passo!, ultimoAcesso: agora })
          .where(and(eq(masterUsuario.id, usuario.id), or(isNull(masterUsuario.totpUltimoPasso), lt(masterUsuario.totpUltimoPasso, passo!))))
          .returning({ id: masterUsuario.id });
        if (!marcado.length) throw new Reutilizado();
        const s = await this.sessoes.criar(tx, usuario.id, agora, ip);
        await registrarPlataforma(tx, { masterUsuarioId: usuario.id, acao: 'auth.login', detalhes: { sessao_id: s.sessaoId, expira_em: s.expiraEm, ip } });
        return s;
      });
    } catch (e) {
      if (!(e instanceof Reutilizado)) throw e;
      return this.recusar('codigo_reutilizado', falha, usuario.id, ip, [rPar, rIp], rLogin, agora, false);
    }
    await this.limite.sucesso(chLogin, chPar, chIp, agora);
    return { ok: true, token: criada.token, expiraEm: criada.expiraEm, usuario: publico(usuario) };
  }

  private async recusar(motivo: string, falha: (m: string) => Promise<void>, usuarioId: string | null, ip: string | null,
    reservas: (ReservaMaster | null)[], rLogin: ReservaMaster, agora: Date, vencida: boolean): Promise<ResultadoLoginMaster> {
    await falha(motivo);
    for (const r of reservas) {
      if (!r) continue;
      const ate = await this.limite.bloquearSeAtingiu(r, agora);
      if (ate) {
        await registrarPlataforma(this.db, {
          masterUsuarioId: r.chave.tipo === 'master_ip' ? usuarioId : null, acao: 'auth.bloqueio',
          detalhes: { tipo: r.chave.tipo, falhas: r.falhas, bloqueado_ate: ate, ip },
        });
      }
    }
    await this.espera.esperar(this.limite.atraso(rLogin.falhas));
    return { ok: false, motivo: vencida ? 'senha_temporaria_expirada' : 'credenciais' };
  }

  async logout(m: AuthMaster): Promise<void> {
    const agora = this.relogio.agora();
    await this.db.transaction(async (tx) => {
      await this.sessoes.revogar(tx, m.sessaoId, 'logout', agora);
      await registrarPlataforma(tx, { masterUsuarioId: m.usuario.id, acao: 'auth.logout', detalhes: { sessao_id: m.sessaoId, ip: m.ip } });
    });
  }

  async me(m: AuthMaster): Promise<UsuarioPlataforma> {
    const [u] = await this.db.select(colunas).from(masterUsuario).where(eq(masterUsuario.id, m.usuario.id));
    if (!u) throw erroApi(401, 'SESSAO_INVALIDA', 'Sua sessão expirou. Entre novamente.');
    return publico(u);
  }

  async trocarSenha(m: AuthMaster, senhaAtual: string, novaSenha: string): Promise<UsuarioPlataforma> {
    const problemas = problemasDaSenha(novaSenha, { login: m.usuario.email });
    if (problemas.length) throw erroApi(422, 'SENHA_FRACA', problemas[0]!, problemas.map((message) => ({ field: 'novaSenha', message })));
    const agora = this.relogio.agora();
    // A senha atual é um segredo sendo adivinhado (sessão roubada): conta no limite do par login+IP, o mesmo do login.
    const par = this.limite.chavePar(m.usuario.email, m.ip);
    const r = await this.limite.reservar(par, agora);
    if (this.limite.estaBloqueada(r, agora)) throw erroApi(429, 'LOGIN_BLOQUEADO', 'Muitas tentativas. Aguarde e tente novamente.');
    const [u] = await this.db.select({ senhaHash: masterUsuario.senhaHash }).from(masterUsuario).where(eq(masterUsuario.id, m.usuario.id));
    if (!u || !(await this.senhas.verificar(u.senhaHash, senhaAtual))) {
      await registrarPlataforma(this.db, { masterUsuarioId: m.usuario.id, acao: 'auth.trocar_senha_falha', detalhes: { ip: m.ip } });
      const ate = await this.limite.bloquearSeAtingiu(r, agora);
      if (ate) await registrarPlataforma(this.db, { masterUsuarioId: m.usuario.id, acao: 'auth.bloqueio', detalhes: { tipo: 'master_ip', falhas: r.falhas, bloqueado_ate: ate, ip: m.ip } });
      throw erroApi(422, 'SENHA_ATUAL_INCORRETA', 'A senha atual não confere.');
    }
    if (novaSenha === senhaAtual) throw erroApi(422, 'SENHA_FRACA', 'A nova senha precisa ser diferente da atual.', [{ field: 'novaSenha', message: 'A nova senha precisa ser diferente da atual.' }]);
    const novoHash = await this.senhas.gerarHash(novaSenha); // fora da transação: argon2 leva centenas de ms
    const usuario = await this.db.transaction(async (tx) => {
      const [depois] = await tx.update(masterUsuario).set({ senhaHash: novoHash, deveTrocarSenha: false, senhaTemporariaExpiraEm: null })
        .where(eq(masterUsuario.id, m.usuario.id)).returning(colunas);
      const revogadas = await this.sessoes.revogarDoUsuario(tx, m.usuario.id, 'troca_senha', agora, m.sessaoId);
      await registrarPlataforma(tx, {
        masterUsuarioId: m.usuario.id, acao: 'auth.trocar_senha',
        detalhes: { deve_trocar_senha_antes: m.usuario.deveTrocarSenha, sessoes_revogadas: revogadas, ip: m.ip },
      });
      return publico(depois!);
    });
    await this.limite.sucesso(this.limite.chave('master', m.usuario.email), par, null, agora);
    return usuario;
  }
}
