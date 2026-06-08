import cron, { type ScheduledTask } from 'node-cron';
import { ScheduleStatus, type ScheduledTag } from '@prisma/client';
import type { Database } from '@/database/prisma.client';
import type { TaggingService } from './tagging.service';
import type { MuteService } from './mute.service';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('scheduler');

/**
 * Owns all time-based work:
 *  - Scheduled tag broadcasts (one cron job per active ScheduledTag).
 *  - Maintenance: expiring mutes and pruning old message_records.
 *
 * Cron jobs live only in memory; on boot we rehydrate them from the DB so the
 * schedule survives restarts.
 */
export class SchedulerService {
  private readonly jobs = new Map<string, ScheduledTask>();
  private maintenance: ScheduledTask | null = null;

  constructor(
    private readonly db: Database,
    private readonly tagging: TaggingService,
    private readonly mutes: MuteService,
  ) {}

  /** Load persisted schedules and start the maintenance loop. Call once at boot. */
  async start(): Promise<void> {
    const active = await this.db.scheduledTag.findMany({
      where: { status: ScheduleStatus.ACTIVE },
      include: { chat: true },
    });
    for (const tag of active) this.register(tag);

    // Every minute: expire mutes; prune records hourly via modulo guard.
    this.maintenance = cron.schedule('* * * * *', () => {
      void this.runMaintenance();
    });

    log.info({ scheduled: active.length }, 'scheduler started');
  }

  /** Persist a new scheduled tag and immediately register its cron job. */
  async create(input: {
    dbChatId: string;
    chatTelegramId: bigint;
    createdById: bigint;
    target: string;
    message: string;
    cronExpr: string;
    timezone?: string;
  }): Promise<ScheduledTag> {
    if (!cron.validate(input.cronExpr)) {
      throw new Error(`Invalid cron expression: ${input.cronExpr}`);
    }
    const tag = await this.db.scheduledTag.create({
      data: {
        chatId: input.dbChatId,
        createdById: input.createdById,
        target: input.target,
        message: input.message,
        cron: input.cronExpr,
        timezone: input.timezone ?? 'UTC',
      },
      include: { chat: true },
    });
    this.register(tag);
    return tag;
  }

  async cancel(scheduledTagId: string): Promise<void> {
    const job = this.jobs.get(scheduledTagId);
    if (job) {
      job.stop();
      this.jobs.delete(scheduledTagId);
    }
    await this.db.scheduledTag.update({
      where: { id: scheduledTagId },
      data: { status: ScheduleStatus.CANCELLED },
    });
  }

  /** Stops all in-memory jobs (graceful shutdown). */
  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
    this.maintenance?.stop();
  }

  private register(tag: ScheduledTag & { chat: { telegramId: bigint } }): void {
    const existing = this.jobs.get(tag.id);
    if (existing) existing.stop();

    const job = cron.schedule(
      tag.cron,
      () => {
        void this.fire(tag);
      },
      { timezone: tag.timezone },
    );
    this.jobs.set(tag.id, job);
  }

  private async fire(tag: ScheduledTag & { chat: { telegramId: bigint } }): Promise<void> {
    try {
      const chunks = await this.resolveChunks(tag);
      if (chunks) {
        if (tag.message) chunks.unshift(tag.message);
        await this.tagging.broadcast(tag.chat.telegramId, chunks);
      }
      await this.db.scheduledTag.update({
        where: { id: tag.id },
        data: { lastRunAt: new Date() },
      });
    } catch (err) {
      log.error({ err, tagId: tag.id }, 'scheduled tag failed');
    }
  }

  private async resolveChunks(tag: ScheduledTag): Promise<string[] | null> {
    switch (tag.target) {
      case 'all':
        return this.tagging.tagAll(tag.chatId);
      case 'admins':
        return this.tagging.tagAdmins(tag.chatId);
      default:
        return this.tagging.tagRole(tag.chatId, tag.target);
    }
  }

  private async runMaintenance(): Promise<void> {
    try {
      const expired = await this.mutes.expireDueMutes();
      if (expired > 0) log.debug({ expired }, 'expired mutes');

      // Prune message_records older than 24h once per hour.
      if (new Date().getMinutes() === 0) {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const { count } = await this.db.messageRecord.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
        if (count > 0) log.info({ pruned: count }, 'pruned old message records');
      }
    } catch (err) {
      log.error({ err }, 'maintenance run failed');
    }
  }
}
