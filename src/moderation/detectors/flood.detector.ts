import { DetectionReason, type ChatSettings } from '@prisma/client';
import type { Database } from '@/database/prisma.client';
import type { DetectionResult, InspectedMessage } from '@/types';
import { secondsFromNow } from '@/utils/time';
import { PASS, type Detector, type DetectorContext } from '../detector.interface';

/**
 * Flags a user sending more than `floodMaxMessages` within
 * `floodWindowSeconds`. Counts rows in the message_records table, which the
 * engine writes for every inbound message.
 */
export class FloodDetector implements Detector {
  public readonly name = 'flood';
  public readonly reason = DetectionReason.FLOOD;

  constructor(private readonly db: Database) {}

  isEnabled(settings: ChatSettings): boolean {
    return settings.floodDetection;
  }

  async detect(_message: InspectedMessage, ctx: DetectorContext): Promise<DetectionResult> {
    const windowStart = secondsFromNow(-ctx.settings.floodWindowSeconds);

    const recentCount = await this.db.messageRecord.count({
      where: {
        chatId: ctx.dbChatId,
        userId: ctx.dbUserId,
        createdAt: { gte: windowStart },
      },
    });

    // The current message is already persisted by the engine before detectors
    // run, so `recentCount` includes it.
    if (recentCount > ctx.settings.floodMaxMessages) {
      return {
        flagged: true,
        reason: this.reason,
        details: `${recentCount} messages in ${ctx.settings.floodWindowSeconds}s (limit ${ctx.settings.floodMaxMessages})`,
        severity: 1,
      };
    }
    return PASS;
  }
}
