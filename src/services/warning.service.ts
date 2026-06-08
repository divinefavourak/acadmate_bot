import { DetectionReason, type Warning } from '@prisma/client';
import type { Database } from '@/database/prisma.client';

export interface IssueWarningInput {
  dbChatId: string;
  dbUserId: string;
  reason: string;
  detection?: DetectionReason;
  issuedById?: string | null;
}

/**
 * Manages the strike system. Warnings are "active" until cleared; the count of
 * active warnings drives escalation (mute/kick/ban) handled by the orchestrator.
 */
export class WarningService {
  constructor(private readonly db: Database) {}

  async issue(input: IssueWarningInput): Promise<{ warning: Warning; activeCount: number }> {
    const warning = await this.db.warning.create({
      data: {
        chatId: input.dbChatId,
        userId: input.dbUserId,
        reason: input.reason,
        detection: input.detection ?? DetectionReason.MANUAL,
        issuedById: input.issuedById ?? null,
      },
    });
    const activeCount = await this.countActive(input.dbChatId, input.dbUserId);
    return { warning, activeCount };
  }

  countActive(dbChatId: string, dbUserId: string): Promise<number> {
    return this.db.warning.count({
      where: { chatId: dbChatId, userId: dbUserId, active: true },
    });
  }

  /** Clears all active warnings (e.g. after escalation fires, or admin reset). */
  async clear(dbChatId: string, dbUserId: string): Promise<number> {
    const { count } = await this.db.warning.updateMany({
      where: { chatId: dbChatId, userId: dbUserId, active: true },
      data: { active: false },
    });
    return count;
  }

  list(dbChatId: string, dbUserId: string): Promise<Warning[]> {
    return this.db.warning.findMany({
      where: { chatId: dbChatId, userId: dbUserId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
