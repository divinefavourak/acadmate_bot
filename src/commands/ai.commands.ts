import { Composer } from 'telegraf';
import type { BotContext } from '@/types';
import type { Container } from '@/container';
import { commandArgs, requireAdmin, resolveTarget } from '@/bot/helpers';
import { escapeMarkdown } from '@/utils/markdown';

/**
 * AI-powered commands, all backed by the failover router.
 *
 *   /ask <question>        — anyone; answers via AI
 *   /summarize [N]         — admin; TL;DR of the last N messages (default 50)
 *   /appeal <user>         — admin; AI review of a ban with a recommendation
 */
export function aiCommands(container: Container): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.command('ask', async (ctx) => {
    if (!container.ai.enabled) {
      return void ctx.reply('🤖 AI features are not configured right now.');
    }
    const question = commandArgs(ctx).join(' ').trim();
    if (!question) return void ctx.reply('Usage: /ask <your question>');

    // Thread follow-ups per user+chat, and seed context if replying to a message.
    const memoryKey = `${ctx.chat!.id}:${ctx.from!.id}`;
    const reply = ctx.message && 'reply_to_message' in ctx.message ? ctx.message.reply_to_message : undefined;
    const replyContext =
      reply && 'text' in reply && reply.text ? reply.text : undefined;

    await ctx.sendChatAction('typing').catch(() => undefined);
    const answer = await container.ai.ask(question, { memoryKey, replyContext });
    await ctx.reply(answer ?? '🤖 Sorry, all AI providers are busy. Try again shortly.', {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
  });

  composer.command(['summarize', 'summarise'], async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    if (!container.ai.enabled) {
      return void ctx.reply('🤖 AI features are not configured right now.');
    }
    const n = Number(commandArgs(ctx)[0]);
    const count = Number.isFinite(n) ? Math.min(300, Math.max(5, n)) : 50;

    const transcript = container.messageBuffer.transcript(ctx.state.dbChatId!, count);
    if (!transcript) {
      return void ctx.reply('Nothing recent to summarise yet — I only see messages since I started.');
    }

    await ctx.sendChatAction('typing').catch(() => undefined);
    const summary = await container.ai.summarize(transcript);
    await ctx.reply(summary ?? '🤖 Sorry, all AI providers are busy. Try again shortly.');
  });

  composer.command('appeal', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    if (!container.ai.enabled) {
      return void ctx.reply('🤖 AI features are not configured right now.');
    }
    const resolved = await resolveTarget(ctx, container, commandArgs(ctx));
    if ('error' in resolved) return void ctx.reply(resolved.error);

    // Gather context: recent moderation log + warnings for this user/chat.
    const [logs, warnings] = await Promise.all([
      container.prisma.moderationLog.findMany({
        where: { chatId: ctx.state.dbChatId!, targetId: resolved.target.dbUserId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      container.warnings.list(ctx.state.dbChatId!, resolved.target.dbUserId),
    ]);

    const contextText = [
      `User: ${resolved.target.label}`,
      `Active/again warnings: ${warnings.length}`,
      'Moderation history (most recent first):',
      ...logs.map((l) => `- ${l.action}/${l.reason}: ${l.details ?? ''}`),
      ...warnings.map((w) => `- WARN/${w.detection}: ${w.reason}`),
    ].join('\n');

    await ctx.sendChatAction('typing').catch(() => undefined);
    const review = await container.ai.reviewAppeal(contextText);
    if (!review) {
      return void ctx.reply('🤖 Sorry, all AI providers are busy. Try again shortly.');
    }
    await ctx.reply(
      `🧑‍⚖️ AI recommendation for ${escapeMarkdown(resolved.target.label)}: *${review.recommendation}*\n${escapeMarkdown(review.reason)}\n\n_Advisory only — your decision stands._`,
      { parse_mode: 'Markdown' },
    );
  });

  return composer;
}
