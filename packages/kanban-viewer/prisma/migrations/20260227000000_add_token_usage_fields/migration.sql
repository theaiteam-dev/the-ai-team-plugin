-- AlterTable: Add token usage fields to HookEvent
ALTER TABLE "HookEvent" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "HookEvent" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "HookEvent" ADD COLUMN "cacheCreationTokens" INTEGER;
ALTER TABLE "HookEvent" ADD COLUMN "cacheReadTokens" INTEGER;
ALTER TABLE "HookEvent" ADD COLUMN "model" TEXT;
