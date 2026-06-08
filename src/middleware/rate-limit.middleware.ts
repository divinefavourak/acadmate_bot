import type { MiddlewareFn } from 'telegraf';
import type { BotContext } from '@/types';

/**
 * Lightweight in-memory token bucket keyed by user+chat, protecting the bot's
 * *command* surface from abuse (e.g. someone spamming /tagall). This is
 * deliberately separate from the moderation flood detector: that protects the
 * group, this protects the bot from doing expensive work.
 *
 * For multi-replica deployments, swap the Map for a Redis-backed bucket; the
 * middleware signature stays identical.
 */
export function rateLimit(options: { capacity: number; refillPerSec: number }): MiddlewareFn<BotContext> {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  // Periodically evict idle buckets so the Map doesn't grow unbounded.
  const evictAfterMs = 5 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (now - b.updatedAt > evictAfterMs) buckets.delete(key);
    }
  }, 60_000).unref();

  return async (ctx, next) => {
    // Only throttle command messages; ordinary chatter is handled elsewhere.
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    if (!text.startsWith('/')) return next();

    const key = `${ctx.chat?.id}:${ctx.from?.id}`;
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: options.capacity, updatedAt: now };

    // Refill based on elapsed time.
    const elapsedSec = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(options.capacity, bucket.tokens + elapsedSec * options.refillPerSec);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      // Silently drop; replying would itself be a vector for spam amplification.
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return next();
  };
}
