import type {
  ExplanationEntry,
  GradeResult,
  KeyEntry,
  LeaderboardRow,
} from '@/services/quiz.service';
import { escapeMarkdown } from '@/utils/markdown';

/** Max wrong-answer reviews shown inline on a score reply (keeps it under 4096). */
const MAX_INLINE_REVIEW = 12;
/** Soft per-message character budget for chunked output. */
const CHUNK_BUDGET = 3900;

/**
 * Presentation helpers for the quiz feature. Kept in the transport layer (the bot
 * owns how things look) and separate from QuizService (which owns the data) so
 * the wording/emoji can change without touching grading logic. All output targets
 * Telegram legacy Markdown; user-controlled text (names) is escaped, and aligned
 * blocks use fenced code so punctuation never breaks formatting.
 */

const BAR_LEN = 10;

/**
 * A student's auto-grade reply: score, a progress bar, an encouraging tier, and
 * a review of the questions they got wrong (correct answer + short rationale).
 */
export function formatScore(result: GradeResult): string {
  const { score, total, unsolved, missed } = result;
  if (total === 0) {
    return "⚠️ I couldn't grade that yet — the answer key isn't ready. Try again in a moment.";
  }
  const pct = Math.round((score / total) * 100);
  const filled = Math.round((score / total) * BAR_LEN);
  const bar = '🟩'.repeat(filled) + '⬜'.repeat(BAR_LEN - filled);

  const lines = [`📊 *Quiz Score:* ${score}/${total} · ${pct}%`, bar, tier(pct)];
  if (unsolved > 0) {
    const s = unsolved === 1 ? '' : 's';
    lines.push(`⚠️ ${unsolved} question${s} couldn't be graded (no answer key).`);
  }

  if (missed.length > 0) {
    lines.push('', '📚 *Review:*');
    for (const m of missed.slice(0, MAX_INLINE_REVIEW)) {
      const text = m.correctText ? `. ${escapeMarkdown(m.correctText)}` : '';
      lines.push(`❌ ${m.number} → *${m.correct}*${text}`);
      if (m.explanation) lines.push(`   _${escapeMarkdown(m.explanation)}_`);
    }
    const extra = missed.length - MAX_INLINE_REVIEW;
    if (extra > 0) lines.push(`…and ${extra} more — ask an admin for /explain.`);
  }
  return lines.join('\n');
}

function tier(pct: number): string {
  if (pct === 100) return '🏆 Perfect score!';
  if (pct >= 80) return '🌟 Excellent!';
  if (pct >= 60) return '👍 Good effort!';
  if (pct >= 40) return '📚 Keep practising!';
  return '💪 Don’t give up — review and retry!';
}

/** Confirmation posted when the coach's question batch is captured. */
export function formatCaptured(numbers: number[]): string {
  if (numbers.length === 0) return '';
  const sorted = [...numbers].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const range = lo === hi ? `${lo}` : `${lo}–${hi}`;
  const s = numbers.length === 1 ? '' : 's';
  return (
    `🧠 *Quiz on!* Captured ${numbers.length} question${s} (${range}).\n` +
    "Reply with your answers — e.g. `31. D` — and I'll grade you automatically. ✍️"
  );
}

/** The answer key as an aligned, monospaced block. */
export function formatAnswerKey(entries: KeyEntry[]): string {
  if (entries.length === 0) return 'ℹ️ No questions captured in the active session yet.';
  const body = entries
    .map((e) => `${String(e.number).padStart(3)}  →  ${e.correct ?? '— (solving…)'}`)
    .join('\n');
  return `🔑 *Answer key* — active session\n\`\`\`\n${body}\n\`\`\``;
}

/** A medal-ranked leaderboard. */
export function formatLeaderboard(rows: LeaderboardRow[], title = '🏆 Leaderboard'): string {
  if (rows.length === 0) return 'ℹ️ No submissions to score yet.';
  const medals = ['🥇', '🥈', '🥉'];
  const body = rows
    .map((r, i) => `${medals[i] ?? `${i + 1}.`} ${escapeMarkdown(r.label)} — ${r.score}/${r.total}`)
    .join('\n');
  return `*${title}*\n${body}`;
}

/**
 * Full per-question explanations, split into one or more messages so a long
 * session never exceeds Telegram's 4096-char limit.
 */
export function formatExplanations(entries: ExplanationEntry[]): string[] {
  if (entries.length === 0) return ['ℹ️ No questions captured in the active session yet.'];
  const blocks = entries.map((e) => {
    const head = `*${e.number}.* ${escapeMarkdown(e.prompt)}`;
    const answer = e.correct
      ? `✅ *${e.correct}*${e.correctText ? `. ${escapeMarkdown(e.correctText)}` : ''}`
      : '⬜ _not solved yet_';
    const why = e.explanation ? `\n${escapeMarkdown(e.explanation)}` : '';
    return `${head}\n${answer}${why}`;
  });
  return chunkBlocks(blocks, '📖 *Explanations — active session*');
}

/** Pack blocks into the fewest messages that stay under the char budget. */
function chunkBlocks(blocks: string[], title: string): string[] {
  const messages: string[] = [];
  let current = title;
  const flush = (): void => {
    if (current.trim()) messages.push(current);
    current = '';
  };
  for (const block of blocks) {
    // Hard-split a single block that on its own exceeds the budget, so no
    // message can ever exceed Telegram's limit.
    for (const piece of hardWrap(block, CHUNK_BUDGET)) {
      if (current && current.length + piece.length + 2 > CHUNK_BUDGET) flush();
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  flush();
  return messages.length > 0 ? messages : [title];
}

/** Split an over-long string into <= max-length pieces. */
function hardWrap(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += max) pieces.push(text.slice(i, i + max));
  return pieces;
}
