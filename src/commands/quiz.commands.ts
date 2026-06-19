import { Composer } from 'telegraf';
import type { BotContext } from '@/types';
import type { Container } from '@/container';
import { commandArgs, requireAdmin } from '@/bot/helpers';
import { parseAnswers } from '@/utils/quiz-parse';
import { formatAnswerKey, formatLeaderboard } from '@/bot/quiz-format';

/**
 * Admin controls for the auto-graded quiz feature. Sessions start/grade
 * automatically (see quiz-handler.ts); these commands let the coach review and
 * correct the AI-generated key and read/close the session.
 *
 *   /quizkey                 — show the active session's answer key
 *   /setkey 31.D 32.C …      — override AI answers (AI can be wrong)
 *   /quizscores              — leaderboard for the active session
 *   /endquiz                 — close the session + post final results
 */
export function quizCommands(container: Container): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.command('quizkey', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const key = await container.quiz.answerKey(ctx.state.dbChatId!);
    if (!key) return void ctx.reply('ℹ️ No active quiz session right now.');
    await ctx.reply(formatAnswerKey(key), { parse_mode: 'Markdown' });
  });

  composer.command('setkey', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const overrides = parseAnswers(commandArgs(ctx).join(' '));
    if (overrides.size === 0) {
      return void ctx.reply('Usage: /setkey 31.D 32.C 33.B');
    }
    const updated = await container.quiz.setKey(ctx.state.dbChatId!, overrides);
    if (updated === null) return void ctx.reply('ℹ️ No active quiz session to update.');
    await ctx.reply(`✅ Updated ${updated} answer${updated === 1 ? '' : 's'} in the answer key.`);
  });

  composer.command(['quizscores', 'leaderboard'], async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const board = await container.quiz.scores(ctx.state.dbChatId!);
    if (!board) return void ctx.reply('ℹ️ No active quiz session right now.');
    await ctx.reply(formatLeaderboard(board), { parse_mode: 'Markdown' });
  });

  composer.command('endquiz', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const board = await container.quiz.closeActive(ctx.state.dbChatId!);
    if (!board) return void ctx.reply('ℹ️ No active quiz session to end.');
    await ctx.reply(formatLeaderboard(board, '🏁 Final Results'), { parse_mode: 'Markdown' });
  });

  return composer;
}
