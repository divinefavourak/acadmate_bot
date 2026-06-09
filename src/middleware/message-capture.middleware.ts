import type { MiddlewareFn } from 'telegraf';
import type { BotContext } from '@/types';
import type { Container } from '@/container';
import { userLabel } from '@/bot/helpers';

/**
 * Records each group text/caption message into the in-memory buffer that backs
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
        container.messageBuffer.push(dbChatId, name, text);
      }
    }
    return next();
  };
}
