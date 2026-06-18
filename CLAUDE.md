# CLAUDE.md — Acadmate Bot

Orientation for AI sessions. Read this first; it captures what isn't obvious from the code. Deep runbook: [docs/operations.md](docs/operations.md). Reference docs: [docs/](docs/).

## What this is

Production Telegram **moderation + tagging bot** with an **admin dashboard API/UI** and a **multi-provider AI layer**. Stack: Node 20 · TypeScript (strict) · Telegraf · PostgreSQL · Prisma · Express · Docker. Deployed via Docker Compose on a HackClub Proxmox container.

## Hard rules (read before committing)

- **NO AI attribution in git.** Never add `Co-Authored-By: Claude…` to commits or `🤖 Generated with Claude Code` to PR bodies. The user asked firmly. (Also in auto-memory.)
- **Workflow = branch + PR.** `main` is what the server deploys. Never commit features to `main` directly. Branch (`feat/…`, `fix/…`, `docs/…`) → push → `gh pr create --base main`. CodeRabbit + Codex auto-review; address real findings, then reply to each thread via `gh api .../pulls/<n>/comments/<id>/replies`.
- **Verify before every commit:** `npm run typecheck && npx eslint . --ext .ts && npx vitest run`. Don't commit red.
- **Secrets:** only `.env` (gitignored); `.env.example` is the template. Never read `process.env` directly — use `@/config` (validated Zod schema, fails fast).

## Architecture (clean / layered, hand-wired DI)

- **`src/container.ts`** is the composition root — the ONLY place that `new`s services. Everything else gets collaborators via constructor injection. Read it to see the whole object graph.
- **Two entrypoints, one service layer:** `src/bot/index.ts` (Telegraf consumer + cron scheduler) and `src/api/server.ts` (Express dashboard). The API builds a `Container` around a *non-launched* Telegraf so dashboard bans/unbans still hit Telegram.
- **Detectors** (`src/moderation/detectors/`) each implement the `Detector` interface and are registered in the engine list in `container.ts`. Add a detector = one class + one line. They decide "flagged?"; enforcement lives in services.
- **AI** (`src/ai/`): `AiRouter` tries providers in `AI_PROVIDER_ORDER`, fails over on HTTP 429 with per-provider cooldown. `OpenAiCompatibleProvider` is generic (Groq/OpenRouter/Cerebras/…); `GeminiProvider` is bespoke. `AiAssistantService` wraps it (`classifyMessage`/`ask`/`summarize`/`reviewAppeal`). All AI degrades gracefully: no keys → AI disabled, heuristics still run.

## Layout

```
src/
  ai/            AiRouter, providers/, ai.types, ai.errors, ai-router.factory
  bot/           index (entry), setup (middleware pipeline order!), message-handler, helpers
  commands/      general, moderation, tagging, admin, ai (/ask /summarize /appeal /aistatus)
  moderation/    detector.interface, moderation.engine, detectors/*
  services/      telegram.gateway, user, admin-cache, warning, mute, ban, moderation,
                 moderation-log, tagging, scheduler, ai-assistant, message-buffer, error-reporter, auth
  middleware/    entity-resolution, rate-limit, message-capture
  api/           server, routes/ (auth, logs, users, chats), middleware/ (auth, error)
  config/, database/, types/, utils/
public/dashboard.html   single-file admin SPA served at GET /
prisma/        schema.prisma, migrations/, seed.ts
```

Bot middleware order (in `bot/setup.ts`) matters: rateLimit → entityResolution → captureMessages → commands → catch-all moderationHandler. Commands MUST precede moderation.

## Commands

```
npm run dev:bot / dev:api      tsx watch (resolves @/ aliases)
npm run build                  tsc + tsc-alias (REQUIRED: tsc alone leaves @/ in dist → runtime crash)
npm run typecheck | lint | test
npm run prisma:migrate:dev     create+apply dev migration
npm run db:seed                seed dashboard super-admin
```

## Gotchas that have bitten us (don't relearn the hard way)

- **Admins bypass ALL automated moderation.** Test AI/heuristic moderation from a NON-admin account, or it looks broken.
- **AI moderation skips short messages** (`AI_MODERATION_MIN_LENGTH=24`, no link/mentions) to save quota. Short slurs → use `/addword`, not AI.
- **Admin recognition is live** via `AdminCacheService` (Telegram `getChatAdministrators`, 60s cache) — a freshly-promoted admin is recognized within ~60s, no `/admins` needed.
- **`/summarize` reads an in-memory buffer** (`MessageBufferService`) — only non-command messages **since the bot last started**; wiped on restart. "Nothing to summarise" is often correct, not a bug. `/summarise` is an alias.
- **`bot.launch()` in polling never resolves** — it's fire-and-forget in `bot/index.ts`; scheduler + shutdown are wired BEFORE it.
- **Telegram IDs are `BigInt`** end-to-end; the API serializes them to strings (`api/http.ts serialize()`).
- **`BOT_TOKEN` must be unquoted in `.env`** — docker-compose `env_file` keeps quotes literally → `401 Unauthorized`.
- **Privacy mode** must be OFF in BotFather for the bot to see all messages (admin status also grants this).

## Deploy & dashboard access — see [docs/operations.md](docs/operations.md)

TL;DR: SSH `jesutobi@hackclub.app` → `cd ~/acadmate_bot && git pull origin main` → run migration **only if schema changed** → `docker compose up -d --build bot api`. The dashboard is reached via an **outbound Cloudflare tunnel** (SSH `-L` forwarding is blocked at HackClub's gateway; the private `10.60.x` IP isn't routable). Full steps, troubleshooting, and env reference are in the operations runbook.
