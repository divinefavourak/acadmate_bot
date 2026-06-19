# Operations Runbook

The real-world deploy + access setup for the live Acadmate instance. This
supplements the generic [deployment.md](deployment.md) with the specifics of the
actual server. If a command here differs from generic docs, trust this file.

## The server

- **Host:** HackClub-provided **Proxmox LXC container**, Debian, named `jesutobi`.
- **Access:** `ssh jesutobi@hackclub.app` (you land as `root@jesutobi`). You have
  **full root** + Docker — this is NOT the standard shared HackClub Nest (no
  Nix/`systemctl --user` dance needed; just Docker).
- **Project dir:** `~/acadmate_bot` (cloned from GitHub `main`).
- **Private IP `10.60.x.x`** is internal only — not reachable from your PC.

## Stack (docker compose)

Services: `postgres` (healthcheck) · `migrate` (one-shot `prisma migrate deploy`,
others `depends_on` it) · `bot` (polling) · `api` (dashboard, port 4000). All
have `restart: unless-stopped` → survive reboots.

**DATABASE_URL gotcha:** containers reach Postgres at host **`postgres`** (the
service name), not `localhost`. `docker-compose.yml` overrides `DATABASE_URL`
for the containers via the `x-database-url` YAML anchor, so the `.env` value
(which uses `localhost` for host-side Prisma CLI / `npm run dev`) is irrelevant
inside containers. Don't "fix" the localhost value in `.env`.

## Deploying an update

### Automated (CI/CD) — preferred

Merging a PR into `main` triggers `.github/workflows/deploy.yml`: it runs the
test suite, then SSHes into this server and deploys. Nothing to do by hand. You
can also trigger it from the GitHub **Actions → Deploy → Run workflow** button.

One-time setup (GitHub repo → Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `SSH_HOST` | `hackclub.app` |
| `SSH_USER` | `jesutobi` |
| `SSH_PRIVATE_KEY` | private key of a **dedicated deploy keypair** |

Generate the deploy key and authorise it once:

```bash
# on your PC
ssh-keygen -t ed25519 -f deploy_key -N "" -C "github-actions-deploy"
ssh-copy-id -i deploy_key.pub jesutobi@hackclub.app   # or append deploy_key.pub to ~/.ssh/authorized_keys
# paste the contents of deploy_key (the PRIVATE file) into the SSH_PRIVATE_KEY secret
```

### Manual

```bash
ssh jesutobi@hackclub.app
cd ~/acadmate_bot
git pull origin main

# Rebuild the shared image FIRST so a newly-added migration is present in the
# migrate container (it bakes the code — `run --rm migrate` alone reuses a stale
# image and silently sees the old migration set).
docker compose build bot api migrate

# ONLY if the PR added a migration under prisma/migrations:
docker compose run --rm migrate npx prisma migrate deploy

# Recreate the services from the freshly built image:
docker compose up -d bot api
```

Match the deploy to the diff: code-only change → `build` + `up -d` is enough;
schema change → run the migration BETWEEN them (new code expects the new
columns). Verify:

```bash
docker compose ps                                  # all "running"; migrate "exited (0)"
docker compose logs --since=2m bot | grep -iE "AI router ready|launched"
docker compose logs --since=2m api | grep -i listening
```

## Accessing the dashboard (port 4000)

**SSH `-L` forwarding does NOT work** — HackClub's gateway returns
`administratively prohibited` even though the container's own sshd allows
forwarding. And the `10.60.x` IP is private. So expose it **outbound** instead.

**Quick (works now, ephemeral URL):**
```bash
docker run --rm --network host cloudflare/cloudflared:latest tunnel --url http://localhost:4000
# prints https://<random>.trycloudflare.com — open it, HTTPS, login required
```
Add `-d --name acadmate-tunnel --restart unless-stopped` to keep it running
(URL still changes on restart).

**Permanent (pick one):**
- **Tailscale** (recommended, private, no domain): install on server + PC, then
  `http://<server-tailscale-ip>:4000`. Most secure — never public.
- **Cloudflare *named* tunnel** (public HTTPS URL): needs a free CF account + a
  domain on Cloudflare; wire `cloudflared` in as a compose service with a token.

Login: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env` (default
`admin@acadmate.local`). The dashboard is HTTP-only by design (relaxed CSP), so
prefer Tailscale/tunnel over opening port 4000 publicly.

## AI providers

Set in `.env` (unquoted), then `docker compose up -d --force-recreate bot api`:

```
AI_PROVIDER_ORDER=groq,gemini
GROQ_API_KEY=gsk_...           # https://console.groq.com/keys
GROQ_MODEL=llama-3.3-70b-versatile
GEMINI_API_KEY=AIza...         # https://aistudio.google.com/apikey
GEMINI_MODEL=gemini-2.5-flash
```

Router tries Groq first, fails over to Gemini on 429 (per-provider cooldown).
**Which AI is in use?** `/aistatus` (admin, in-chat) shows per-provider
ready/cooldown state + next/last served. Logs show switches:
`docker compose logs bot | grep "served by provider"`. No keys → AI disabled,
heuristics still run.

## Telegram setup (one-time)

- @BotFather: `/setprivacy` → **Disable** (bot must read all messages). Being a
  group admin also grants this.
- Promote the bot to **admin** with **delete / ban / restrict** rights.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Bot crash-loops, logs `401 Unauthorized` on `getMe` | Bad/placeholder/quoted `BOT_TOKEN`. Test: `curl https://api.telegram.org/bot<TOKEN>/getMe`. Fix `.env` (no quotes), `docker compose up -d --force-recreate bot`. |
| `/warn` etc. say "restricted to admins" though you're admin | Wait ~60s (admin cache TTL). If persistent, bot may lack rights / deployed code predates `AdminCacheService`. |
| Dashboard `localhost:5000` won't load via SSH tunnel | Gateway blocks `-L` forwarding (`administratively prohibited`). Use the Cloudflare tunnel instead. |
| `/summarize` says "nothing to summarise" | Buffer only holds non-command messages since last bot start; post real chatter first. Use `/summarise` too (alias). |
| AI moderation ignores a toxic message | Message < 24 chars / no link → AI gate skips it. Use `/addword <slur>` for short ones, or lower `AI_MODERATION_MIN_LENGTH`. |
| `Can't reach database at localhost:5432` from a container | DATABASE_URL not overridden to host `postgres` — confirm the `x-database-url` anchor is applied (`docker compose config | grep DATABASE_URL`). |
| `/aistatus` says "AI not configured" | `GROQ_API_KEY`/`GEMINI_API_KEY` missing or quoted in `.env`; recreate containers after fixing. |

## Day-to-day

```bash
docker compose logs -f bot          # live bot logs
docker compose restart bot          # restart without rebuild
docker compose down                 # stop all (data persists in pgdata volume)
docker compose down -v              # ⚠️ also deletes the database
```
