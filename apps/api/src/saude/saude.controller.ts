import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../database/database.module';
import { eventoAcessoCadeia } from '../db/schema';

@Controller('saude')
export class SaudeController {
  private readonly log = new Logger(SaudeController.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async saude() {
    try {
      await this.db.execute(sql`select 1`);
      const [cabeca] = await this.db
        .select({ ultimoSeq: eventoAcessoCadeia.ultimoSeq })
        .from(eventoAcessoCadeia)
        .limit(1);
      return { status: 'ok', banco: 'ok', ultimoSeq: cabeca?.ultimoSeq ?? null, timeStamp: Date };
    } catch (erro) {
      this.log.error(erro instanceof Error ? (erro.cause instanceof Error ? erro.cause.message : erro.message) : String(erro));
      throw new ServiceUnavailableException({ status: 'erro', banco: 'indisponivel', ultimoSeq: null });
    }
  }
}
