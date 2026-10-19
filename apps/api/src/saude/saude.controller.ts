import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Publico } from '../auth/decorators';
import { DB, type Db } from '../database/database.module';
import { eventoAcessoCadeia } from '../db/schema';

// Público: o healthcheck do compose e do proxy chama sem sessão (guard global não pode derrubar o /saude).
// Não devolve o `ultimo_seq` da cadeia: com o rewrite da Vercel este endpoint fica aberto na internet, e o seq em
// polling mostraria o instante de cada evento da portaria (ver selo/publico.ts). A leitura da cabeça continua aqui
// como prova de que o app_rw enxerga a tabela da trilha, não só de que o banco responde.
@Publico()
@Controller('saude')
export class SaudeController {
  private readonly log = new Logger(SaudeController.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async saude() {
    try {
      await this.db.execute(sql`select 1`);
      await this.db.select({ id: eventoAcessoCadeia.id }).from(eventoAcessoCadeia).limit(1);
      return { status: 'ok', banco: 'ok', em: new Date().toISOString() };
    } catch (erro) {
      this.log.error(erro instanceof Error ? (erro.cause instanceof Error ? erro.cause.message : erro.message) : String(erro));
      throw new ServiceUnavailableException({ status: 'erro', banco: 'indisponivel' });
    }
  }
}
