import {
  ModerationActionType,
  DetectionReason,
  type ChatSettings,
} from '@prisma/client';
import type { DetectionResult, InspectedMessage } from '@/types';
import { formatDuration } from '@/utils/time';
import { scopedLogger } from '@/utils/logger';
import type { WarningService } from './warning.service';
import type { MuteService } from './mute.service';
import type { BanService } from './ban.service';
import type { ModerationLogService } from './moderation-log.service';
import type { TelegramGateway } from './telegram.gateway';

const log = scopedLogger('moderation-service');

export interface EnforcementContext {
  settings: ChatSettings;
  dbChatId: string;
  dbUserId: string;
  chatTelegramId: bigint;
  userTelegramId: bigint;
  /** Display name for user-facing notices. */
  userLabel: string;
}

export interface EnforcementOutcome {
  action: ModerationActionType;
  /** Public notice to post in the chat, or null to stay silent. */
  notice: string | null;
}

/**
 * Applies a moderation decision: deletes the message if configured, issues a
 * warning, escalates when the threshold is reached, and records an audit log.
 * The single funnel for BOTH automated detections and manual admin commands.
 */
export class ModerationService {
  constructor(
    private readonly warnings: WarningService,
    private readonly mutes: MuteService,
    private readonly bans: BanService,
    private readonly logs: ModerationLogService,
    private readonly telegram: TelegramGateway,
  ) {}

  /** Entry point for an automated detection produced by the engine. */
  async enforceDetection(
    message: InspectedMessage,
    result: DetectionResult,
    ctx: EnforcementContext,
  ): Promise<EnforcementOutcome> {
    const reason = result.reason ?? DetectionReason.MANUAL;

    if (ctx.settings.deleteOnDetect) {
      await this.telegram.deleteMessage(ctx.chatTelegramId, message.messageId);
      await this.logs.record({
        dbChatId: ctx.dbChatId,
        action: ModerationActionType.DELETE_MESSAGE,
        reason,
        targetId: ctx.dbUserId,
        actorId: null,
        details: result.details,
      });
    }

    return this.warnAndEscalate(ctx, reason, result.details ?? 'Automated detection', null);
  }

  /** Entry point for a manual `/warn` command issued by an admin. */
  async manualWarn(
    ctx: EnforcementContext,
    issuedById: string,
    reason: string,
  ): Promise<EnforcementOutcome> {
    return this.warnAndEscalate(ctx, DetectionReason.MANUAL, reason, issuedById);
  }

  private async warnAndEscalate(
    ctx: EnforcementContext,
    reason: DetectionReason,
    details: string,
    issuedById: string | null,
  ): Promise<EnforcementOutcome> {
    const { warning, activeCount } = await this.warnings.issue({
      dbChatId: ctx.dbChatId,
      dbUserId: ctx.dbUserId,
      reason: details,
      detection: reason,
      issuedById,
    });

    await this.logs.record({
      dbChatId: ctx.dbChatId,
      action: ModerationActionType.WARN,
      reason,
      targetId: ctx.dbUserId,
      actorId: issuedById,
      details,
      metadata: { warningId: warning.id, activeCount },
    });

    if (activeCount < ctx.settings.warnThreshold) {
      return {
        action: ModerationActionType.WARN,
        notice: `⚠️ ${ctx.userLabel} warned (${activeCount}/${ctx.settings.warnThreshold}). Reason: ${details}`,
      };
    }

    // Threshold reached → escalate and reset the strike counter.
    await this.warnings.clear(ctx.dbChatId, ctx.dbUserId);
    return this.escalate(ctx, reason);
  }

  private async escalate(
    ctx: EnforcementContext,
    reason: DetectionReason,
  ): Promise<EnforcementOutcome> {
    switch (ctx.settings.warnAction) {
      case ModerationActionType.BAN: {
        await this.bans.ban({
          dbChatId: ctx.dbChatId,
          dbUserId: ctx.dbUserId,
          chatTelegramId: ctx.chatTelegramId,
          userTelegramId: ctx.userTelegramId,
          reason: `Auto-ban after ${ctx.settings.warnThreshold} warnings`,
        });
        await this.record(ctx, ModerationActionType.BAN, reason);
        return { action: ModerationActionType.BAN, notice: `🔨 ${ctx.userLabel} was banned (warning limit reached).` };
      }
      case ModerationActionType.KICK: {
        await this.bans.kick(ctx.chatTelegramId, ctx.userTelegramId);
        await this.record(ctx, ModerationActionType.KICK, reason);
        return { action: ModerationActionType.KICK, notice: `👢 ${ctx.userLabel} was kicked (warning limit reached).` };
      }
      case ModerationActionType.MUTE:
      default: {
        const minutes = ctx.settings.defaultMuteMinutes;
        await this.mutes.mute({
          dbChatId: ctx.dbChatId,
          dbUserId: ctx.dbUserId,
          chatTelegramId: ctx.chatTelegramId,
          userTelegramId: ctx.userTelegramId,
          minutes,
          reason: `Auto-mute after ${ctx.settings.warnThreshold} warnings`,
        });
        await this.record(ctx, ModerationActionType.MUTE, reason, { minutes });
        return {
          action: ModerationActionType.MUTE,
          notice: `🔇 ${ctx.userLabel} muted for ${formatDuration(minutes)} (warning limit reached).`,
        };
      }
    }
  }

  private async record(
    ctx: EnforcementContext,
    action: ModerationActionType,
    reason: DetectionReason,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.logs.record({
      dbChatId: ctx.dbChatId,
      action,
      reason,
      targetId: ctx.dbUserId,
      actorId: null,
      details: `Escalated after reaching warning threshold`,
      metadata: metadata as never,
    });
    log.info({ action, user: ctx.userTelegramId.toString() }, 'escalation applied');
  }
}
