#!/bin/sh
# Bootstrap do banco `plataforma` do SaaS (docs/05_arquitetura_saas.md SAAS-02; fase F1). Roda como superusuário, DEPOIS
# do 00_roles.sh (app_migrator já existe) e ANTES das migrações de drizzle-plataforma/. Idempotente.
# No Docker roda sozinho na primeira subida do volume (ordem alfabética de /docker-entrypoint-initdb.d). Num cluster que
# já existe (produção), roda à mão: docs/deploy.md, seção 12.
#
# - app_plataforma: role da API para o banco `plataforma` (a partir da F2). CONNECT só lá: não tem CONNECT no banco de
#   condomínio (o 00_roles.sh tira o CONNECT de PUBLIC em `portaria`), e app_rw não tem CONNECT aqui. Com
#   APP_PLATAFORMA_PASSWORD vazia nasce sem LOGIN (a senha entra depois por stdin, sem passar por linha de comando).
# - app_provisionador: cria os bancos dos condomínios novos (CLI de onboarding, F5). Nasce SEM LOGIN: só ganha login
#   quando a CLI existir. Nunca é role da API (SAAS-10).
set -eu
DB_PLATAFORMA="${PLATAFORMA_DB:-plataforma}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres -v db="$DB_PLATAFORMA" <<'SQL'
SELECT 'CREATE ROLE app_plataforma NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_plataforma') \gexec
SELECT 'CREATE ROLE app_provisionador NOLOGIN NOSUPERUSER CREATEDB NOCREATEROLE'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_provisionador') \gexec
SELECT format('CREATE DATABASE %I OWNER app_migrator', :'db')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO app_migrator, app_plataforma;
SQL

if [ -n "${APP_PLATAFORMA_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres -v pw="$APP_PLATAFORMA_PASSWORD" <<'SQL'
ALTER ROLE app_plataforma LOGIN PASSWORD :'pw';
SQL
else
  echo "10_plataforma.sh: APP_PLATAFORMA_PASSWORD vazia; app_plataforma ficou sem LOGIN (docs/deploy.md, seção 12)" >&2
fi
