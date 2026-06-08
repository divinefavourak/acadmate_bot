import { MemberRole } from '@prisma/client';
import type { BotContext } from '@/types';
import type { Container } from '@/container';

export interface ResolvedTarget {
  dbUserId: string;
  telegramId: bigint;
  label: string;
  role: MemberRole;
}

/** Builds a readable @mention/name for notices and logs. */
export function userLabel(u: {
  username?: string | null;
  firstName?: string | null;
  telegramId: bigint;
}): string {
  if (u.username) return `@${u.username}`;
  return u.firstName ?? `user ${u.telegramId.toString()}`;
}

/**
 * Determines which user a moderation command targets, from (in priority order):
 *   1. a replied-to message,
 *   2. a numeric user id argument,
 *   3. an @username argument.
 * Returns null with a reason if no valid, moderatable target is found.
 */
export async function resolveTarget(
  ctx: BotContext,
  container: Container,
  args: string[],
): Promise<{ target: ResolvedTarget } | { error: string }> {
  const dbChatId = ctx.state.dbChatId;
  if (!dbChatId) return { error: 'This command only works in a group.' };

  let telegramId: bigint | null = null;
  let username: string | undefined;
  let firstName: string | undefined;

  const reply = ctx.message && 'reply_to_message' in ctx.message ? ctx.message.reply_to_message : undefined;
  if (reply?.from) {
    telegramId = BigInt(reply.from.id);
    username = reply.from.username;
    firstName = reply.from.first_name;
  } else if (args[0]) {
    const arg = args[0].replace(/^@/, '');
    if (/^\d+$/.test(arg)) {
      telegramId = BigInt(arg);
    } else {
      username = arg;
      const found = await container.prisma.tgUser.findFirst({ where: { username: arg } });
      if (found) telegramId = found.telegramId;
    }
  }

  if (telegramId === null) {
    return { error: 'Reply to a user or pass their @username / numeric id.' };
  }

  // Never let the bot target itself.
  if (ctx.botInfo && telegramId === BigInt(ctx.botInfo.id)) {
    return { error: "I can't moderate myself." };
  }

  const dbUser = await container.users.upsertUser({ telegramId, username, firstName });
  const role = await container.users.getRole(dbChatId, dbUser.id);

  // Protect admins/owners from being moderated via the bot.
  if (role === MemberRole.ADMIN || role === MemberRole.OWNER) {
    return { error: 'That user is an admin and cannot be moderated.' };
  }

  return {
    target: {
      dbUserId: dbUser.id,
      telegramId,
      label: userLabel({ username, firstName, telegramId }),
      role,
    },
  };
}

/** Guard for admin-only commands. Replies and returns false if not allowed. */
export async function requireAdmin(ctx: BotContext): Promise<boolean> {
  if (ctx.state.isAdmin) return true;
  await ctx.reply('⛔ This command is restricted to group admins.');
  return false;
}

/** Splits the command text into argument tokens (drops the /command itself). */
export function commandArgs(ctx: BotContext): string[] {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  return text.split(/\s+/).slice(1).filter(Boolean);
}
