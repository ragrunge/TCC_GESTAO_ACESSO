// Pessoa como a API devolve (minimização, LGPD art. 6º, III):
// - documento_busca (HMAC do CPF) NUNCA sai da API;
// - telefone completo só para quem pode corrigir o cadastro (pessoa.editar: SI, AD) e só onde ele é preciso (ficha e
//   resposta de escrita). Nas listas, só `telefoneMascarado`.
import { pode } from '@portaria/domain/rbac';
import type { Papel } from '@portaria/domain/types';
import { mascararTelefone } from '../auditoria/snapshot';
import { pessoa } from '../db/schema';

export const SEM_CPF = '(sem CPF)';
export const ANONIMIZADO = '(anonimizado)';

/** Colunas lidas para montar a PessoaApi. `temCpf` no lugar do HMAC: o valor do HMAC não sai do banco. */
export const colunasPessoa = {
  id: pessoa.id, nome: pessoa.nome, categoria: pessoa.categoria, semCpf: pessoa.semCpf,
  documentoMascarado: pessoa.documentoMascarado, telefone: pessoa.telefone, empresa: pessoa.empresa, servico: pessoa.servico,
  importacaoId: pessoa.importacaoId, anonimizadaEm: pessoa.anonimizadaEm, criadoEm: pessoa.criadoEm,
};

export type LinhaPessoa = {
  id: string; nome: string; categoria: (typeof pessoa.categoria.enumValues)[number]; semCpf: boolean;
  documentoMascarado: string | null; telefone: string | null; empresa: string | null; servico: string | null;
  importacaoId: string | null; anonimizadaEm: Date | null; criadoEm: Date;
};

export interface PessoaApi {
  id: string;
  nome: string;
  documentoTipo: 'cpf';
  categoria: LinhaPessoa['categoria'];
  semCpf: boolean;
  documentoMascarado: string;
  telefone?: string;
  telefoneMascarado: string | null;
  empresa?: string;
  servico?: string;
  importacaoId?: string;
  anonimizadaEm: number | null;
  criadoEm: number;
}

/** Telefone completo só para quem tem pessoa.editar (correção do cadastro, art. 18). */
export const veTelefoneCompleto = (papel: Papel) => pode(papel, 'pessoa.editar');

export function paraPessoaApi(p: LinhaPessoa, o: { telefoneCompleto?: boolean } = {}): PessoaApi {
  const documento = p.anonimizadaEm ? ANONIMIZADO : p.semCpf ? SEM_CPF : (p.documentoMascarado ?? SEM_CPF);
  return {
    id: p.id, nome: p.nome, documentoTipo: 'cpf', categoria: p.categoria, semCpf: p.semCpf, documentoMascarado: documento,
    ...(o.telefoneCompleto && p.telefone ? { telefone: p.telefone } : {}),
    telefoneMascarado: p.telefone ? mascararTelefone(p.telefone) : null,
    ...(p.empresa ? { empresa: p.empresa } : {}),
    ...(p.servico ? { servico: p.servico } : {}),
    ...(p.importacaoId ? { importacaoId: p.importacaoId } : {}),
    anonimizadaEm: p.anonimizadaEm ? p.anonimizadaEm.getTime() : null,
    criadoEm: p.criadoEm.getTime(),
  };
}

/**
 * Cadastro completo (pré-requisito para aprovar ou regularizar vínculo, RN-02): mesma regra de `cadastroCompleto` do
 * domain (CPF, não "sem CPF", telefone com DDD e não anonimizada). `temCpf` = documento_busca preenchido.
 */
export const cadastroCompletoDe = (p: { semCpf: boolean; anonimizadaEm: Date | null; telefone: string | null; temCpf: boolean }) =>
  !p.semCpf && !p.anonimizadaEm && p.temCpf && /^\d{10,11}$/.test(p.telefone ?? '');
