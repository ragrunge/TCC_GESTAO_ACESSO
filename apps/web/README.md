# Portaria Parque — front-end do sistema de controle de acesso e gestão de portaria

Aplicação React (Vite + TypeScript estrito + Tailwind) do Condomínio Residencial do Parque, produto do TCC de Sistemas de
Informação. Roda **localmente, sem backend**: uma API simulada em memória aplica as regras de negócio como se fosse o
servidor. Requisitos, especificação e protótipo de referência estão em `../../docs/01_requisitos.md`, `../../docs/02_especificacao_tecnica.md`,
`../../docs/03_prompt_prototipo.md`, `../../docs/04_prompt_correcoes_prototipo.md` e `../../prototipo/Portaria.dc.html`.

## Como rodar

```bash
# da raiz do monorepo (app/)
npm install
npm run dev      # http://localhost:5173 (delega a apps/web)
npm test         # Vitest em todos os workspaces (web + domain)
npm run build    # tsc (strict) + vite build do web
npm run test:e2e -w apps/web   # Playwright (sobe o vite na porta 5180; na 1ª vez: npx playwright install chromium)

# ou dentro de apps/web: npm run dev | test | build
```

O domínio vive em `packages/domain` (`@portaria/domain`); os testes dele rodam com `npm test -w packages/domain`.

Node 20+ (testado com Node 24). Fontes IBM Plex via `@fontsource` (funcionam offline).

**Login de demonstração**: escolha o perfil (Porteiro João Lima, Administração Paula Nogueira, Síndico Roberto Faria,
Auditor Luíza Campos); qualquer senha vale; administração e síndico pedem um código de 6 dígitos (qualquer um). O botão
discreto "Restaurar dados de demonstração" fica na tela de login.

O **relógio simulado** começa em sexta-feira 09/10/2026 14:32 e avança em tempo real. Os dados ficam no `localStorage`
(com `try/catch`); o relógio retoma de onde parou ao recarregar.

## Arquitetura

```
packages/domain/src/   (pacote `@portaria/domain`, importado como `@portaria/domain/rules` etc.)
  tipos (espelham a spec, seção 3), regras puras (rules.ts), RBAC (rbac.ts), encadeamento SHA-256 (hashChain.ts),
  geração das 165 unidades (units.ts), tempo e relógio simulado (time.ts). Sem React.

apps/web/src/
  api/      types.ts (interface Api, ApiError), mock/ (servidor em memória + seed), http/ (esqueleto fetch), index.tsx (escolha + useApi)
  auth/     sessão e guardas de rota por papel
  components/  Button, Badge/Selo, Card, Modal (foco preso, Esc), Toast, Table, Tabs, TowerUnitPicker, PessoaPicker, PageHeader...
  features/ portaria (painel, entrada, pessoas), encomendas, ocorrencias, unidades, vinculos, cadastro, importacao, historico,
            relatorios, usuarios, auth, common
  app/      App (rotas), Layout (sidebar, topbar, busca global, relógio, atalhos F2/F3/F4), hooks
```

As regras vivem em `packages/domain/src/rules.ts` e são usadas **dos dois lados**: a UI as chama para habilitar botões; o mock as chama
para decidir de verdade (e responder 403/422 com os códigos da spec).

### Trocar o mock pela API HTTP

```bash
cp .env.example .env
# VITE_API_MODE=http
# VITE_API_URL=http://localhost:3000/api/v1
```

`src/api/http/createHttpApi.ts` é só um esqueleto: cada método lança `NAO_IMPLEMENTADO` e traz comentado o endpoint da spec
(seção 6). Já existe o helper `requisitar()` (cookie de sessão, mapeamento do erro `{ codigo, mensagem }` para `ApiError`).

## Rastreabilidade (RF/UC → arquivo/tela)

| Requisito / caso de uso | Onde |
|---|---|
| UC01, RN-05 (login; 2FA fica para o pós-MVP) | `features/auth/LoginPage.tsx`, `auth/AuthContext.tsx`, `api/mock` (`auth`) |
| RNF-04 RBAC | `packages/domain/src/rbac.ts` (matriz), `RequireRole`, `exige()` em `api/mock/createMockApi.ts` |
| UC02–UC06, RF-12/13/16/17/34, RN-01, RN-07 (registrar entrada, T03–T05) | `features/portaria/EntradaPage.tsx`, `packages/domain/src/rules.ts`, `eventos.criar` no mock |
| RF-16 restrição bloqueante (T04) | modal em `EntradaPage.tsx`; evento `negado` gravado no servidor |
| UC07, UC09, RF-20 (pessoas no condomínio, saída — T06) | `features/portaria/PessoasDentroPage.tsx`, `eventos.registrarSaida` |
| UC08, RF-35 (retroativo) | `EntradaPage.tsx?retroativo=1`, botão no `PainelPage.tsx` |
| UC10–UC12, RF-14/15, RN-06 (autorização prévia, restrição, síndico aprova) | `features/unidades/UnidadeDetalhePage.tsx`, painel do síndico em `PainelPage.tsx` |
| UC13, RF-01/08 (unidades, veículos — T09) | `features/unidades/*` |
| UC14, RF-02, RN-10 (pessoas) | `features/cadastro/*` |
| UC15–UC17, RF-03–06, RN-02/03 (vínculos — T10) | `features/vinculos/VinculosPage.tsx`, `vinculos.*` no mock |
| UC18, RF-11, RN-09 (importação — T11) | `features/importacao/*` |
| UC19, RF-33 (usuários — T14) | `features/usuarios/UsuariosPage.tsx` |
| UC21–UC24, RF-22–26, RN-08 (encomendas — T07) | `features/encomendas/EncomendasPage.tsx` |
| UC25–UC26, RF-27/28 (ocorrências — T08) | `features/ocorrencias/OcorrenciasPage.tsx` |
| UC27, RF-29, RF-38 (painel e passagem de turno — T02) | `features/portaria/PainelPage.tsx` |
| UC28–UC31, RF-19/32/37, RN-04, RNF-01 (histórico, integridade, exportação — T12) | `features/historico/*`, `packages/domain/src/hashChain.ts`, `auditoria.*` |
| UC29, RF-30/31 (relatórios — T13) | `features/relatorios/RelatoriosPage.tsx` |
| RNF-07 teclado | `app/Layout.tsx` (F2/F3/F4), `EntradaPage.tsx` (foco, 1–9, Enter/Esc), `components/TowerUnitPicker.tsx` |

## Roteiros de demonstração

1. **Visitante com interfone** — Porteiro, `F2`, "Marcos", `Enter`; tecla `4`, digite `32`; Interfone → Ana Ribeiro → `Enter`. Toast e nova linha no painel.
2. **Pessoa em restrição** — `F2`, "Bruno Teixeira", torre 4, unidade 32: modal vermelho; "Registrar ocorrência" abre a ocorrência já preenchida e vinculada ao evento "negado".
3. **Exceção** — `F2`, "Técnico Enel", torre 2, unidade 24 (antes T2-104), Exceção do porteiro, "Serviço público (luz, água, gás)", `Enter`. Etiqueta âmbar no painel.
4. **Encomenda** — `F3`, torre 7 AP 11, confirmar a unidade; depois, em Aguardando, "Entregar" a uma pessoa sem vínculo (ex.: Marcos Pereira) e ver o bloqueio.
5. **Fraude de locação** — Administração, Vínculos pendentes, "Rodrigo Alves — inquilino — T9-13": 3 itens não conferem, Rejeitar é a ação primária; rejeitar com justificativa (ou aprovar só com 15+ caracteres).
6. **Auditoria** — Auditor, Histórico, "Somente exceções", abrir o evento do roteiro 3, "Verificar integridade", "Exportar trilha".
7. **Retroativo** — Painel, "Lançar registro retroativo": hora real anterior a agora + nº do formulário; evento fica "Retroativo" com hora real e hora do lançamento.
8. **Adulteração da trilha** — no console do navegador: `window.__adulterarEvento('e4808')` (aceita id, código EV-… ou seq). Em Histórico, "Verificar integridade" aponta o primeiro registro adulterado. "Restaurar dados de demonstração" (ou `window.__restaurarDemo()`) desfaz.

Outras demonstrações: autorização prévia da Dedetizadora Lumen (T6-52) aparece em âmbar até 15h (avance o dia seguinte para ver vencida); Válter Souza (zelador) entra por Escala; síndico aprova a restrição para todo o condomínio pendente no painel.

## Remapeamento de unidades (165 unidades: torres 1–8 com 11–54; torre 9 com 11–15)

| Protótipo | App | Observação |
|---|---|---|
| T1-73 | T1-33 | |
| T3-91 | T3-51 | |
| T5-63 | T5-43 | |
| T5-81 | T5-51 | pedido de vínculo de Beatriz Okada |
| T2-104 | T2-24 | |
| T2-61 | T2-41 | |
| T9-21 | T9-13 | Rodrigo Alves e o contrato de locador que não é a proprietária (Marta Siqueira) |
| T9-33 | T9-14 | |
| T4-32, T7-11, T6-52, T3-42, T8-42, T1-12, T3-14, T6-22, T8-13 | iguais | existem no novo desenho |

Unidades sem moradores no protótipo recebem moradores fictícios com vínculo **Legado** (prazo 31/03/2027), simulando a
importação da planilha; por isso "cadastro completo" (vínculo aprovado) é baixo no início. Há ~175 veículos e ~275
entradas históricas geradas de forma determinística (alimentam os gráficos).

## Limitações

- **Sem backend**: tudo é simulado em memória/`localStorage`. Não há segurança real: a senha é de mentira (não há 2FA no MVP), o RBAC "do servidor" roda no navegador.
- **Hash no navegador** (Web Crypto, exige `localhost` ou HTTPS). Quem controla o navegador pode reescrever a cadeia inteira; sem âncora externa a verificação prova só consistência interna (spec 4.6). A exportação `.jsonl` não é assinada: é um "arquivo de hashes para verificação".
- Importação lê **CSV** e **.xlsx** (primeira planilha; biblioteca `read-excel-file`).
- Anexos e fotos são simulados (guarda-se só o nome do arquivo). Sem criptografia de documentos, retenção LGPD automática, notificação à unidade, job de encerramento de vínculos, hardware.
- Cadastro/edição de funcionários e escalas (RF-09) sem tela: há um funcionário de seed (Válter Souza).
- Retirada de encomenda por "pessoa autorizada não vinculada" (RN-08, 2ª parte) não implementada.
- Layout para desktop (≥ 1280 px); sem versão mobile.

## Decisões e desvios da spec

- `tipo` do evento ganhou `negado` (tentativa bloqueada gravada na trilha) e `correcao` (novo evento com `corrigeEventoId`).
- Restrição (RF-16) é checada **antes** da validação do autorizador, e o mock grava o evento `negado` antes de responder 422.
- Pessoa tem `categoria` fixa (necessária para a regra da Escala); a spec deriva o papel do contexto.
- Usuários: login é só usuário + senha para todos os papéis; 2FA fica para a fase de segurança (pós-MVP).
