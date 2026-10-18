// Erros da API no formato da spec §6: { codigo, mensagem, detalhes? }.
import { ForbiddenException, HttpException } from '@nestjs/common';

export interface CorpoErro {
  codigo: string;
  mensagem: string;
  detalhes?: unknown;
}

export const erroApi = (status: number, codigo: string, mensagem: string, detalhes?: unknown) =>
  new HttpException(detalhes === undefined ? { codigo, mensagem } : { codigo, mensagem, detalhes }, status);

/**
 * 403 com a ação RBAC tentada. O filtro global grava `acesso.negado` para TODO 403 (spec §5.2), DEPOIS do rollback
 * da transação em que a negação aconteceu: gravar dentro dela perderia o registro.
 */
export class AcessoNegado extends ForbiddenException {
  constructor(readonly acaoTentada: string, mensagem = 'Seu perfil não tem permissão para esta ação.', codigo = 'SEM_PERMISSAO') {
    super({ codigo, mensagem });
  }
}

/** Código SQLSTATE do Postgres. O Drizzle embrulha o erro do driver em `cause`. */
export function codigoPg(erro: unknown): string | undefined {
  const e = erro as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = e?.cause?.code ?? e?.code;
  return typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c) ? c : undefined;
}

export function constraintPg(erro: unknown): string | undefined {
  const e = erro as { constraint?: unknown; cause?: { constraint?: unknown } } | null;
  const c = e?.cause?.constraint ?? e?.constraint;
  return typeof c === 'string' ? c : undefined;
}
