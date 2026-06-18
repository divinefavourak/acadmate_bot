/**
 * Heuristic parsers for revision-quiz messages. These are pure functions over
 * plaintext so the quiz handler can classify every message cheaply (regex only)
 * and reserve the AI router for actually *solving* a confirmed question batch —
 * the same "cheap checks first, AI last" principle the moderation engine uses.
 *
 * Two shapes are recognised, matching how coaches run sessions in-chat:
 *   • Questions — a number, a prompt, and ≥2 lettered options:
 *         31.
 *         Which vitamin is produced when the skin is exposed to sunlight?
 *         A. Vitamin A
 *         B. Vitamin B            (the number may also sit inline: "31. Which…")
 *   • Answers  — lines of "<number>. <letter>" only:
 *         31. D
 *         32. C
 */

export type OptionKey = 'A' | 'B' | 'C' | 'D';

export interface ParsedQuestion {
  number: number;
  prompt: string;
  options: Partial<Record<OptionKey, string>>;
}

/**
 * A number that begins a block, capturing any inline trailing text. The `.`/`)`
 * separator is required so a prompt line that merely starts with a digit
 * (e.g. "2 + 2 equals?") is not mistaken for a new question header.
 */
const NUMBER_LINE = /^\s*(\d{1,3})[.)]\s*(.*)$/;
/** A lettered option line, e.g. "A. Vitamin A" or "B) Mombasa". */
const OPTION_LINE = /^\s*([A-Da-d])[.)]\s+(.+?)\s*$/;
/** A "<number><sep><letter>" answer pair, where the letter is standalone. */
const ANSWER_PAIR = /(\d{1,3})\s*[.)\-:]?\s*([A-Da-d])(?![A-Za-z])/g;
/** A bare answer token like "D" or "C." (used to ignore answers in the Q parser). */
const BARE_ANSWER = /^[A-Da-d][.)]?$/;

/**
 * Extract MCQ questions from a message. A block is kept only if it has a prompt
 * and at least two options, so stray numbers and answer lists are ignored.
 */
export function parseQuestions(text: string): ParsedQuestion[] {
  const lines = text.split(/\r?\n/);
  const questions: ParsedQuestion[] = [];
  let current: ParsedQuestion | null = null;

  const finalize = (): void => {
    if (current && current.prompt && Object.keys(current.options).length >= 2) {
      questions.push(current);
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const opt = OPTION_LINE.exec(line);
    if (opt && current) {
      current.options[opt[1].toUpperCase() as OptionKey] = opt[2].trim();
      continue;
    }

    const num = !opt ? NUMBER_LINE.exec(line) : null;
    if (num) {
      finalize();
      const rest = num[2].trim();
      current = {
        number: Number(num[1]),
        // An inline single letter ("31. D") is an answer, not a prompt.
        prompt: BARE_ANSWER.test(rest) ? '' : rest,
        options: {},
      };
      continue;
    }

    // A non-number, non-option line continues the prompt (handles the blank-line
    // layout where the prompt sits a line or two below its number).
    if (current && Object.keys(current.options).length === 0) {
      current.prompt = current.prompt ? `${current.prompt} ${line}` : line;
    }
  }

  finalize();
  return questions;
}

/**
 * Extract a map of `questionNumber → answerLetter` from a submission. A line is
 * accepted only when it consists entirely of "<number> <letter>" pairs (ignoring
 * separators/whitespace), so prose that merely contains a number and a letter
 * does not count. Handles both one-per-line and inline ("31.D 32.C") layouts.
 */
export function parseAnswers(text: string): Map<number, OptionKey> {
  const result = new Map<number, OptionKey>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || OPTION_LINE.test(line)) continue; // never count MCQ option lines

    const pairs: Array<[number, OptionKey]> = [];
    let leftover = line;
    ANSWER_PAIR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ANSWER_PAIR.exec(line)) !== null) {
      pairs.push([Number(m[1]), m[2].toUpperCase() as OptionKey]);
      leftover = leftover.replace(m[0], ' ');
    }

    // Reject the line unless what remains is only separators/whitespace.
    if (pairs.length === 0 || /[A-Za-z0-9]/.test(leftover)) continue;
    for (const [n, k] of pairs) result.set(n, k);
  }

  return result;
}

/**
 * Cheap classification used by the quiz handler. Questions take priority (an MCQ
 * block can contain number+letter substrings); any line that parses cleanly as
 * answer pairs counts, so a single-question quiz or an incremental "31. D" reply
 * is still graded. Stray chatter is already rejected by `parseAnswers` (a whole
 * line must reduce to answer pairs), and the grader stays silent when there is
 * no active session or no matching question — so a low threshold is safe here.
 */
export function classifyQuizMessage(text: string): 'questions' | 'answers' | 'none' {
  if (!text || !text.trim()) return 'none';
  if (parseQuestions(text).length > 0) return 'questions';
  if (parseAnswers(text).size >= 1) return 'answers';
  return 'none';
}
