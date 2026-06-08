import { MemberRole } from '@prisma/client';
import type { MiddlewareFn } from 'telegraf';
import type { BotContext, InspectedMessage } from '@/types';
import type { Container } from '@/container';
import { userLabel } from './helpers';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('message-handler');

/**
 * The automated moderation pipeline for every inbound text/caption message.
 * Admins are exempt; their messages are skipped before any detection runs.
 */
export function moderationHandler(container: Container): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const { dbChatId, dbUserId, settings } = ctx.state;
    if (!dbChatId || !dbUserId || !settings) return next();

    // Admins/owners bypass moderation entirely.
    if (ctx.state.actorRole === MemberRole.ADMIN || ctx.state.actorRole === MemberRole.OWNER) {
      return next();
    }

    const msg = ctx.message;
    if (!msg || (!('text' in msg) && !('caption' in msg))) return next();

    const text = ('text' in msg ? msg.text : undefined) ?? ('caption' in msg ? msg.caption : '') ?? '';
    const entities = extractEntities(msg as unknown as Record<string, unknown>);

    const inspected: InspectedMessage = {
      chatTelegramId: BigInt(ctx.chat!.id),
      userTelegramId: BigInt(ctx.from!.id),
      messageId: msg.message_id,
      text,
      entities,
    };

    try {
      const result = await container.engine.inspect(inspected, settings, dbChatId, dbUserId);
      if (!result.flagged) return next();

      const label = userLabel({
        username: ctx.from!.username,
        firstName: ctx.from!.first_name,
        telegramId: inspected.userTelegramId,
      });

      const outcome = await container.moderation.enforceDetection(inspected, result, {
        settings,
        dbChatId,
        dbUserId,
        chatTelegramId: inspected.chatTelegramId,
        userTelegramId: inspected.userTelegramId,
        userLabel: label,
      });

      if (outcome.notice) {
        await container.telegram.sendMessage(inspected.chatTelegramId, outcome.notice);
      }
    } catch (err) {
      log.error({ err }, 'moderation pipeline error');
      return next();
    }
  };
}

function extractEntities(msg: Record<string, unknown>): InspectedMessage['entities'] {
  const raw =
    (msg['entities'] as { type: string; url?: string }[] | undefined) ??
    (msg['caption_entities'] as { type: string; url?: string }[] | undefined) ??
    [];
  return raw.map((e) => ({ type: e.type, url: e.url }));
}
