import type { Database } from '@/database/prisma.client';

/**
 * Stores recent plaintext messages per chat to back `/summarize`. Persisted in
 * Postgres (`RecentMessage`) so the transcript survives bot restarts; the
 * scheduler prunes rows older than 24h to keep retention (and storage) bounded.
 *
 * (This was previously an in-memory ring buffer; persistence was added at the
 * user's request, trading the prior privacy/storage minimalism for durability.)
 */
export class MessageBufferService {
  constructor(private readonly db: Database) {}

  /** Record a message. Ignores empty text; trims long messages. */
  async push(dbChatId: string, name: string, text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    await this.db.recentMessage.create({
      data: { chatId: dbChatId, authorName: name, text: clean.slice(0, 1000) },
    });
  }

  /** Build a transcript of the last `count` messages, oldest first. */
  async transcript(dbChatId: string, count: number): Promise<string> {
    const rows = await this.db.recentMessage.findMany({
      where: { chatId: dbChatId },
      orderBy: { createdAt: 'desc' },
      take: count,
    });
    return rows
      .reverse()
      .map((m) => `${m.authorName}: ${m.text}`)
      .join('\n');
  }

  async size(dbChatId: string): Promise<number> {
    return this.db.recentMessage.count({ where: { chatId: dbChatId } });
  }
}
