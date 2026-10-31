# Contexto de build = raiz do monorepo (docker-compose.yml). Estágios:
#   deps     todas as dependências do workspace apps/api (dev incluídas)
#   build    tsc -> dist (CommonJS), antes o build CJS de @portaria/domain (packages/domain/dist/cjs)
#   migrate  drizzle-kit + as migrações do banco `portaria` (serviço "migrate")
#   dev      build + tsc-watch: recompila e reinicia a API a cada mudança em src/ (docker compose watch)
#   prod     só dependencies de produção
#   runtime  imagem final da API, usuário não-root
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
# O package.json da API depende de @portaria/domain; o npm precisa ver o diretório do workspace.
COPY packages/domain/package.json packages/domain/
# O lockfile lista apps/web; o npm ci exige o package.json dele (o resto fica fora, ver .dockerignore).
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/api --include-workspace-root --ignore-scripts

FROM deps AS build
# A API importa @portaria/domain (serialização do hash, unidades): o build da API compila o domain primeiro.
COPY packages/domain/tsconfig.json packages/domain/tsconfig.build.json packages/domain/
COPY packages/domain/src packages/domain/src
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/src apps/api/src
RUN npm run build -w apps/api

# Desenvolvimento com reload: parte do `build` (dependências de dev, domain compilado, dist/package.json CommonJS já
# gravado) e deixa o tsc-watch recompilando src/ -> dist/ e reiniciando o node a cada sucesso. Os arquivos chegam
# pelo `develop.watch` do compose (sync), não por bind mount: no macOS o bind mount perde eventos de arquivo e
# misturaria o node_modules do host (darwin) com o do container (musl, binário do argon2).
FROM build AS dev
WORKDIR /app/apps/api
ENV TZ=UTC
EXPOSE 3000
CMD ["npx", "tsc-watch", "-p", "tsconfig.build.json", "--noClear", "--onSuccess", "node dist/main.js"]

FROM deps AS migrate
WORKDIR /app/apps/api
COPY apps/api/drizzle.config.ts ./
COPY apps/api/drizzle ./drizzle
COPY apps/api/src/db/schema.ts ./src/db/schema.ts
USER node
CMD ["npx", "drizzle-kit", "migrate"]

FROM node:22-alpine AS prod
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/api --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production TZ=UTC
WORKDIR /app/apps/api
COPY --from=prod --chown=node:node /app/node_modules /app/node_modules
# node_modules/@portaria/domain é um link para packages/domain (workspace): o runtime precisa do package.json e do dist.
COPY --from=build --chown=node:node /app/packages/domain/package.json /app/packages/domain/package.json
COPY --from=build --chown=node:node /app/packages/domain/dist /app/packages/domain/dist
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --chown=node:node apps/api/package.json ./
# Pasta dos anexos cifrados (volume `documentos` do compose): criada aqui com dono node, para o volume novo herdar.
# Idem para o arquivo append-only da âncora do selo (volume `ancoras`).
RUN mkdir -p /var/lib/portaria/documentos /var/lib/portaria/ancoras \
  && chown node:node /var/lib/portaria/documentos /var/lib/portaria/ancoras \
  && chmod 700 /var/lib/portaria/documentos && chmod 750 /var/lib/portaria/ancoras
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
