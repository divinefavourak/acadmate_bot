import { DetectionReason, type ChatSettings } from '@prisma/client';
import type { DetectionResult, InspectedMessage } from '@/types';
import { PASS, type Detector } from '../detector.interface';

/**
 * Heuristic spam scoring. Rather than a single rule, we accumulate a score
 * across several signals and flag once it crosses a threshold. This is more
 * resilient than any single check and easy to tune.
 *
 * Signals: excessive links, excessive @mentions, ALL-CAPS shouting,
 * emoji flooding, and Telegram join-link spam (t.me/+invite, joinchat).
 */
export class SpamDetector implements Detector {
  public readonly name = 'spam';
  public readonly reason = DetectionReason.SPAM;

  private readonly threshold = 3;

  isEnabled(settings: ChatSettings): boolean {
    return settings.spamDetection;
  }

  detect(message: InspectedMessage): DetectionResult {
    const text = message.text ?? '';
    if (text.length === 0) return PASS;

    let score = 0;
    const reasons: string[] = [];

    const linkCount = countLinks(text, message.entities);
    if (linkCount >= 3) {
      score += 2;
      reasons.push(`${linkCount} links`);
    } else if (linkCount === 2) {
      score += 1;
    }

    const mentionCount = (text.match(/@\w{3,}/g) ?? []).length;
    if (mentionCount >= 5) {
      score += 2;
      reasons.push(`${mentionCount} mentions`);
    }

    if (isShouting(text)) {
      score += 1;
      reasons.push('all-caps');
    }

    const emojiCount = countEmoji(text);
    if (emojiCount >= 10) {
      score += 1;
      reasons.push(`${emojiCount} emoji`);
    }

    if (/t\.me\/(?:\+|joinchat\/)/i.test(text)) {
      score += 2;
      reasons.push('telegram invite link');
    }

    if (score >= this.threshold) {
      return {
        flagged: true,
        reason: this.reason,
        details: `Spam score ${score} (${reasons.join(', ')})`,
        severity: score >= 5 ? 2 : 1,
      };
    }
    return PASS;
  }
}

function countLinks(text: string, entities: InspectedMessage['entities']): number {
  const entityLinks = entities.filter((e) => e.type === 'url' || e.type === 'text_link').length;
  const textLinks = (text.match(/https?:\/\//gi) ?? []).length;
  return Math.max(entityLinks, textLinks);
}

function isShouting(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.8;
}

function countEmoji(text: string): number {
  // Covers most emoji code points without a heavyweight dependency.
  const matches = text.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}]/gu);
  return matches?.length ?? 0;
}
