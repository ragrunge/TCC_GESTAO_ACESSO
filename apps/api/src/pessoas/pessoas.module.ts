// Busca de pessoas e busca global (spec §6.2, RF-18 e RF-34). POST com o termo no CORPO: o termo pode ser um CPF, e a
// URL (query string) fica registrada em proxies e na borda da Vercel, fora do controle do log da API.
// O CRUD de pessoas chega no próximo lote.
import { Body, Controller, HttpCode, Inject, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { Acao } from '../auth/decorators';
import { ZodPipe } from '../comum/zod.pipe';
import { BuscaService } from './busca.service';

const Termo = z.string().max(100);
const BuscaPessoasDto = z.strictObject({
  q: Termo,
  /** Padrão 8, como o mock. A portaria pede 8 e usa `temMais` para avisar que há mais resultados. */
  limite: z.number().int().min(1).max(50).default(8),
  semMoradores: z.boolean().default(false),
});
const BuscaGlobalDto = z.strictObject({ q: Termo });

@Controller()
export class PessoasController {
  constructor(@Inject(BuscaService) private readonly busca: BuscaService) {}

  /** `{ pessoas, temMais }`. */
  @Post('pessoas/busca')
  @Acao('pessoa.ver')
  @HttpCode(200)
  buscar(@Body(new ZodPipe(BuscaPessoasDto)) b: z.infer<typeof BuscaPessoasDto>) {
    return this.busca.pessoas(b.q, { limite: b.limite, semMoradores: b.semMoradores });
  }

  /** Busca do topo: `{ pessoas, unidades: [{ id, motivo }], temMaisPessoas }`. */
  @Post('busca')
  @Acao('pessoa.ver')
  @HttpCode(200)
  global(@Body(new ZodPipe(BuscaGlobalDto)) b: z.infer<typeof BuscaGlobalDto>) {
    return this.busca.global(b.q);
  }
}

@Module({ controllers: [PessoasController], providers: [BuscaService], exports: [BuscaService] })
export class PessoasModule {}
