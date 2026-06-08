import {
  type ModerationActionType,
  type DetectionReason,
  type ModerationLog,
  type Prisma,
} from '@prisma/client';
import type { Database } from '@/database/prisma.client';

export interface LogActionInput {
  dbChatId: string;
  action: ModerationActionType;
  reason: DetectionReason;
  /** Internal target user id; null for chat-wide actions. */
  targetId?: string | null;
  /** Internal actor user id; null for automated bot actions. */
  actorId?: string | null;
  details?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface LogQuery {
  dbChatId?: string;
  action?: ModerationActionType;
  reason?: DetectionReason;
  page?: number;
  pageSize?: number;
}

/**
 * Append-only audit trail. The API dashboard reads from here; nothing ever
 * updates or deletes a log row, which is what makes it trustworthy evidence.
 */
export class ModerationLogService {
  constructor(private readonly db: Database) {}

  async record(input: LogActionInput): Promise<ModerationLog> {
    return this.db.moderationLog.create({
      data: {
        chatId: input.dbChatId,
        action: input.action,
        reason: input.reason,
        targetId: input.targetId ?? null,
        actorId: input.actorId ?? null,
        details: input.details ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async query(q: LogQuery): Promise<{ total: number; items: ModerationLog[] }> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25));

    const where: Prisma.ModerationLogWhereInput = {
      ...(q.dbChatId ? { chatId: q.dbChatId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.reason ? { reason: q.reason } : {}),
    };

    const [total, items] = await this.db.$transaction([
      this.db.moderationLog.count({ where }),
      this.db.moderationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          target: { select: { telegramId: true, username: true, firstName: true } },
          actor: { select: { telegramId: true, username: true, firstName: true } },
          chat: { select: { telegramId: true, title: true } },
        },
      }),
    ]);

    return { total, items };
  }
}
