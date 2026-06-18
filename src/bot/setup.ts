import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from '@/config';
import type { BotContext } from '@/types';
import { Container } from '@/container';
import { entityResolution } from '@/middleware/entity-resolution.middleware';
import { rateLimit } from '@/middleware/rate-limit.middleware';
import { moderationHandler } from './message-handler';
import { quizHandler } from './quiz-handler';
import { captureMessages } from '@/middleware/message-capture.middleware';
import { generalCommands } from '@/commands/general.commands';
import { moderationCommands } from '@/commands/moderation.commands';
import { taggingCommands } from '@/commands/tagging.commands';
import { adminCommands } from '@/commands/admin.commands';
import { aiCommands } from '@/commands/ai.commands';
import { quizCommands } from '@/commands/quiz.commands';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('bot-setup');

export interface BuiltBot {
  bot: Telegraf<BotContext>;
  container: Container;
}

/**
 * Constructs the Telegraf bot, wires the middleware pipeline, and registers all
 * commands and the automated moderation handler. Returns both the bot and the
 * container so the entrypoint can start the scheduler and shut down cleanly.
 */
export function buildBot(): BuiltBot {
  const bot = new Telegraf<BotContext>(config.BOT_TOKEN, {
    handlerTimeout: 30_000,
  });

  const container = new Container(bot.telegram);

  // 1. Global error boundary — one bad update must never kill the process,
  //    and the owner gets a (throttled) DM alert.
  bot.catch((err, ctx) => {
    log.error({ err, updateType: ctx.updateType }, 'unhandled bot error');
    void container.errorReporter.report(`bot:${ctx.updateType}`, err);
  });

  // 2. Cheap guards first.
  bot.use(rateLimit({ capacity: 8, refillPerSec: 0.5 }));

  // 3. Resolve entities + roles for group activity.
  bot.use(entityResolution(container));

  // 3b. Capture recent plaintext into the buffer for /summarize.
  bot.use(captureMessages(container));

  // 4. Maintain membership bookkeeping on join/leave.
  bot.on(message('new_chat_members'), async (ctx, next) => {
    if (ctx.state.dbChatId) {
      for (const m of ctx.message.new_chat_members) {
        const u = await container.users.upsertUser({
          telegramId: BigInt(m.id),
          username: m.username,
          firstName: m.first_name,
          isBot: m.is_bot,
        });
        await container.users.upsertMembership(ctx.state.dbChatId, u.id);
      }
    }
    return next();
  });

  // 5. Commands (must precede the catch-all moderation scan).
  bot.use(generalCommands());
  bot.use(moderationCommands(container));
  bot.use(taggingCommands(container));
  bot.use(adminCommands(container));
  bot.use(aiCommands(container));
  bot.use(quizCommands(container));

  // 6. Auto-detect revision quizzes on remaining (non-command) messages. Sits
  //    after commands and before moderation; always calls next() so the
  //    moderation scan still runs.
  bot.use(quizHandler(container));

  // 7. Automated moderation for any remaining text/caption message.
  bot.on(message(), moderationHandler(container));

  return { bot, container };
}
