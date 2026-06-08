import pino from 'pino';
import { config, isProduction } from '@/config';

/**
 * Structured logger. Pretty-prints in dev, emits JSON in production
 * (so log aggregators like Loki/Datadog can parse it).
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'acadmate-bot' },
  redact: {
    // Never leak secrets into logs.
    paths: ['BOT_TOKEN', 'JWT_SECRET', 'password', 'passwordHash', 'token', '*.token'],
    censor: '[REDACTED]',
  },
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
});

export type Logger = typeof logger;

/** Returns a child logger scoped to a component for easier filtering. */
export function scopedLogger(component: string): Logger {
  return logger.child({ component });
}
