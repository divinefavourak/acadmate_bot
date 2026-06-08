-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('WARN', 'UNWARN', 'MUTE', 'UNMUTE', 'KICK', 'BAN', 'UNBAN', 'DELETE_MESSAGE', 'NOTE');

-- CreateEnum
CREATE TYPE "DetectionReason" AS ENUM ('SPAM', 'FLOOD', 'DUPLICATE', 'SCAM_LINK', 'BANNED_WORD', 'MANUAL');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tg_users" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tg_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "title" TEXT,
    "type" TEXT NOT NULL DEFAULT 'supergroup',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_settings" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "spamDetection" BOOLEAN NOT NULL DEFAULT true,
    "floodDetection" BOOLEAN NOT NULL DEFAULT true,
    "duplicateDetection" BOOLEAN NOT NULL DEFAULT true,
    "scamLinkDetection" BOOLEAN NOT NULL DEFAULT true,
    "bannedWordsFilter" BOOLEAN NOT NULL DEFAULT true,
    "floodMaxMessages" INTEGER NOT NULL DEFAULT 5,
    "floodWindowSeconds" INTEGER NOT NULL DEFAULT 7,
    "duplicateWindowSeconds" INTEGER NOT NULL DEFAULT 60,
    "warnThreshold" INTEGER NOT NULL DEFAULT 3,
    "warnAction" "ModerationActionType" NOT NULL DEFAULT 'MUTE',
    "defaultMuteMinutes" INTEGER NOT NULL DEFAULT 60,
    "deleteOnDetect" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_members" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warnings" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuedById" TEXT,
    "reason" TEXT NOT NULL,
    "detection" "DetectionReason" NOT NULL DEFAULT 'MANUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mutes" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "until" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bans" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banned_words" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "isRegex" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banned_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_records" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" BIGINT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_logs" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "targetId" TEXT,
    "actorId" TEXT,
    "action" "ModerationActionType" NOT NULL,
    "reason" "DetectionReason" NOT NULL DEFAULT 'MANUAL',
    "details" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_roles" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_role_members" (
    "id" TEXT NOT NULL,
    "tagRoleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_role_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tags" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "createdById" BIGINT NOT NULL,
    "target" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tg_users_telegramId_key" ON "tg_users"("telegramId");

-- CreateIndex
CREATE INDEX "tg_users_username_idx" ON "tg_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "chats_telegramId_key" ON "chats"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_settings_chatId_key" ON "chat_settings"("chatId");

-- CreateIndex
CREATE INDEX "chat_members_chatId_role_idx" ON "chat_members"("chatId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "chat_members_chatId_userId_key" ON "chat_members"("chatId", "userId");

-- CreateIndex
CREATE INDEX "warnings_chatId_userId_active_idx" ON "warnings"("chatId", "userId", "active");

-- CreateIndex
CREATE INDEX "mutes_active_until_idx" ON "mutes"("active", "until");

-- CreateIndex
CREATE INDEX "mutes_chatId_userId_idx" ON "mutes"("chatId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "bans_chatId_userId_key" ON "bans"("chatId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "banned_words_chatId_pattern_key" ON "banned_words"("chatId", "pattern");

-- CreateIndex
CREATE INDEX "message_records_chatId_userId_createdAt_idx" ON "message_records"("chatId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "message_records_chatId_contentHash_createdAt_idx" ON "message_records"("chatId", "contentHash", "createdAt");

-- CreateIndex
CREATE INDEX "message_records_createdAt_idx" ON "message_records"("createdAt");

-- CreateIndex
CREATE INDEX "moderation_logs_chatId_createdAt_idx" ON "moderation_logs"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "moderation_logs_action_idx" ON "moderation_logs"("action");

-- CreateIndex
CREATE UNIQUE INDEX "tag_roles_chatId_name_key" ON "tag_roles"("chatId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tag_role_members_tagRoleId_userId_key" ON "tag_role_members"("tagRoleId", "userId");

-- CreateIndex
CREATE INDEX "scheduled_tags_status_idx" ON "scheduled_tags"("status");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_adminUserId_idx" ON "refresh_tokens"("adminUserId");

-- AddForeignKey
ALTER TABLE "chat_settings" ADD CONSTRAINT "chat_settings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tg_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tg_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "tg_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tg_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bans" ADD CONSTRAINT "bans_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bans" ADD CONSTRAINT "bans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tg_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banned_words" ADD CONSTRAINT "banned_words_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_records" ADD CONSTRAINT "message_records_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_records" ADD CONSTRAINT "message_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tg_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_logs" ADD CONSTRAINT "moderation_logs_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_logs" ADD CONSTRAINT "moderation_logs_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "tg_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_logs" ADD CONSTRAINT "moderation_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "tg_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_roles" ADD CONSTRAINT "tag_roles_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_role_members" ADD CONSTRAINT "tag_role_members_tagRoleId_fkey" FOREIGN KEY ("tagRoleId") REFERENCES "tag_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_role_members" ADD CONSTRAINT "tag_role_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "tg_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tags" ADD CONSTRAINT "scheduled_tags_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

