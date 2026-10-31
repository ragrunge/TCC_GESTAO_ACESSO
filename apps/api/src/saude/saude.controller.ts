import { Controller, Get, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Publico } from '../auth/decorators';
import { DB, type Db } from '../database/database.module';
import { eventoAcessoCadeia } from '../db/schema';

/** Validade do resultado do /saude: o healthcheck e quem chama de fora não viram uma consulta ao banco a cada vez. */
export const SAUDE_CACHE_MS = 5_000;

/** Checagem do /saude: a cabeça da cadeia legível pelo app_rw. O cache vale para o processo. */
@Injectable()
export class SaudeService {
  private readonly log = new Logger('Saude');
  private cache: { ate: number; valor: Promise<boolean> } | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  verificar(): Promise<boolean> {
    const agora = Date.now();
    if (!this.cache || this.cache.ate <= agora) this.cache = { ate: agora + SAUDE_CACHE_MS, valor: this.checar() };
    return this.cache.valor;
  }

  private async checar(): Promise<boolean> {
    try {
      await this.db.select({ id: eventoAcessoCadeia.id }).from(eventoAcessoCadeia).limit(1);
      return true;
    } catch (erro) {
      this.log.error(erro instanceof Error ? (erro.cause instanceof Error ? erro.cause.message : erro.message) : String(erro));
      return false;
    }
  }
}

// Público: o healthcheck do compose chama sem sessão (guard global não pode derrubar o /saude).
// Não devolve o `ultimo_seq` da cadeia: se este endpoint ficar aberto na internet, o seq em polling mostraria o
// instante de cada evento da portaria (ver selo/publico.ts). A leitura da cabeça continua aqui como prova de que o
// app_rw enxerga a tabela da trilha, não só de que o banco responde.
@Publico()
@Controller('saude')
export class SaudeController {
  constructor(@Inject(SaudeService) private readonly saudeService: SaudeService) {}

  @Get()
  async saude() {
    if (!(await this.saudeService.verificar())) throw new ServiceUnavailableException({ status: 'erro', banco: 'indisponivel' });
    return { status: 'ok', banco: 'ok', em: new Date().toISOString() };
  }
}
