import type { Telegram } from 'telegraf';
import { toUnixSeconds } from '@/utils/time';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('telegram-gateway');

/**
 * Thin, defensive wrapper around the Telegram Bot API surface our services use.
 * Telegram frequently returns errors for benign races (message already deleted,
 * user already left, insufficient rights). We log and swallow those so a single
 * stale action never crashes moderation flow, while surfacing the boolean
 * outcome to callers that care.
 */
export class TelegramGateway {
  constructor(private readonly telegram: Telegram) {}

  async deleteMessage(chatId: bigint, messageId: number): Promise<boolean> {
    return this.guard('deleteMessage', () =>
      this.telegram.deleteMessage(Number(chatId), messageId),
    );
  }

  /**
   * Restricts a member (mute) until `until`. Passing a permissions object with
   * everything false is how Telegram models a mute.
   */
  async muteUntil(chatId: bigint, userId: bigint, until: Date): Promise<boolean> {
    return this.guard('restrictChatMember', () =>
      this.telegram.restrictChatMember(Number(chatId), Number(userId), {
        permissions: {
          can_send_messages: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        },
        until_date: toUnixSeconds(until),
      }),
    );
  }

  /** Lifts all restrictions (restores default group permissions). */
  async unmute(chatId: bigint, userId: bigint): Promise<boolean> {
    return this.guard('restrictChatMember(unmute)', () =>
      this.telegram.restrictChatMember(Number(chatId), Number(userId), {
        permissions: {
          can_send_messages: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_video_notes: true,
          can_send_voice_notes: true,
        },
      }),
    );
  }

  async banUser(chatId: bigint, userId: bigint): Promise<boolean> {
    return this.guard('banChatMember', () =>
      this.telegram.banChatMember(Number(chatId), Number(userId)),
    );
  }

  async unbanUser(chatId: bigint, userId: bigint): Promise<boolean> {
    return this.guard('unbanChatMember', () =>
      this.telegram.unbanChatMember(Number(chatId), Number(userId), { only_if_banned: true }),
    );
  }

  /**
   * Kick = ban then immediately unban, which removes the user but lets them
   * rejoin via an invite link. This is the standard Telegram "kick" idiom.
   */
  async kickUser(chatId: bigint, userId: bigint): Promise<boolean> {
    const banned = await this.banUser(chatId, userId);
    if (!banned) return false;
    return this.unbanUser(chatId, userId);
  }

  async sendMessage(chatId: bigint, text: string, threadId?: number): Promise<number | null> {
    try {
      const msg = await this.telegram.sendMessage(Number(chatId), text, {
        ...(threadId ? { message_thread_id: threadId } : {}),
        link_preview_options: { is_disabled: true },
      });
      return msg.message_id;
    } catch (err) {
      log.warn({ err, chatId: chatId.toString() }, 'sendMessage failed');
      return null;
    }
  }

  async getChatAdministrators(
    chatId: bigint,
  ): Promise<{ userId: bigint; isOwner: boolean; username?: string; firstName?: string }[]> {
    try {
      const admins = await this.telegram.getChatAdministrators(Number(chatId));
      return admins.map((a) => ({
        userId: BigInt(a.user.id),
        isOwner: a.status === 'creator',
        username: a.user.username,
        firstName: a.user.first_name,
      }));
    } catch (err) {
      log.warn({ err, chatId: chatId.toString() }, 'getChatAdministrators failed');
      return [];
    }
  }

  private async guard(op: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err) {
      log.warn({ err, op }, 'telegram operation failed (swallowed)');
      return false;
    }
  }
}
