import { Composer } from 'telegraf';
import type { BotContext } from '@/types';

/** /start and /help. Available to everyone. */
export function generalCommands(): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.start(async (ctx) => {
    await ctx.reply(
      'Hi! I am Acadmate — a moderation and tagging bot.\n' +
        'Add me to a group and promote me to admin (with ban/restrict/delete rights).\n' +
        'Use /help to see what I can do.',
    );
  });

  composer.help(async (ctx) => {
    await ctx.reply(
      [
        '*Moderation* (admins): /warn /unwarn /warns /mute /unmute /kick /ban /unban',
        '*Filters* (admins): /addword /delword /words /settings /set',
        '*Tagging*: /tagall /admins /tag <role> /roles',
        '*Roles* (admins): /createrole /addrole',
        '*Scheduling* (admins): /schedtag /unschedule',
        '*AI*: /ask <question> · /summarize [N] (admin) · /appeal <user> (admin)',
        '',
        'I automatically detect spam, flooding, duplicates, scam links, banned words,',
        'and use AI to catch context-aware toxicity, scams and harassment.',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  return composer;
}
