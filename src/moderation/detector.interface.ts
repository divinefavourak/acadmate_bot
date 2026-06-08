import type { ChatSettings, DetectionReason } from '@prisma/client';
import type { DetectionResult, InspectedMessage } from '@/types';

/** Read-only context handed to every detector for a single message. */
export interface DetectorContext {
  settings: ChatSettings;
  /** Internal Chat.id (cuid). */
  dbChatId: string;
  /** Internal TgUser.id (cuid). */
  dbUserId: string;
}

/**
 * A single moderation heuristic. Implementations must be side-effect free
 * with respect to enforcement — they only decide whether a message is flagged.
 * Detectors MAY read from the database (e.g. flood/duplicate) but MUST NOT
 * mutate moderation state.
 */
export interface Detector {
  /** Stable identifier, used in logs. */
  readonly name: string;
  /** Reason recorded if this detector flags the message. */
  readonly reason: DetectionReason;
  /** Whether this detector is turned on for the given chat. */
  isEnabled(settings: ChatSettings): boolean;
  detect(message: InspectedMessage, ctx: DetectorContext): Promise<DetectionResult> | DetectionResult;
}

/** Convenience: a non-flagged result. */
export const PASS: DetectionResult = { flagged: false };
