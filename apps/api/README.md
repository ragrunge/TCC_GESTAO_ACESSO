# apps/api

Backend NestJS 11 + Drizzle ORM + PostgreSQL. Hoje: esqueleto (`GET /api/v1/saude`) e a camada de banco
(schema, migrações, verificador da cadeia de hash, testes). Regras de negócio e autenticação ainda não existem.

```
src/main.ts              bootstrap: prefixo api/v1, 0.0.0.0:3000, shutdown hooks
src/app.module.ts        AppModule
src/database/            DatabaseModule global: Pool do pg + Drizzle (node-postgres), DATABASE_URL, fecha o pool no shutdown
src/saude/               GET /api/v1/saude: select 1 + ultimo_seq da cadeia; 503 se o banco cair
src/db/schema.ts         schema Drizzle (fonte das migrações geradas)
src/db/cadeia.ts         serialização canônica v1 e verificador independente da cadeia (RF-32, RF-37)
src/db/cpf.ts            máscara e HMAC do CPF
src/db/seed.ts           165 unidades + portaria social + áreas comuns (idempotente)
drizzle/                 0000_init.sql (gerada), 0001_regras_imutabilidade.sql (manual), 0002_conferencia_comprovante.sql (gerada + trigger manual)
test/                    vitest + PGlite com as migrações reais; postgres-real/ só com PG_TEST_URL
Dockerfile               multi-stage (deps, build, migrate, prod, runtime), node:22-alpine
```

## Ambiente Docker

Compose único na raiz do monorepo: `db` (postgres:17-alpine) -> `migrate` (drizzle-kit como `app_migrator`, roda e termina)
-> `api` (como `app_rw`, usuário `node`, nunca migra). Detalhes, bootstrap de roles e variáveis: [../../db/README.md](../../db/README.md).

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"   # CLI do Docker Desktop
cd 05_Sistema/app
cp .env.example .env            # preencher; o .env (raiz) tem segredos e não deve ser distribuído
docker compose up -d --build    # sobe tudo; API em http://127.0.0.1:3000, Postgres em 127.0.0.1:${DB_HOST_PORT:-5432}
docker compose ps
curl http://127.0.0.1:3000/api/v1/saude    # {"status":"ok","banco":"ok","ultimoSeq":0}
docker compose logs -f api
docker compose down             # derruba (mantém os dados)
docker compose down -v          # derruba e ZERA o volume do Postgres
```

Testes contra Postgres real (atenção à armadilha da senha do `app_rw` em [../../db/README.md](../../db/README.md)):

```bash
set -a; . ./.env; set +a
PG_TEST_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${DB_HOST_PORT:-5432}/postgres" npm run test:pg -w apps/api
```

## Comandos (no host)

```bash
npm test -w apps/api                 # PGlite, sem Docker
npm run typecheck -w apps/api
npm run build -w apps/api            # tsc -> dist/ (CommonJS) e dist/package.json
DATABASE_URL=postgres://app_rw:SENHA@127.0.0.1:5433/portaria npm run start:dev -w apps/api   # tsc-watch + node
npm run db:generate -w apps/api      # após mudar schema.ts
```

## Decisões de build

- **tsc, não `nest build`/SWC.** O esqueleto não precisa do CLI; `tsc` com `emitDecoratorMetadata` basta e há uma ferramenta a menos.
  (`tsx`/esbuild não servem: não emitem metadata de decorators e a injeção de dependência quebra.)
- **CommonJS só no build da API.** `tsconfig.build.json` usa `module: CommonJS`/`Node10` e o build grava `dist/package.json`
  com `{ "type": "commonjs" }`. O pacote continua `"type": "module"` (vitest, drizzle-kit), e `tsconfig.json` (typecheck/testes) fica como estava,
  só com `experimentalDecorators`/`emitDecoratorMetadata`. Os imports extensionless de `src/db` seguem funcionando sem alterar esses arquivos.
- **NestJS 11, não 12.** A 12 (latest) é ESM-only; ficar na 11 evita reescrever imports com `.js` e o build ESM.
  Reavaliar quando o código migrar para ESM.

## Pendências

- ~~`@portaria/domain` sem build~~ (resolvido): o domain tem build CJS em `packages/domain/dist/cjs` (`npm run build -w packages/domain`,
  chamado pelo build da API). Os `exports` têm a condição `require` para o Node (dist) e `default` para Vite/vitest (src);
  `typesVersions` dá os `.d.ts` ao build CommonJS da API (`moduleResolution: Node10` não lê `exports`). A serialização canônica
  do hash e o verificador vivem em `@portaria/domain/hashChain`; `src/db/cadeia.ts` só reexporta e mapeia a linha do Drizzle.
  O Dockerfile compila o domain no estágio `build` e copia `package.json` + `dist` para o runtime.
- Segredos `PORTARIA_HMAC_CPF_KEY` e `PORTARIA_KEK` existem no `.env`, mas a API ainda não os recebe (o compose só repassa `DATABASE_URL`).
- `test:pg` sobrescreve a senha do `app_rw` no cluster (ver db/README.md).
- Serviços `web`, `mailhog` e `minio` da spec §12.2 não foram incluídos.
- A imagem `migrate` carrega as dependências de desenvolvimento inteiras (591 MB); é só de dev, mas pode virar um estágio enxuto.
