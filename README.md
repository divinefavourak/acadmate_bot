# Acadmate Bot

Production-ready Telegram **moderation & tagging** bot with an admin dashboard
REST API.

Built with **Node.js · TypeScript · Telegraf · PostgreSQL · Prisma · Docker**,
using clean/layered architecture, constructor-based dependency injection, and
modular services.

---

## Features

**Moderation** — spam, flood, duplicate, and scam-link detection; banned-word
filtering; a warning/strike system with configurable escalation to temporary
mute, kick, or ban. Admins are exempt; every action is logged to an append-only
audit trail.

**Tagging** — `/tagall`, `/admins`, `/tag <role>`, custom roles, and cron-based
**scheduled tags**.

**Admin dashboard API** — JWT-authenticated REST endpoints for moderation logs,
user management, and per-chat settings, with RBAC and rotating refresh tokens.

---

## Project structure

```
src/
├── bot/            # Telegraf wiring, entrypoint, message handler, helpers
├── commands/       # Command composers (general/moderation/tagging/admin)
├── moderation/     # Detector interface, detectors, detection engine
├── services/       # Domain + orchestration services, Telegram gateway
├── database/       # Prisma client singleton
├── middleware/     # Bot middleware (rate-limit, entity resolution)
├── api/            # Express dashboard API (routes, middleware, server)
├── config/         # Validated env config
├── utils/          # logger, hashing, time, errors
├── types/          # Shared types
└── container.ts    # Composition root (DI)
prisma/             # schema.prisma, seed
docs/               # architecture, specs, deployment, security, telegram limits
```

---

## Quick start (local)

```bash
cp .env.example .env          # set BOT_TOKEN, DATABASE_URL, JWT_SECRET
npm install
npm run prisma:generate
npm run prisma:migrate:dev
npm run db:seed               # creates initial super-admin

npm run dev:bot               # terminal 1
npm run dev:api               # terminal 2
```

> In @BotFather, **disable privacy mode** and add the bot as a group admin with
> *delete / ban / restrict* rights. See `docs/deployment.md`.

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up -d
docker compose run --rm migrate npx tsx prisma/seed.ts
curl http://localhost:4000/health
```

---

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/architecture.md](docs/architecture.md) | Layering, DI, moderation pipeline, topology |
| [docs/specs.md](docs/specs.md) | Commands, config, detection rules, REST API spec |
| [docs/deployment.md](docs/deployment.md) | Local, Docker, webhook, Kubernetes, migrations |
| [docs/security.md](docs/security.md) | Threat model, auth, rate limiting strategy |
| [docs/telegram-limitations.md](docs/telegram-limitations.md) | Bot API constraints that shape the design |

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev:bot` / `dev:api` | Hot-reload dev servers |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start:bot` / `start:api` | Run compiled processes |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `format` | ESLint / Prettier |
| `npm run prisma:migrate:dev` | Create & apply a dev migration |
| `npm run prisma:migrate` | Apply migrations (prod) |
| `npm run db:seed` | Seed the super-admin |
| `npm test` | Vitest |

## License

MIT
