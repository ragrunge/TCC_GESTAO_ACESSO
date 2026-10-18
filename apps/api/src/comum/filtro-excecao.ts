// Filtro global: toda resposta de erro sai no formato { codigo, mensagem, detalhes? } e nenhum erro de driver,
// SQL ou parâmetro chega ao cliente ou ao log. (DrizzleQueryError.message traz o SQL E OS PARÂMETROS: hash de senha,
// nome, telefone. Do erro de banco só vão ao log o SQLSTATE e o nome da constraint.)
//
// Todo 403 grava `acesso.negado` (spec §5.2). Gravar aqui, e não onde a negação acontece, garante duas coisas:
// nenhum 403 escapa da trilha, e a gravação roda DEPOIS do rollback da transação que negou (dentro dela, sumiria).
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ipDe } from '../auth/decorators';
import { DB, type Db } from '../database/database.module';
import { AcessoNegado, codigoPg, constraintPg, type CorpoErro } from './erros';
import { log } from './log';

const CODIGO_POR_STATUS: Record<number, string> = {
  400: 'REQUISICAO_INVALIDA', 401: 'NAO_AUTENTICADO', 403: 'SEM_PERMISSAO', 404: 'NAO_ENCONTRADO', 405: 'METODO_NAO_PERMITIDO',
  409: 'CONFLITO', 413: 'CORPO_GRANDE_DEMAIS', 415: 'TIPO_NAO_SUPORTADO', 422: 'REGRA_VIOLADA', 429: 'MUITAS_REQUISICOES',
};

function corpoDe(e: HttpException): CorpoErro {
  const r = e.getResponse();
  if (r && typeof r === 'object' && 'codigo' in r && 'mensagem' in r) return r as CorpoErro;
  // Exceção do próprio Nest (404 de rota, 400 de JSON malformado): mensagem genérica, nunca o texto interno.
  const status = e.getStatus();
  return { codigo: CODIGO_POR_STATUS[status] ?? 'ERRO', mensagem: status === 404 ? 'Recurso não encontrado.' : 'Requisição recusada.' };
}

@Catch()
export class FiltroExcecao implements ExceptionFilter {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  async catch(erro: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    let status: number;
    let corpo: CorpoErro;

    if (erro instanceof HttpException) {
      status = erro.getStatus();
      corpo = corpoDe(erro);
    } else if (codigoPg(erro)) {
      const pg = codigoPg(erro)!;
      if (pg === '23505') { status = 409; corpo = { codigo: 'CONFLITO', mensagem: 'Registro duplicado.' }; }
      else if (pg === '40P01' || pg === '40001') { status = 409; corpo = { codigo: 'CONFLITO_CONCORRENTE', mensagem: 'Outra alteração aconteceu ao mesmo tempo. Tente novamente.' }; }
      else if (pg === '23514' || pg === '23503' || pg === '23502') { status = 422; corpo = { codigo: 'REGRA_VIOLADA', mensagem: 'Os dados violam uma regra do cadastro.' }; }
      else { status = 500; corpo = { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente.' }; }
      log(status >= 500 ? 'error' : 'warn', 'erro.banco', { request_id: req.requestId, codigo_pg: pg, constraint: constraintPg(erro), status });
    } else {
      status = 500;
      corpo = { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente.' };
      // Só o tipo do erro: a mensagem de erro de terceiro pode carregar dado.
      log('error', 'erro.interno', { request_id: req.requestId, erro: erro instanceof Error ? erro.name : typeof erro });
      // Em dev, os quadros da pilha (sem a primeira linha, que é a mensagem) ajudam a achar o bug sem expor dado.
      if (erro instanceof Error && process.env.PORTARIA_AMBIENTE === 'dev') console.error(erro.stack?.split('\n').slice(1, 8).join('\n'));
    }

    if (status === 403) await this.registrarNegacao(req, erro);
    if (!res.headersSent) res.status(status).json(corpo);
  }

  private async registrarNegacao(req: Request, erro: unknown) {
    const usuario = req.auth?.usuario;
    try {
      await this.auditoria.registrar(this.db, {
        ator: usuario ? { id: usuario.id, nome: usuario.nome, papel: usuario.papel } : null,
        nomeInformado: '(sem sessão)',
        acao: 'acesso.negado',
        entidade: 'acao',
        ip: ipDe(req),
        depois: {
          acao: erro instanceof AcessoNegado ? erro.acaoTentada : null,
          metodo: req.method,
          rota: req.route?.path ? `${req.baseUrl ?? ''}${String(req.route.path)}` : null,
        },
      });
    } catch (e) {
      // A negação continua valendo; a falha da trilha vai para o log (e para o alerta, quando houver).
      log('error', 'auditoria.falha_acesso_negado', { request_id: req.requestId, codigo_pg: codigoPg(e) });
    }
  }
}
