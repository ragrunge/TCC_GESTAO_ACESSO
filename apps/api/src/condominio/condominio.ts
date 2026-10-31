// O condomínio atendido por esta API: UM condomínio, UM banco (`portaria`). O que os serviços precisam
// dele (nome exibido, agrupamento "Bloco"/"Torre" e as chaves) é montado UMA vez no boot (carregar.ts) e injetado pelo
// token `CONDOMINIO` (database.module.ts). Nada aqui é dado pessoal; as chaves nunca vão a log nem a resposta.
import type { Agrupamento } from '@portaria/domain/units';

/** Token do provider com o condomínio (database.module.ts). */
export const CONDOMINIO = Symbol('CONDOMINIO');

export interface ChavesCondominio {
  /** HMAC do CPF (`documento_busca`) e raiz da subchave do limite de login. */
  hmacCpf: Buffer;
  /** KEK dos anexos e a versão dela (gravada em `documento.chave_versao` e na AAD da DEK). */
  kek: Buffer;
  kekVersao: number;
}

export interface Condominio {
  /** Nome exibido (cabeçalho do front, via /auth/me, e exportações). */
  nome: string;
  /** "Bloco"/"Torre" da tabela `configuracao`; sem a linha, `ESTRUTURA_PADRAO.agrupamento`. */
  agrupamento: Agrupamento;
  chaves: ChavesCondominio;
}

