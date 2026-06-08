import { MemberRole } from '@prisma/client';
import type { TelegramGateway } from './telegram.gateway';

interface CachedAdmins {
  fetchedAt: number;
  /** Map of admin Telegram user id → whether they are the chat owner. */
  admins: Map<string, boolean>;
}

/**
 * Resolves a user's *live* admin status from Telegram, cached per chat with a
 * short TTL. This is the source of truth for "is this user an admin", rather
 * than the (lazily-synced) ChatMember.role column — so promoting the bot and a
 * user to admin in Telegram is recognised immediately, with no `/admins` step.
 *
 * One `getChatAdministrators` call per chat per TTL window keeps it cheap even
 * in busy groups.
 */
export class AdminCacheService {
  private readonly cache = new Map<string, CachedAdmins>();

  constructor(
    private readonly telegram: TelegramGateway,
    private readonly ttlMs = 60_000,
  ) {}

  /** Resolves the caller's role in a chat from Telegram's admin list. */
  async resolveRole(chatTelegramId: bigint, userTelegramId: bigint): Promise<MemberRole> {
    const admins = await this.getAdmins(chatTelegramId);
    const owner = admins.get(userTelegramId.toString());
    if (owner === undefined) return MemberRole.MEMBER;
    return owner ? MemberRole.OWNER : MemberRole.ADMIN;
  }

  /** Drop the cache for a chat (e.g. after a known admin change). */
  invalidate(chatTelegramId: bigint): void {
    this.cache.delete(chatTelegramId.toString());
  }

  private async getAdmins(chatTelegramId: bigint): Promise<Map<string, boolean>> {
    const key = chatTelegramId.toString();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.admins;
    }

    const list = await this.telegram.getChatAdministrators(chatTelegramId);
    const admins = new Map<string, boolean>();
    for (const a of list) admins.set(a.userId.toString(), a.isOwner);

    // If the API call failed (returns []), don't poison the cache for a full
    // TTL — keep any previous good data, otherwise cache the empty result
    // briefly so we retry soon.
    if (list.length === 0 && cached) return cached.admins;
    this.cache.set(key, { fetchedAt: Date.now(), admins });
    return admins;
  }
}
