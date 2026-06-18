import type { AiRouter } from '@/ai/ai-router';
import type { AiMessage } from '@/ai/ai.types';
import { AiUnavailableError } from '@/ai/ai.errors';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('ai-assistant');

export type AiModerationCategory =
  | 'SAFE'
  | 'SPAM'
  | 'SCAM'
  | 'TOXIC'
  | 'HARASSMENT'
  | 'OFF_TOPIC';

export interface AiModerationVerdict {
  category: AiModerationCategory;
  flagged: boolean;
  confidence: number; // 0..1
  reason: string;
}

export interface AppealRecommendation {
  recommendation: 'UPHOLD' | 'OVERTURN' | 'UNSURE';
  reason: string;
}

/**
 * High-level AI use-cases built on the failover router. Every method degrades
 * gracefully: if no provider is available, moderation returns SAFE (so the bot
 * falls back to heuristics) and the chat features return a friendly notice.
 */
export class AiAssistantService {
  // Short conversation memory for /ask, keyed by `${chatId}:${userId}`.
  private readonly conversations = new Map<string, { at: number; turns: AiMessage[] }>();
  private readonly convTtlMs = 15 * 60_000;
  private readonly maxTurns = 8; // 4 user/assistant exchanges
  private readonly maxConversations = 1000;

  constructor(private readonly router: AiRouter) {}

  get enabled(): boolean {
    return this.router.available;
  }

  /** Classify a single group message for moderation. Never throws. */
  async classifyMessage(text: string, chatTopic?: string): Promise<AiModerationVerdict> {
    const system =
      'You are a strict but fair Telegram group moderator. Classify the user message into exactly one category: ' +
      'SAFE, SPAM, SCAM, TOXIC, HARASSMENT, or OFF_TOPIC. ' +
      'SCAM = phishing, crypto/airdrop lures, fake giveaways. SPAM = unsolicited ads/self-promo/flooding. ' +
      'TOXIC = slurs, hate, severe profanity directed at people. HARASSMENT = targeted bullying/threats. ' +
      'OFF_TOPIC only if a group topic is provided and the message is clearly unrelated. ' +
      (chatTopic ? `The group topic is: "${chatTopic}". ` : '') +
      'Respond with ONLY a JSON object: {"category": "...", "confidence": 0.0-1.0, "reason": "<=120 chars"}. ' +
      'Be conservative: prefer SAFE unless reasonably confident.';

    try {
      const result = await this.router.complete({
        system,
        messages: [{ role: 'user', content: text.slice(0, 2000) }],
        json: true,
        temperature: 0,
        maxTokens: 200,
      });
      const parsed = extractJson<{ category?: string; confidence?: number; reason?: string }>(
        result.text,
      );
      const category = normaliseCategory(parsed?.category);
      const confidence = clamp01(parsed?.confidence ?? 0.5);
      return {
        category,
        flagged: category !== 'SAFE' && confidence >= 0.6,
        confidence,
        reason: (parsed?.reason ?? 'AI classification').slice(0, 200),
      };
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) log.warn({ err }, 'classifyMessage failed');
      return { category: 'SAFE', flagged: false, confidence: 0, reason: 'AI unavailable' };
    }
  }

  /**
   * Answer a member's question, with short multi-turn memory so follow-ups
   * keep context. `memoryKey` (chat+user) threads consecutive /ask calls;
   * `replyContext` seeds the prior bot message when a user replies to it.
   * Returns null when AI is unavailable.
   */
  async ask(
    question: string,
    opts?: { memoryKey?: string; replyContext?: string },
  ): Promise<string | null> {
    const history = opts?.memoryKey ? this.loadHistory(opts.memoryKey) : [];

    const messages: AiMessage[] = [];
    // If replying to a bot message that isn't already the last remembered turn,
    // seed it so the model has the thing the user is following up on.
    if (opts?.replyContext && history.at(-1)?.content !== opts.replyContext) {
      messages.push({ role: 'assistant', content: opts.replyContext.slice(0, 2000) });
    }
    messages.push(...history, { role: 'user', content: question.slice(0, 2000) });

    try {
      const result = await this.router.complete({
        system:
          'You are a concise, helpful assistant inside a Telegram group for an academic/student community. ' +
          'Answer in plain text (no markdown headings), under 120 words. Use the prior conversation for ' +
          'context when relevant. If unsure, say so briefly.',
        messages,
        temperature: 0.5,
        maxTokens: 400,
      });
      const answer = result.text.trim();
      if (opts?.memoryKey) {
        this.saveTurn(opts.memoryKey, question.slice(0, 2000), answer);
      }
      return answer;
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) log.warn({ err }, 'ask failed');
      return null;
    }
  }

  private loadHistory(key: string): AiMessage[] {
    const c = this.conversations.get(key);
    if (!c || Date.now() - c.at > this.convTtlMs) {
      this.conversations.delete(key);
      return [];
    }
    return c.turns;
  }

  private saveTurn(key: string, question: string, answer: string): void {
    // Re-read the latest stored history (not the caller's pre-request snapshot)
    // so two overlapping /ask calls for the same key don't drop each other's
    // turns — the second writer appends to whatever the first already saved.
    const current = this.loadHistory(key);
    const turns = [
      ...current,
      { role: 'user' as const, content: question },
      { role: 'assistant' as const, content: answer },
    ].slice(-this.maxTurns);

    // Refresh LRU position and evict the oldest conversation past the cap.
    this.conversations.delete(key);
    this.conversations.set(key, { at: Date.now(), turns });
    while (this.conversations.size > this.maxConversations) {
      const oldest = this.conversations.keys().next().value;
      if (oldest === undefined) break;
      this.conversations.delete(oldest);
    }
  }

  /** Summarise a transcript of recent messages. Returns null when unavailable. */
  async summarize(transcript: string): Promise<string | null> {
    if (!transcript.trim()) return 'Nothing to summarise yet.';
    try {
      const result = await this.router.complete({
        system:
          'Summarise this Telegram group chat transcript into 3-6 short bullet points capturing the key ' +
          'topics, decisions, and questions. Plain text, start each bullet with "• ". Be neutral and concise.',
        messages: [{ role: 'user', content: transcript.slice(0, 12_000) }],
        temperature: 0.3,
        maxTokens: 500,
      });
      return result.text.trim();
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) log.warn({ err }, 'summarize failed');
      return null;
    }
  }

  /**
   * Generate an answer key for a batch of multiple-choice questions. Returns a
   * map of `questionNumber → letter` ("A".."D"). Solves the whole batch in one
   * call to save quota. Like the other methods, never throws: an unavailable
   * provider (or unparseable output) yields an empty map so callers degrade to
   * "answer unknown" rather than crashing a grading flow.
   */
  async solveQuiz(
    questions: { number: number; prompt: string; options: Record<string, string> }[],
  ): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (questions.length === 0) return result;

    const rendered = questions
      .map((q) => {
        const opts = Object.entries(q.options)
          .map(([k, v]) => `${k}. ${v}`)
          .join('\n');
        return `${q.number}. ${q.prompt}\n${opts}`;
      })
      .join('\n\n');

    try {
      const completion = await this.router.complete({
        system:
          'You are an exam answer-key generator. For each multiple-choice question, pick the single ' +
          'correct option letter (A, B, C or D). Respond with ONLY a JSON array of ' +
          '{"number": <int>, "answer": "<A-D>"} — one entry per question, no prose.',
        messages: [{ role: 'user', content: rendered.slice(0, 12_000) }],
        json: true,
        temperature: 0,
        maxTokens: 1000,
      });
      const parsed = extractJsonArray<{ number?: number; answer?: string }>(completion.text);
      for (const item of parsed ?? []) {
        const n = Number(item?.number);
        const letter = (item?.answer ?? '').trim().toUpperCase();
        if (Number.isInteger(n) && /^[A-D]$/.test(letter)) result.set(n, letter);
      }
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) log.warn({ err }, 'solveQuiz failed');
    }
    return result;
  }

  /** Review a ban appeal given context. Advisory only — a human still decides. */
  async reviewAppeal(context: string): Promise<AppealRecommendation | null> {
    try {
      const result = await this.router.complete({
        system:
          'You review Telegram moderation ban appeals. Given the moderation history and the user\'s appeal, ' +
          'recommend whether to UPHOLD the ban, OVERTURN it, or mark UNSURE. You are advisory only; a human ' +
          'admin makes the final call. Respond with ONLY JSON: ' +
          '{"recommendation":"UPHOLD|OVERTURN|UNSURE","reason":"<=200 chars"}.',
        messages: [{ role: 'user', content: context.slice(0, 6000) }],
        json: true,
        temperature: 0.2,
        maxTokens: 250,
      });
      const parsed = extractJson<{ recommendation?: string; reason?: string }>(result.text);
      const rec = parsed?.recommendation?.toUpperCase();
      return {
        recommendation: rec === 'UPHOLD' || rec === 'OVERTURN' ? rec : 'UNSURE',
        reason: (parsed?.reason ?? 'No reason provided').slice(0, 300),
      };
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) log.warn({ err }, 'reviewAppeal failed');
      return null;
    }
  }
}

/** Tolerant JSON extraction — models sometimes wrap JSON in prose or fences. */
function extractJson<T>(text: string): T | null {
  const fenced = text.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Like `extractJson`, but for a top-level JSON array (the quiz answer key). */
function extractJsonArray<T>(text: string): T[] | null {
  const fenced = text.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function normaliseCategory(raw?: string): AiModerationCategory {
  const c = (raw ?? '').toUpperCase();
  const allowed: AiModerationCategory[] = [
    'SAFE',
    'SPAM',
    'SCAM',
    'TOXIC',
    'HARASSMENT',
    'OFF_TOPIC',
  ];
  return (allowed as string[]).includes(c) ? (c as AiModerationCategory) : 'SAFE';
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
