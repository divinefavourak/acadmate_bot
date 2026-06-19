import type { MiddlewareFn } from 'telegraf';
import type { BotContext } from '@/types';
import type { Container } from '@/container';
import { userLabel } from '@/bot/helpers';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('message-capture');

/**
 * Records each group text/caption message into the persisted buffer that backs
 * `/summarize`. Commands are skipped so the TL;DR is about conversation, not
 * bot invocations. Runs after entity resolution, before command handlers.
 */
export function captureMessages(container: Container): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const { dbChatId } = ctx.state;
    const msg = ctx.message;
    if (dbChatId && ctx.from && msg) {
      const text = 'text' in msg ? msg.text : 'caption' in msg ? msg.caption : undefined;
      if (text && !text.startsWith('/')) {
        const name = userLabel({
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          telegramId: BigInt(ctx.from.id),
        });
        // Best-effort: a persistence hiccup must never break the pipeline
        // (otherwise commands/moderation for this update would be skipped).
        try {
          await container.messageBuffer.push(dbChatId, name, text);
        } catch (err) {
          log.warn({ err }, 'failed to buffer message for /summarize');
        }
      }
    }
    return next();
  };
}
