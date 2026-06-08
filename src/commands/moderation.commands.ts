import { Composer } from 'telegraf';
import { ModerationActionType, DetectionReason } from '@prisma/client';
import type { BotContext } from '@/types';
import type { Container } from '@/container';
import { commandArgs, requireAdmin, resolveTarget } from '@/bot/helpers';
import { formatDuration } from '@/utils/time';

/**
 * Manual moderation commands. Every command funnels through the same services
 * the automated pipeline uses, so manual and automated actions are logged and
 * enforced identically.
 *
 *   /warn   <user> [reason]
 *   /unwarn <user>
 *   /mute   <user> [minutes] [reason]
 *   /unmute <user>
 *   /kick   <user>
 *   /ban    <user> [reason]
 *   /unban  <user>
 *   /warns  <user>
 */
export function moderationCommands(container: Container): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.command('warn', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const args = commandArgs(ctx);
    const resolved = await resolveTarget(ctx, container, args);
    if ('error' in resolved) return void ctx.reply(resolved.error);

    const reason = args.slice(ctx.message && 'reply_to_message' in ctx.message ? 0 : 1).join(' ') || 'No reason given';
    const settings = ctx.state.settings!;
    const outcome = await container.moderation.manualWarn(
      {
        settings,
        dbChatId: ctx.state.dbChatId!,
        dbUserId: resolved.target.dbUserId,
        chatTelegramId: BigInt(ctx.chat!.id),
        userTelegramId: resolved.target.telegramId,
        userLabel: resolved.target.label,
      },
      ctx.state.dbUserId!,
      reason,
    );
    if (outcome.notice) await ctx.reply(outcome.notice);
  });

  composer.command('unwarn', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx, container, commandArgs(ctx));
    if ('error' in resolved) return void ctx.reply(resolved.error);
    const cleared = await container.warnings.clear(ctx.state.dbChatId!, resolved.target.dbUserId);
    await ctx.reply(`✅ Cleared ${cleared} warning(s) for ${resolved.target.label}.`);
  });

  composer.command('warns', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx, container, commandArgs(ctx));
    if ('error' in resolved) return void ctx.reply(resolved.error);
    const active = await container.warnings.countActive(ctx.state.dbChatId!, resolved.target.dbUserId);
    await ctx.reply(`${resolved.target.label} has ${active} active warning(s) (limit ${ctx.state.settings!.warnThreshold}).`);
  });

  composer.command('mute', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const args = commandArgs(ctx);
    const resolved = await resolveTarget(ctx, container, args);
    if ('error' in resolved) return void ctx.reply(resolved.error);

    const replied = Boolean(ctx.message && 'reply_to_message' in ctx.message);
    const numericArg = args[replied ? 0 : 1];
    const minutes = numericArg && /^\d+$/.test(numericArg) ? Number(numericArg) : ctx.state.settings!.defaultMuteMinutes;

    await container.mutes.mute({
      dbChatId: ctx.state.dbChatId!,
      dbUserId: resolved.target.dbUserId,
      chatTelegramId: BigInt(ctx.chat!.id),
      userTelegramId: resolved.target.telegramId,
      minutes,
      reason: 'Manual mute',
    });
    await container.logs.record({
      dbChatId: ctx.state.dbChatId!,
      action: ModerationActionType.MUTE,
      reason: DetectionReason.MANUAL,
      targetId: resolved.target.dbUserId,
      actorId: ctx.state.dbUserId!,
      details: `Manual mute for ${formatDuration(minutes)}`,
    });
    await ctx.reply(`🔇 Muted ${resolved.target.label} for ${formatDuration(minutes)}.`);
  });

  composer.command('unmute', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx, container, commandArgs(ctx));
    if ('error' in resolved) return void ctx.reply(resolved.error);
    await container.mutes.unmute(
      ctx.state.dbChatId!,
      resolved.target.dbUserId,
      BigInt(ctx.chat!.id),
      resolved.target.telegramId,
    );
    await container.logs.record({
      dbChatId: ctx.state.dbChatId!,
      action: ModerationActionType.UNMUTE,
      reason: DetectionReason.MANUAL,
      targetId: resolved.target.dbUserId,
      actorId: ctx.state.dbUserId!,
    });
    await ctx.reply(`🔊 Unmuted ${resolved.target.label}.`);
  });

  composer.command('kick', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx, container, commandArgs(ctx));
    if ('error' in resolved) return void ctx.reply(resolved.error);
    await container.bans.kick(BigInt(ctx.chat!.id), resolved.target.telegramId);
    await container.logs.record({
      dbChatId: ctx.state.dbChatId!,
      action: ModerationActionType.KICK,
      reason: DetectionReason.MANUAL,
      targetId: resolved.target.dbUserId,
      actorId: ctx.state.dbUserId!,
    });
    await ctx.reply(`👢 Kicked ${resolved.target.label}.`);
  });

  composer.command('ban', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const args = commandArgs(ctx);
    const resolved = await resolveTarget(ctx, container, args);
    if ('error' in resolved) return void ctx.reply(resolved.error);
    const reason = args.slice(ctx.message && 'reply_to_message' in ctx.message ? 0 : 1).join(' ') || 'Manual ban';
    await container.bans.ban({
      dbChatId: ctx.state.dbChatId!,
      dbUserId: resolved.target.dbUserId,
      chatTelegramId: BigInt(ctx.chat!.id),
      userTelegramId: resolved.target.telegramId,
      reason,
    });
    await container.logs.record({
      dbChatId: ctx.state.dbChatId!,
      action: ModerationActionType.BAN,
      reason: DetectionReason.MANUAL,
      targetId: resolved.target.dbUserId,
      actorId: ctx.state.dbUserId!,
      details: reason,
    });
    await ctx.reply(`🔨 Banned ${resolved.target.label}. Reason: ${reason}`);
  });

  composer.command('unban', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const resolved = await resolveTarget(ctx, container, commandArgs(ctx));
    if ('error' in resolved) return void ctx.reply(resolved.error);
    await container.bans.unban(
      ctx.state.dbChatId!,
      resolved.target.dbUserId,
      BigInt(ctx.chat!.id),
      resolved.target.telegramId,
    );
    await container.logs.record({
      dbChatId: ctx.state.dbChatId!,
      action: ModerationActionType.UNBAN,
      reason: DetectionReason.MANUAL,
      targetId: resolved.target.dbUserId,
      actorId: ctx.state.dbUserId!,
    });
    await ctx.reply(`✅ Unbanned ${resolved.target.label}.`);
  });

  return composer;
}
