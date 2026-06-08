# Telegram Bot API Limitations

Constraints imposed by the Telegram Bot API that directly shape this bot's
design. Knowing these explains *why* the code does several non-obvious things.

---

## 1. Message visibility (privacy mode)

By default, bots in groups only receive: commands addressed to them, replies to
their messages, and service messages. **Moderation needs every message**, so the
bot **requires privacy mode disabled** (`/setprivacy` → Disable in @BotFather).
If left enabled, detectors simply never see most messages.

## 2. Admin rights are required and granular

The bot must be a group admin with the specific rights it uses:

- *Delete messages* → `deleteMessage`
- *Ban users* → `banChatMember` / `unbanChatMember` (ban, kick, unban)
- *Restrict members* → `restrictChatMember` (mute/unmute)

Missing a right makes the corresponding API call fail. The `TelegramGateway`
swallows these failures (logs + returns `false`) so one missing permission
degrades gracefully rather than crashing flows.

## 3. Rate limits (outbound)

Telegram does not publish hard numbers, but the practical, widely-observed
ceilings are:

- **~1 message/second to the same chat** (sustained). Short bursts tolerated.
- **~30 messages/second globally** across all chats.
- **~20 messages/minute** to the same group for bulk/identical content.

Consequences in this bot:

- `/tagall` and scheduled tags **chunk** mentions and space sends ~1.1s apart.
- Mention batches are kept small (≤5) so a single broadcast is few messages.
- Hitting a limit returns **HTTP 429 with `retry_after`**; Telegraf's built-in
  queue backs off. Don't bypass it with parallel sends.

## 4. Mentions & notifications

- Only a handful of mentions per message actually trigger notifications; cramming
  100 `@user`s into one message does **not** ping 100 people.
- `@username` only works for users who have a public username. For users without
  one, we use inline mentions `[name](tg://user?id=…)`, which still notify and
  render as a tappable name.
- A user who has never interacted may not be pingable by username at all; inline
  id mentions are the reliable fallback.

## 5. Message size & formatting

- **4096 characters** max per text message → another reason tagging is chunked.
- Markdown/HTML parse modes are strict; unescaped `_ * [ ]` can break a message.
  Notices avoid user-controlled markdown; mentions sanitise names.

## 6. Restriction (mute) semantics

- A mute is a `restrictChatMember` call with all send-permissions `false` and an
  `until_date`. Telegram auto-lifts at `until_date`, **but** if `until_date` is
  < 30s or > 366 days, Telegram treats it as **forever**. We keep windows within
  sane bounds and also track the window in our DB so the scheduler can lift it
  deterministically.
- `until_date` is a **Unix timestamp in seconds**, not ms (see `toUnixSeconds`).

## 7. Kick vs. ban

- There is no "kick" primitive. **Kick = `banChatMember` then
  `unbanChatMember`**, which removes the user but lets them rejoin. A plain ban
  omits the unban. `unbanChatMember` is called with `only_if_banned: true`.

## 8. Getting members

- The Bot API **cannot list all members** of a group (only
  `getChatAdministrators` and `getChatMemberCount`). Therefore the bot builds
  its own membership view incrementally from observed messages and join events.
  `/tagall` mentions **known** members, which is the best a bot can do — this is
  a platform limitation, not a bug.

## 9. Webhooks

- Must be **HTTPS** on port 443/80/88/8443 with a valid certificate.
- Telegram retries failed deliveries with backoff; handlers should be idempotent
  where possible.
- Use the secret token header to verify requests genuinely come from Telegram.

## 10. Updates & ordering

- Updates are delivered roughly in order but not guaranteed; design does not
  assume strict ordering. `dropPendingUpdates` is used in polling to skip
  backlogs after downtime.

## 11. BigInt identifiers

- User/chat IDs can exceed 2³¹; channel IDs are large negatives. All IDs are
  modelled as `BigInt`/`BIGINT` end-to-end and serialised to strings in JSON.
