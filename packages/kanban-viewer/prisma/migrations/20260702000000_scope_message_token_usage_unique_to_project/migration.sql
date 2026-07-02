-- DropIndex: the global messageId unique key let a second project's ingest
-- of the same (real or synthetic) messageId overwrite the first project's row
-- CREATE UNIQUE INDEX "MessageTokenUsage_messageId_key" ON "MessageTokenUsage"("messageId")
DROP INDEX "MessageTokenUsage_messageId_key";

-- CreateIndex: idempotency key scoped per-project instead
CREATE UNIQUE INDEX "MessageTokenUsage_projectId_messageId_key" ON "MessageTokenUsage"("projectId", "messageId");
