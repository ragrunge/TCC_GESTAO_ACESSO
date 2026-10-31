import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditoriaModule } from './auditoria/auditoria.service';
import { AuthModule } from './auth/auth.module';
import { PapelGuard, SessaoGuard } from './auth/guards';
import { EnvelopeInterceptor } from './comum/envelope.interceptor';
import { FiltroExcecao } from './comum/filtro-excecao';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { SaudeController, SaudeService } from './saude/saude.controller';
import { PessoasModule } from './pessoas/pessoas.module';
import { UnidadesModule } from './unidades/unidades.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { VinculosModule } from './vinculos/vinculos.controller';
import { FuncionariosModule } from './funcionarios/funcionarios.module';
import { ImportacaoModule } from './importacao/importacao.module';
import { VeiculosModule } from './veiculos/veiculos.module';
import { AcessoModule } from './eventos/acesso.module';
import { AuditoriaRotasModule } from './auditoria/auditoria.controller';
import { RelatoriosModule } from './relatorios/relatorios.module';
import { EncomendasModule } from './encomendas/encomendas.module';
import { OcorrenciasModule } from './ocorrencias/ocorrencias.module';
import { SeloModule } from './selo/selo.module';
import { LgpdModule } from './lgpd/lgpd.module';
import { JobsModule } from './jobs/agendador';

@Module({
  imports: [ConfigModule, DatabaseModule, AuditoriaModule, AuthModule, UsuariosModule, UnidadesModule, PessoasModule, VinculosModule,
    FuncionariosModule, VeiculosModule, ImportacaoModule, AcessoModule, AuditoriaRotasModule, RelatoriosModule, EncomendasModule, OcorrenciasModule,
    SeloModule, LgpdModule, JobsModule],
  controllers: [SaudeController],
  providers: [
    SaudeService,
    // Ordem importa: autenticação antes de autorização. Os dois respeitam @Publico() (o /saude continua aberto).
    { provide: APP_GUARD, useClass: SessaoGuard },
    { provide: APP_GUARD, useClass: PapelGuard },
    { provide: APP_FILTER, useClass: FiltroExcecao },
    // Todo 2xx com corpo sai como { data } (ou { data, pagination }); 204 sem corpo.
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
