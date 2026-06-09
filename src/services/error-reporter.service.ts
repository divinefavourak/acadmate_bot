import { createHash } from 'node:crypto';
import { config } from '@/config';
import { scopedLogger } from '@/utils/logger';
import type { TelegramGateway } from './telegram.gateway';

const log = scopedLogger('error-reporter');

/**
 * Sends operational error alerts to the owner's Telegram DM.
 *
 * Throttling is essential: a crash-looping bug could otherwise send hundreds of
 * DMs a minute. We fingerprint each error (context + message) and suppress
 * repeats of the same fingerprint within a cooldown window, while still logging
 * every occurrence locally.
 */
export class ErrorReporterService {
  private readonly lastSentAt = new Map<string, number>();
  private readonly cooldownMs = config.ERROR_ALERT_COOLDOWN_SECONDS * 1000;

  constructor(private readonly telegram: TelegramGateway) {}

  get enabled(): boolean {
    return config.OWNER_TELEGRAM_ID !== undefined;
  }

  /**
   * Report an error. Always logs; DMs the owner if configured and not within
   * the cooldown for this error's fingerprint. Never throws.
   */
  async report(context: string, error: unknown): Promise<void> {
    const err = normaliseError(error);
    log.error({ context, err: err.message }, 'reported error');

    if (!this.enabled) return;

    const fingerprint = hash(`${context}:${err.message}`);
    const now = Date.now();
    const last = this.lastSentAt.get(fingerprint) ?? 0;
    if (now - last < this.cooldownMs) return; // suppressed (still logged above)

    const text = [
      '🚨 Acadmate alert',
      `Context: ${context}`,
      `Error: ${err.message}`,
      err.stack ? `\n${truncate(err.stack, 600)}` : '',
      `\n(identical alerts muted for ${config.ERROR_ALERT_COOLDOWN_SECONDS}s)`,
    ]
      .filter(Boolean)
      .join('\n');

    const delivered = await this.telegram.sendMessage(BigInt(config.OWNER_TELEGRAM_ID!), text);
    // Only start the dedup cooldown once delivery actually succeeded, so a
    // transient send failure doesn't silently mute the alert.
    if (delivered !== null) {
      this.lastSentAt.set(fingerprint, now);
    } else {
      log.warn('failed to deliver error alert DM');
    }
  }
}

function normaliseError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}

function hash(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
