// Banco da API: um condomínio, um banco (`portaria`), um pool `app_rw` aberto pela `DATABASE_URL`.
//  - `PG_POOL` / `DB`: o pool e o executor do Drizzle. Os serviços usam `@Inject(DB) db`.
//  - `CONDOMINIO`: nome, agrupamento e chaves do condomínio, montados uma vez no boot (condominio/carregar.ts).
//  - `ESTRUTURA`: o agrupamento ("Bloco"/"Torre") que o front exibe.
import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import type { ConfigEstrutura } from '@portaria/domain/units';
import { CONFIG, type Config, ESTRUTURA } from '../config/config';
import { carregarCondominio } from '../condominio/carregar';
import { CONDOMINIO, type Condominio } from '../condominio/condominio';
import * as schema from '../db/schema';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');
/** Tipo comum aos drivers (node-postgres em produção, PGlite nos testes). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = PgTransaction<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;
/** Onde uma escrita roda: a conexão do pool ou a transação do chamador. */
export type Executor = Db | Tx;

/** O que a API usa da estrutura do condomínio: só o nome do agrupamento (as unidades vêm do banco). */
export type EstruturaCondominio = Pick<ConfigEstrutura, 'agrupamento'>;

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
        // Erro em conexão ociosa não pode derrubar o processo. Só a mensagem do driver (não traz a senha).
        pool.on('error', (erro) => new Logger('Pool').error(erro.message));
        return pool;
      },
    },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: Pool): Db => drizzle(pool, { schema }) as unknown as Db },
    { provide: CONDOMINIO, inject: [CONFIG, DB], useFactory: (config: Config, db: Db): Promise<Condominio> => carregarCondominio(config, db) },
    { provide: ESTRUTURA, inject: [CONDOMINIO], useFactory: (c: Condominio): EstruturaCondominio => ({ agrupamento: c.agrupamento }) },
  ],
  exports: [PG_POOL, DB, CONDOMINIO, ESTRUTURA],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: { end(): Promise<void> } | null) {}

  async onApplicationShutdown() {
    await this.pool?.end();
  }
}
