import { DetectionReason, type ChatSettings } from '@prisma/client';
import type { Database } from '@/database/prisma.client';
import type { DetectionResult, InspectedMessage } from '@/types';
import { normalizeText } from '@/utils/hash';
import { PASS, type Detector, type DetectorContext } from '../detector.interface';

/**
 * Flags messages containing any of the chat's banned words/patterns.
 *
 * Banned words are cached in-memory per chat with a short TTL so we don't hit
 * the DB on every single message — a hot path in busy groups.
 */
export class BannedWordsDetector implements Detector {
  public readonly name = 'banned-words';
  public readonly reason = DetectionReason.BANNED_WORD;

  private readonly cache = new Map<string, { fetchedAt: number; entries: CompiledPattern[] }>();
  private readonly ttlMs = 30_000;

  constructor(private readonly db: Database) {}

  isEnabled(settings: ChatSettings): boolean {
    return settings.bannedWordsFilter;
  }

  async detect(message: InspectedMessage, ctx: DetectorContext): Promise<DetectionResult> {
    if (!message.text) return PASS;
    const patterns = await this.getPatterns(ctx.dbChatId);
    if (patterns.length === 0) return PASS;

    const haystack = normalizeText(message.text);
    for (const p of patterns) {
      if (p.test(haystack)) {
        return {
          flagged: true,
          reason: this.reason,
          details: `Matched banned pattern: ${p.label}`,
          severity: 1,
        };
      }
    }
    return PASS;
  }

  /** Invalidate the cache for a chat after an admin edits the word list. */
  invalidate(dbChatId: string): void {
    this.cache.delete(dbChatId);
  }

  private async getPatterns(dbChatId: string): Promise<CompiledPattern[]> {
    const cached = this.cache.get(dbChatId);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.entries;
    }

    const rows = await this.db.bannedWord.findMany({ where: { chatId: dbChatId } });
    const entries = rows.map((r) => compile(r.pattern, r.isRegex));
    this.cache.set(dbChatId, { fetchedAt: Date.now(), entries });
    return entries;
  }
}

interface CompiledPattern {
  label: string;
  test(haystack: string): boolean;
}

function compile(pattern: string, isRegex: boolean): CompiledPattern {
  if (isRegex) {
    try {
      const re = new RegExp(pattern, 'iu');
      return { label: pattern, test: (h) => re.test(h) };
    } catch {
      // A malformed admin regex must never crash the pipeline — fall back to literal.
      const literal = normalizeText(pattern);
      return { label: pattern, test: (h) => h.includes(literal) };
    }
  }
  const literal = normalizeText(pattern);
  // Word-boundary-ish match to avoid flagging substrings inside larger words.
  return {
    label: pattern,
    test: (h) => new RegExp(`(?:^|\\W)${escapeRegExp(literal)}(?:$|\\W)`, 'iu').test(` ${h} `),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
