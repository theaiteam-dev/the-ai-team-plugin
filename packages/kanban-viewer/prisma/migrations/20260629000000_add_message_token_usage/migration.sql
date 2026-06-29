-- CreateTable: MessageTokenUsage
CREATE TABLE "MessageTokenUsage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "missionId" TEXT,
    "agentName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheCreationTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageTokenUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MessageTokenUsage_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex: unique on messageId (idempotency)
CREATE UNIQUE INDEX "MessageTokenUsage_messageId_key" ON "MessageTokenUsage"("messageId");

-- CreateIndex
CREATE INDEX "MessageTokenUsage_missionId_idx" ON "MessageTokenUsage"("missionId");

-- CreateIndex
CREATE INDEX "MessageTokenUsage_missionId_agentName_idx" ON "MessageTokenUsage"("missionId", "agentName");
