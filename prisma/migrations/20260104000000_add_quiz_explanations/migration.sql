-- AlterTable: store an AI-generated rationale per quiz question
ALTER TABLE "quiz_questions" ADD COLUMN "explanation" TEXT;
