# Controle e Gestão de Acesso em Condomínio Residencial

Material do Trabalho de Conclusão de Curso de Sistemas de Informação (EAD) *Controle e Gestão de Acesso em
Condomínio Residencial: contribuições para a segurança patrimonial, administrativa e jurídica*.

Autores: Ana Carolina Vilelo Moreira Dias, Rafael Aparecido Vidal e Ruan Abolis de Araújo.
Orientador: Prof. Me. Gilberto Alves Pereira. Faculdade Impacta, São Paulo, 2026.

## Sobre o trabalho

Estudo de caso em um condomínio residencial vertical de São Paulo–SP, com portaria 24 horas, 9 blocos e de 500 a 600
moradores. A pesquisa:

1. identificou as limitações do controle de acesso atual, por entrevista com o síndico e questionário com a equipe do
   condomínio;
2. levantou os requisitos de um sistema de controle de acesso aderente à gestão condominial;
3. analisou a legislação aplicável (LGPD, Código Civil, Lei de Condomínios e Estatuto da Pessoa com Deficiência);
4. desenvolveu um protótipo funcional do sistema a partir desses requisitos;
5. avaliou o protótipo quanto à conformidade legal, à mitigação de riscos operacionais e à aceitação pela equipe
   (Modelo de Aceitação de Tecnologia, TAM).

O nome do condomínio e dos participantes não aparece neste repositório, para preservar a identidade de quem
participou da pesquisa.

## Conteúdo

| Pasta | O que tem |
|---|---|
| `docs/requisitos.md` | Documento de requisitos: problemas levantados, escopo, requisitos funcionais e não funcionais, regras de negócio, proteção de dados (LGPD), casos de uso e matriz de rastreabilidade com os indicadores de avaliação |
| `docs/rastreabilidade.md` | Ligação de cada requisito funcional ao código que o implementa |
| `docs/api/` | Documentação da API: contrato OpenAPI 3.1 e coleções Bruno e Postman, gerados do código |
| `diagramas/` | Diagramas de casos de uso (portaria, administração e auditoria), em PlantUML, SVG e PNG, e a visão geral da arquitetura |
| `pesquisa/` | Instrumento de avaliação de aceitação (TAM) pós-uso, com termo de consentimento, roteiro da demonstração e plano de análise, e o registro do pré-teste do instrumento |
| `apps/web` | Front-end: SPA React 18 + Vite 5 + TypeScript + Tailwind + React Query (telas da portaria e da administração) |
| `apps/api` | Back-end: NestJS 11 + Drizzle ORM + PostgreSQL 17 (regras, permissões, trilha e LGPD) |
| `packages/domain` | Regras de negócio puras compartilhadas pelo front e pela API (RBAC, hash chain, unidades, prazos) |
| `db/` | Bootstrap dos papéis do PostgreSQL e notas de migração, testes e backup |
| `scripts/` | Execução local (`npm run local`), geração das coleções da API, conferência das âncoras do selo e ícones |

## O sistema

O protótipo atende **um condomínio**, com um banco de dados só. Funções:

- **Portaria:** registro de entrada e saída; meios de autorização (interfone, celular, morador presente, autorização
  prévia, escala de funcionário e exceção do porteiro com justificativa); registro retroativo para queda do sistema
  (contingência); prazo de permanência por tipo de visita; restrições de acesso; painel do turno; encomendas e
  ocorrências com anexos cifrados (AES-256-GCM).
- **Administração:** cadastro de pessoas, vínculos com a unidade e conferência do comprovante, unidades e veículos,
  funcionários e escala, usuários por papel (síndico, administração, porteiro, auditor), importação de planilha e
  relatórios.
- **Auditoria:** trilha de acessos só de inclusão, encadeada por hash (SHA-256), com verificação de integridade,
  exportação verificável, filtro por placa e selo diário com âncora externa.
- **Privacidade (LGPD):** pedidos do titular (exportação e anonimização), retenção por prazo e registro das
  anonimizações fora do banco, para reaplicá-las depois de uma restauração de backup.

Segurança: sessão em cookie `HttpOnly; SameSite=Strict` (o front nunca vê token), senha com argon2id, troca obrigatória
da senha provisória, limite de tentativas de login por usuário+IP e por IP, autorização por papel em toda rota e CPF
guardado só como máscara e HMAC.

## Como rodar localmente

Precisa de Node 22 ou mais novo (`.nvmrc`) e npm. Não precisa de Docker, PostgreSQL nem `.env`.

```bash
npm ci
npm run local
```

Abra http://localhost:5173 e entre com um destes usuários fictícios, todos com a senha `senha-demo-gestao-acesso`
(válida só neste modo local):

| Usuário | Papel |
|---|---|
| `roberto.faria` | síndico (acesso total) |
| `paula.nogueira` | administração |
| `joao.lima` | porteiro |
| `luiza.campos` | auditor (só leitura) |

O `npm run local` sobe a API de verdade (mesmas regras, permissões e trilha com hash chain) sobre um PostgreSQL em
memória (PGlite), aplica as migrações reais e carrega dados fictícios. O banco nasce limpo a cada execução e some no
Ctrl+C. A documentação interativa da API (Swagger) fica em http://127.0.0.1:3101/api/v1/docs enquanto ele roda.
Roteiros do que testar em cada tela: [apps/web/README.md](apps/web/README.md#roteiros-de-demonstração).

Com PostgreSQL 17 de verdade (dados persistentes), há um ambiente Docker de desenvolvimento:

```bash
cp .env.example .env            # preencher senhas e chaves (o .env não é versionado)
docker compose up -d --build    # db -> migrate -> api em http://127.0.0.1:3000
```

Detalhes em [apps/api/README.md](apps/api/README.md) e [db/README.md](db/README.md).

## Testes

```bash
npm run typecheck -w packages/domain -w apps/api
npm test -w packages/domain -w apps/api        # regras e API real sobre PGlite com as migrações reais
npx tsc --noEmit -p apps/web
npm test -w apps/web                            # Vitest + Testing Library
npm run test:e2e -w apps/web                    # Playwright contra a API real sobre PGlite (1ª vez: npx playwright install chromium)
```

No GitHub Actions, `testes-web.yml` roda tudo isso e `testes-postgres.yml` repete os testes de banco contra um
PostgreSQL 17 real (papéis, migrações, concorrência e o boot da API).

## Versão publicada

O front pode ser publicado na Vercel a partir de `apps/web` (`apps/web/vercel.json`). Ele precisa de uma API: o
`vercel.json` repassa `/api` para um endereço **provisório e inválido** (`api-da-demonstracao.invalid`), de propósito,
até que exista uma instância da API só para a demonstração, com dados fictícios. Para ligar, troque esse endereço pelo
da API da demonstração (com https) e configure nela `TRUST_PROXY` conforme os proxies na frente.

## Proteção de dados

Nenhum dado pessoal real está publicado aqui. Os exemplos de pessoas, unidades e placas são fictícios, as chaves e
senhas vêm do ambiente e as respostas dos questionários não são publicadas, apenas os instrumentos.

## Direitos

Todos os direitos reservados aos autores (ver `LICENSE`), inclusive sobre o código deste repositório. Citação
acadêmica permitida, com a referência ao trabalho.
