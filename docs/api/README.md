# Documentação da API

A API (`/api/v1`) é documentada em OpenAPI 3.1, gerada dos controllers do Nest e dos schemas Zod. Nada aqui é escrito à mão.

| Arquivo | O que é |
|---|---|
| `openapi.json` | Contrato OpenAPI 3.1 (fonte das demais coleções) |
| `postman/` | Coleção Postman v2.1 e os ambientes `publicado` e `local` |
| `bruno/` | Coleção Bruno (`bruno.json`, uma pasta por tag, `environments/`) |

## Importar

- **Bruno:** Open Collection e escolha `docs/api/bruno`. Selecione o ambiente (`publicado` ou `local`), preencha `login` e `senha` (a senha é secret) e rode `auth / login` primeiro. O Bruno guarda o cookie entre as requests.
- **Postman:** Import e selecione os 3 JSON de `docs/api/postman/` (a coleção e os dois ambientes). Escolha o ambiente, preencha `login` e `senha` e rode `auth / login`. O cookie fica no cookie jar.
- **Insomnia:** Import do `docs/api/openapi.json`.

Os ids dos paths e dos corpos são variáveis (`{{pessoaId}}`, `{{unidadeId}}`...): preencha com os ids que as respostas devolvem.

## Ver no Swagger

- Local: `npm run dev:pglite -w apps/api` e abra `http://127.0.0.1:3101/api/v1/docs` (porta em `PORTA_E2E`). O Swagger UI e o `/api/v1/openapi.json` existem só nesse modo.
- Ou cole o `openapi.json` em https://editor.swagger.io.

## Regenerar

```bash
npm run openapi -w apps/api && npm run colecoes
```

Os testes (`npm test -w apps/api` e `npm run test:scripts`) falham se `openapi.json`, `postman/` ou `bruno/` ficarem diferentes do que a API gera hoje.

## Ambientes

- **`publicado`** usa `https://tccgestaoacesso.vercel.app/api/v1`, a mesma origem do front e do cookie, e só responde depois que o `/api` do `apps/web/vercel.json` apontar para uma API (ver o README da raiz). O cookie `__Host-portaria_sessao` (`HttpOnly; SameSite=Strict; Secure`) funciona em cliente HTTP fora do navegador, mas exige https.
- **`local`** usa `http://127.0.0.1:3101/api/v1` (modo `dev:pglite`, cookie `portaria_sessao` sem `Secure`).

> **Aviso:** o ambiente `publicado` escreve na trilha append-only da instância por trás dele. Nada se apaga: cada criação fica registrada para sempre. Para experimentar, use `local`.

## Limitações

- As respostas de sucesso são só o envelope genérico `{data}` (ou `{data, pagination}` nas listas por cursor); o conteúdo de `data` não é descrito.
- Os corpos de exemplo das coleções são ponto de partida (CPF e telefone fictícios), e podem precisar de ajuste para passar nas regras de negócio.
