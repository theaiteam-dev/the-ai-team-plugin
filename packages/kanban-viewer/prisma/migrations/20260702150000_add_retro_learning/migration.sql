-- CreateTable: RetroLearning
CREATE TABLE "RetroLearning" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" TEXT NOT NULL,
    "missionId" TEXT,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "attributedAgent" TEXT NOT NULL,
    "targetSurface" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "proposalId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetroLearning_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RetroLearning_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RetroLearning_projectId_status_idx" ON "RetroLearning"("projectId", "status");

-- CreateIndex
CREATE INDEX "RetroLearning_fingerprint_idx" ON "RetroLearning"("fingerprint");

-- CreateIndex
CREATE INDEX "RetroLearning_missionId_idx" ON "RetroLearning"("missionId");
