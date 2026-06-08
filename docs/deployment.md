# Deployment Guide

This guide covers local development, Docker Compose (single host), and notes for
orchestrated production (Kubernetes / managed Postgres).

---

## 1. Prerequisites

- Node.js ≥ 20 and npm (for local dev)
- Docker + Docker Compose (for containerised runs)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A PostgreSQL 14+ database

### Telegram bot prerequisites

1. Create the bot via @BotFather → copy the token into `BOT_TOKEN`.
2. With @BotFather, run `/setprivacy` → **Disable** so the bot can read group
   messages (required for moderation). Without this, Telegram only delivers
   commands and replies to the bot, and detection will not work.
3. Add the bot to your group and **promote it to admin** with at least:
   *Delete messages*, *Ban users*, *Restrict members*.

---

## 2. Local development

```bash
cp .env.example .env          # then edit BOT_TOKEN, DATABASE_URL, JWT_SECRET
npm install
npm run prisma:generate
npm run prisma:migrate:dev    # creates the schema in your dev DB
npm run db:seed               # creates the initial super-admin

# run the two processes in separate terminals
npm run dev:bot
npm run dev:api
```

`dev:*` scripts use `tsx watch` for hot reload. The bot defaults to polling mode
(`BOT_MODE=polling`), which needs no public URL.

---

## 3. Docker Compose (single host)

The provided `docker-compose.yml` brings up Postgres, runs migrations as a
one-shot job, then starts the `bot` and `api` services.

```bash
cp .env.example .env          # fill in real values
docker compose build
docker compose up -d

# first-time only: seed the super-admin (uses SEED_ADMIN_EMAIL/PASSWORD from .env)
docker compose run --rm migrate npx tsx prisma/seed.ts
```

> The `migrate` service runs `prisma migrate deploy` and exits; `bot` and `api`
> wait for it via `depends_on: condition: service_completed_successfully`.

Check health:

```bash
curl http://localhost:4000/health      # {"status":"ok",...}
docker compose logs -f bot
```

---

## 4. Production: webhook mode

Polling is fine for small/medium bots. For higher throughput and lower latency,
use webhooks behind HTTPS:

```env
BOT_MODE=webhook
WEBHOOK_DOMAIN=https://bot.yourdomain.com
WEBHOOK_PATH=/telegraf/<long-random-segment>
WEBHOOK_PORT=8443
WEBHOOK_SECRET=<long-random-string>
```

- Telegram requires the webhook to be HTTPS on port 443/80/88/8443.
- Terminate TLS at your reverse proxy (nginx/Caddy/Traefik) and forward to
  `WEBHOOK_PORT`. The bot validates `X-Telegram-Bot-Api-Secret-Token` against
  `WEBHOOK_SECRET`, so set it.
- Keep `WEBHOOK_PATH` secret and random — it is effectively a shared secret.

Example nginx location:

```nginx
location /telegraf/ {
    proxy_pass http://bot:8443;
    proxy_set_header X-Telegram-Bot-Api-Secret-Token $http_x_telegram_bot_api_secret_token;
}
```

---

## 5. Production: orchestrated (Kubernetes)

- Deploy `bot` and `api` as **separate Deployments** (different `command`).
- Run migrations as a **Job** or an `initContainer` (`prisma migrate deploy`) —
  never auto-migrate from app code.
- The **bot** scheduler runs cron in-process; run **exactly one** bot replica
  unless you add a distributed lock, otherwise scheduled tags fire N times.
  The **api** is stateless and scales horizontally freely.
- Use a managed Postgres (RDS/Cloud SQL) and inject `DATABASE_URL` + secrets via
  your secret manager, not env files.
- Set resource requests/limits; the bot is I/O-bound, the api is light.
- Liveness/readiness: api exposes `GET /health`. For the bot, use a process
  liveness probe (it exits non-zero on fatal errors).

---

## 6. Database migrations

```bash
# create a new migration during development
npm run prisma:migrate:dev -- --name add_x

# apply pending migrations in CI/production (no prompts)
npm run prisma:migrate         # prisma migrate deploy
```

Migrations are committed under `prisma/migrations/` and applied by the `migrate`
service / Job. Generated Prisma client lives in `node_modules` (built in the
Docker `build` stage via `prisma generate`).

---

## 7. Backups & retention

- Back up Postgres regularly (`pg_dump` / managed snapshots). The
  `moderation_logs` table is your audit trail — treat it as compliance data.
- `message_records` is ephemeral (pruned > 24h by the scheduler) and need not be
  backed up.

---

## 8. Upgrades / zero-downtime

1. Apply migrations (backward-compatible first).
2. Roll the `api` Deployment (stateless, safe).
3. Roll the `bot` Deployment; `dropPendingUpdates` is **off** in webhook mode so
   no updates are lost during the brief restart (Telegram retries delivery).

---

## 9. Rollback

- App: redeploy the previous image tag.
- DB: only roll back a migration if it was backward-incompatible; prefer
  forward-fix migrations to avoid data loss.
