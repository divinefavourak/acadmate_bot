# Security Considerations

This document covers the threat model, the controls implemented, the rate
limiting strategy, and Telegram API limitations that shape the design.

---

## 1. Threat model

| Asset | Threat | Control |
|-------|--------|---------|
| Bot token | Leak → full bot takeover | Env-only, redacted in logs, never echoed by API. |
| JWT secret | Leak → forge admin tokens | ≥32-char secret enforced at boot; env-only. |
| Dashboard accounts | Credential stuffing / brute force | bcrypt (cost 12), strict `/auth` rate limit, generic login errors. |
| Refresh tokens | DB leak → token replay | Stored as SHA-256 hashes; rotation + family revocation on reuse. |
| Group | Spam/scam/flood abuse | Moderation pipeline (this is the product). |
| Bot command surface | Command flooding | Per-user token-bucket middleware. |
| API | Injection / DoS | Zod validation, Prisma (parameterised), body-size + rate limits, helmet. |
| Privilege | Admin abuse via bot | Bot refuses to moderate admins/owners or itself. |

---

## 2. Authentication & authorization (dashboard)

- **Passwords**: bcrypt with configurable cost (`BCRYPT_ROUNDS`, default 12).
  Login compares against a dummy hash when the user doesn't exist to blunt
  user-enumeration timing.
- **Access tokens**: stateless JWT, 15-minute TTL, `type: "access"` claim
  checked on every request.
- **Refresh tokens**: JWT with a `jti`, 7-day TTL, **stored hashed** in
  `RefreshToken`. On refresh we rotate (revoke old, issue new). Presenting a
  revoked/expired refresh token revokes the **entire token family** for that
  user — a theft-detection signal.
- **RBAC**: `SUPER_ADMIN` ⊃ `ADMIN` ⊃ `VIEWER`. Mutating endpoints require
  `ADMIN`; `SUPER_ADMIN` satisfies any role check.

> Recommended hardening for production: deliver refresh tokens as
> `HttpOnly; Secure; SameSite=Strict` cookies instead of JSON to remove them
> from JS reach (mitigates XSS token theft). The service layer already supports
> this — only the transport changes.

---

## 3. Input handling

- **Environment** validated with Zod at boot; the process refuses to start on
  bad/missing config (fail fast, no half-configured runtime).
- **API request bodies/queries** validated with Zod per route; failures map to
  `400 VALIDATION_ERROR` with field details.
- **Database** access is exclusively via Prisma → parameterised queries, no
  string-built SQL.
- **Admin-supplied regex** (banned words) is compiled defensively; a malformed
  pattern falls back to a literal match instead of throwing. Patterns run only
  against single messages with bounded length.

---

## 4. Output & transport

- `helmet` sets secure headers; `x-powered-by` disabled.
- JSON body limit 100kb; `trust proxy` set for correct client IPs behind a LB.
- CORS is an explicit allow-list (`CORS_ORIGINS`), not `*`.
- Production error responses never include stack traces or raw DB messages.
- `BigInt` fields are serialised to strings to avoid leaking via thrown
  serializer errors and to keep IDs precise in JSON.

---

## 5. Secrets management

- All secrets via environment (`.env` for local, secret manager in prod).
- `.env` is git-ignored; only `.env.example` is committed.
- Logger redacts `BOT_TOKEN`, `JWT_SECRET`, `password`, `passwordHash`, `token`.
- Container runs as the non-root `node` user; image is multi-stage and minimal.

---

## 6. Telegram-specific abuse handling

- Webhook authenticity: `WEBHOOK_SECRET` is validated against
  `X-Telegram-Bot-Api-Secret-Token`; the webhook path is long and random.
- The bot never trusts `from` for authority — admin status is resolved from
  Telegram (`getChatAdministrators`) and cached in `ChatMember`.
- Self-protection: it cannot ban/mute itself or other admins via commands.

---

## 7. Rate limiting strategy

Three independent layers, each protecting a different asset:

| Layer | Where | Limit (default) | Protects |
|-------|-------|-----------------|----------|
| Bot command bucket | `middleware/rate-limit.middleware.ts` | 8 tokens, refill 0.5/s, per user+chat | The bot from command-spam work |
| Moderation flood detector | `moderation/detectors/flood.detector.ts` | `floodMaxMessages`/`floodWindowSeconds` per chat | The **group** from flooding |
| API global limiter | `api/server.ts` | 120 req/min/IP | The API from scraping/DoS |
| API auth limiter | `api/server.ts` | 20 req/15min/IP on `/auth` | Login brute force |

**Outbound** rate limiting toward Telegram is handled by Telegraf's queue plus
our deliberate ~1.1s spacing between tag-broadcast chunks, keeping us under
Telegram's ~1 msg/sec per-chat and ~30 msg/sec global ceilings.

**Scaling note:** the bot bucket and flood window are process-local /
DB-backed respectively. For multi-replica bots, move the command bucket to Redis
(token-bucket) and optionally front the flood window with a Redis sliding
window; the middleware/detector interfaces don't change.

---

## 8. Auditability

- `moderation_logs` is **append-only** — no code path updates or deletes rows.
  Every automated and manual action (delete, warn, mute, kick, ban, unban) is
  recorded with actor (null = automated), target, reason, and JSON metadata.
- Dashboard ban/unban records the operator's email in the log details.

---

## 9. Known limitations / residual risk

- Heuristic detection has false positives/negatives by nature; `deleteOnDetect`
  + warnings (not instant bans) keep first-offence mistakes recoverable.
- In-memory command rate limiting resets on restart and is per-replica.
- Scheduled tags require a single bot replica (or a distributed lock) to avoid
  duplicate fires.
