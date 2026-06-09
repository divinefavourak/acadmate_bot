import 'dotenv/config';
import { z } from 'zod';

/**
 * Centralised, validated configuration.
 * The entire app reads from `config` — never from `process.env` directly.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Telegram
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  WEBHOOK_DOMAIN: z.string().url().optional(),
  WEBHOOK_PATH: z.string().default('/telegraf'),
  WEBHOOK_PORT: z.coerce.number().int().positive().default(8443),
  WEBHOOK_SECRET: z.string().optional(),

  // Database
  DATABASE_URL: z.string().url(),

  // API
  API_PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604800),
  CORS_ORIGINS: z.string().default('').transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // Moderation defaults
  FLOOD_MAX_MESSAGES: z.coerce.number().int().positive().default(5),
  FLOOD_WINDOW_SECONDS: z.coerce.number().int().positive().default(7),
  DUPLICATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  WARN_THRESHOLD: z.coerce.number().int().positive().default(3),
  DEFAULT_MUTE_MINUTES: z.coerce.number().int().positive().default(60),

  // AI providers + router
  AI_PROVIDER_ORDER: z
    .string()
    .default('groq,gemini')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  AI_PROVIDER_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  AI_MODERATION_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  AI_MODERATION_MIN_LENGTH: z.coerce.number().int().nonnegative().default(24),

  // Operational alerts: the bot DMs this Telegram user id on errors.
  // Leave blank to disable. You must /start the bot in DM at least once.
  // Note: dotenv turns a blank `OWNER_TELEGRAM_ID=` into '', which would coerce
  // to 0 and fail .positive(); normalise empty string to undefined (disabled).
  OWNER_TELEGRAM_ID: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  ERROR_ALERT_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(300),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Cross-field invariant: webhook mode requires a domain.
if (parsed.data.BOT_MODE === 'webhook' && !parsed.data.WEBHOOK_DOMAIN) {
  // eslint-disable-next-line no-console
  console.error('❌ WEBHOOK_DOMAIN is required when BOT_MODE=webhook');
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;

export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
