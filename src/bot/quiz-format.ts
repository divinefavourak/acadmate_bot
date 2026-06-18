import type { GradeResult, KeyEntry, LeaderboardRow } from '@/services/quiz.service';
import { escapeMarkdown } from '@/utils/markdown';

/**
 * Presentation helpers for the quiz feature. Kept in the transport layer (the bot
 * owns how things look) and separate from QuizService (which owns the data) so
 * the wording/emoji can change without touching grading logic. All output targets
 * Telegram legacy Markdown; user-controlled text (names) is escaped, and aligned
 * blocks use fenced code so punctuation never breaks formatting.
 */

const BAR_LEN = 10;

/** A student's auto-grade reply: score, a progress bar, and an encouraging tier. */
export function formatScore(result: GradeResult): string {
  const { score, total, unsolved } = result;
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
