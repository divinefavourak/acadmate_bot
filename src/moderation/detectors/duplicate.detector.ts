import { DetectionReason, type ChatSettings } from '@prisma/client';
import type { Database } from '@/database/prisma.client';
import type { DetectionResult, InspectedMessage } from '@/types';
import { contentHash } from '@/utils/hash';
import { secondsFromNow } from '@/utils/time';
import { PASS, type Detector, type DetectorContext } from '../detector.interface';

/**
 * Flags a user repeating the same (normalised) message within
 * `duplicateWindowSeconds`. Uses the precomputed content hash so we compare
 * an indexed fixed-length string rather than scanning full message text.
 */
export class DuplicateDetector implements Detector {
  public readonly name = 'duplicate';
  public readonly reason = DetectionReason.DUPLICATE;

  constructor(private readonly db: Database) {}

  isEnabled(settings: ChatSettings): boolean {
    return settings.duplicateDetection;
  }

  async detect(message: InspectedMessage, ctx: DetectorContext): Promise<DetectionResult> {
    if (!message.text || message.text.trim().length < 3) return PASS;

    const hash = contentHash(message.text);
    const windowStart = secondsFromNow(-ctx.settings.duplicateWindowSeconds);

    // Count identical prior messages from the same user (excludes the one just
    // written by matching on createdAt < now via id ordering is unnecessary —
    // we look for >1 because the current message is already persisted).
    const duplicates = await this.db.messageRecord.count({
      where: {
        chatId: ctx.dbChatId,
        userId: ctx.dbUserId,
        contentHash: hash,
        createdAt: { gte: windowStart },
      },
    });

    if (duplicates > 1) {
      return {
        flagged: true,
        reason: this.reason,
        details: `Repeated identical message ${duplicates}x within ${ctx.settings.duplicateWindowSeconds}s`,
        severity: 1,
      };
    }
    return PASS;
  }
}
