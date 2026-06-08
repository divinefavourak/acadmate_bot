import { MemberRole } from '@prisma/client';
import type { MiddlewareFn } from 'telegraf';
import type { BotContext } from '@/types';
import type { Container } from '@/container';
import { prisma } from '@/database/prisma.client';

/**
 * Resolves the Telegram user + chat behind every group update into internal
 * records, caches their role, and attaches everything to `ctx.state`. Running
 * this first means downstream handlers never repeat upsert/lookup boilerplate.
 *
 * Private chats and channel posts without a `from` are passed through untouched.
 */
export function entityResolution(container: Container): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const from = ctx.from;
    const chat = ctx.chat;

    // Only resolve for group/supergroup activity with a real sender.
    if (!from || !chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      return next();
    }

    const dbUser = await container.users.upsertUser({
      telegramId: BigInt(from.id),
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      isBot: from.is_bot,
    });

    const dbChat = await container.users.upsertChat({
      telegramId: BigInt(chat.id),
      title: 'title' in chat ? chat.title : undefined,
      type: chat.type,
    });

    const settings =
      (await prisma.chatSettings.findUnique({ where: { chatId: dbChat.id } })) ??
      (await prisma.chatSettings.create({ data: { chatId: dbChat.id } }));

    // Resolve the role LIVE from Telegram's admin list (cached per chat), so a
    // user promoted to admin is recognised immediately — no `/admins` needed.
    // Persist it so the cached ChatMember.role stays consistent for the API.
    const role = await container.adminCache.resolveRole(BigInt(chat.id), BigInt(from.id));
    await container.users.upsertMembership(dbChat.id, dbUser.id, role);

    ctx.state.dbChatId = dbChat.id;
    ctx.state.dbUserId = dbUser.id;
    ctx.state.settings = settings;
    ctx.state.actorRole = role;
    ctx.state.isAdmin = role === MemberRole.ADMIN || role === MemberRole.OWNER;

    return next();
  };
}
