# Portaria Parque — monorepo

Sistema de controle de acesso e gestão de portaria do Condomínio Residencial do Parque (TCC, Sistemas de Informação).

## Estrutura

| Pasta | Conteúdo | Status |
|---|---|---|
| `apps/web` | SPA React 18 + Vite 5 + TS + Tailwind (`@portaria/web`), cliente HTTP da API (sem mock) | funcional |
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

Detalhes da SPA e login de demonstração: [apps/web/README.md](apps/web/README.md). Rastreabilidade RF → API → tela: [docs/rastreabilidade.md](docs/rastreabilidade.md).

## Deploy

Runbook completo (VPS, proxy, TLS, Vercel, âncora, backup, restore, checklist e rollback): [docs/deploy.md](docs/deploy.md).

| Peça | Onde |
|---|---|
| Front (Vercel) | `apps/web/vercel.json`: rewrite `/api/*` para a VPS antes do fallback da SPA, mais headers de segurança. Projeto Vercel com **Root Directory = `apps/web`**. Só a branch `main` publica (`git.deploymentEnabled`: sem previews, que escreveriam na produção); ver `docs/deploy.md` §6 |
| API + banco (VPS) | `docker-compose.prod.yml` (projeto `tcc-portaria`, API em `127.0.0.1:3100`, banco sem porta) e `.env.producao.example` |
| Backup | `db/backup/` (script, timer systemd e crontab de exemplo) |
| Âncora do selo | `.github/workflows/ancora-selo.yml` + `scripts/ancoras/anexar-selos.mjs` (abaixo) |

`npm test` da raiz roda também os testes dos scripts (`npm run test:scripts`, `node --test`).

## Âncora do selo diário (GitHub Actions)

Uma vez por dia, o workflow `ancora-selo.yml` lê os selos diários publicados pela API
(`GET /api/v1/auditoria/selos/publico`: data, seq, hash e total do dia, nada pessoal) e **anexa** os dias novos a
`selos.jsonl`, no branch `ancoras`. Se um dia já ancorado voltar diferente, o job falha e abre uma issue. O porquê e o
que isso prova, e não prova, estão na spec §4.6. Para funcionar, quem administra o repositório precisa:

1. **Criar o branch órfão `ancoras`** com um `selos.jsonl` vazio (comandos em [docs/deploy.md §7](docs/deploy.md)).
2. **Proteger o branch `ancoras`** contra **force-push** e **deleção** (Settings → Rules → Rulesets: *Restrict
   deletions* + *Block force pushes*, sem bypass). Sem isso, o histórico deixa de ser só por append. Não exigir PR,
   assinatura nem "Restrict updates": o workflow faz push direto com o `GITHUB_TOKEN`.
3. **Criar a variável** do repositório `ANCORA_URL` (Actions → *Variables*, não *Secrets*) com
   `https://179-197-78-78.sslip.io/api/v1/auditoria/selos/publico`.
4. Manter o workflow desligado até a API estar no ar (`gh workflow disable ancora-selo.yml`), e então ligá-lo e
   rodá-lo à mão uma vez.

Conferência offline de uma trilha exportada contra as âncoras:
`node apps/api/dist/cli/verificar-ancoras.js trilha.jsonl selos.jsonl` (depois de `npm run build -w apps/api`).
