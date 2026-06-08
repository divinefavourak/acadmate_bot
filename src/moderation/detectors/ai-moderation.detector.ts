import { DetectionReason, type ChatSettings } from '@prisma/client';
import { config } from '@/config';
import type { DetectionResult, InspectedMessage } from '@/types';
import type { AiAssistantService, AiModerationCategory } from '@/services/ai-assistant.service';
import { contentHash } from '@/utils/hash';
import { PASS, type Detector, type DetectorContext } from '../detector.interface';

/**
 * Context-aware moderation via the AI failover router. Runs LAST and only on
 * messages worth the spend (long enough, or carrying links / many mentions),
 * with a short verdict cache so repeats are free. Degrades to PASS whenever AI
 * is unavailable, so the bot keeps working on heuristics alone.
 */
export class AiModerationDetector implements Detector {
  public readonly name = 'ai-moderation';
  public readonly reason = DetectionReason.SPAM; // overridden per-result

  private readonly cache = new Map<string, { at: number; result: DetectionResult }>();
  private readonly cacheTtlMs = 5 * 60_000;

  constructor(private readonly ai: AiAssistantService) {}

  isEnabled(settings: ChatSettings): boolean {
    return settings.aiModeration && config.AI_MODERATION_ENABLED && this.ai.enabled;
  }

  async detect(message: InspectedMessage, ctx: DetectorContext): Promise<DetectionResult> {
    const text = message.text?.trim() ?? '';
    if (!this.worthChecking(text, message)) return PASS;

    const key = contentHash(text);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached.result;

    const verdict = await this.ai.classifyMessage(text, ctx.settings.topic ?? undefined);
    const result: DetectionResult = verdict.flagged
      ? {
          flagged: true,
          reason: mapCategory(verdict.category),
          details: `AI: ${verdict.category} (${Math.round(verdict.confidence * 100)}%) — ${verdict.reason}`,
          severity: verdict.confidence >= 0.85 ? 2 : 1,
        }
      : PASS;

    this.cache.set(key, { at: Date.now(), result });
    return result;
  }

  /** Cheap pre-filter so we don't spend an API call on trivial messages. */
  private worthChecking(text: string, message: InspectedMessage): boolean {
    if (text.length === 0) return false;
    if (text.length >= config.AI_MODERATION_MIN_LENGTH) return true;
    const hasLink = message.entities.some((e) => e.type === 'url' || e.type === 'text_link');
    const manyMentions = (text.match(/@\w{3,}/g) ?? []).length >= 3;
    return hasLink || manyMentions;
  }
}

function mapCategory(category: AiModerationCategory): DetectionReason {
  switch (category) {
    case 'SCAM':
      return DetectionReason.SCAM_LINK;
    case 'TOXIC':
      return DetectionReason.TOXICITY;
    case 'HARASSMENT':
      return DetectionReason.HARASSMENT;
    case 'OFF_TOPIC':
      return DetectionReason.OFF_TOPIC;
    case 'SPAM':
    default:
      return DetectionReason.SPAM;
  }
}
