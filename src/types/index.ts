import type { Context } from 'telegraf';
import type { Update } from 'telegraf/types';
import type {
  ChatSettings,
  MemberRole,
  ModerationActionType,
  DetectionReason,
} from '@prisma/client';

/**
 * Values the entity-resolution middleware attaches to `ctx.state`.
 * Optional because non-group updates (e.g. private DMs) skip resolution.
 */
export interface ResolvedState {
  dbChatId?: string;
  dbUserId?: string;
  settings?: ChatSettings;
  actorRole?: MemberRole;
  isAdmin?: boolean;
}

/**
 * Telegraf context augmented with values our middleware attaches.
 * Keeping this in one place gives every handler strong typing for `ctx`.
 */
export interface BotContext<U extends Update = Update> extends Context<U> {
  state: Context['state'] & ResolvedState;
}

/** Outcome of running a message through the moderation pipeline. */
export interface DetectionResult {
  flagged: boolean;
  reason?: DetectionReason;
  /** Human-readable explanation for logs and admin notifications. */
  details?: string;
  /** Optional severity hint a detector can raise (0 = info, 1 = normal, 2 = high). */
  severity?: number;
}

/** What the moderation engine decides to do with a flagged message. */
export interface ModerationDecision {
  action: ModerationActionType | 'NONE';
  reason: DetectionReason;
  details: string;
  deleteMessage: boolean;
  muteMinutes?: number;
}

/** Minimal message shape detectors operate on, decoupled from Telegraf. */
export interface InspectedMessage {
  chatTelegramId: bigint;
  userTelegramId: bigint;
  messageId: number;
  text: string;
  entities: { type: string; url?: string }[];
}

/** JWT payload for dashboard access tokens. */
export interface AccessTokenPayload {
  sub: string; // AdminUser.id
  email: string;
  role: string; // AdminRole
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // token id, stored hashed for revocation
  type: 'refresh';
}
