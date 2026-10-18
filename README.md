# Portaria Parque — monorepo

Sistema de controle de acesso e gestão de portaria do Condomínio Residencial do Parque (TCC, Sistemas de Informação).

## Estrutura

| Pasta | Conteúdo | Status |
|---|---|---|
| `apps/web` | SPA React 18 + Vite 5 + TS + Tailwind (`@portaria/web`), com API mock em memória | funcional (protótipo) |
| `apps/api` | Backend NestJS + Drizzle + PostgreSQL | esqueleto NestJS (`/api/v1/saude`) + camada de banco (schema, migrações, testes); regras e auth pendentes |
| `packages/domain` | Regras puras, RBAC, hash chain, tempo, unidades (`@portaria/domain`, sem build, exporta `.ts`) | funcional, com testes |
| `db` | Bootstrap de roles, guia de migração e testes (o `docker-compose.yml` fica na raiz) | funcional |
| `docs` | Requisitos, especificação técnica, prompts do protótipo | v0.3 / v0.1 |
| `diagramas` | PlantUML (uc1–uc3) e diagrama de arquitetura/deploy | — |
| `prototipo` | Protótipo HTML de referência | — |

## Comandos (da raiz)

```bash
npm install
npm run dev                          # SPA em http://localhost:5173
npm test                             # testes de todos os workspaces
npm run build                        # tsc + vite build do web
npm run typecheck                    # todos os workspaces
```

## Ambiente Docker (db + migrate + api)

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
cp .env.example .env && docker compose up -d --build   # ver apps/api/README.md
```

Detalhes da SPA, login de demonstração e tabela de rastreabilidade RF/UC: [apps/web/README.md](apps/web/README.md).

## Deploy (Vercel)

`vercel.json` fica em `apps/web`. O projeto Vercel precisa de **Root Directory = `apps/web`** (com instalação do monorepo habilitada).
