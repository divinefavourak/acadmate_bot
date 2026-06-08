import type { Database } from '@/database/prisma.client';
import type { TelegramGateway } from './telegram.gateway';

/** A user that can be mentioned. */
interface Taggable {
  telegramId: bigint;
  username: string | null;
  firstName: string | null;
}

/**
 * Builds chunked mention messages for the tagging commands. Telegram only
 * delivers a handful of notifications per message and enforces a 4096-char
 * cap, so we batch mentions into several smaller messages.
 */
export class TaggingService {
  /** Mentions per outgoing message — keeps pings reliable. */
  private readonly batchSize = 5;

  constructor(
    private readonly db: Database,
    private readonly telegram: TelegramGateway,
  ) {}

  /** All known members of the chat (everyone the bot has recorded). */
  async tagAll(dbChatId: string, header?: string): Promise<string[]> {
    const members = await this.db.chatMember.findMany({
      where: { chatId: dbChatId, user: { isBot: false } },
      include: { user: true },
    });
    return this.buildChunks(
      members.map((m) => m.user),
      header ?? '📢 Attention everyone:',
    );
  }

  /** Mention only admins/owners. */
  async tagAdmins(dbChatId: string, header?: string): Promise<string[]> {
    const members = await this.db.chatMember.findMany({
      where: { chatId: dbChatId, role: { in: ['ADMIN', 'OWNER'] } },
      include: { user: true },
    });
    return this.buildChunks(
      members.map((m) => m.user),
      header ?? '👮 Admins:',
    );
  }

  /** Mention members of a custom tag role (e.g. "year1"). */
  async tagRole(dbChatId: string, roleName: string, header?: string): Promise<string[] | null> {
    const role = await this.db.tagRole.findUnique({
      where: { chatId_name: { chatId: dbChatId, name: roleName.toLowerCase() } },
      include: { members: { include: { user: true } } },
    });
    if (!role) return null;
    return this.buildChunks(
      role.members.map((m) => m.user),
      header ?? `🏷️ @${roleName}:`,
    );
  }

  /** Sends pre-built chunks with a small gap to respect rate limits. */
  async broadcast(chatTelegramId: bigint, chunks: string[], threadId?: number): Promise<void> {
    for (const chunk of chunks) {
      await this.telegram.sendMessage(chatTelegramId, chunk, threadId);
      // ~1 msg/sec to the same chat is the safe sustained rate.
      await sleep(1100);
    }
  }

  private buildChunks(users: Taggable[], header: string): string[] {
    if (users.length === 0) return [`${header}\n(no members found)`];

    const chunks: string[] = [];
    for (let i = 0; i < users.length; i += this.batchSize) {
      const slice = users.slice(i, i + this.batchSize);
      const mentions = slice.map((u) => mention(u)).join(' ');
      const prefix = i === 0 ? `${header}\n` : '';
      chunks.push(`${prefix}${mentions}`);
    }
    return chunks;
  }
}

/**
 * Prefer @username mentions (notify even if the user never DM'd the bot).
 * Fall back to a tg://user inline mention by id, which Telegram resolves to a
 * tappable name and still triggers a notification.
 */
function mention(u: Taggable): string {
  if (u.username) return `@${u.username}`;
  const name = (u.firstName ?? 'user').replace(/[<>&]/g, '');
  return `[${name}](tg://user?id=${u.telegramId.toString()})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
