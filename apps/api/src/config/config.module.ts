import { Global, Module } from '@nestjs/common';
import { RELOGIO, relogioDoSistema } from '../comum/relogio';
import { carregarConfig, CONFIG } from './config';

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => carregarConfig(process.env) },
    { provide: RELOGIO, useValue: relogioDoSistema },
  ],
  exports: [CONFIG, RELOGIO],
})
export class ConfigModule {}
