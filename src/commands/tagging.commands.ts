import { Composer } from 'telegraf';
import type { BotContext } from '@/types';
import type { Container } from '@/container';
import { commandArgs, requireAdmin } from '@/bot/helpers';

/**
 * Tagging commands.
 *
 *   /tagall [message]          — mention every known member (chunked)
 *   /admins [message]          — mention admins (synced live from Telegram)
 *   /tag <role> [message]      — mention a custom role
 *   /roles                     — list custom roles
 *   /createrole <name>         — create a custom role (admin)
 *   /addrole <role> <user>     — add replied/〈user〉 to a role (admin)
 *   /schedtag <target> <cron>  — schedule a recurring tag (admin)
 *   /unschedule <id>           — cancel a scheduled tag (admin)
 */
export function taggingCommands(container: Container): Composer<BotContext> {
  const composer = new Composer<BotContext>();

  composer.command('tagall', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const header = commandArgs(ctx).join(' ') || undefined;
    const chunks = await container.tagging.tagAll(ctx.state.dbChatId!, header);
    await container.tagging.broadcast(BigInt(ctx.chat!.id), chunks, threadId(ctx));
  });

  composer.command('admins', async (ctx) => {
    // Sync the live admin list from Telegram so @admins is always accurate.
    const tgAdmins = await container.telegram.getChatAdministrators(BigInt(ctx.chat!.id));
    const mapped = await Promise.all(
      tgAdmins
        .filter((a) => a.username || a.firstName)
        .map(async (a) => {
          const user = await container.users.upsertUser({
            telegramId: a.userId,
            username: a.username,
            firstName: a.firstName,
          });
          return { dbUserId: user.id, isOwner: a.isOwner };
        }),
    );
    await container.users.syncAdmins(ctx.state.dbChatId!, mapped);

    const header = commandArgs(ctx).join(' ') || undefined;
    const chunks = await container.tagging.tagAdmins(ctx.state.dbChatId!, header);
    await container.tagging.broadcast(BigInt(ctx.chat!.id), chunks, threadId(ctx));
  });

  composer.command('tag', async (ctx) => {
    const args = commandArgs(ctx);
    const roleName = args[0];
    if (!roleName) return void ctx.reply('Usage: /tag <role> [message]');
    const header = args.slice(1).join(' ') || undefined;
    const chunks = await container.tagging.tagRole(ctx.state.dbChatId!, roleName, header);
    if (!chunks) return void ctx.reply(`No such role: ${roleName}`);
    await container.tagging.broadcast(BigInt(ctx.chat!.id), chunks, threadId(ctx));
  });

  composer.command('roles', async (ctx) => {
    const roles = await container.prisma.tagRole.findMany({
      where: { chatId: ctx.state.dbChatId! },
      include: { _count: { select: { members: true } } },
    });
    if (roles.length === 0) return void ctx.reply('No custom roles yet. Create one with /createrole <name>.');
    const list = roles.map((r) => `• ${r.name} (${r._count.members})`).join('\n');
    await ctx.reply(`Roles:\n${list}`);
  });

  composer.command('createrole', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const name = commandArgs(ctx)[0]?.toLowerCase();
    if (!name) return void ctx.reply('Usage: /createrole <name>');
    await container.prisma.tagRole.upsert({
      where: { chatId_name: { chatId: ctx.state.dbChatId!, name } },
      create: { chatId: ctx.state.dbChatId!, name },
      update: {},
    });
    await ctx.reply(`✅ Role "${name}" is ready. Add members with /addrole ${name} (reply to a user).`);
  });

  composer.command('addrole', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const args = commandArgs(ctx);
    const name = args[0]?.toLowerCase();
    if (!name) return void ctx.reply('Usage: /addrole <role> (reply to a user)');

    const role = await container.prisma.tagRole.findUnique({
      where: { chatId_name: { chatId: ctx.state.dbChatId!, name } },
    });
    if (!role) return void ctx.reply(`No such role: ${name}. Create it with /createrole ${name}.`);

    const reply = ctx.message && 'reply_to_message' in ctx.message ? ctx.message.reply_to_message : undefined;
    if (!reply?.from) return void ctx.reply('Reply to the user you want to add to the role.');

    const user = await container.users.upsertUser({
      telegramId: BigInt(reply.from.id),
      username: reply.from.username,
      firstName: reply.from.first_name,
    });
    await container.prisma.tagRoleMember.upsert({
      where: { tagRoleId_userId: { tagRoleId: role.id, userId: user.id } },
      create: { tagRoleId: role.id, userId: user.id },
      update: {},
    });
    await ctx.reply(`✅ Added to role "${name}".`);
  });

  composer.command('schedtag', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    // /schedtag <target> "<cron>" [message]
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const match = text.match(/^\/schedtag(?:@\S+)?\s+(\S+)\s+"([^"]+)"\s*(.*)$/);
    if (!match) {
      return void ctx.reply('Usage: /schedtag <all|admins|role> "<cron>" [message]\nExample: /schedtag all "0 9 * * 1" Weekly standup!');
    }
    const [, target, cronExpr, message] = match;
    try {
      const tag = await container.scheduler.create({
        dbChatId: ctx.state.dbChatId!,
        chatTelegramId: BigInt(ctx.chat!.id),
        createdById: BigInt(ctx.from!.id),
        target,
        message: message ?? '',
        cronExpr,
      });
      await ctx.reply(`🗓️ Scheduled tag created (id: ${tag.id}). Cancel with /unschedule ${tag.id}.`);
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  composer.command('unschedule', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const id = commandArgs(ctx)[0];
    if (!id) return void ctx.reply('Usage: /unschedule <id>');
    await container.scheduler.cancel(id);
    await ctx.reply('🗑️ Scheduled tag cancelled.');
  });

  return composer;
}

/** Forward thread id so tags post in the right topic of a forum supergroup. */
function threadId(ctx: BotContext): number | undefined {
  const msg = ctx.message;
  if (msg && 'message_thread_id' in msg && typeof msg.message_thread_id === 'number') {
    return msg.message_thread_id;
  }
  return undefined;
}
