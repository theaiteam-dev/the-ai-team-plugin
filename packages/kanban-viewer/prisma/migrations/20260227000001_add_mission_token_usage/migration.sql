-- CreateTable: MissionTokenUsage
CREATE TABLE "MissionTokenUsage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "missionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheCreationTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL,
    "estimatedCostUsd" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MissionTokenUsage_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MissionTokenUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex: composite unique
CREATE UNIQUE INDEX "MissionTokenUsage_missionId_agentName_model_key" ON "MissionTokenUsage"("missionId", "agentName", "model");

-- CreateIndex
CREATE INDEX "MissionTokenUsage_missionId_idx" ON "MissionTokenUsage"("missionId");

-- CreateIndex
CREATE INDEX "MissionTokenUsage_projectId_idx" ON "MissionTokenUsage"("projectId");
