import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EsperaLogin } from './espera-login';
import { LimiteLoginService } from './limite-login.service';
import { SenhaService } from './senha.service';
import { SessaoService } from './sessao.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SenhaService, SessaoService, LimiteLoginService, EsperaLogin],
  exports: [SenhaService, SessaoService, LimiteLoginService, EsperaLogin],
})
export class AuthModule {}
