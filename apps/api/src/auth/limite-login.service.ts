// Limite de tentativas de login (spec §5.1): 10 falhas por login ou 30 por IP em 15 min bloqueiam por 15 min
// (padrões de config.ts, ajustáveis por ambiente).
//
// Persistente (tabela login_limite) e não em memória: com duas réplicas, um contador por processo dobraria o limite.
// A tentativa é RESERVADA (contada) antes de verificar a senha, num UPSERT atômico: N requisições paralelas não
// conseguem N palpites, porque a (máximo+1)ª já vê o contador acima do limite. No sucesso, a reserva é desfeita.
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or, isNull, lte, sql } from 'drizzle-orm';
import { createHmac, hkdfSync } from 'node:crypto';
import { CONFIG, type Config } from '../config/config';
import { DB, type Db, type Executor } from '../database/database.module';
import { loginLimite } from '../db/schema';

export type TipoLimite = 'login' | 'ip';

export interface ChaveLimite {
  tipo: TipoLimite;
  chave: string;
}

export interface Reserva {
  chave: ChaveLimite;
  falhas: number;
  bloqueadoAte: Date | null;
}

export const normalizarLogin = (login: string) => login.trim().toLowerCase();

@Injectable()
export class LimiteLoginService {
  private readonly subchave: Buffer;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
  ) {
    // Subchave dedicada (HKDF): a chave do CPF não é usada diretamente para outro fim.
    this.subchave = Buffer.from(hkdfSync('sha256', config.hmacCpfKey, Buffer.alloc(0), 'portaria/login_limite/v1', 32));
  }

  /** HMAC, não SHA puro: o login digitado pode ser um CPF, e o espaço do CPF (e do IPv4) se percorre por força bruta. */
  chave(tipo: TipoLimite, valor: string): ChaveLimite {
    const v = tipo === 'login' ? normalizarLogin(valor) : valor;
    return { tipo, chave: createHmac('sha256', this.subchave).update(`${tipo}:${v}`, 'utf8').digest('hex') };
  }

  maximo(tipo: TipoLimite) {
    return tipo === 'login' ? this.config.login.maxFalhasLogin : this.config.login.maxFalhasIp;
  }

  /**
   * Conta a tentativa. Bloqueio vigente: não mexe no contador. Janela vencida ou bloqueio já expirado: recomeça em 1.
   * Instantes do relógio da API passados como texto + cast (Date cru em `sql` livre depende do driver).
   */
  async reservar(c: ChaveLimite, agora: Date): Promise<Reserva> {
    const t = agora.toISOString();
    const janela = this.config.login.janelaMin;
    const res = (await this.db.execute(sql`
      INSERT INTO login_limite AS l (tipo, chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
      VALUES (${c.tipo}, ${c.chave}, 1, ${t}::timestamptz, NULL, ${t}::timestamptz)
      ON CONFLICT (tipo, chave) DO UPDATE SET
        falhas = CASE
          WHEN l.bloqueado_ate > ${t}::timestamptz THEN l.falhas
          WHEN l.bloqueado_ate IS NOT NULL OR l.janela_inicio <= ${t}::timestamptz - make_interval(mins => ${janela}) THEN 1
          ELSE l.falhas + 1 END,
        janela_inicio = CASE
          WHEN l.bloqueado_ate > ${t}::timestamptz THEN l.janela_inicio
          WHEN l.bloqueado_ate IS NOT NULL OR l.janela_inicio <= ${t}::timestamptz - make_interval(mins => ${janela}) THEN ${t}::timestamptz
          ELSE l.janela_inicio END,
        bloqueado_ate = CASE WHEN l.bloqueado_ate > ${t}::timestamptz THEN l.bloqueado_ate ELSE NULL END,
        atualizado_em = ${t}::timestamptz
      RETURNING falhas, bloqueado_ate`)) as unknown as { rows: { falhas: number | string; bloqueado_ate: string | Date | null }[] };
    const linha = res.rows[0]!;
    return { chave: c, falhas: Number(linha.falhas), bloqueadoAte: linha.bloqueado_ate ? new Date(linha.bloqueado_ate) : null };
  }

  /** Bloqueada se há bloqueio vigente ou se a tentativa passou do máximo (concorrência antes do bloqueio gravar). */
  estaBloqueada(r: Reserva, agora: Date): boolean {
    return (r.bloqueadoAte !== null && r.bloqueadoAte > agora) || r.falhas > this.maximo(r.chave.tipo);
  }

  /**
   * Depois de uma falha verificada: ao atingir o máximo, grava o bloqueio. Devolve o fim do bloqueio só se ESTA chamada
   * o criou (para o auth.bloqueio sair uma vez, mesmo com requisições concorrentes).
   */
  async bloquearSeAtingiu(r: Reserva, agora: Date): Promise<Date | null> {
    if (r.falhas < this.maximo(r.chave.tipo)) return null;
    const ate = new Date(agora.getTime() + this.bloqueioMs());
    const linhas = await this.db.update(loginLimite)
      .set({ bloqueadoAte: ate, atualizadoEm: agora })
      .where(and(eq(loginLimite.tipo, r.chave.tipo), eq(loginLimite.chave, r.chave.chave),
        or(isNull(loginLimite.bloqueadoAte), lte(loginLimite.bloqueadoAte, agora))))
      .returning({ tipo: loginLimite.tipo });
    return linhas.length ? ate : null;
  }

  /** Login com sucesso: zera o contador do login e desfaz a reserva do IP (sem zerar: outras contas no mesmo IP). */
  async sucesso(login: ChaveLimite, ip: ChaveLimite | null, agora: Date): Promise<void> {
    await this.zerar(this.db, login, agora);
    if (ip) {
      await this.db.update(loginLimite)
        .set({ falhas: sql`greatest(${loginLimite.falhas} - 1, 0)`, atualizadoEm: agora })
        .where(and(eq(loginLimite.tipo, ip.tipo), eq(loginLimite.chave, ip.chave)));
    }
  }

  /** Também usado pela redefinição de senha (desbloqueia o login do alvo), dentro da transação dela. */
  async zerar(exec: Executor, c: ChaveLimite, agora: Date): Promise<void> {
    await exec.update(loginLimite)
      .set({ falhas: 0, janelaInicio: agora, bloqueadoAte: null, atualizadoEm: agora })
      .where(and(eq(loginLimite.tipo, c.tipo), eq(loginLimite.chave, c.chave)));
  }

  bloqueioMs() {
    return this.config.login.bloqueioMin * 60_000;
  }

  /** Atraso crescente das falhas: base * 2^(n-1), com teto. */
  atraso(falhas: number): number {
    const { atrasoBaseMs, atrasoMaxMs } = this.config.login;
    if (atrasoBaseMs <= 0) return 0;
    return Math.min(atrasoMaxMs, atrasoBaseMs * 2 ** Math.max(0, falhas - 1));
  }
}
