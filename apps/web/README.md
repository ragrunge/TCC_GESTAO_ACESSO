# Portaria Parque — front-end do sistema de controle de acesso e gestão de portaria

Aplicação React (Vite + TypeScript estrito + Tailwind) do Condomínio Residencial do Parque, produto do TCC de Sistemas de
Informação. É só cliente: todos os dados e regras vêm da API NestJS (`apps/api`), pelo cliente HTTP em `src/api/http`.
Não existe mais modo de demonstração (API simulada, banco no `localStorage` ou relógio simulado): a hora da tela é a
do navegador. Requisitos, especificação e protótipo de referência estão em `../../docs/01_requisitos.md`,
`../../docs/02_especificacao_tecnica.md` e `../../prototipo/Portaria.dc.html`.

## Como rodar

```bash
# da raiz do monorepo (app/)
npm install
npm run dev      # http://localhost:5173; o proxy /api aponta para a API de PRODUÇÃO (ver aviso abaixo)
npm test         # Vitest em todos os workspaces (web + domain + api)
npm run build    # tsc (strict) + vite build do web
npm run test:e2e -w apps/web   # Playwright contra a API real sobre PGlite (na 1ª vez: npx playwright install chromium)
```

### Contra qual API o `npm run dev` fala

A base é sempre relativa (`/api/v1`, mesma origem) e o `server.proxy` do `vite.config.ts` repassa `/api` à API. Mesma
origem é o que faz o cookie de sessão (`HttpOnly; SameSite=Strict`) funcionar sem CORS, como o rewrite da Vercel em
produção. O front nunca lê nem guarda token.

- **Padrão: a API de PRODUÇÃO da VPS** (`https://179-197-78-78.sslip.io`), com o banco e os dados reais. Use só para
  consultar. A trilha de eventos e a de alterações são **append-only**: qualquer entrada, cadastro, vínculo ou
  ocorrência de teste feito ali fica para sempre. **Não teste escrita contra a produção.** O cookie vem `__Host-`/`Secure`:
  Chrome e Firefox aceitam em `http://localhost`; o **Safari não**, use outro navegador.
- **Para desenvolver (com escrita)**: a API de teste local, sobre PGlite em memória, com as migrações reais e dados
  fictícios, sem Docker:

  ```bash
  npm run dev:pglite -w apps/api                              # http://127.0.0.1:3101, usuários roberto.faria, paula.nogueira,
                                                              # joao.lima, luiza.campos (senha: SENHA_E2E em e2e/ambiente.ts)
  API_PROXY_ALVO=http://127.0.0.1:3101 npm run dev -w apps/web
  ```

  O banco some ao parar o processo. `API_PROXY_ALVO` (variável de shell, sem `VITE_`, fora do bundle) troca o alvo.

## Testes

- **Unitários** (`npm test -w apps/web`): o cliente HTTP com o transporte do axios simulado (`src/test/httpApi.test.ts`:
  rotas, corpos, envelope, erros, sessão, 429) e as funções puras da tela (planilha, senha temporária, negado). As regras
  de negócio são testadas onde vivem: `packages/domain` e a API (`apps/api/test`, sobre PGlite).
- **E2E** (`npm run test:e2e -w apps/web`): o `playwright.config.ts` sobe a API de teste (`npm run dev:pglite`) e o Vite
  na 5180 com `API_PROXY_ALVO` apontando para ela. Os testes rodam em série num banco só; antes de cada teste o banco
  volta ao estado semeado (`POST /__e2e/reset`, rota que só existe nesse servidor; ver `e2e/helpers.ts`). Os dados que
  as specs esperam (Márcia Pereira, Pedro Almeida dentro do condomínio, restrição do Bruno Teixeira, ocorrências,
  encomenda K1...) estão em `apps/api/test/e2e/dados.ts`; as datas são relativas à hora real. As specs `21-26-api-*`
  são fluxos longos (serial) e resetam o banco uma vez, no início.
- CI: `.github/workflows/testes-web.yml` (typecheck, build, unitários e e2e com Chromium).

O domínio vive em `packages/domain` (`@portaria/domain`); os testes dele rodam com `npm test -w packages/domain`.

Node 20+ (testado com Node 24). Fontes IBM Plex via `@fontsource` (funcionam offline).

## Arquitetura

```
packages/domain/src/   (pacote `@portaria/domain`, importado como `@portaria/domain/rules` etc.)
  tipos (espelham a spec, seção 3), regras puras (rules.ts), RBAC (rbac.ts), encadeamento SHA-256 (hashChain.ts),
  estrutura do condomínio declarativa e utilitários de unidade (units.ts: blocos, código "A-32", busca), tempo (time.ts). Sem React.

apps/web/src/
  api/      types.ts (interface Api, ApiError), http/ (axios: cliente e adaptador de todos os módulos), index.tsx (criarApi + useApi)
  auth/     sessão e guardas de rota por papel
  components/  Button, Badge/Selo, Card, Modal (foco preso, Esc), Toast, Table, Tabs, TowerUnitPicker, PessoaPicker, PageHeader...
  features/ portaria (painel, entrada, pessoas), encomendas, ocorrencias, unidades, vinculos, cadastro, importacao, historico,
            relatorios, usuarios, auth, common
  app/      App (rotas), Layout (sidebar, topbar, busca global, relógio, atalhos F2/F3/F4), hooks
```

As regras vivem em `packages/domain/src/rules.ts` e são usadas **dos dois lados**: a UI as chama para habilitar botões; a
API as chama para decidir de verdade (e responder 403/422 com os códigos da spec).

- `src/api/http/cliente.ts`: instância axios (`withCredentials`) e interceptor que converte todo erro em `ApiError`,
  emite "sessão expirada" uma vez por sessão (401 fora de login/me/logout) e "troca obrigatória" (403
  `TROCA_DE_SENHA_OBRIGATORIA`), e põe o tempo do `Retry-After` na mensagem do 429. O interceptor não navega: o
  `AuthContext` zera o usuário e os guards redirecionam.
- `src/api/http/createHttpApi.ts`: todos os módulos da API (auth, usuários, unidades, pessoas, vínculos, funcionários,
  veículos, importação, registro de acesso, autorizações, restrições, auditoria com selo, relatórios, encomendas,
  ocorrências com anexos e LGPD).
- React Query (v5) nas telas. A senha temporária (criar/redefinir) aparece uma vez num modal e não passa pelo cache.

## Rastreabilidade (RF/UC → arquivo/tela)

Tabela completa por RF, com os arquivos da API e da tela: [`docs/rastreabilidade.md`](../../docs/rastreabilidade.md). Resumo por caso de uso (caminhos relativos a `apps/web/src/`, salvo indicação):

| Requisito / caso de uso | Onde |
|---|---|
| UC01, RN-05 (login; 2FA fica para o pós-MVP) | `features/auth/LoginPage.tsx`, `auth/AuthContext.tsx`, `api/http` (`auth`); API em `apps/api/src/auth/` |
| RNF-04 RBAC | `packages/domain/src/rbac.ts` (matriz), `RequireRole` em `auth/AuthContext.tsx` (tela), `PapelGuard` em `apps/api/src/auth/guards.ts` |
| UC02–UC06, RF-12/13/16/17/34, RN-01, RN-07 (registrar entrada, T03–T05) | `features/portaria/EntradaPage.tsx`, `packages/domain/src/rules.ts`, `EventosService.criarEntrada` em `apps/api/src/eventos/eventos.service.ts` |
| RF-16 restrição bloqueante (T04) | modal em `EntradaPage.tsx`; evento `negado` gravado no servidor |
| UC07, UC09, RF-20 (pessoas no condomínio, saída — T06) | `features/portaria/PessoasDentroPage.tsx`, `EventosService.registrarSaida` na API |
| UC08, RF-35 (retroativo) | `EntradaPage.tsx?retroativo=1`, botão no `PainelPage.tsx` |
| UC10–UC12, RF-14/15, RN-06 (autorização prévia, restrição, síndico aprova) | `features/unidades/UnidadeDetalhePage.tsx`, painel do síndico em `features/portaria/PainelPage.tsx`; API em `apps/api/src/eventos/autorizacoes.service.ts` |
| UC13, RF-01/08 (unidades, veículos — T09) | `features/unidades/*` |
| UC14, RF-02, RN-10 (pessoas) | `features/cadastro/*` |
| UC15–UC17, RF-03–06, RN-02/03 (vínculos — T10) | `features/vinculos/VinculosPage.tsx`; API em `apps/api/src/vinculos/vinculos.service.ts` |
| UC18, RF-11, RN-09 (importação — T11) | `features/importacao/*` |
| UC19, RF-33 (usuários — T14) | `features/usuarios/UsuariosPage.tsx` |
| UC21–UC24, RF-22–26, RN-08 (encomendas — T07) | `features/encomendas/EncomendasPage.tsx` |
| UC25–UC26, RF-27/28 (ocorrências — T08) | `features/ocorrencias/OcorrenciasPage.tsx` |
| UC27, RF-29, RF-38 (painel e passagem de turno — T02) | `features/portaria/PainelPage.tsx` |
| UC28–UC31, RF-19/32/37, RN-04, RNF-01 (histórico, integridade, exportação — T12) | `features/historico/*`, `packages/domain/src/hashChain.ts`; API em `apps/api/src/auditoria/auditoria.controller.ts` e `apps/api/src/db/cadeia.ts` |
| UC29, RF-30/31 (relatórios — T13) | `features/relatorios/RelatoriosPage.tsx` |
| RNF-07 teclado | `app/Layout.tsx` (F2/F3/F4), `EntradaPage.tsx` (foco, tecla do bloco A–I, Enter/Esc), `components/TowerUnitPicker.tsx` |

## Roteiros de demonstração

Com a API de teste (`npm run dev:pglite -w apps/api`, dados de `apps/api/test/e2e/dados.ts` e do seed de dev).

1. **Visitante com interfone** — Porteiro, `F2`, "Marcos", `Enter`; tecla `D`, digite `32`; Interfone → Ana Ribeiro → `Enter`. Toast e nova linha no painel.
2. **Pessoa em restrição** — `F2`, "Bruno Teixeira", bloco D, unidade 32: modal vermelho; "Registrar ocorrência" abre a ocorrência já preenchida e vinculada ao evento "negado".
3. **Exceção** — `F2`, "Técnico Enel", bloco B, unidade 24 (no protótipo, T2-104), Exceção do porteiro, "Serviço público (luz, água, gás)", `Enter`. Etiqueta âmbar no painel.
4. **Encomenda** — `F3`, bloco G AP 11, confirmar a unidade; depois, em Aguardando, "Entregar" a uma pessoa sem vínculo (ex.: Marcos Pereira) e ver o bloqueio.
5. **Fraude de locação** — Administração, Vínculos pendentes, "Rodrigo Alves — inquilino — I-13": 3 itens não conferem, Rejeitar é a ação primária; rejeitar com justificativa (ou aprovar só com 15+ caracteres).
6. **Auditoria** — Auditor, Histórico, "Somente exceções", abrir o evento do roteiro 3, "Verificar integridade", "Exportar trilha".
7. **Retroativo** — Painel, "Lançar registro retroativo": hora real anterior a agora + nº do formulário; evento fica "Retroativo" com hora real e hora do lançamento.
8. **Adulteração da trilha** — `curl -X POST -H 'content-type: application/json' -d '{"pessoa":"Thiago Moura"}' http://127.0.0.1:3101/__e2e/adulterar-evento` (rota só da API de teste). Em Histórico, "Verificar integridade" aponta o primeiro registro adulterado. `curl -X POST http://127.0.0.1:3101/__e2e/reset` volta ao banco semeado.

Outras demonstrações: Válter Souza (zelador) entra por Escala nos dias e horas da escala dele.

## Remapeamento de unidades (blocos A a I, térreo 03–04 e andares 1 a 4 com finais 1 a 4)

A estrutura vem de `ESTRUTURA_PADRAO` (`packages/domain/src/units.ts`), a mesma do seed da API. O protótipo usava torres
numéricas: a torre N virou a N-ésima letra (T4-32 -> D-32), e os números que não existem na estrutura foram remapeados.

| Protótipo | App | Observação |
|---|---|---|
| T1-73 | A-33 | |
| T3-91 | C-03 | |
| T5-63 | E-43 | |
| T5-81 | E-03 | pedido de vínculo de Beatriz Okada |
| T2-104 | B-24 | |
| T2-61 | B-41 | |
| T9-21 | I-13 | Rodrigo Alves e o contrato de locador que não é a proprietária (Marta Siqueira) |
| T9-33 | I-14 | |
| T6-52 | F-04 | 52 não existe (só até o 4º andar) |
| T4-32, T7-11, T3-42, T8-42, T1-12, T3-14, T6-22, T8-13 | D-32, G-11, C-42, H-42, A-12, C-14, F-22, H-13 | mesma posição, bloco por letra |


## Limitações

- O cookie de sessão de produção é `__Host-`/`Secure`: no `npm run dev` contra a VPS, o Safari não o aceita em `http://localhost`.
- A exportação `.jsonl` não é assinada: é um "arquivo de hashes para verificação"; a âncora externa é o selo diário (spec 4.6).
- Importação lê **CSV** e **.xlsx** (primeira planilha; biblioteca `read-excel-file`).
- Sem notificação à unidade e sem integração com hardware.
- Layout para desktop (≥ 1280 px); sem versão mobile.

## Decisões e desvios da spec

- `tipo` do evento ganhou `negado` (tentativa bloqueada gravada na trilha) e `correcao` (novo evento com `corrigeEventoId`).
- Restrição (RF-16) é checada **antes** da validação do autorizador, e a API grava o evento `negado` antes de responder 422.
- Pessoa tem `categoria` fixa (necessária para a regra da Escala); a spec deriva o papel do contexto.
- Usuários: login é só usuário + senha para todos os papéis; 2FA fica para a fase de segurança (pós-MVP).
