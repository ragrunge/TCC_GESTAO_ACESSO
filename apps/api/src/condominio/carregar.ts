// Carga do condomínio no boot, a partir da configuração (nome e chaves do ambiente, config.ts) e da tabela
// `configuracao` do banco (agrupamento). Separado de condominio.ts para o cofre (que injeta CONDOMINIO) e esta carga
// (que usa o cofre) não se importarem em ciclo.
//
// Conferência do boot (erro aqui derruba o processo antes de abrir a porta): se já existe anexo cifrado com a versão
// atual da KEK, a KEK do ambiente tem de abrir a DEK dele. KEK trocada por engano faria a API gravar anexos novos com
// uma chave e não conseguir ler os antigos.
import { eq } from 'drizzle-orm';
import { AGRUPAMENTOS, type Agrupamento, ESTRUTURA_PADRAO } from '@portaria/domain/units';
import { log } from '../comum/log';
import type { Config } from '../config/config';
import type { Db } from '../database/database.module';
import { configuracao, documento } from '../db/schema';
import { kekAbreDek } from '../documentos/cofre';
import type { Condominio } from './condominio';

export class ErroCondominio extends Error {}

/** Agrupamento da `configuracao` (linha única). Sem a linha: o padrão. Valor fora da lista: erro de boot. */
async function agrupamentoDo(db: Db): Promise<Agrupamento> {
  const [c] = await db.select({ agrupamento: configuracao.agrupamento }).from(configuracao).limit(1);
  if (!c) return ESTRUTURA_PADRAO.agrupamento;
  if (!(AGRUPAMENTOS as readonly string[]).includes(c.agrupamento)) throw new ErroCondominio('agrupamento desconhecido na configuração');
  return c.agrupamento as Agrupamento;
}

export async function carregarCondominio(config: Config, db: Db): Promise<Condominio> {
  const chaves = config.condominio.chaves;
  const [d] = await db.select({ id: documento.id, dekCifrada: documento.dekCifrada, chaveVersao: documento.chaveVersao })
    .from(documento).where(eq(documento.chaveVersao, chaves.kekVersao)).limit(1);
  if (d && !kekAbreDek(chaves.kek, d)) {
    throw new ErroCondominio(`a KEK v${chaves.kekVersao} do ambiente não abre a DEK de um anexo existente: boot recusado`);
  }
  const agrupamento = await agrupamentoDo(db);
  log('info', 'condominio.boot', { detalhe: `agrupamento=${agrupamento} deks_conferidas=${d ? 1 : 0}` });
  return { nome: config.condominio.nome, agrupamento, chaves };
}
