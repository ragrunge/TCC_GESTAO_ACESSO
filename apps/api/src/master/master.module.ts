// App do Master (docs/05_arquitetura_saas.md SAAS-07/08, F5 entrega 1). Tudo aqui é estático (singleton): depende só do
// banco plataforma, da chave mestra e da configuração, nunca de DB/CONDOMINIO (que são por condomínio). As rotas
// /plataforma passam pelo middleware de condomínio SEM condomínio (plataforma.ts), então nenhuma subárvore de condomínio
// é criada por elas.
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { AuthMasterService } from './auth-master.service';
import { CondominiosMasterService } from './condominios-master.service';
import { LimiteMasterService } from './limite-master.service';
import { AuthMasterController, CondominiosMasterController } from './master.controller';
import { PlataformaGuard } from './plataforma.guard';
import { PROVISIONADOR, provisionadorDoAmbiente } from './provisionador';
import { SessaoMasterService } from './sessao-master.service';

@Module({
  imports: [AuthModule],
  controllers: [AuthMasterController, CondominiosMasterController],
  providers: [
    AuthMasterService, SessaoMasterService, LimiteMasterService, CondominiosMasterService,
    { provide: PROVISIONADOR, useFactory: () => provisionadorDoAmbiente(process.env) },
    // Global e estática: roda antes das guardas duráveis de condomínio e só age em rota `{ tipo: 'plataforma' }`.
    { provide: APP_GUARD, useClass: PlataformaGuard },
  ],
})
export class MasterModule {}
