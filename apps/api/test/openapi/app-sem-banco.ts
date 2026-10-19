// App do Nest só para ler metadados (gerador de OpenAPI): AppModule real, mas sem banco, sem .env e sem abrir porta.
// DB e PG_POOL são stubs vazios: nenhum serviço consulta o banco na construção, e o app nunca recebe requisição nem init.
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { CONFIG } from '../../src/config/config';
import { RELOGIO, relogioDoSistema } from '../../src/comum/relogio';
import { DB, PG_POOL } from '../../src/database/database.module';
import { configDeTeste } from '../helpers/app';

export async function appSemBanco(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL).useValue({ end: async () => undefined })
    .overrideProvider(DB).useValue({})
    .overrideProvider(CONFIG).useValue(configDeTeste())
    .overrideProvider(RELOGIO).useValue(relogioDoSistema)
    .compile();
  return mod.createNestApplication({ logger: false });
}
