// Leitura dos dados de um condomínio pelo app do Master (docs/05_arquitetura_saas.md SAAS-09, F5 entrega 2). PONTO ÚNICO:
// é o único lugar de src/master que obtém a subárvore de injeção de um condomínio (teste de arquitetura em
// test/master-leitura.test.ts). Para cada requisição de /plataforma/condominios/:id/...:
//
//   1. resolve o condomínio (ativo, suspenso ou encerrado; `provisionando` 409; `excluido` ou desconhecido 404);
//   2. obtém a subárvore durável dele, a MESMA das requisições do condomínio e dos jobs (`contextoDoJob`): os serviços
//      leem pelo pool `app_rw` daquele banco. O `app_plataforma` continua sem CONNECT nos bancos de condomínio;
//   3. chama o serviço existente (as mesmas views e máscaras que o síndico recebe);
//   4. grava UMA linha no `audit_log` DAQUELE condomínio (`plataforma.ler` ou `plataforma.exportar`, quem =
//      `plataforma/<e-mail>`, `depois = { rota, metodo, status, master_usuario_id }`, sem corpo nem filtros) e uma em
//      `plataforma_audit` (sem dado de morador nem id de registro do condomínio);
//   5. só então devolve o dado. Falhou qualquer das duas gravações: 503 e o dado não sai.
//
// A linha é gravada DEPOIS da leitura e ANTES da resposta, para levar o status de verdade (200, 404...). As duas
// gravações estão em bancos diferentes, sem transação comum: se a do condomínio entra e a da plataforma falha, fica a do
// condomínio (o controle externo, visto pelo síndico) e o Master recebe 503. Leitura que falha (404 de um id
// inexistente) também é registrada, com o status.
//
// O ModuloGuard não se aplica aqui (rota da plataforma): o dado de um módulo desligado continua existindo e o Master o lê
// para suporte e exportação de fim de contrato (SAAS-19).
import { HttpException, Inject, Injectable, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { codigoPg, erroApi } from '../comum/erros';
import { log } from '../comum/log';
import { DB, type Db } from '../database/database.module';
import { contextoDoJob } from '../saas/contexto';
import { type DbPlataforma, PLATAFORMA_DB } from '../saas/plataforma-db';
import { ResolvedorCondominio } from '../saas/resolvedor';
import type { AuthMaster } from './tipos';
import { registrarPlataforma } from './trilha-plataforma';

/** O que foi lido: a entidade (nome da tabela) e, quando a rota é de um registro, o id dele. */
export interface AlvoLeitura {
  entidade: string;
  registroId?: string | null;
  /** Download, CSV, JSONL ou anexo: `plataforma.exportar` em vez de `plataforma.ler`. */
  exportar?: boolean;
}

/** Serviço resolvido na subárvore do condomínio lido. */
export type Servicos = <T>(token: Type<T>) => Promise<T>;

export const MENSAGEM_TRILHA_INDISPONIVEL = 'Não foi possível registrar a consulta na trilha do condomínio. Nada foi mostrado; tente de novo.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rota sem o prefixo comum (`/api/v1/plataforma/condominios/:id`): o padrão, nunca a URL (sem query string). */
export function rotaDaLeitura(req: Request): string | null {
  const padrao = req.route?.path ? `${req.baseUrl ?? ''}${String(req.route.path)}` : null;
  return padrao ? padrao.replace(/^.*\/plataforma\/condominios\/:id/i, '') || '/' : null;
}

const statusDe = (e: unknown) => (e instanceof HttpException ? e.getStatus() : 500);

@Injectable()
export class AcessoPlataformaService {
  constructor(
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Inject(ResolvedorCondominio) private readonly resolvedor: ResolvedorCondominio,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(PLATAFORMA_DB) private readonly db: DbPlataforma,
  ) {}

  async ler<T>(m: AuthMaster, req: Request, condominioId: string, alvo: AlvoLeitura, fn: (s: Servicos) => Promise<T>): Promise<T> {
    const r = await this.resolvedor.paraPlataforma(condominioId);
    if (r.tipo === 'inexistente') throw erroApi(404, 'NAO_ENCONTRADO', 'Condomínio não encontrado.');
    if (r.tipo === 'provisionando') throw erroApi(409, 'CONDOMINIO_PROVISIONANDO', 'O condomínio ainda está em provisionamento: não há dados para ler.');
    const c = r.condominio;
    const arvore = contextoDoJob(this.moduleRef, c);
    const servico: Servicos = (t) => this.moduleRef.resolve(t, arvore, { strict: false });

    let resultado: { ok: true; valor: T } | { ok: false; erro: unknown };
    try {
      resultado = { ok: true, valor: await fn(servico) };
    } catch (erro) {
      resultado = { ok: false, erro };
    }

    const exportar = !!alvo.exportar;
    const rota = rotaDaLeitura(req);
    const status = resultado.ok ? 200 : statusDe(resultado.erro);
    const registroId = alvo.registroId && UUID.test(alvo.registroId) ? alvo.registroId : null;
    try {
      const dbCondominio = await servico<Db>(DB as unknown as Type<Db>);
      await this.auditoria.registrarPlataforma(dbCondominio, {
        email: m.usuario.email, acao: exportar ? 'plataforma.exportar' : 'plataforma.ler', entidade: alvo.entidade, registroId,
        ip: m.ip, depois: { rota, metodo: req.method, status, masterUsuarioId: m.usuario.id },
      });
      await registrarPlataforma(this.db, {
        masterUsuarioId: m.usuario.id, acao: exportar ? 'condominio.exportar' : 'condominio.ler', condominioId: c.id,
        detalhes: { entidade: alvo.entidade, rota, metodo: req.method, status, ip: m.ip },
      });
    } catch (e) {
      log('error', 'plataforma.falha_trilha_leitura', { request_id: req.requestId, condominio_id: c.id, codigo_pg: codigoPg(e), erro: e instanceof Error ? e.name : 'erro' });
      throw erroApi(503, 'TRILHA_INDISPONIVEL', MENSAGEM_TRILHA_INDISPONIVEL);
    }
    if (!resultado.ok) throw resultado.erro;
    return resultado.valor;
  }
}
