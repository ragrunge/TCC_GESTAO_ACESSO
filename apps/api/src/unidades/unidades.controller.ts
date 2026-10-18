// Rotas de unidades (spec §6.2, RF-01) e catálogo leve. Permissões da MATRIZ (@portaria/domain/rbac):
// GET unidade.ver (todos); escrita unidade.editar (SI, AD). Catálogo: qualquer usuário logado (o Layout precisa dele).
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Acao, Autenticado, Ctx } from '../auth/decorators';
import type { Contexto } from '../auth/tipos';
import { PaginacaoDto } from '../comum/pagina';
import { uuidParam, ZodPipe } from '../comum/zod.pipe';
import { UnidadesService } from './unidades.service';

const ListarUnidadesDto = PaginacaoDto.extend({ torre: z.coerce.number().int().min(1).max(99).optional() });

/** Corpo de criar/editar. A estrutura (torre 1..99, número de 1 a 4 dígitos) é validada no serviço com a regra do
 *  domain e responde 422 UNIDADE_INVALIDA, como o mock; aqui só o tipo. */
const UnidadeDto = z.strictObject({ torre: z.number().int(), numero: z.string().max(10) });

/** uuid ou código legível ("T4-32"). */
const refParam = new ZodPipe(z.string().trim().min(1).max(40));

@Controller()
export class UnidadesController {
  constructor(@Inject(UnidadesService) private readonly unidades: UnidadesService) {}

  @Get('catalogo')
  @Autenticado()
  catalogo() {
    return this.unidades.catalogo();
  }

  @Get('unidades')
  @Acao('unidade.ver')
  listar(@Query(new ZodPipe(ListarUnidadesDto)) q: z.infer<typeof ListarUnidadesDto>) {
    return this.unidades.listar(q);
  }

  @Get('unidades/:ref')
  @Acao('unidade.ver')
  detalhe(@Param('ref', refParam) ref: string) {
    return this.unidades.detalhe(ref);
  }

  @Post('unidades')
  @Acao('unidade.editar')
  criar(@Ctx() ctx: Contexto, @Body(new ZodPipe(UnidadeDto)) body: z.infer<typeof UnidadeDto>) {
    return this.unidades.criar(ctx, body);
  }

  @Patch('unidades/:id')
  @Acao('unidade.editar')
  editar(@Ctx() ctx: Contexto, @Param('id', uuidParam) id: string, @Body(new ZodPipe(UnidadeDto)) body: z.infer<typeof UnidadeDto>) {
    return this.unidades.editar(ctx, id, body);
  }

  @Post('unidades/:id/desativar')
  @Acao('unidade.editar')
  @HttpCode(200)
  desativar(@Ctx() ctx: Contexto, @Param('id', uuidParam) id: string) {
    return this.unidades.desativar(ctx, id);
  }

  @Post('unidades/:id/reativar')
  @Acao('unidade.editar')
  @HttpCode(200)
  reativar(@Ctx() ctx: Contexto, @Param('id', uuidParam) id: string) {
    return this.unidades.reativar(ctx, id);
  }
}
