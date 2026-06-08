import type { ChatSettings } from '@prisma/client';
import type { Database } from '@/database/prisma.client';
import type { DetectionResult, InspectedMessage } from '@/types';
import { contentHash } from '@/utils/hash';
import { scopedLogger } from '@/utils/logger';
import type { Detector, DetectorContext } from './detector.interface';

const log = scopedLogger('moderation-engine');

/**
 * Runs an inbound message through every enabled detector and returns the
 * first flagged result (detectors are ordered by severity of concern).
 *
 * The engine is responsible for one side effect only: persisting a
 * MessageRecord, which the flood/duplicate detectors rely on. All other
 * enforcement is delegated to services downstream.
 */
export class ModerationEngine {
  constructor(
    private readonly db: Database,
    /** Ordered list — earlier detectors win when multiple would flag. */
    private readonly detectors: Detector[],
  ) {}

  async inspect(
    message: InspectedMessage,
    settings: ChatSettings,
    dbChatId: string,
    dbUserId: string,
  ): Promise<DetectionResult> {
    // 1. Record the message first so stateful detectors can count it.
    await this.recordMessage(message, dbChatId, dbUserId);

    const ctx: DetectorContext = { settings, dbChatId, dbUserId };

    // 2. Run detectors in order; short-circuit on the first flag.
    for (const detector of this.detectors) {
      if (!detector.isEnabled(settings)) continue;
      try {
        const result = await detector.detect(message, ctx);
        if (result.flagged) {
          log.debug({ detector: detector.name, details: result.details }, 'message flagged');
          return result;
        }
      } catch (err) {
        // A misbehaving detector must never block message processing.
        log.error({ err, detector: detector.name }, 'detector threw');
      }
    }

    return { flagged: false };
  }

  private async recordMessage(
    message: InspectedMessage,
    dbChatId: string,
    dbUserId: string,
  ): Promise<void> {
    await this.db.messageRecord.create({
      data: {
        chatId: dbChatId,
        userId: dbUserId,
        messageId: BigInt(message.messageId),
        contentHash: message.text ? contentHash(message.text) : '',
      },
    });
  }
}
