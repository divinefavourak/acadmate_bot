import type { BotContext } from '@/types';
import { splitMathSegments, prettifyMath, codecogsUrl } from '@/utils/math-render';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('rich-reply');

export interface RichReplyOptions {
  replyToMessageId?: number;
  /**
   * Only set 'Markdown' for callers that build CONTROLLED markup (and escape
   * user/AI text with escapeMarkdown). Raw model output (/ask, /summarize) must
   * be left plain, or Telegram rejects the whole message on an unbalanced `_`,
   * backtick, or bracket.
   */
  parseMode?: 'Markdown';
}

/**
 * Reply with math-aware rendering: inline math is prettified to Unicode, and any
 * display block ($$…$$ / \[…\]) is sent as a rendered image (CodeCogs), since
 * Telegram can't show LaTeX and can't embed an image mid-text. Falls back to
 * prettified plain text if image rendering fails, so a renderer outage never
 * drops content. Only the first message threads as a reply.
 */
export async function replyRich(
  ctx: BotContext,
  text: string,
  opts?: RichReplyOptions,
): Promise<void> {
  const segments = splitMathSegments(text);
  let replyTo = opts?.replyToMessageId;

  const threadExtra = (): { reply_parameters: { message_id: number } } | undefined =>
    replyTo ? { reply_parameters: { message_id: replyTo } } : undefined;

  for (const segment of segments) {
    if (segment.type === 'math') {
      try {
        await ctx.replyWithPhoto({ url: codecogsUrl(segment.content) }, threadExtra());
      } catch (err) {
        log.warn({ err }, 'math image render failed; sending prettified text');
        await ctx.reply(prettifyMath(segment.content).trim() || segment.content, threadExtra());
      }
      replyTo = undefined;
      continue;
    }

    const pretty = prettifyMath(segment.content).trim();
    if (!pretty) continue;
    await ctx.reply(pretty, {
      ...(opts?.parseMode ? { parse_mode: opts.parseMode } : {}),
      ...threadExtra(),
    });
    replyTo = undefined;
  }
}
