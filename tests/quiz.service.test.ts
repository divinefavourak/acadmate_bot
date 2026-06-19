/* eslint-disable @typescript-eslint/no-explicit-any -- the in-memory Prisma fake
   mirrors many query-arg shapes; precise typing here would dwarf the test. */
import { describe, expect, it, beforeEach } from 'vitest';
import { QuizService } from '@/services/quiz.service';
import type { Database } from '@/database/prisma.client';
import type { AiAssistantService } from '@/services/ai-assistant.service';
import type { OptionKey } from '@/utils/quiz-parse';

/**
 * Minimal in-memory stand-in for the slice of PrismaClient QuizService touches.
 * Enough to exercise ingest → solve → grade → leaderboard without a database.
 */
function fakeDb() {
  type Session = {
    id: string;
    chatId: string;
    status: string;
    startedAt: number;
    lastQuestionAt: Date;
    closedAt: Date | null;
  };
  type Question = {
    id: string;
    sessionId: string;
    number: number;
    prompt: string;
    options: unknown;
    correct: string | null;
    explanation: string | null;
  };
  type Submission = {
    id: string;
    sessionId: string;
    userId: string;
    answers: unknown;
    score: number;
    total: number;
    createdAt: number;
  };

  const sessions: Session[] = [];
  const questions: Question[] = [];
  const submissions: Submission[] = [];
  const users: Record<string, { username: string | null; firstName: string | null; telegramId: bigint }> = {};
  let seq = 0;
  let clock = 0;
  const id = (): string => `id${++seq}`;

  const db = {
    sessions,
    questions,
    submissions,
    users,
    quizSession: {
      findFirst: async ({ where }: any) => {
        const rows = sessions
          .filter((s) => s.chatId === where.chatId && s.status === where.status)
          .sort((a, b) => b.startedAt - a.startedAt);
        return rows[0] ?? null;
      },
      create: async ({ data }: any) => {
        const s: Session = {
          id: id(),
          chatId: data.chatId,
          status: 'ACTIVE',
          startedAt: ++clock,
          lastQuestionAt: new Date(),
          closedAt: null,
        };
        sessions.push(s);
        return s;
      },
      update: async ({ where, data }: any) => {
        const s = sessions.find((x) => x.id === where.id)!;
        Object.assign(s, data);
        return s;
      },
    },
    quizQuestion: {
      upsert: async ({ where, create, update }: any) => {
        const existing = questions.find(
          (q) => q.sessionId === where.sessionId_number.sessionId && q.number === where.sessionId_number.number,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const q: Question = { id: id(), correct: null, explanation: null, ...create };
        questions.push(q);
        return q;
      },
      findMany: async ({ where, orderBy }: any) => {
        let rows = questions.filter((q) => q.sessionId === where.sessionId);
        if (where.correct === null) rows = rows.filter((q) => q.correct === null);
        if (where.number?.in) rows = rows.filter((q) => where.number.in.includes(q.number));
        if (orderBy?.number === 'asc') rows = [...rows].sort((a, b) => a.number - b.number);
        return rows;
      },
      update: async ({ where, data }: any) => {
        const q = questions.find((x) => x.id === where.id)!;
        Object.assign(q, data);
        return q;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = questions.filter((q) => q.sessionId === where.sessionId && q.number === where.number);
        rows.forEach((q) => Object.assign(q, data));
        return { count: rows.length };
      },
    },
    quizSubmission: {
      create: async ({ data }: any) => {
        const s: Submission = { id: id(), createdAt: ++clock, ...data };
        submissions.push(s);
        return s;
      },
      findMany: async ({ where, include }: any) => {
        const rows = submissions
          .filter((s) => s.sessionId === where.sessionId)
          .sort((a, b) => b.createdAt - a.createdAt);
        return include?.user ? rows.map((s) => ({ ...s, user: users[s.userId] })) : rows;
      },
      update: async ({ where, data }: any) => {
        const s = submissions.find((x) => x.id === where.id)!;
        Object.assign(s, data);
        return s;
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  return db;
}

/** AI stub returning a fixed answer key (+ optional explanations). Empty = AI unavailable. */
function fakeAi(
  key: Record<number, string>,
  explanations: Record<number, string> = {},
): AiAssistantService {
  return {
    solveQuiz: async (qs: { number: number }[]) => {
      const m = new Map<number, { answer: string; explanation: string }>();
      for (const q of qs) {
        if (key[q.number]) m.set(q.number, { answer: key[q.number], explanation: explanations[q.number] ?? '' });
      }
      return m;
    },
  } as unknown as AiAssistantService;
}

const QUESTIONS = [
  { number: 31, prompt: 'Q31', options: { A: 'a', B: 'b', C: 'c', D: 'd' } },
  { number: 32, prompt: 'Q32', options: { A: 'a', B: 'b', C: 'c', D: 'd' } },
];

function answers(pairs: Record<number, OptionKey>): Map<number, OptionKey> {
  return new Map(Object.entries(pairs).map(([n, a]) => [Number(n), a]));
}

describe('QuizService grading', () => {
  let db: ReturnType<typeof fakeDb>;

  beforeEach(() => {
    db = fakeDb();
    db.users['u1'] = { username: 'ada', firstName: 'Ada', telegramId: 1n };
    db.users['u2'] = { username: null, firstName: 'Ben', telegramId: 2n };
  });

  it('grades a submission against the AI answer key', async () => {
    const svc = new QuizService(db as unknown as Database, fakeAi({ 31: 'D', 32: 'C' }));
    await svc.ingestQuestions('chat', QUESTIONS);

    const result = await svc.gradeSubmission('chat', 'u1', answers({ 31: 'D', 32: 'B' }));
    expect(result).toEqual({
      score: 1,
      total: 2,
      unsolved: 0,
      missed: [{ number: 32, correct: 'C', correctText: 'c', explanation: null }],
    });
  });

  it('only grades questions the student actually answered', async () => {
    const svc = new QuizService(db as unknown as Database, fakeAi({ 31: 'D', 32: 'C' }));
    await svc.ingestQuestions('chat', QUESTIONS);

    const result = await svc.gradeSubmission('chat', 'u1', answers({ 31: 'D' }));
    expect(result).toEqual({ score: 1, total: 1, unsolved: 0, missed: [] });
  });

  it('reports unsolved questions when the AI could not answer', async () => {
    const svc = new QuizService(db as unknown as Database, fakeAi({})); // AI returns nothing
    await svc.ingestQuestions('chat', QUESTIONS);

    const result = await svc.gradeSubmission('chat', 'u1', answers({ 31: 'A', 32: 'B' }));
    expect(result).toEqual({ score: 0, total: 0, unsolved: 2, missed: [] });
  });

  it('returns the correct answer + explanation for missed questions', async () => {
    const svc = new QuizService(
      db as unknown as Database,
      fakeAi({ 31: 'D', 32: 'C' }, { 32: 'Nairobi is the capital of Kenya.' }),
    );
    await svc.ingestQuestions('chat', QUESTIONS);

    const result = await svc.gradeSubmission('chat', 'u1', answers({ 31: 'D', 32: 'B' }));
    expect(result?.missed).toEqual([
      { number: 32, correct: 'C', correctText: 'c', explanation: 'Nairobi is the capital of Kenya.' },
    ]);
  });

  it('exposes per-question explanations for /explain', async () => {
    const svc = new QuizService(
      db as unknown as Database,
      fakeAi({ 31: 'D', 32: 'C' }, { 31: 'Vitamin D from sunlight.' }),
    );
    await svc.ingestQuestions('chat', QUESTIONS);

    const entries = await svc.explanations('chat');
    expect(entries).toHaveLength(2);
    expect(entries?.[0]).toEqual({
      number: 31,
      prompt: 'Q31',
      correct: 'D',
      correctText: 'd',
      explanation: 'Vitamin D from sunlight.',
    });
  });

  it('returns null when no quiz session is active', async () => {
    const svc = new QuizService(db as unknown as Database, fakeAi({ 31: 'D' }));
    const result = await svc.gradeSubmission('chat', 'u1', answers({ 31: 'D' }));
    expect(result).toBeNull();
  });

  it('builds a leaderboard sorted by score', async () => {
    const svc = new QuizService(db as unknown as Database, fakeAi({ 31: 'D', 32: 'C' }));
    await svc.ingestQuestions('chat', QUESTIONS);
    await svc.gradeSubmission('chat', 'u1', answers({ 31: 'D', 32: 'C' })); // 2/2
    await svc.gradeSubmission('chat', 'u2', answers({ 31: 'A', 32: 'C' })); // 1/2

    const board = await svc.scores('chat');
    expect(board).toEqual([
      { label: '@ada', score: 2, total: 2 },
      { label: 'Ben', score: 1, total: 2 },
    ]);
  });

  it('lets an admin override the answer key (/setkey)', async () => {
    const svc = new QuizService(db as unknown as Database, fakeAi({ 31: 'D', 32: 'C' }));
    await svc.ingestQuestions('chat', QUESTIONS);

    const updated = await svc.setKey('chat', answers({ 31: 'A' }));
    expect(updated).toBe(1);

    const result = await svc.gradeSubmission('chat', 'u1', answers({ 31: 'A', 32: 'C' }));
    expect(result).toEqual({ score: 2, total: 2, unsolved: 0, missed: [] });
  });

  it('re-grades already-submitted answers after /setkey', async () => {
    const svc = new QuizService(db as unknown as Database, fakeAi({ 31: 'D', 32: 'C' }));
    await svc.ingestQuestions('chat', QUESTIONS);

    // Student submits before the coach corrects a wrong AI answer.
    await svc.gradeSubmission('chat', 'u1', answers({ 31: 'A', 32: 'C' })); // 1/2 vs AI key
    await svc.setKey('chat', answers({ 31: 'A' })); // coach fixes Q31

    const board = await svc.scores('chat');
    expect(board).toEqual([{ label: '@ada', score: 2, total: 2 }]); // recomputed
  });

  it('does not persist an AI answer that is not one of the options', async () => {
    // AI returns "C" but the captured question only has options A and B.
    const partial = [{ number: 41, prompt: 'Q41', options: { A: 'a', B: 'b' } }];
    const svc = new QuizService(db as unknown as Database, fakeAi({ 41: 'C' }));
    await svc.ingestQuestions('chat', partial);

    const result = await svc.gradeSubmission('chat', 'u1', answers({ 41: 'A' }));
    expect(result).toEqual({ score: 0, total: 0, unsolved: 1, missed: [] }); // stayed unsolved
  });
});
