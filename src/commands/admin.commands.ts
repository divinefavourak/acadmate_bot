import { Composer } from 'telegraf';
import { ModerationActionType, type Prisma } from '@prisma/client';
import type { BotContext } from '@/types';
import type { Container } from '@/container';
import { commandArgs, requireAdmin } from '@/bot/helpers';

/**
 * Per-chat configuration commands.
 *
 *   /settings                       — show current config
 *   /set <key> <value>              — change a setting
 *   /addword <pattern>              — add a banned word/pattern (admin)
 *   /delword <pattern>              — remove a banned word (admin)
 *   /words                          — list banned words
 */
export function adminCommands(container: Container): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.command('settings', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const s = ctx.state.settings!;
    await ctx.reply(
      [
        '⚙️ *Chat settings*',
        `spam: ${onOff(s.spamDetection)}  flood: ${onOff(s.floodDetection)}  duplicate: ${onOff(s.duplicateDetection)}`,
        `scamLinks: ${onOff(s.scamLinkDetection)}  bannedWords: ${onOff(s.bannedWordsFilter)}  ai: ${onOff(s.aiModeration)}`,
        `topic: ${s.topic ?? '(none)'}`,
        `flood: ${s.floodMaxMessages} msgs / ${s.floodWindowSeconds}s`,
        `duplicate window: ${s.duplicateWindowSeconds}s`,
        `warnThreshold: ${s.warnThreshold} → ${s.warnAction}`,
        `defaultMute: ${s.defaultMuteMinutes}m   deleteOnDetect: ${onOff(s.deleteOnDetect)}`,
        '',
        'Change with `/set <key> <value>` (e.g. `/set warnThreshold 5`).',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  composer.command('set', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const args = commandArgs(ctx);
    const key = args[0];
    // Join the remainder so free-text values like a topic can contain spaces.
    const value = args.slice(1).join(' ');
    if (!key || value === '') return void ctx.reply('Usage: /set <key> <value>');

    const data = buildSettingsPatch(key, value);
    if (!data) return void ctx.reply(`Unknown or invalid setting: ${key}`);

    await container.prisma.chatSettings.update({ where: { chatId: ctx.state.dbChatId! }, data });
    await ctx.reply(`✅ Updated ${key} = ${value}`);
  });

  composer.command('addword', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const pattern = commandArgs(ctx).join(' ').trim();
    if (!pattern) return void ctx.reply('Usage: /addword <word or /regex/>');

    const isRegex = pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2;
    const stored = isRegex ? pattern.slice(1, -1) : pattern;
    await container.prisma.bannedWord.upsert({
      where: { chatId_pattern: { chatId: ctx.state.dbChatId!, pattern: stored } },
      create: { chatId: ctx.state.dbChatId!, pattern: stored, isRegex },
      update: { isRegex },
    });
    container.bannedWords.invalidate(ctx.state.dbChatId!);
    await ctx.reply(`✅ Added banned ${isRegex ? 'pattern' : 'word'}: ${stored}`);
  });

  composer.command('delword', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const pattern = commandArgs(ctx).join(' ').trim();
    if (!pattern) return void ctx.reply('Usage: /delword <pattern>');
    const stripped = pattern.startsWith('/') && pattern.endsWith('/') ? pattern.slice(1, -1) : pattern;
    await container.prisma.bannedWord.deleteMany({
      where: { chatId: ctx.state.dbChatId!, pattern: stripped },
    });
    container.bannedWords.invalidate(ctx.state.dbChatId!);
    await ctx.reply(`🗑️ Removed: ${stripped}`);
  });

  composer.command('words', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const words = await container.prisma.bannedWord.findMany({
      where: { chatId: ctx.state.dbChatId! },
    });
    if (words.length === 0) return void ctx.reply('No banned words configured.');
    await ctx.reply(words.map((w) => `• ${w.pattern}${w.isRegex ? ' (regex)' : ''}`).join('\n'));
  });

  return composer;
}

function onOff(v: boolean): string {
  return v ? 'on' : 'off';
}

/** Validates and maps a settings key/value to a Prisma update payload. */
function buildSettingsPatch(key: string, value: string): Prisma.ChatSettingsUpdateInput | null {
  const bool = value === 'on' || value === 'true' || value === '1';
  const num = Number(value);

  switch (key) {
    case 'spamDetection':
      return { spamDetection: bool };
    case 'floodDetection':
      return { floodDetection: bool };
    case 'duplicateDetection':
      return { duplicateDetection: bool };
    case 'scamLinkDetection':
      return { scamLinkDetection: bool };
    case 'bannedWordsFilter':
      return { bannedWordsFilter: bool };
    case 'aiModeration':
      return { aiModeration: bool };
    case 'topic':
      // Free-text; `/set topic off` clears it.
      return { topic: value === 'off' || value === 'none' ? null : value };
    case 'deleteOnDetect':
      return { deleteOnDetect: bool };
    case 'floodMaxMessages':
      return Number.isFinite(num) ? { floodMaxMessages: Math.trunc(num) } : null;
    case 'floodWindowSeconds':
      return Number.isFinite(num) ? { floodWindowSeconds: Math.trunc(num) } : null;
    case 'duplicateWindowSeconds':
      return Number.isFinite(num) ? { duplicateWindowSeconds: Math.trunc(num) } : null;
    case 'warnThreshold':
      return Number.isFinite(num) ? { warnThreshold: Math.trunc(num) } : null;
    case 'defaultMuteMinutes':
      return Number.isFinite(num) ? { defaultMuteMinutes: Math.trunc(num) } : null;
    case 'warnAction': {
      const upper = value.toUpperCase();
      if (upper === 'MUTE' || upper === 'KICK' || upper === 'BAN') {
        return { warnAction: ModerationActionType[upper] };
      }
      return null;
    }
    default:
      return null;
  }
}
