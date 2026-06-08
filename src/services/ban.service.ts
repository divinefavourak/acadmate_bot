import type { Ban } from '@prisma/client';
import type { Database } from '@/database/prisma.client';
import type { TelegramGateway } from './telegram.gateway';

export interface BanInput {
  dbChatId: string;
  dbUserId: string;
  chatTelegramId: bigint;
  userTelegramId: bigint;
  reason?: string;
}

/**
 * Permanent ban and kick (ban + immediate unban) operations. Bans are tracked
 * in the DB so the dashboard can list and reverse them; kicks are not persisted
 * as a standing state because the user may freely rejoin.
 */
export class BanService {
  constructor(
    private readonly db: Database,
    private readonly telegram: TelegramGateway,
  ) {}

  async ban(input: BanInput): Promise<Ban> {
    await this.telegram.banUser(input.chatTelegramId, input.userTelegramId);
    return this.db.ban.upsert({
      where: { chatId_userId: { chatId: input.dbChatId, userId: input.dbUserId } },
      create: {
        chatId: input.dbChatId,
        userId: input.dbUserId,
        reason: input.reason ?? null,
        active: true,
      },
      update: { active: true, reason: input.reason ?? null },
    });
  }

  async unban(
    dbChatId: string,
    dbUserId: string,
    chatTelegramId: bigint,
    userTelegramId: bigint,
  ): Promise<void> {
    await this.telegram.unbanUser(chatTelegramId, userTelegramId);
    await this.db.ban.updateMany({
      where: { chatId: dbChatId, userId: dbUserId, active: true },
      data: { active: false },
    });
  }

  /** Removes the user but allows them to rejoin. Not persisted as a ban. */
  async kick(chatTelegramId: bigint, userTelegramId: bigint): Promise<boolean> {
    return this.telegram.kickUser(chatTelegramId, userTelegramId);
  }
}
