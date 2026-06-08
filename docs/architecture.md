# Architecture

Acadmate is a Telegram moderation and tagging bot built on **clean / layered
architecture** with explicit dependency injection. This document describes the
runtime topology, the layering rules, the moderation pipeline, and the key
design decisions.

---

## 1. Runtime topology

There are **two processes** built from one codebase, sharing the same service
and database layers:

```
                         ┌──────────────────────────┐
                         │        PostgreSQL         │
                         │   (single source of truth)│
                         └─────────────┬─────────────┘
                                       │ Prisma
              ┌────────────────────────┴────────────────────────┐
              │                                                  │
   ┌──────────┴───────────┐                          ┌───────────┴──────────┐
   │     Bot process      │                          │     API process      │
   │  (src/bot/index.ts)  │                          │ (src/api/server.ts)  │
   │                      │                          │                      │
   │  Telegraf  ◀── updates                          │  Express  ◀── HTTPS  │
   │  Scheduler (cron)    │                          │  JWT auth            │
   └──────────┬───────────┘                          └───────────┬──────────┘
              │                shared                             │
              └──────────────► services/ ◀───────────────────────┘
                               (business logic, telegram gateway)
```

- **Bot process** — consumes Telegram updates (polling or webhook), runs the
  moderation pipeline, handles commands, and owns the cron scheduler.
- **API process** — serves the admin dashboard REST API. It builds a `Container`
  around a *non-launched* Telegraf client so dashboard-triggered actions
  (ban/unban) still reach the Telegram Bot API.

Both can be scaled and deployed independently. Postgres is the single
coordination point, so running multiple bot replicas (e.g. sharded by chat)
does not require sticky state.

---

## 2. Layered design & dependency rule

Dependencies point **inward / downward** only. A layer may depend on the layer
below it, never above.

| Layer | Directory | Responsibility | May depend on |
|-------|-----------|----------------|---------------|
| **Transport** | `bot/`, `api/`, `commands/`, `middleware/` | Translate Telegram updates / HTTP requests into service calls | services, moderation, utils, types |
| **Orchestration** | `services/moderation.service.ts`, `scheduler.service.ts` | Coordinate multiple services to fulfil a use-case | services, utils |
| **Domain services** | `services/*` | Single-responsibility business logic + persistence | database, gateway, utils |
| **Detection** | `moderation/` | Pure-ish heuristics over a message | database (read), utils |
| **Infrastructure** | `database/`, `services/telegram.gateway.ts`, `config/`, `utils/` | Prisma client, Telegram API wrapper, logging, config | — |

The **composition root** (`src/container.ts`) is the only place that calls
`new` on a service. Everything else receives collaborators via constructor
injection, which keeps the graph explicit and every unit testable with fakes.

### Why hand-wired DI over a framework

We deliberately avoid decorator-based containers (`tsyringe`, `inversify`):

- The entire dependency graph is readable in one ~60-line file.
- No `reflect-metadata`, no decorator/emit ordering pitfalls.
- Swapping a real service for a fake in tests is a one-line constructor change.

---

## 3. The moderation pipeline

A single inbound group message flows through this sequence:

```
update
  │
  ├─ rateLimit          (drop command floods aimed at the bot)
  ├─ entityResolution   (upsert user/chat/membership, load settings + role → ctx.state)
  ├─ join/leave bookkeeping
  ├─ command composers  (general / moderation / tagging / admin)  ── handled? stop
  │
  └─ moderationHandler  (only non-command messages from non-admins)
        │
        ▼
   ModerationEngine.inspect()
        │  1. persist MessageRecord (enables flood/duplicate counting)
        │  2. run enabled detectors in order, short-circuit on first flag:
        │        BannedWords → ScamLink → Spam → Duplicate → Flood
        ▼
   DetectionResult { flagged, reason, details, severity }
        │  if flagged
        ▼
   ModerationService.enforceDetection()
        │  • delete message (if deleteOnDetect)
        │  • issue Warning, write ModerationLog
        │  • if activeWarnings ≥ warnThreshold → escalate (MUTE | KICK | BAN)
        ▼
   public notice posted in chat
```

### Detector contract

Every detector implements one interface and is registered in the engine's
ordered list. Adding a detection type = write one class + register it; the
engine is untouched.

```ts
interface Detector {
  readonly name: string;
  readonly reason: DetectionReason;
  isEnabled(settings: ChatSettings): boolean;
  detect(message: InspectedMessage, ctx: DetectorContext): Promise<DetectionResult> | DetectionResult;
}
```

Stateless detectors (banned words, scam links, spam heuristics) are pure
functions of the message. Stateful detectors (flood, duplicate) read recent
`MessageRecord` rows — Postgres is the sliding-window store, which keeps the
result correct across restarts and replicas.

### Enforcement is a single funnel

Both automated detections **and** manual `/warn` commands call
`ModerationService`, so the strike/escalation policy is defined exactly once and
cannot drift between manual and automated paths.

---

## 4. Tagging subsystem

- `/tagall`, `/admins`, `/tag <role>` build **chunked** mention messages
  (≤ 5 mentions per message) because Telegram only reliably delivers a few
  notifications per message and caps messages at 4096 chars.
- `/admins` syncs the live admin list from `getChatAdministrators` before
  tagging, keeping roles accurate.
- **Scheduled tags** are persisted (`ScheduledTag`) and rehydrated into
  `node-cron` jobs at boot, so schedules survive restarts.

---

## 5. Background work (scheduler)

`SchedulerService` owns all time-based work in the bot process:

- One cron job per active `ScheduledTag`.
- A 1-minute maintenance tick that:
  - expires mutes whose window elapsed (lifting the Telegram restriction even if
    the bot was offline when Telegram's own timer fired), and
  - hourly prunes `MessageRecord` rows older than 24h.

---

## 6. Admin dashboard API

- **Express** with `helmet`, JSON body limits, CORS allow-list, and two tiers of
  rate limiting (global + strict on `/auth`).
- **JWT**: short-lived stateless access tokens (15 min) + long-lived, **hashed,
  rotating** refresh tokens stored in `RefreshToken` for revocation.
- **RBAC**: `SUPER_ADMIN` > `ADMIN` > `VIEWER`, enforced by `requireRole`.
- Reuses the same `services/` as the bot, so a dashboard ban is the identical
  code path as an in-chat `/ban`.

---

## 7. Data model (summary)

See `prisma/schema.prisma` for the authoritative definition.

- **Telegram domain**: `TgUser`, `Chat`, `ChatSettings`, `ChatMember`.
- **Moderation**: `Warning`, `Mute`, `Ban`, `BannedWord`, `MessageRecord`,
  `ModerationLog` (append-only audit trail).
- **Tagging**: `TagRole`, `TagRoleMember`, `ScheduledTag`.
- **Dashboard auth**: `AdminUser`, `RefreshToken` — deliberately separate from
  `TgUser` so "a person we moderate" is never conflated with "a person who can
  log into the API".

Telegram IDs use `BigInt` (Postgres `BIGINT`) to avoid 32-bit overflow.

---

## 8. Error handling philosophy

- **Telegram gateway** swallows benign races (message already deleted, user
  already left) and returns booleans — one stale action never breaks a flow.
- **Detectors** are individually try/caught in the engine; a throwing detector
  is logged and skipped, never blocking message processing.
- **API** maps every error through one central handler (`AppError` hierarchy,
  `ZodError`, Prisma errors) and never leaks stack traces in production.
- **Bot** has a global `bot.catch` boundary so one bad update cannot crash the
  process.

---

## 9. Extension points

- **New detector**: implement `Detector`, register in `container.ts`.
- **New command**: add to (or create) a `Composer` in `commands/`, mount in
  `bot/setup.ts`.
- **New API resource**: add a route module in `api/routes/`, mount in
  `api/server.ts`.
- **Redis-backed rate limiting / flood counting**: swap the in-memory `Map` in
  `rate-limit.middleware.ts` and the DB count in `flood.detector.ts`; interfaces
  are unchanged.
