// Trava de job entre processos (várias réplicas da API, o agendador e o pedido sob demanda): advisory lock de SESSÃO
// numa conexão dedicada do pool, `pg_try_advisory_lock` (não espera: se outra réplica já está rodando, esta pula).
// Se o processo cair, a conexão fecha e o Postgres solta a trava sozinho; não há lease nem tabela para limpar.
//
// A trava evita trabalho e e-mail em dobro; a CORREÇÃO não depende dela: cada passo é idempotente no banco (selo diário
// com índice único, pessoa travada e reconferida antes de anonimizar, descarte com a cabeça da cadeia travada, documento
// só é marcado se ainda não foi eliminado).
//
// Nos testes com PGlite (uma conexão só, sem pool), não há concorrência a proteger: roda direto.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';

export type NomeJob = 'retencao' | 'selo';

@Injectable()
export class TravaJobs {
  constructor(@Inject(PG_POOL) private readonly pool: Pool | { end(): Promise<void> }) {}

  /** Roda `fn` com a trava; `{ obtida: false }` se outro processo a tem. */
  async tentar<T>(nome: NomeJob, fn: () => Promise<T>): Promise<{ obtida: true; valor: T } | { obtida: false }> {
    if (!('connect' in this.pool)) return { obtida: true, valor: await fn() };
    const chave = `portaria:job:${nome}`;
    const c: PoolClient = await this.pool.connect();
    let solta = false;
    try {
      const r = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok', [chave]);
      if (!r.rows[0]?.ok) return { obtida: false };
      try {
        return { obtida: true, valor: await fn() };
      } finally {
        try { await c.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [chave]); } catch {
          solta = true; // conexão com problema: descartada abaixo, o que solta a trava de sessão
        }
      }
    } finally {
      c.release(solta);
    }
  }
}
