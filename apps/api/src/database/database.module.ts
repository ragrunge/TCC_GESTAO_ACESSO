import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from '../db/schema';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');
/** Tipo comum aos drivers (node-postgres em produção, PGlite nos testes). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = PgTransaction<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;
/** Onde uma escrita roda: a conexão do pool ou a transação do chamador. */
export type Executor = Db | Tx;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) throw new Error('DATABASE_URL não definida');
        // keepAlive: o SO sonda a conexão ociosa; connectionTimeoutMillis: falha rápida em vez de pendurar o request.
        const pool = new Pool({ connectionString, max: 10, keepAlive: true, connectionTimeoutMillis: 5000 });
        // Erro em conexão ociosa não pode derrubar o processo.
        pool.on('error', (erro) => new Logger('Pool').error(erro.message));
        return pool;
      },
    },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool): Db => drizzle(pool, { schema }) as unknown as Db },
  ],
  exports: [PG_POOL, DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
