import { Global, Module } from '@nestjs/common';
import { RELOGIO, relogioDoSistema } from '../comum/relogio';
import { ESTRUTURA_PADRAO } from '@portaria/domain/units';
import { carregarConfig, CONFIG, ESTRUTURA } from './config';

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => carregarConfig(process.env) },
    { provide: RELOGIO, useValue: relogioDoSistema },
    // Estrutura do condomínio (agrupamento "Bloco"/"Torre" e grade inicial): a mesma do seed.
    { provide: ESTRUTURA, useValue: ESTRUTURA_PADRAO },
  ],
  exports: [CONFIG, RELOGIO, ESTRUTURA],
})
export class ConfigModule {}
