import { MemberRole, type Chat, type TgUser } from '@prisma/client';
import type { Database } from '@/database/prisma.client';

export interface TgUserInput {
  telegramId: bigint;
  username?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  isBot?: boolean;
}

export interface ChatInput {
  telegramId: bigint;
  title?: string | undefined;
  type?: string | undefined;
}

/**
 * Resolves Telegram entities (users, chats, memberships) to internal records.
 * Uses upserts so the first time we ever see a user/chat it is created
 * transparently — the bot never assumes prior registration.
 */
export class UserService {
  constructor(private readonly db: Database) {}

  async upsertUser(input: TgUserInput): Promise<TgUser> {
    return this.db.tgUser.upsert({
      where: { telegramId: input.telegramId },
      create: {
        telegramId: input.telegramId,
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        isBot: input.isBot ?? false,
      },
      update: {
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
      },
    });
  }

  async upsertChat(input: ChatInput): Promise<Chat> {
    return this.db.chat.upsert({
      where: { telegramId: input.telegramId },
      create: {
        telegramId: input.telegramId,
        title: input.title ?? null,
        type: input.type ?? 'supergroup',
        // Create default settings alongside the chat in one round-trip.
        settings: { create: {} },
      },
      update: { title: input.title ?? null },
    });
  }

  /** Records/updates a user's membership + cached role in a chat. */
  async upsertMembership(
    dbChatId: string,
    dbUserId: string,
    role: MemberRole = MemberRole.MEMBER,
  ): Promise<void> {
    await this.db.chatMember.upsert({
      where: { chatId_userId: { chatId: dbChatId, userId: dbUserId } },
      create: { chatId: dbChatId, userId: dbUserId, role },
      update: { role },
    });
  }

  async getRole(dbChatId: string, dbUserId: string): Promise<MemberRole> {
    const member = await this.db.chatMember.findUnique({
      where: { chatId_userId: { chatId: dbChatId, userId: dbUserId } },
    });
    return member?.role ?? MemberRole.MEMBER;
  }

  /** Bulk-sync admin roles fetched from Telegram into chat_members. */
  async syncAdmins(
    dbChatId: string,
    admins: { dbUserId: string; isOwner: boolean }[],
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      // Demote anyone currently marked admin/owner who is no longer one.
      const adminIds = new Set(admins.map((a) => a.dbUserId));
      const current = await tx.chatMember.findMany({
        where: { chatId: dbChatId, role: { in: [MemberRole.ADMIN, MemberRole.OWNER] } },
      });
      for (const m of current) {
        if (!adminIds.has(m.userId)) {
          await tx.chatMember.update({ where: { id: m.id }, data: { role: MemberRole.MEMBER } });
        }
      }
      for (const a of admins) {
        const role = a.isOwner ? MemberRole.OWNER : MemberRole.ADMIN;
        await tx.chatMember.upsert({
          where: { chatId_userId: { chatId: dbChatId, userId: a.dbUserId } },
          create: { chatId: dbChatId, userId: a.dbUserId, role },
          update: { role },
        });
      }
    });
  }

  async findByTelegramId(telegramId: bigint): Promise<TgUser | null> {
    return this.db.tgUser.findUnique({ where: { telegramId } });
  }
}
