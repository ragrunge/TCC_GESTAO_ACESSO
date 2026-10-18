// Seed mínimo de estrutura (idempotente): as 165 unidades do condomínio, o ponto de acesso único e as áreas comuns
// (RF-36), todos a partir de @portaria/domain/units (o mesmo que o mock do navegador usa).
// Usuários e pessoas NÃO são semeados aqui: senha e dados pessoais não vão para o código (RN-05).
import { AREAS_COMUNS_INICIAIS, PORTARIA_SOCIAL, gerarUnidades } from '@portaria/domain/units';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { areaComum, pontoAcesso, unidade } from './schema';

export { PORTARIA_SOCIAL };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- aceita qualquer driver (PGlite, node-postgres) e schema
export async function seedEstrutura(db: PgDatabase<PgQueryResultHKT, any>) {
  await db.insert(unidade)
    .values(gerarUnidades().map((u) => ({ torre: u.torre, numero: u.numero })))
    .onConflictDoNothing({ target: [unidade.torre, unidade.numero] });
  await db.insert(pontoAcesso).values({ nome: PORTARIA_SOCIAL }).onConflictDoNothing({ target: pontoAcesso.nome });
  await db.insert(areaComum).values(AREAS_COMUNS_INICIAIS.map((nome) => ({ nome }))).onConflictDoNothing({ target: areaComum.nome });
}
