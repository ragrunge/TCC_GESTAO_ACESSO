# Deploy — Portaria Parque na VPS da Betech

Runbook das fases 2 e 3. A fase 1 (este repositório) entregou só código e configuração, validados localmente. Nada
foi feito no servidor.

| Fase | O quê | Quem decide |
|---|---|---|
| 1 (feita) | Compose de produção, backup, âncora pelo GitHub Actions, `vercel.json`, este runbook | — |
| 2 | Inventário da VPS (só leitura), escolha do proxy, clone, `.env`, build, migrate, seed, TLS | responsável técnico + Betech |
| 3 | Rewrite da Vercel ativo em `http`, âncora ligada, backup agendado, checklist | responsável técnico |

Topologia alvo:

```
navegador ──https──> tccgestaoacesso.vercel.app ──(rewrite /api/*)──https──> 179-197-78-78.sslip.io
                         (SPA estática)                                        proxy da VPS (nginx | Caddy | Traefik, TLS)
                                                                                   │ http, 127.0.0.1:3100
                                                                                   ▼
                                                    projeto compose "tcc-portaria": api (node, não-root) ── rede interna ── db (Postgres 17)
GitHub Actions (1x/dia) ──https──> /api/v1/auditoria/selos/publico ──> commit append-only no branch `ancoras`
```

A VPS também roda a produção do Tobe (porta 3333, clone em `/app/tobe-api`). Nada aqui mexe nele, exceto o bloco do
proxy, que é compartilhado. Esse ponto está sinalizado na seção 5.

---

## 1. Pré-requisitos

### 1.1 Autorização

- [ ] Betech autorizou o uso da VPS (já registrado) **e** o responsável pelo proxy/Tobe sabe da janela da fase 2.
- [ ] Acesso SSH com usuário próprio (não compartilhar a chave do Tobe), com `sudo` e no grupo `docker`.
- [ ] Repositório: o responsável tem permissão de admin em `ragrunge/TCC_GESTAO_ACESSO` (ruleset e variável).

### 1.2 Inventário (fase 2, só leitura: nada de `restart`, `reload` ou edição)

```bash
uname -a; lsb_release -ds; free -h; df -h / /var/lib/docker
docker version --format '{{.Server.Version}}'; docker compose version
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
docker network ls; docker volume ls
sudo ss -ltnp                                   # quem escuta em 80/443, 3333, 5432 e se 3100 está livre
systemctl is-active nginx caddy traefik 2>/dev/null
sudo cat /etc/docker/daemon.json 2>/dev/null    # userland-proxy, log-driver, ipv6
sudo ufw status verbose 2>/dev/null; sudo iptables -S DOCKER-USER 2>/dev/null
command -v age git openssl
```

O que a fase 2 precisa responder com isso:

| Pergunta | Por quê |
|---|---|
| Qual processo ocupa 80/443: nginx/Caddy no host ou um container (Traefik/Caddy/nginx)? | Define o bloco da seção 5. Proxy em container **não alcança** `127.0.0.1:3100` do host (5.4) |
| Onde fica a config do proxy, e como o Tobe está declarado nela? | O bloco novo entra ao lado do Tobe, sem tocar no dele |
| Como o proxy trata `X-Forwarded-For` hoje? | `TRUST_PROXY=2` só funciona se o proxy **acrescenta** ao XFF da Vercel (seção 4). Mudar isso pode afetar o Tobe |
| ACME: quem emite certificado hoje (certbot, Caddy, Traefik resolver)? | O certificado do `179-197-78-78.sslip.io` sai pelo mesmo mecanismo (seção 5, aviso do limite) |
| 3100 livre? Memória livre ≥ 1,5 GB? Disco ≥ 5 GB livres? | API 384 MiB + banco 512 MiB + build (pico ~1 GB, temporário) |
| Firewall da Hostinger sincronizado? | Só 22/80/443 precisam estar abertos. 3100 e 5432 **não** (e o compose nem os expõe fora do loopback) |
| `age` disponível? | Backup (seção 8): `sudo apt install age` |

---

## 2. Clone e `.env`

```bash
sudo mkdir -p /opt/tcc-portaria && sudo chown "$USER": /opt/tcc-portaria
git clone https://github.com/ragrunge/TCC_GESTAO_ACESSO.git /opt/tcc-portaria
cd /opt/tcc-portaria
cp .env.producao.example .env && chmod 600 .env
```

Gerar os segredos **na VPS** (nunca colar valor em chat, e-mail ou outra máquina). O bloco abaixo grava direto no
`.env`, sem imprimir:

```bash
cd /opt/tcc-portaria
pw()  { openssl rand -base64 32 | tr -d '/+=\n'; }      # senhas de banco (entram em URL)
key() { openssl rand -base64 32; }                      # chaves da aplicação (32 bytes)
sed -i \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(pw)|" \
  -e "s|^APP_MIGRATOR_PASSWORD=.*|APP_MIGRATOR_PASSWORD=$(pw)|" \
  -e "s|^APP_RW_PASSWORD=.*|APP_RW_PASSWORD=$(pw)|" \
  -e "s|^PORTARIA_HMAC_CPF_KEY=.*|PORTARIA_HMAC_CPF_KEY=$(key)|" \
  -e "s|^PORTARIA_KEK=.*|PORTARIA_KEK=$(key)|" \
  -e "s|^PORTARIA_KEK_VERSAO=.*|PORTARIA_KEK_VERSAO=1|" \
  -e "s|^TRUST_PROXY=.*|TRUST_PROXY=2|" \
  -e "s|^API_TAG=.*|API_TAG=$(git rev-parse --short HEAD)|" \
  .env
grep -c '=$' .env    # quantas ficaram vazias (as opcionais); nunca `cat .env`
```

**Cofre, antes de seguir:** `PORTARIA_HMAC_CPF_KEY` e `PORTARIA_KEK` precisam de uma cópia **fora da VPS** (gerenciador
de senhas do responsável). Elas não estão no dump. Sem a HMAC, a busca por CPF dos cadastros se perde, e ela não é
rotacionável. Sem a KEK, os anexos ficam ilegíveis para sempre. Copie pelo terminal da VPS para o cofre sem passar por
arquivo intermediário. As senhas de banco não precisam de cofre: o restore recria os roles a partir do `.env` novo.

O `.env` já traz `COMPOSE_FILE=docker-compose.prod.yml`: qualquer `docker compose ...` nessa pasta usa o arquivo de
produção. **Não** rode o `docker-compose.yml` de dev na VPS (Mailpit, seed com pessoas fictícias e porta do banco
publicada).

---

## 3. Build, migrate, seed

```bash
cd /opt/tcc-portaria
docker compose config --quiet && echo ok       # interpolação: falta de variável obrigatória aparece aqui
docker compose build                            # na própria VPS (amd64); ~3-5 min na primeira vez
docker compose up -d --wait                     # db -> permissoes + migrate (rodam e terminam) -> api
docker compose ps -a                            # db/api healthy; permissoes/migrate Exited (0)
curl -s http://127.0.0.1:3100/api/v1/saude      # {"data":{"status":"ok","banco":"ok",...}}
```

- `db`: o bootstrap (`db/bootstrap/00_roles.sh`) cria `app_migrator`, `app_rw` e o banco **na primeira subida do
  volume**. Mudar a senha no `.env` depois **não** muda o role (ver `db/README.md`).
- `permissoes`: acerta o dono dos volumes `documentos` e `ancoras` para o usuário `node` da API (volume restaurado de
  backup ou criado por outra imagem nasce root, e a API não-root não gravaria). Roda a cada `up`; é idempotente.
- `migrate`: roda a cada `up` e aplica só o que falta. A API só sobe depois do sucesso dele.

**Seed** (estrutura do condomínio + 4 usuários de demonstração, **todos com troca de senha obrigatória** em produção;
pessoas fictícias não entram). A senha temporária só existe no ambiente daquele processo:

```bash
read -rs -p 'Senha temporária do seed (12+ caracteres): ' SEED_SENHA_DEV; echo; export SEED_SENHA_DEV
docker compose run --rm --no-deps -e SEED_SENHA_DEV api node dist/cli/seed-dev.js
unset SEED_SENHA_DEV
```

Em seguida, entre com o síndico (`roberto.faria`), troque a senha e crie os usuários reais. Desative os de
demonstração que não forem usados.

---

## 4. `TRUST_PROXY`: quantos saltos confiar

A API usa `req.ip` (Express `trust proxy` = número de saltos) para o limite de login por IP e para o IP gravado na
sessão e na trilha. O número é a contagem de proxies **entre o cliente e a API**, cada um acrescentando o endereço
de quem o chamou ao `X-Forwarded-For`.

| Topologia | `TRUST_PROXY` | Observação |
|---|---|---|
| navegador → Vercel (rewrite) → proxy da VPS → API | **2** | Esta fase. Exige que o proxy **acrescente** ao XFF que a Vercel mandou |
| navegador → proxy da VPS → API (domínio próprio `api.`, sem Vercel no caminho) | 1 | Evolução sugerida em spec §14 nº 26 |
| navegador → Cloudflare → Vercel → proxy → API | 3 | Só se um CDN entrar na frente |
| sem proxy (dev, `127.0.0.1:3000` direto) | `false` | Nunca em produção |

Erro para **menos** (ex.: 1 com Vercel): todo mundo aparece com o IP da borda da Vercel, e 30 falhas de qualquer um
bloqueiam o login de todos por 15 min. Erro para **mais**: o IP vira o valor que o cliente escreveu no XFF.

**Custo aceito (spec §14 nº 26):** quem chama `https://179-197-78-78.sslip.io` direto, sem passar pela Vercel, escolhe
o próprio IP pelo XFF, porque a Vercel não publica faixa fixa de IP e o proxy não tem como distinguir. Por isso o limite
por IP é auxiliar, e o controle que vale é o limite por login. Não "consertar" pondo IP de bridge em allowlist (com
o `userland-proxy` do Docker, todo cliente aparece com o IP do gateway da bridge, e a allowlist liberaria qualquer um):
o número de saltos não depende do IP de origem do socket.

---

## 5. Proxy da VPS (a fase 2 escolhe UM)

Regras comuns aos três:

- só `/api/` vai para a API; o resto do host responde 404 (o front é da Vercel);
- `X-Forwarded-For` **acrescentado**, nunca substituído (seção 4);
- corpo até 6 MB (anexo de ocorrência até 4 MB + multipart);
- upstream `http://127.0.0.1:3100` (proxy no host). Proxy em container: seção 5.4.

> **Aviso: limite de emissão do Let's Encrypt no sslip.io.** `sslip.io` **não** está na Public Suffix List (conferido em
> 2026-10-19). O limite de 50 certificados novos por semana por domínio registrado vale para **todos** os usuários do
> sslip.io juntos, e pode estar esgotado no dia da emissão (`too many certificates already issued for "sslip.io"`).
> Também vale o limite de 5 certificados duplicados por semana para o mesmo nome. Então:
> 1. teste primeiro contra o **staging** do Let's Encrypt (`--test-cert` no certbot, `acme_ca` de staging no Caddy,
>    `caServer` de staging no Traefik) e só depois emita o real;
> 2. não deixe o proxy em laço de reemissão (cada falha gasta tentativa e pode acionar o limite de falhas por hora);
> 3. se o limite estiver esgotado: espere a janela de 7 dias, use outra CA ACME (ZeroSSL, Buypass) com o mesmo
>    proxy, ou registre um domínio barato (o que também resolve o custo do nº 26, com `api.` no mesmo site);
> 4. confira o vencimento (90 dias) e a renovação automática do proxy, que concorre ao mesmo limite.

### 5.1 nginx (no host)

```nginx
# /etc/nginx/sites-available/tcc-portaria  (ln -s em sites-enabled; `nginx -t` antes de `systemctl reload nginx`)
server {
    listen 80;
    server_name 179-197-78-78.sslip.io;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    # nginx 1.24 (Ubuntu 24.04) não conhece `http2 on;` (só a partir da 1.25.1): http2 vai no listen.
    listen 443 ssl http2;
    server_name 179-197-78-78.sslip.io;

    ssl_certificate     /etc/letsencrypt/live/179-197-78-78.sslip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/179-197-78-78.sslip.io/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;

    client_max_body_size 6m;

    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # ACRESCENTA o IP de quem chamou (a borda da Vercel) ao XFF que a Vercel mandou: TRUST_PROXY=2.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location / { return 404; }
}
```

Certificado em dois passos, porque o `nginx -t` falha enquanto o bloco 443 aponta para um certificado que ainda não
existe: (1) `mkdir -p /var/www/certbot`, habilitar só o bloco 80, `nginx -t && systemctl reload nginx`;
(2) `certbot certonly --webroot -w /var/www/certbot -d 179-197-78-78.sslip.io --test-cert` (staging), depois sem
`--test-cert` (com `--force-renewal` para trocar o de staging); (3) acrescentar o bloco 443, `nginx -t`, reload. O `$proxy_add_x_forwarded_for` é por `location`: **não afeta o Tobe**.

### 5.2 Caddy (no host)

```caddy
179-197-78-78.sslip.io {
    request_body { max_size 6MB }
    handle /api/* {
        reverse_proxy 127.0.0.1:3100
    }
    handle { respond 404 }
}
```

Caddy **descarta** o XFF recebido de quem não está em `trusted_proxies`. Sem ajuste, a API vê só o IP da borda da
Vercel (o caso "para menos" da seção 4). Duas saídas, a decidir na fase 2:

- **A (escopo global):** `{ servers { trusted_proxies static 0.0.0.0/0 ::/0 } }` no bloco global. Vale para **todos os
  sites desse listener, inclusive o Tobe**: o Tobe passaria a confiar em XFF arbitrário. Só com o aval de quem mantém
  o Tobe.
- **B (só neste site):** `reverse_proxy 127.0.0.1:3100 { header_up X-Forwarded-For "{http.request.header.X-Forwarded-For}, {http.request.remote.host}" }`.
  **Não testado aqui.** Validar com o item "IP real" da checklist (seção 10) antes de abrir para a portaria. Pedido
  sem XFF (acesso direto) sai com o primeiro item vazio, e a API o vê como IP vazio, um balde compartilhado só por
  quem burla a Vercel.

ACME de staging para o primeiro teste: `{ acme_ca https://acme-staging-v02.api.letsencrypt.org/directory }`.

### 5.3 Traefik

Configuração dinâmica (file provider), ao lado do router do Tobe:

```yaml
http:
  routers:
    tcc-portaria:
      rule: "Host(`179-197-78-78.sslip.io`) && PathPrefix(`/api/`)"
      entryPoints: [websecure]          # o entrypoint HTTPS que já existe
      service: tcc-portaria
      middlewares: [tcc-portaria-corpo]
      tls:
        certResolver: letsencrypt       # o resolver que já existe (teste antes com caServer de staging)
  middlewares:
    tcc-portaria-corpo:
      buffering:
        maxRequestBodyBytes: 6291456
  services:
    tcc-portaria:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:3100"   # Traefik no host. Em container: seção 5.4
```

Traefik também **remove** o XFF recebido, a menos que o entrypoint confie no remetente
(`entryPoints.websecure.forwardedHeaders.trustedIPs` ou `insecure: true`). É configuração **do entrypoint**, ou seja,
afeta o Tobe, como a opção A do Caddy. A fase 2 decide com quem mantém o Tobe.

### 5.4 Proxy em container (caso provável, se o Tobe já usa Traefik/Caddy em Docker)

Dentro de um container, `127.0.0.1` é o próprio container: `127.0.0.1:3100` do host **não é alcançável**. Em vez de
publicar a API em `0.0.0.0` (nunca), ligue a API à rede externa do proxy com um override, declarado no `COMPOSE_FILE`
do `.env` (um override que não entra em toda linha do `up` é desfeito no próximo `up` sem ele):

```yaml
# docker-compose.prod.proxy.yml (criar na fase 2 com o nome real da rede)
services:
  api:
    networks: [banco, borda, proxy]
networks:
  proxy:
    external: true
    name: NOME_DA_REDE_DO_PROXY     # docker network ls
```

```bash
# .env
COMPOSE_FILE=docker-compose.prod.yml:docker-compose.prod.proxy.yml
```

O upstream vira `http://tcc-portaria-api-1:3000` (ou o alias do serviço). A publicação em `127.0.0.1:3100` pode ficar,
para o `curl` de diagnóstico. `TRUST_PROXY` continua 2.

---

## 6. Vercel (front)

O `apps/web/vercel.json` tem o rewrite `/api/:caminho*` → `https://179-197-78-78.sslip.io/api/:caminho*`, **antes**
do fallback da SPA, e os headers de segurança (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy`, COOP). O front é só cliente HTTP: não existe mais modo mock nem a variável `VITE_API_MODE`.

Variáveis de **build** (Project → Settings → Environment Variables), escopo Production:

| Variável | Valor | Observação |
|---|---|---|
| `VITE_API_URL` | `/api/v1` | é o padrão; explícita para não depender dele |
| ~~`VITE_API_MODE`~~ | — | **remover** do painel: o código não a lê mais (sobra inofensiva, mas engana quem lê) |

**Sem deploy de Preview.** Como o front só fala HTTP, um preview usaria o mesmo rewrite `/api` e leria e **escreveria no banco de
produção** (trilhas append-only: nada se desfaz). Por isso o `vercel.json` traz
`"git": { "deploymentEnabled": { "main": true, "**": false } }`: as chaves são globs (minimatch) de branch; `**` casa
qualquer branch (inclusive com `/`, como `feature/x`), e quando um branch casa mais de uma regra basta UMA ser `true`
para publicar, então `main` continua publicando e todo o resto não gera deploy. Limites, a conferir no painel
(Project → Settings → Git / Deployments):

- a Vercel lê o `vercel.json` **do commit** que vai publicar: um branch criado a partir de um commit anterior a esta
  regra ainda gera preview. Apague/rebaseie esses branches ou desligue também pelo painel;
- deploy manual (`vercel` na CLI, "Redeploy" de um preview antigo) não passa por essa regra;
- se o projeto tiver Deployment Protection ou previews de PR de fork, conferir que não há preview ativo apontando
  para a produção (Deployments → filtrar por Preview).

**Rollback do front:** **Instant Rollback** para um deploy anterior de produção. Ele **não** "volta para o mock" (o
mock não existe mais): o deploy anterior também fala com a API da VPS. Se o problema for da API, o rollback é o da
API (§11), não o do front. Um deploy de produção antigo, de antes desta mudança, ainda pode estar em `mock` se a
variável `VITE_API_MODE` não estava definida naquele build: não promova deploys anteriores à fase 3.

Para desenvolver o front sem tocar em produção: `npm run dev:pglite -w apps/api` e
`API_PROXY_ALVO=http://127.0.0.1:3101 npm run dev -w apps/web` (ver `apps/web/README.md`).

---

## 7. Âncora do selo (GitHub Actions)

O porquê e o que ela prova, e o que não prova: spec §4.6. Passos no GitHub, uma vez:

1. **Branch órfão `ancoras`**, criado num clone temporário (não no clone de trabalho):

   ```bash
   git clone https://github.com/ragrunge/TCC_GESTAO_ACESSO.git /tmp/ancoras && cd /tmp/ancoras
   git switch --orphan ancoras
   printf '%s\n' '# Âncoras do selo diário' '' 'Arquivo append-only gravado pelo workflow ancora-selo.yml. Não editar à mão.' > README.md
   : > selos.jsonl
   git add README.md selos.jsonl && git commit -m "âncoras: início" && git push origin ancoras
   cd / && rm -rf /tmp/ancoras
   ```

2. **Proteção do branch** (Settings → Rules → Rulesets → New branch ruleset):
   - Target: `ancoras` · Enforcement: **Active** · Bypass list: **vazia** (nem admin);
   - marcar **Restrict deletions** e **Block force pushes**;
   - **não** marcar "Require a pull request", "Restrict updates" nem "Require signed commits": o workflow faz push
     direto com o `GITHUB_TOKEN`, em commit sem assinatura.

3. **Variável** (Settings → Secrets and variables → Actions → **Variables**, não Secrets):
   `ANCORA_URL = https://179-197-78-78.sslip.io/api/v1/auditoria/selos/publico`
   (ou `gh variable set ANCORA_URL --body '<url>' --repo ragrunge/TCC_GESTAO_ACESSO`).

4. **Workflow:** `.github/workflows/ancora-selo.yml` precisa estar no `main` (o agendamento só roda a partir do branch
   padrão). O job só roda quando a variável `ANCORA_URL` existe (`if: vars.ANCORA_URL != ''`): até a fase 3 o
   agendamento é pulado sem falhar e sem abrir issue. Na fase 3, crie a variável e faça uma
   execução manual (Actions → "Âncora do selo diário" → Run workflow). Resultado esperado: commit
   `âncora: selos de ...` no branch `ancoras`.

5. **Terceiros:** peça ao orientador ou a um membro do conselho que mantenha um clone do repositório e o atualize de
   tempos em tempos (`git fetch`). É isso que fecha o limite "o dono do repositório pode desligar a proteção".

Operação:

- Falha por API fora do ar: o job falha sem gravar nada (e o GitHub manda e-mail ao dono). A coleta seguinte recupera
  até 31 dias.
- Divergência: o job falha e abre ou comenta a issue **"Âncora do selo: divergência (possível adulteração da trilha)"**.
  Não apague a issue nem o branch. Siga o roteiro do corpo da issue.
- O GitHub desativa workflow agendado de repositório público depois de 60 dias sem atividade. O aviso chega por e-mail
  e é preciso reativar.
- Conferência offline, em qualquer máquina com Node (de preferência não a VPS):

  ```bash
  git clone https://github.com/ragrunge/TCC_GESTAO_ACESSO.git && cd TCC_GESTAO_ACESSO
  npm ci && npm run build -w apps/api
  git show origin/ancoras:selos.jsonl > /tmp/selos.jsonl
  # trilha-....jsonl: Histórico -> "Exportar trilha", sem filtro
  node apps/api/dist/cli/verificar-ancoras.js trilha-portaria-parque-AAAAMMDD-HHMM.jsonl /tmp/selos.jsonl
  # 0 confere | 1 sem âncora no intervalo exportado | 2 divergente ou trilha inconsistente
  ```

---

## 8. Backup (RNF-10)

`db/backup/backup-portaria.sh`: `pg_dump -Fc` + volumes `documentos` e `ancoras`, cifrados com a chave **pública** age,
num conjunto atômico (`portaria-<carimbo>.dump.age`, `arquivos-<carimbo>.tar.age`, `<carimbo>.sha256`), com rotação de
30 diários e 12 mensais em `/var/backups/tcc-portaria` (fora dos volumes do Docker). Testado localmente: três execuções
seguidas com rotação, recusa de arquivo com chave privada e restore completo (seção 9).

1. **Par de chaves age, gerado FORA da VPS** (na máquina do responsável): `age-keygen -o portaria-backup.key`. A chave
   privada vai para o cofre (e uma cópia offline). Só a linha pública (`age1...`) vai para a VPS:

   ```bash
   sudo apt install age
   sudo install -d -m 755 /etc/tcc-portaria
   echo 'age1...' | sudo tee /etc/tcc-portaria/backup-age.pub >/dev/null    # a linha PÚBLICA
   sudo install -d -m 700 /var/backups/tcc-portaria
   ```

   O script recusa rodar se o arquivo tiver `AGE-SECRET-KEY`. Quem toma a VPS lê o banco vivo, mas não os backups
   antigos, que podem trazer dado já eliminado pela retenção.

2. **Agendar** (escolha um):
   - systemd: `sudo install -m 644 db/backup/tcc-portaria-backup.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now tcc-portaria-backup.timer`
   - cron: a linha de `db/backup/crontab.exemplo`.

   Primeiro teste manual: `sudo systemctl start tcc-portaria-backup.service && journalctl -u tcc-portaria-backup -n 20`.

3. **Cópia externa** (o backup só vale fora da VPS). Puxe da máquina do responsável, ou de outro servidor, para que a VPS
   não guarde credencial do destino:

   ```bash
   rsync -a --ignore-existing usuario@179.197.78.78:/var/backups/tcc-portaria/ ~/backups/tcc-portaria/
   cd ~/backups/tcc-portaria/diario && sha256sum -c ./*.sha256
   ```

   `--ignore-existing` e nenhum `--delete`: a cópia externa não apaga nada quando a VPS rotaciona (ou é adulterada).
   Para object storage, use bucket com retenção imutável (object lock).

   **Em uso (desde 2026-10-19):** chave dedicada só de leitura, presa no `authorized_keys` do root a
   `restrict,command="tar -C /var/backups/tcc-portaria -cf - diario mensal"` (o `rrsync` do Ubuntu recusa o `openrsync`
   do macOS). Na máquina do responsável, um agente do `launchd` roda às 09:00 e no login:
   `ssh -i <chave> root@179.197.78.78 backup | tar -xkf - -C ~/backups/tcc-portaria` (`-k`: nunca sobrescreve),
   confere todos os `.sha256` e avisa por notificação se a VPS não responder, se um hash divergir ou se o último dump
   tiver mais de 2 dias.

4. **Teste de restauração mensal** (spec §11): restaurar o último conjunto numa máquina isolada (seção 9), rodar a
   verificação de integridade e o `verificar-ancoras`, e registrar o resultado.

---

## 9. Restore completo (na ordem)

`pg_dump` é por banco: roles, senhas e as chaves da aplicação **não** estão nele. Ordem testada em 2026-10-19 com o
compose de produção (contagens, cabeça da cadeia, arquivos, login, integridade e privilégios do `app_rw` iguais aos da
origem):

1. **Decifrar** (na máquina com a chave privada) e conferir:
   `sha256sum -c <carimbo>.sha256 && age -d -i portaria-backup.key -o portaria.dump portaria-<carimbo>.dump.age && age -d -i portaria-backup.key -o arquivos.tar arquivos-<carimbo>.tar.age`.
   Copie os dois arquivos decifrados para o servidor novo por `scp` e apague-os ao fim.
2. **Roles e bootstrap:** clone + `.env` novo (seção 2, senhas de banco novas), com **as mesmas** `PORTARIA_KEK`,
   `PORTARIA_KEK_VERSAO` e `PORTARIA_HMAC_CPF_KEY` do cofre (passos 4 e 5 abaixo), e só o banco:
   `docker compose build && docker compose up -d --wait db` (o bootstrap cria `app_migrator`, `app_rw` e o banco vazio).
3. **Dump** (antes de qualquer `migrate`):
   `docker compose exec -T db pg_restore -U postgres -d portaria --exit-on-error --single-transaction < portaria.dump`
4. **KEK** (`PORTARIA_KEK` + `PORTARIA_KEK_VERSAO`): do cofre para o `.env`. Sem ela, os anexos restaurados são lixo.
5. **Chave HMAC** (`PORTARIA_HMAC_CPF_KEY`): do cofre para o `.env`. Sem ela, a busca por CPF não acha ninguém.
6. **Volume de documentos** (e `ancoras`):
   `docker compose run --rm --no-deps -T --entrypoint tar api -C /var/lib/portaria -xf - < arquivos.tar`
7. **Subir tudo:** `docker compose up -d --wait` (o `permissoes` acerta o dono, e o `migrate` não tem o que fazer porque a
   tabela de migrações veio no dump).
8. **Depois do restore:** `docker compose exec api node dist/cli/jobs.js retencao` (o dump traz de volta o que já tinha
   vencido) e reaplicar as anonimizações **a pedido** posteriores ao dump (`db/README.md` §Backup). Conferir a
   integridade (Histórico → "Verificar integridade") e o `verificar-ancoras` contra o branch `ancoras`.

---

## 10. Checklist de verificação (fase 3, antes de abrir para a portaria)

```bash
cd /opt/tcc-portaria
docker compose ps -a                                  # api/db healthy; permissoes/migrate Exited (0)
sudo ss -ltnp | grep -E ':3100|:5432'                 # 3100 SÓ em 127.0.0.1; nenhum 5432 deste projeto
docker stats --no-stream | grep tcc-portaria          # api < 384M, db < 512M
curl -s http://127.0.0.1:3100/api/v1/saude            # direto
curl -sv https://179-197-78-78.sslip.io/api/v1/saude 2>&1 | grep -E 'subject|issuer|expire|"status"'   # TLS real, sem -k
curl -s https://tccgestaoacesso.vercel.app/api/v1/saude                    # pelo rewrite
curl -s https://tccgestaoacesso.vercel.app/api/v1/auditoria/selos/publico  # {"data":{"formato":"portaria-parque/selos-diarios",...}}
curl -sI https://tccgestaoacesso.vercel.app/ | grep -iE 'content-security|x-frame'
```

- [ ] **Saúde:** os três `saude` respondem `ok`, e o `/saude` não traz `ultimoSeq`.
- [ ] **TLS:** certificado de produção (não o de staging), emitido para `179-197-78-78.sslip.io`, com renovação
      automática configurada.
- [ ] **Login** pelo site da Vercel em modo `http`, com troca de senha do usuário de seed.
- [ ] **Cookie:** DevTools → Application → Cookies: `__Host-portaria_sessao` com **Secure**, **HttpOnly**,
      `SameSite=Strict`, `Path=/`, sem `Domain`.
- [ ] **IP real, não o do proxy** (sem provocar 429: nunca testar o bloqueio contra a produção, porque com
      `TRUST_PROXY` errado ele bloqueia todo mundo). Entre pelo site da Vercel e compare o IP gravado na sessão com o
      seu IP público (`curl -s https://api.ipify.org` na sua máquina):

      ```bash
      docker compose exec -T db psql -U postgres -d portaria -Atc "select ip, criada_em from sessao order by criada_em desc limit 3"
      ```

      Tem que ser o **seu** IP. `172.x`/`127.0.0.1` indica proxy que não repassa o XFF; um IP da Vercel (AWS) indica
      proxy que **substitui** o XFF (Caddy/Traefik sem ajuste) ou `TRUST_PROXY` baixo. Repita por um segundo
      provedor (4G do celular) para ver dois IPs diferentes.
- [ ] **Âncora:** execução manual do workflow verde e uma linha nova em `selos.jsonl` do branch `ancoras` (no dia
      seguinte ao primeiro selo diário).
- [ ] **Backup:** um conjunto em `/var/backups/tcc-portaria/diario`, a cópia externa puxada e um restore de teste feito.
- [ ] **Tobe intacto:** o health do Tobe (3333) responde como antes e o certificado dele não mudou.

---

## 11. Atualização e rollback

**Atualizar** (nova versão do `main`):

```bash
cd /opt/tcc-portaria
git fetch && git checkout --detach origin/main
sed -i "s|^API_TAG=.*|API_TAG=$(git rev-parse --short HEAD)|" .env      # a tag mora no .env: `up` sem variável usa a mesma
docker compose build && docker compose up -d --wait
```

A tag anterior continua em `docker images tcc-portaria-api`. Só o `api`, o `migrate` e o `permissoes` dependem de
`API_TAG`, e o `db` não é recriado.

**Deploy automático** (`.github/workflows/deploy-api.yml`): push na `main` que mexa em `apps/api`, `packages/domain`
ou no `package-lock.json` roda typecheck e testes e, se passarem, entra por SSH na VPS com a chave do CI. No
`authorized_keys` do root essa chave é `restrict,command="/usr/local/sbin/tcc-portaria-deploy"`: ela só executa o
`scripts/deploy/deploy-vps.sh` (instalado fora do clone, por cópia manual), que faz o passo acima sozinho:

1. recusa (código 2, job vermelho) se a `main` foi reescrita ou se o intervalo muda infra: compose, Dockerfile,
   `db/bootstrap`, `db/backup`, `scripts/deploy` ou `.env.producao.example`. Esses vão à mão, como acima;
2. backup: o cifrado (`backup-portaria.sh`) se houver chave age, senão um `pg_dump` local em
   `/var/backups/tcc-portaria/pre-deploy` (root, 600, os 3 últimos);
3. build com a tag nova; falhou, nada muda no que está rodando;
4. troca `API_TAG`, `up -d --wait` (o `migrate` roda antes da API) e confere `/saude`;
5. falhou: volta commit e tag anteriores. Migração aplicada **não** volta: o log aponta o backup do passo 2.

Configuração (uma vez, pelo dono do repositório): variáveis `DEPLOY_HOST` e `DEPLOY_KNOWN_HOSTS`; environment
`producao` com regra de branch `main` e o secret `DEPLOY_SSH_KEY`. Sem `DEPLOY_HOST` o job de deploy é pulado.
Trocar a chave: gerar outra, substituir a linha `tcc-portaria-ci` do `authorized_keys` e o secret.

**Limite do que a chave restrita protege:** ela impede que uma chave vazada vire shell, mas quem faz push na `main`
continua decidindo o código que sobe. A trava de infra evita que um push troque o compose (volume do host, privilégio)
sem passar por uma pessoa na VPS.

**Rollback da API** (sem migração nova no meio):

```bash
git checkout --detach <commit anterior>
sed -i "s|^API_TAG=.*|API_TAG=<tag anterior>|" .env
docker compose up -d --wait
```

**Migração no meio:** as migrações só andam para a frente. Voltar o código depois de aplicar uma migração exige o restore
do backup anterior a ela (seção 9). Antes de atualizar com migração nova, rode o backup à mão
(`sudo systemctl start tcc-portaria-backup.service`).

**Rollback do front:** Instant Rollback na Vercel (seção 6).

**Retirar tudo** (sem afetar o Tobe): `docker compose down` (mantém volumes) e remover o bloco do proxy e o `reload`.
`docker compose down -v` **apaga o banco**: só com backup conferido.
