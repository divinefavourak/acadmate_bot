import type { BotContext } from '@/types';
import { splitMathSegments, prettifyMath, codecogsUrl } from '@/utils/math-render';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('rich-reply');

/**
 * Reply with math-aware rendering: inline math is prettified to Unicode, and any
 * display block ($$…$$ / \[…\]) is sent as a rendered image (CodeCogs), since
 * Telegram can't show LaTeX and can't embed an image mid-text. Falls back to
 * monospace if image rendering fails, so a renderer outage never drops content.
 *
 * Text segments keep `parse_mode: Markdown`; the prettifier is Markdown-safe.
 * Only the first text message threads as a reply (avoids repeated quote blocks).
 */
export async function replyRich(
  ctx: BotContext,
  text: string,
  opts?: { replyToMessageId?: number },
): Promise<void> {
  const segments = splitMathSegments(text);
  let replyTo = opts?.replyToMessageId;

  for (const segment of segments) {
    if (segment.type === 'math') {
      try {
        await ctx.replyWithPhoto({ url: codecogsUrl(segment.content) });
      } catch (err) {
        log.warn({ err }, 'math image render failed; sending raw LaTeX');
        await ctx.reply('```\n' + segment.content + '\n```', { parse_mode: 'Markdown' });
      }
      continue;
    }

    const pretty = prettifyMath(segment.content).trim();
    if (!pretty) continue;
    await ctx.reply(pretty, {
      parse_mode: 'Markdown',
      ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
    });
    replyTo = undefined;
  }
}
