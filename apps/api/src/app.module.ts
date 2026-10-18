import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditoriaModule } from './auditoria/auditoria.service';
import { AuthModule } from './auth/auth.module';
import { PapelGuard, SessaoGuard } from './auth/guards';
import { EnvelopeInterceptor } from './comum/envelope.interceptor';
import { FiltroExcecao } from './comum/filtro-excecao';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { SaudeController } from './saude/saude.controller';
import { PessoasModule } from './pessoas/pessoas.module';
import { UnidadesModule } from './unidades/unidades.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { VinculosModule } from './vinculos/vinculos.controller';
import { FuncionariosModule } from './funcionarios/funcionarios.module';
import { ImportacaoModule } from './importacao/importacao.module';
import { VeiculosModule } from './veiculos/veiculos.module';

@Module({
  imports: [ConfigModule, DatabaseModule, AuditoriaModule, AuthModule, UsuariosModule, UnidadesModule, PessoasModule, VinculosModule,
    FuncionariosModule, VeiculosModule, ImportacaoModule],
  controllers: [SaudeController],
  providers: [
    // Ordem importa: autenticação antes de autorização. Os dois respeitam @Publico() (o /saude continua aberto).
    { provide: APP_GUARD, useClass: SessaoGuard },
    { provide: APP_GUARD, useClass: PapelGuard },
    { provide: APP_FILTER, useClass: FiltroExcecao },
    // Todo 2xx com corpo sai como { data } (ou { data, pagination }); 204 sem corpo.
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
