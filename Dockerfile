# ─────────────────────────────────────────────────────────────
# Multi-stage build: small, non-root runtime image.
# ─────────────────────────────────────────────────────────────

# 1. Dependencies (with dev deps for build) ───────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# 2. Build ────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
  && npm run build \
  && npm prune --omit=dev

# 3. Runtime ──────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production

# Run as the built-in unprivileged "node" user
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

# tini reaps zombies / forwards signals for clean shutdown
ENTRYPOINT ["/sbin/tini", "--"]

# Default command runs the bot; the API service overrides this in compose.
CMD ["node", "dist/bot/index.js"]
