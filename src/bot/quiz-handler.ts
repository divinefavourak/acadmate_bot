import { MemberRole } from '@prisma/client';
import type { MiddlewareFn } from 'telegraf';
import type { BotContext } from '@/types';
import type { Container } from '@/container';
import { config } from '@/config';
import { classifyQuizMessage, parseQuestions, parseAnswers } from '@/utils/quiz-parse';
import { formatScore, formatCaptured } from './quiz-format';
import { replyRich } from './rich-reply';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('quiz-handler');

/**
 * Auto-detects revision-quiz activity on ordinary (non-command) messages and
 * runs the grading flow. Mounted after message capture and before the command
 * composers; always calls `next()` so the moderation pipeline still sees the
 * message.
 *
 * Trust boundary: only admins/owners (the coach) may define questions — a
 * student can't post a fake answer key. Grading is open to everyone.
 */
export function quizHandler(container: Container): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!config.QUIZ_GRADING_ENABLED) return next();

    const { dbChatId, dbUserId, actorRole } = ctx.state;
    const msg = ctx.message;
    if (!dbChatId || !dbUserId || !msg) return next();

    const text = 'text' in msg ? msg.text : 'caption' in msg ? msg.caption : undefined;
    if (!text || text.startsWith('/')) return next();

    try {
      const kind = classifyQuizMessage(text);

      if (kind === 'questions') {
        const isCoach = actorRole === MemberRole.ADMIN || actorRole === MemberRole.OWNER;
        if (isCoach) {
          const numbers = await container.quiz.ingestQuestions(dbChatId, parseQuestions(text));
          if (numbers.length > 0) {
            await ctx.reply(formatCaptured(numbers), { parse_mode: 'Markdown' });
          }
        }
      } else if (kind === 'answers') {
        const result = await container.quiz.gradeSubmission(dbChatId, dbUserId, parseAnswers(text));
        if (result) {
          await replyRich(ctx, formatScore(result), { replyToMessageId: msg.message_id });
        }
      }
    } catch (err) {
      log.error({ err }, 'quiz handler error');
    }

    return next();
  };
}
