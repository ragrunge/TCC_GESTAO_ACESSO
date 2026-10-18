// Vínculos (spec §6.2). Por enquanto só a contagem por status, usada pelo badge "Vínculos pendentes" do menu.
// A listagem completa, a conferência e a decisão chegam no lote de pessoas e cadastro.
import { Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Acao } from '../auth/decorators';
import { ZodPipe } from '../comum/zod.pipe';
import { DB, type Db } from '../database/database.module';
import { statusVinculo, vinculoUnidade } from '../db/schema';

const ContagemDto = z.strictObject({ status: z.enum(statusVinculo.enumValues) });

@Controller('vinculos')
export class VinculosController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** `{ status, total }`. Varre a tabela de vínculos pelo status: ela cresce com os moradores (centenas a poucos milhares), não com os acessos. */
  @Get('contagem')
  @Acao('vinculo.ver')
  async contagem(@Query(new ZodPipe(ContagemDto)) q: z.infer<typeof ContagemDto>) {
    const [r] = await this.db.select({ total: count() }).from(vinculoUnidade).where(eq(vinculoUnidade.status, q.status));
    return { status: q.status, total: Number(r?.total ?? 0) };
  }
}

@Module({ controllers: [VinculosController] })
export class VinculosModule {}
