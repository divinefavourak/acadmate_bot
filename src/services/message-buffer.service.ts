interface BufferedMessage {
  name: string;
  text: string;
  at: number;
}

/**
 * In-memory ring buffer of recent plaintext messages per chat, used only by
 * `/summarize`. Deliberately NOT persisted: message content stays in memory
 * briefly and is capped per chat, avoiding a privacy/storage liability.
 */
export class MessageBufferService {
  /** Map insertion order doubles as an LRU queue (oldest key first). */
  private readonly buffers = new Map<string, BufferedMessage[]>();

  constructor(
    /** Max messages retained per chat. */
    private readonly capacity = 300,
    /** Max number of distinct chats buffered before LRU eviction. */
    private readonly maxChats = 500,
  ) {}

  /** Record a message (newest last). Ignores empty text. */
  push(dbChatId: string, name: string, text: string): void {
    const clean = text.trim();
    if (!clean) return;
    const buf = this.buffers.get(dbChatId) ?? [];
    buf.push({ name, text: clean.slice(0, 1000), at: Date.now() });
    if (buf.length > this.capacity) buf.splice(0, buf.length - this.capacity);

    // Re-insert to mark this chat most-recently-used (moves it to the end).
    this.buffers.delete(dbChatId);
    this.buffers.set(dbChatId, buf);

    // Evict the least-recently-used chat(s) once we exceed the chat cap.
    while (this.buffers.size > this.maxChats) {
      const oldest = this.buffers.keys().next().value;
      if (oldest === undefined) break;
      this.buffers.delete(oldest);
    }
  }

  /** Build a transcript of the last `count` messages, oldest first. */
  transcript(dbChatId: string, count: number): string {
    const buf = this.buffers.get(dbChatId) ?? [];
    return buf
      .slice(-count)
      .map((m) => `${m.name}: ${m.text}`)
      .join('\n');
  }

  size(dbChatId: string): number {
    return this.buffers.get(dbChatId)?.length ?? 0;
  }
}
