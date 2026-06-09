-- AlterEnum: AI classifier categories
ALTER TYPE "DetectionReason" ADD VALUE 'TOXICITY';
ALTER TYPE "DetectionReason" ADD VALUE 'HARASSMENT';
ALTER TYPE "DetectionReason" ADD VALUE 'OFF_TOPIC';

-- AlterTable: AI moderation settings on chat_settings
ALTER TABLE "chat_settings" ADD COLUMN "aiModeration" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "chat_settings" ADD COLUMN "topic" TEXT;
