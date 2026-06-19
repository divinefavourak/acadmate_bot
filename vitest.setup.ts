// Seed the env vars that `@/config` validates, so importing any module that
// transitively loads the config does not `process.exit(1)` during tests. Runs
// before test files (and their imports) are evaluated. CI runners and fresh
// checkouts have no `.env`; `dotenv/config` won't override these dummy values,
// so a developer's real `.env` is irrelevant to the (DB-less, fully faked) tests.
process.env.NODE_ENV ??= 'test';
process.env.BOT_TOKEN ??= 'test-bot-token';
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long';
