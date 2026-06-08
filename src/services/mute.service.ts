import type { Mute } from '@prisma/client';
import type { Database } from '@/database/prisma.client';
import type { TelegramGateway } from './telegram.gateway';
import { minutesFromNow } from '@/utils/time';

export interface MuteInput {
  dbChatId: string;
  dbUserId: string;
  chatTelegramId: bigint;
  userTelegramId: bigint;
  minutes: number;
  reason?: string;
}

/**
 * Temporary mute. Persists the mute window in the DB *and* applies the Telegram
 * restriction. The DB record is the source of truth the scheduler uses to
 * auto-expire mutes even if the bot was offline when Telegram's own timer ran.
 */
export class MuteService {
  constructor(
    private readonly db: Database,
    private readonly telegram: TelegramGateway,
  ) {}

  async mute(input: MuteInput): Promise<Mute> {
    const until = minutesFromNow(input.minutes);

    // Deactivate any prior active mute to keep a single live window per user.
    await this.db.mute.updateMany({
      where: { chatId: input.dbChatId, userId: input.dbUserId, active: true },
      data: { active: false },
    });

    const mute = await this.db.mute.create({
      data: {
        chatId: input.dbChatId,
        userId: input.dbUserId,
        reason: input.reason ?? null,
        until,
        active: true,
      },
    });

    await this.telegram.muteUntil(input.chatTelegramId, input.userTelegramId, until);
    return mute;
  }

  async unmute(
    dbChatId: string,
    dbUserId: string,
    chatTelegramId: bigint,
    userTelegramId: bigint,
  ): Promise<void> {
    await this.db.mute.updateMany({
      where: { chatId: dbChatId, userId: dbUserId, active: true },
      data: { active: false },
    });
    await this.telegram.unmute(chatTelegramId, userTelegramId);
  }

  /**
   * Called by the scheduler: finds mutes whose window has elapsed, lifts the
   * Telegram restriction, and marks them inactive.
   */
  async expireDueMutes(): Promise<number> {
    const due = await this.db.mute.findMany({
      where: { active: true, until: { lte: new Date() } },
      include: {
        chat: { select: { telegramId: true } },
        user: { select: { telegramId: true } },
      },
      take: 200,
    });

    for (const m of due) {
      await this.telegram.unmute(m.chat.telegramId, m.user.telegramId);
      await this.db.mute.update({ where: { id: m.id }, data: { active: false } });
    }
    return due.length;
  }
}
