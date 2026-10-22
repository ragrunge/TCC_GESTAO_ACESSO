# apps/api

Backend NestJS 11 + Drizzle ORM + PostgreSQL. Hoje: `GET /api/v1/saude`, autenticação por sessão (login, logout, me,
troca de senha), autorização pela matriz RBAC do domain, gestão de usuários, unidades (CRUD e resumo paginado), catálogo,
busca de pessoas e busca global (leitura), contagem de vínculos, trilha `audit_log` e a camada de banco (schema, migrações,
verificador da cadeia de hash, testes), pessoas, vínculos, funcionários, veículos, importação e o registro de acesso (eventos,
presentes, turno, autorizações prévias, restrições, auditoria e relatórios), encomendas e ocorrências (com anexos cifrados). LGPD
(exportar, anonimizar, retenção) e o job do selo diário ainda não existem.

Documentação OpenAPI, Swagger local e coleções Bruno/Postman: ver [`docs/api/`](../../docs/api/README.md).

```
src/main.ts              bootstrap: lê a config e chama configurarApp; 0.0.0.0:3000
src/plataforma.ts        configurarApp (usado também pelos testes): prefixo api/v1, trust proxy, CORS, log, no-store
src/app.module.ts        AppModule: guards globais (SessaoGuard -> PapelGuard) e filtro global de exceção
src/config/              config validada no boot (falha em vez de default silencioso) + relógio injetável
src/comum/               envelope { data } (interceptor), paginação por cursor, erro { statusCode, error, code, message, details?, timestamp, path } (filtro global, acesso.negado em todo 403), ZodPipe, log JSON em allowlist
src/auditoria/           AuditoriaService.registrar(tx, ...) e o snapshot (snake_case, sem segredo, CPF/telefone mascarados)
src/auth/                login/logout/me/trocar-senha, sessão, limite de login, senha (argon2id), guards e decorators
src/usuarios/            gestão de usuários (usuario.gerenciar / usuario.gerenciar_sindico)
src/unidades/            GET /catalogo, GET/POST/PATCH /unidades, /unidades/:id/desativar|reativar; paraNovoUso (unidade inativa barra novo uso)
src/pessoas/             POST /pessoas/busca e POST /busca (termo no corpo: pode ser CPF); nome sem acento, CPF por HMAC, unidade, placa
src/vinculos/            vínculos (RF-03 a RF-07) e a regra "vínculo válido" em SQL (mesma do domain)
src/eventos/             M2 (spec §6.3): entrada, recusa, saída, correção, listagem, presentes, turno, autorizações prévias e restrições.
                         efetivo.ts: valores efetivos em SQL (original + última correção); evento-view.ts: a EventoView do domínio em lote
src/auditoria/auditoria.controller.ts  integridade no banco (lotes, selo, cabeça), exportação JSONL v2 e trilha de alterações paginada
src/relatorios/          resumo (RF-30, RF-31) agregado no banco e CSV (construtor do domain)
src/encomendas/          M3 (spec §6.4): receber, filas paginadas, resumo, atrasadas, retirada (RN-08) e autorização de retirada
src/ocorrencias/         M4 (spec §6.5): abrir, status só para a frente, vincular eventos (aditivo), anexos multipart
src/documentos/cofre.ts  anexos cifrados: AES-256-GCM, DEK por arquivo embrulhada pela KEK (PORTARIA_KEK), AAD = id, volume `documentos`
src/comum/transacao.ts   transação com retry curto em 40001/40P01
src/cli/recriar-estrutura.ts troca TODAS as unidades pela estrutura configurada (ESTRUTURA_PADRAO), só sem nenhuma referência; simula sem --aplicar
src/cli/seed-dev.ts      seed de dev: estrutura + 4 usuários (um por papel), senha de SEED_SENHA_DEV; com PORTARIA_AMBIENTE=dev, pessoas fictícias
src/database/            DatabaseModule global: Pool do pg + Drizzle (node-postgres), DATABASE_URL, fecha o pool no shutdown
src/saude/               GET /api/v1/saude: select 1 + leitura da cabeça da cadeia (sem devolver o seq); 503 se o banco cair
src/db/schema.ts         schema Drizzle (fonte das migrações geradas)
src/db/cadeia.ts         serialização canônica v1 e verificador independente da cadeia (RF-32, RF-37)
src/db/cpf.ts            máscara e HMAC do CPF
src/db/seed.ts           unidades da estrutura configurada + portaria social + áreas comuns (idempotente)
src/db/seed-usuarios.ts  usuários de dev (um por papel), idempotente
src/db/seed-pessoas-dev.ts pessoas, vínculos e veículos fictícios, CPF válido só como máscara + HMAC, idempotente
drizzle/                 0000_init.sql (gerada), 0001_regras_imutabilidade.sql (manual), 0002_conferencia_comprovante.sql (gerada + trigger manual),
                         0003_autenticacao_sessao.sql (gerada: sessao, login_limite, deve_trocar_senha + GRANT manual),
                         0005_unidade_bloco.sql (manual, snapshot do schema: torre -> bloco texto, número canônico, unidade_descartar_estrutura())
test/                    vitest + PGlite com as migrações reais; postgres-real/ só com PG_TEST_URL
Dockerfile               multi-stage (deps, build, migrate, prod, runtime), node:22-alpine
```

## Ambiente Docker

Compose único na raiz do monorepo: `db` (postgres:17-alpine) -> `migrate` (drizzle-kit como `app_migrator`, roda e termina)
-> `api` (como `app_rw`, nunca migra).

Reload (target `dev`, padrão): o estágio `dev` do Dockerfile roda `tsc-watch`, e o `develop.watch` do compose sincroniza
`apps/api/src` para dentro do container. Mudanças em `packages/domain/src`, `package.json`, `package-lock.json` ou
`tsconfig.build.json` reconstroem a imagem. Sem bind mount: no macOS ele perde eventos de arquivo e misturaria o
`node_modules` do host (darwin) com o do container (musl, binário do argon2). O dev usa ~340 MiB (tsc-watch + API),
por isso `mem_limit` padrão de 768m; para medir com o limite de produção: `API_MEM_LIMIT=384m API_TARGET=runtime`. Detalhes, bootstrap de roles e variáveis: [../../db/README.md](../../db/README.md).

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"   # CLI do Docker Desktop
cd 05_Sistema/app
cp .env.example .env            # preencher; o .env (raiz) tem segredos e não deve ser distribuído
docker compose up --build --watch   # sobe tudo com reload: salvar em apps/api/src recompila e reinicia a API (~3 s)
docker compose up -d --build    # sobe tudo sem reload; API em http://127.0.0.1:3000, Postgres em 127.0.0.1:${DB_HOST_PORT:-5432}
docker compose watch            # liga o reload numa stack já de pé
API_TARGET=runtime docker compose up -d --build   # imagem de produção (sem tsc-watch, usuário node)
docker compose run --rm migrate # depois de criar migração nova (o migrate só roda sozinho na subida)
docker compose ps
curl http://127.0.0.1:3000/api/v1/saude    # {"data":{"status":"ok","banco":"ok","em":"..."}}
docker compose exec api node dist/cli/seed-dev.js   # 4 usuários de dev; senha = SEED_SENHA_DEV do .env
docker compose exec api node dist/cli/recriar-estrutura.js [--aplicar]  # só banco sem uso de unidade; sem --aplicar, simula
docker compose exec api node dist/cli/jobs.js retencao            # retenção LGPD agora (spec §9.1); saída só com contagens
docker compose exec api node dist/cli/jobs.js selo [AAAA-MM-DD]   # selo diário do dia (padrão: ontem BRT) + âncoras pendentes
docker compose exec api node dist/cli/jobs.js ancoras             # só reenvia âncoras pendentes
open http://localhost:8025                                        # Mailpit (só dev): o e-mail da âncora do selo chega aqui
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
npm run dev:pglite -w apps/api       # API de teste sobre PGlite em memória (abaixo), sem Docker
```

### Modo de teste sobre PGlite (`dev:pglite`, e2e)

`test/e2e/servidor.ts` sobe o `AppModule` de verdade (guards, filtro, `configurarApp`) sobre um PGlite **em memória**,
com as migrações reais (0000 em diante), o seed de estrutura, os 4 usuários de dev, as pessoas fictícias do seed de dev
e os dados do e2e (`test/e2e/dados.ts`, gravados pelos próprios serviços da API, com trilha e hash). Senha de todos os
usuários: `E2E_SENHA` (o Playwright manda a de `apps/web/e2e/ambiente.ts`). Porta: `PORTA_E2E` (padrão 3101), só em
`127.0.0.1`. Cookie sem `Secure` e argon2 leve: é teste. Usado pelo `playwright.config.ts` do web e para desenvolver o
front com escrita sem tocar na produção (`API_PROXY_ALVO=http://127.0.0.1:3101 npm run dev -w apps/web`).

Rotas que só existem nesse modo (registradas direto no Express pelo `servidor.ts`, fora do `AppModule`):
`POST /__e2e/reset` (o banco volta ao modelo semeado, por `PGlite.clone()`, em ~0,2 s; as sessões abertas caem junto),
`POST /__e2e/adulterar-evento` e `POST /__e2e/vencer-senha-temporaria` (manipulam dado de teste para os e2e de
integridade e de senha vencida).

Trava contra produção (provada em `test/servidor-e2e.test.ts`):
- recusa subir com `PORTARIA_AMBIENTE=producao`, `NODE_ENV=production`, `DATABASE_URL` ou `DATABASE_URL_MIGRATOR` no
  ambiente: nunca fala com Postgres de verdade;
- o código mora em `test/e2e/`, fora de `src/`: o `tsconfig.build.json` só compila `src/`, então nada dele entra no
  `dist/` nem na imagem; o runtime do Dockerfile roda só `node dist/main.js`, e o PGlite é devDependency (nem está lá).
  O teste também confere que nada em `src/` importa `test/`, PGlite ou `__e2e`;
- a API montada como em produção (`AppModule`) responde 404 em todas as rotas `/__e2e/*`.

## Autenticação e autorização (spec §5.1, §5.2, §6.1)

Fluxo de dev com `curl` (no `.env` local: `PORTARIA_AMBIENTE=dev`, `COOKIE_SECURE=false`, `TRUST_PROXY=false`):

```bash
B=http://127.0.0.1:3000/api/v1
curl -c /tmp/j -H 'Content-Type: application/json' -d '{"login":"roberto.faria","senha":"<SEED_SENHA_DEV>"}' $B/auth/login
curl -b /tmp/j $B/auth/me
curl -b /tmp/j $B/usuarios                  # 200 para síndico/administração, 403 para porteiro/auditor
curl -b /tmp/j -X POST $B/auth/logout        # 204; o mesmo cookie passa a dar 401
```

Usuários do seed: `roberto.faria` (síndico), `paula.nogueira` (administração), `joao.lima` (porteiro), `luiza.campos` (auditor).
Rode o curl via `!` no terminal se não quiser a senha no histórico do chat.

**Toda rota declara uma política**, senão é negada:

```ts
@Publico()                                 // sem sessão (só /saude e /auth/login)
@Autenticado()                             // qualquer usuário logado
@Autenticado({ permiteTrocaPendente: true }) // também quem ainda deve trocar a senha (me, logout, trocar-senha)
@Acao('evento.registrar')                  // pode(papel, acao) da MATRIZ de @portaria/domain/rbac (fonte única)
```

Regra de autorização que depende do REGISTRO (ex.: "administração não mexe em síndico", "porteiro edita só a ocorrência
que abriu") fica no serviço: `throw new AcessoNegado('usuario.gerenciar_sindico')`. O filtro global grava o
`acesso.negado` de TODO 403, depois do rollback da transação (gravar dentro dela perderia o registro).

Contexto do usuário: `@Ctx() ctx: Contexto` (`ator`, `sessaoId`, `ip`), passado explicitamente ao serviço. Sem
AsyncLocalStorage (nada vaza entre requisições).

Validação: Zod, um pipe por parâmetro, `@Body(new ZodPipe(Schema))` com `z.strictObject` (campo desconhecido é 400);
`@Param('id', uuidParam)`. Não há `ValidationPipe` global (o `whitelist` do class-validator esvaziaria o corpo do Zod).
Escolha: Zod já é TypeScript (schema = tipo), não depende de `emitDecoratorMetadata` (o vitest/esbuild não emite) e é o
mesmo idioma que o front pode usar; class-validator exigiria classes decoradas e o pipe global com metadata.

### Formato das respostas (skill rest-api)

- 2xx com corpo: `{ "data": ... }`, aplicado pelo `EnvelopeInterceptor` global: o controller devolve o objeto puro.
- Listagem: o serviço devolve `new Pagina(itens, proximoCursor)` e sai `{ "data": [...], "pagination": { "cursor", "hasNextPage" } }`.
  Query `?limite=1..100` (padrão 50) e `?cursor=` (opaco: base64url da chave de ordenação do último item, nunca offset). Ver `GET /usuarios`.
- 204: handler sem retorno, sem corpo.
- Erro: `{ statusCode, error, code, message, details?, timestamp, path }` pelo `FiltroExcecao`. No código continua
  `erroApi(status, codigo, mensagem, detalhes)`; `details` de validação é `[{ field, message }]`; `path` sai sem query.

### Auditoria: padrão para os próximos módulos

Toda escrita de cadastro grava `audit_log` **na mesma transação**, passando a `tx` como executor:

```ts
await this.db.transaction(async (tx) => {
  const [antes] = await tx.select().from(pessoa).where(eq(pessoa.id, id)).for('update');
  const [depois] = await tx.update(pessoa).set(valores).where(eq(pessoa.id, id)).returning();
  await this.auditoria.registrar(tx, {
    ator: ctx.ator, ip: ctx.ip, acao: 'pessoa.editar', entidade: 'pessoa', registroId: id, antes, depois,
  });
});
```

- `antes`/`depois` podem ser a linha do Drizzle (camelCase): o snapshot converte para **snake_case** (nome de coluna),
  que é o que `lgpd_redigir_audit_pessoa` remove (`nome`, `telefone`, `documento_mascarado`, `empresa`, `servico`).
- Some do snapshot: `senha*`, `token*`, `documento_busca`. Telefone vira `(**) *****-1234`; sequências de 9+ dígitos
  (CPF digitado em texto livre) viram asteriscos; uuid e `*_id` passam intactos; Date vira ISO.
- O nome da pessoa PODE aparecer (spec §3.3: é redigível na anonimização). Segredo e documento em claro, nunca.
- `entidade` = nome da tabela. `acao` = `entidade.verbo` (CHECK `audit_log_acao_ck`), validada antes do SQL: erro de SQL
  aborta a transação do chamador, e try/catch sem savepoint não salva.
- Leitura não audita; 403 é auditado pelo filtro; 401 não é auditado.

### Logs

Uma linha JSON por requisição (`request_id` gerado no servidor, `usuario_id`, método, **padrão** da rota, status, ms),
com campos em allowlist (`src/comum/log.ts`): corpo, cookie, login digitado, senha e query nunca entram. Erro de banco
loga só SQLSTATE e constraint (a mensagem do `DrizzleQueryError` traz SQL e parâmetros).

### Variáveis (repassadas uma a uma no docker-compose.yml e no docker-compose.prod.yml)

| Variável | Valores | Observação |
|---|---|---|
| `PORTARIA_AMBIENTE` | `dev` \| `producao` | producao recusa `COOKIE_SECURE=false`; o seed em producao cria usuários com troca obrigatória |
| `COOKIE_SECURE` | `true` \| `false` | só essas grafias; `false` só em http://localhost |
| `TRUST_PROXY` | `false` \| 1 a 3 | saltos de proxy confiáveis; produção com rewrite da Vercel + Caddy: 2 (spec §14, nº 26) |
| `CORS_ORIGENS` | origens exatas, vírgula | vazio = CORS desligado (produção, mesma origem) |
| `SESSAO_ABSOLUTA_MIN`, `SESSAO_INATIVIDADE_MIN` | 720, 30 | minutos |
| `PORTARIA_HMAC_CPF_KEY` | base64, 32+ bytes | também origem (HKDF) da chave do `login_limite` |
| `SEED_SENHA_DEV` | 12+ caracteres | só o seed usa. Em produção não fica no serviço: vai só no `docker compose run` do seed (docs/deploy.md §3) |
| `LOGIN_MAX_FALHAS_LOGIN`, `LOGIN_MAX_FALHAS_IP` | 10 (3 a 50), 30 (3 a 500) | falhas na janela que bloqueiam o par login+IP e o IP (o login sozinho só atrasa); vazio = padrão (spec §14, nº 27) |
| `LOGIN_JANELA_MIN`, `LOGIN_BLOQUEIO_MIN` | 15, 15 | minutos; vazio = padrão |
| `IMPORTACAO_PRAZO_LEGADO_DIAS` | 90 (1 a 730) | prazo para regularizar o legado da planilha (RN-09), definido em assembleia; vazio = padrão (spec §14, nº 30) |
| `ANCORA_DESTINOS` | `github`, `email` (vírgula) | destinos externos da âncora (spec §4.6). `github` liga `GET /auditoria/selos/publico` para o GitHub Actions. Vazio = `email` se `ANCORA_EMAILS` estiver preenchida. Produção exige ao menos um (o compose de produção usa `github`) |
| `ANCORA_EMAILS`, `ANCORA_REMETENTE` | e-mails, vírgula | destinatários da âncora por e-mail (opcional; exige `email` em `ANCORA_DESTINOS` quando a lista é explícita). Dev: os fictícios do compose |
| `ANCORA_SMTP_HOST`, `_PORTA`, `_TLS`, `_USUARIO`, `_SENHA` | host; 587/465; `starttls` \| `implicito` \| `nenhum` | `nenhum` só em dev (Mailpit); produção recusa. Usuário e senha vão juntos |
| `ANCORA_ARQUIVO` | caminho absoluto | cópia append-only (JSONL) da âncora no volume `ancoras`; cópia local, não conta como destino externo |
| `JOBS_AGENDADOR`, `JOBS_INTERVALO_MIN`, `RETENCAO_HORA_BRT` | `true`; 10; 3 | agendador interno (selo, âncoras, retenção); `false` desliga (spec §14, nº 32) |
| `RETENCAO_ANEXO_OCORRENCIA_ANOS` | 1 a 20 | prazo dos anexos de ocorrência, do encerramento; vazio = nenhum sai por prazo (spec §14, nº 31, em aberto) |

Os padrões do limite de login ficam em `PADROES_LOGIN` (`src/config/config.ts`); valor fora da faixa derruba o boot.
O atraso crescente e os parâmetros do argon2 (`PADROES_ARGON2`) continuam constantes: mudam com revisão de código.

### Dev do front contra a API

Preferir o proxy do Vite (`API_PROXY_ALVO=http://127.0.0.1:3000` para a API do Docker, ou `:3101` para o modo
PGlite; sem a variável, o alvo é a API de PRODUÇÃO): mesma origem, igual ao rewrite de produção, sem CORS. Alternativa: `CORS_ORIGENS=http://localhost:5173` (localhost:5173 e :3000 são o mesmo site, então o
cookie Strict viaja).

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
- `/auth/reautenticar` (desbloqueio de tela da portaria) não foi implementado.
- Bootstrap do primeiro síndico em produção: hoje só pelo seed (`PORTARIA_AMBIENTE=producao` cria os 4 usuários com troca
  obrigatória). Falta um comando que crie só o síndico, com login e nome informados.
- Rehash de senha quando os parâmetros do argon2 mudarem (hoje o hash antigo continua valendo com os parâmetros dele).
- Ajustar os parâmetros do argon2 por medição na VPS (alvo de ~250 ms; no Mac de dev, ~120 ms).
- `login_limite` cresce uma linha por login, IP ou par login+IP distinto e não tem limpeza (app_rw não tem DELETE); um job de manutenção
  como app_migrator resolve quando o volume importar.
- `test:pg` sobrescreve a senha do `app_rw` no cluster (ver db/README.md).
- Serviços `web` e `minio` da spec §12.2 não foram incluídos (o `mailpit`, de dev, recebe a âncora do selo).
- Verificação diária de integridade com alerta ao síndico (spec §4.5): o agendador sela e envia a âncora, mas a verificação
  continua sob demanda.
- A imagem `migrate` carrega as dependências de desenvolvimento inteiras (591 MB); é só de dev, mas pode virar um estágio enxuto.
- Registro de acesso: a busca (`ultimoAcesso`) ainda usa o valor gravado, não o efetivo depois de uma correção.
- `pessoasDentro`, `presentes` e "já está dentro" fazem anti-join com as saídas de toda a trilha: medir quando passar de
  centenas de milhares de eventos (uma coluna/tabela de "aberto" resolveria, com trigger próprio).
- Verificação de integridade recalcula a cadeia inteira a cada pedido (lotes de 2.000): com centenas de milhares de eventos,
  passa a ser de segundos; o próximo passo é verificar a partir do último selo conferido.
- Exportação síncrona com teto de 20.000 eventos (`EXPORTACAO_GRANDE`); acima disso, exportação assíncrona (spec §6.6).
