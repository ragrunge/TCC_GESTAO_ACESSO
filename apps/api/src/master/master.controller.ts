// Rotas do app do Master (/api/v1/plataforma/*, SAAS-07/08). Só o banco plataforma; nenhuma injeta DB de condomínio.
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { MODULOS } from '@portaria/domain/modulos';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ipDe } from '../auth/decorators';
import { SENHA_MAX } from '../auth/senha.service';
import { erroApi } from '../comum/erros';
import { uuidParam, ZodPipe } from '../comum/zod.pipe';
import { CONFIG, type Config } from '../config/config';
import { EntradaJson } from '../saas/provisionar';
import { AuthMasterService, MENSAGEM_CREDENCIAIS_MASTER, MENSAGEM_TEMPORARIA_EXPIRADA_MASTER } from './auth-master.service';
import { CondominiosMasterService } from './condominios-master.service';
import { gravarCookieMaster, limparCookieMaster } from './cookie-master';
import { Master, PlataformaAcao, PlataformaAutenticada, PlataformaPublica } from './decorators';
import { SESSAO_MASTER_INATIVIDADE_MIN } from './sessao-master.service';
import type { AuthMaster } from './tipos';

const LoginDto = z.strictObject({
  email: z.string().trim().min(1, 'Informe o e-mail.').max(254),
  senha: z.string().min(1, 'Informe a senha.').max(SENHA_MAX),
});

const TrocarSenhaDto = z.strictObject({
  senhaAtual: z.string().min(1).max(SENHA_MAX),
  novaSenha: z.string().min(1).max(SENHA_MAX),
});

const ModulosDto = z.strictObject({ modulos: z.array(z.enum(MODULOS)).max(MODULOS.length * 2) });

const sessaoDe = (expiraEm: Date) => ({ expiraEm: expiraEm.toISOString(), inatividadeMin: SESSAO_MASTER_INATIVIDADE_MIN });

@Controller('plataforma/auth')
export class AuthMasterController {
  constructor(
    @Inject(AuthMasterService) private readonly auth: AuthMasterService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Post('login')
  @PlataformaPublica()
  @HttpCode(200)
  async login(@Body(new ZodPipe(LoginDto)) body: z.infer<typeof LoginDto>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body.email, body.senha, ipDe(req));
    if (!r.ok && r.motivo === 'bloqueado') {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((r.ate.getTime() - Date.now()) / 1000))));
      throw erroApi(429, 'LOGIN_BLOQUEADO', 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
    }
    if (!r.ok && r.motivo === 'senha_temporaria_expirada') throw erroApi(401, 'SENHA_TEMPORARIA_EXPIRADA', MENSAGEM_TEMPORARIA_EXPIRADA_MASTER);
    if (!r.ok) throw erroApi(401, 'CREDENCIAIS_INVALIDAS', MENSAGEM_CREDENCIAIS_MASTER);
    gravarCookieMaster(res, this.config, r.token, r.expiraEm);
    return { usuario: r.usuario, sessao: sessaoDe(r.expiraEm) };
  }

  @Post('logout')
  @PlataformaAutenticada({ permiteTrocaPendente: true })
  @HttpCode(204)
  async logout(@Master() m: AuthMaster, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(m);
    limparCookieMaster(res, this.config);
  }

  @Get('me')
  @PlataformaAutenticada({ permiteTrocaPendente: true })
  async me(@Master() m: AuthMaster) {
    return { usuario: await this.auth.me(m), sessao: sessaoDe(m.expiraEm) };
  }

  @Post('trocar-senha')
  @PlataformaAutenticada({ permiteTrocaPendente: true })
  @HttpCode(200)
  async trocarSenha(@Master() m: AuthMaster, @Body(new ZodPipe(TrocarSenhaDto)) body: z.infer<typeof TrocarSenhaDto>) {
    return { usuario: await this.auth.trocarSenha(m, body.senhaAtual, body.novaSenha) };
  }
}

@Controller('plataforma/provisionador')
export class ProvisionadorMasterController {
  constructor(@Inject(CondominiosMasterService) private readonly condominios: CondominiosMasterService) {}

  /**
   * O serviço provisionador está de pé? Só para quem pode criar condomínio (mesma permissão de POST /condominios).
   * Responde `{ disponivel }` e nada mais: nem URL, nem token, nem o motivo da falha. Consulta com timeout curto.
   */
  @Get('saude')
  @PlataformaAcao('condominio.criar')
  saude() {
    return this.condominios.provisionadorDisponivel(); // no-store: global (plataforma.ts)
  }
}

@Controller('plataforma/condominios')
export class CondominiosMasterController {
  constructor(@Inject(CondominiosMasterService) private readonly condominios: CondominiosMasterService) {}

  @Get()
  @PlataformaAcao('condominio.listar')
  listar() {
    return this.condominios.listar();
  }

  /**
   * Mesmo contrato do JSON da CLI provisionar-condominio (docs/deploy.md §16.2). A senha temporária do síndico volta UMA
   * vez, nesta resposta (Cache-Control: no-store, como toda a API); reenviar a mesma entrada responde `ja_provisionado`
   * sem senha.
   */
  @Post()
  @PlataformaAcao('condominio.criar')
  @HttpCode(201)
  async criar(@Master() m: AuthMaster, @Body(new ZodPipe(EntradaJson)) corpo: z.infer<typeof EntradaJson>, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.condominios.criar(m, corpo);
  }

  @Patch(':id/modulos')
  @PlataformaAcao('condominio.modulos')
  async modulos(@Master() m: AuthMaster, @Param('id', uuidParam) id: string, @Body(new ZodPipe(ModulosDto)) body: z.infer<typeof ModulosDto>) {
    return this.condominios.modulos(m, id, body.modulos);
  }
}
