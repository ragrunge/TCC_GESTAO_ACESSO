// App do Nest só para ler metadados (gerador de OpenAPI): AppModule real, mas sem banco, sem .env e sem abrir porta.
// Banco e condomínio são stubs: nada é consultado na construção, e o app nunca recebe requisição nem init.
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { CONFIG } from '../../src/config/config';
import { RELOGIO, relogioDoSistema } from '../../src/comum/relogio';
import { CONDOMINIO, type Condominio } from '../../src/condominio/condominio';
import { DB, PG_POOL } from '../../src/database/database.module';
import { configDeTeste } from '../helpers/app';

export async function appSemBanco(): Promise<INestApplication> {
  const config = configDeTeste();
  const condominio: Condominio = { nome: config.condominio.nome, agrupamento: 'Bloco', chaves: config.condominio.chaves };
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL).useValue(null)
    .overrideProvider(DB).useValue({})
    .overrideProvider(CONDOMINIO).useValue(condominio)
    .overrideProvider(CONFIG).useValue(config)
    .overrideProvider(RELOGIO).useValue(relogioDoSistema)
    .compile();
  return mod.createNestApplication({ logger: false });
}
