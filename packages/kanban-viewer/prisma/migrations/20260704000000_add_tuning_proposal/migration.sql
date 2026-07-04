-- CreateTable: TuningProposal
CREATE TABLE "TuningProposal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" TEXT NOT NULL,
    "targetSurface" TEXT NOT NULL,
    "altitude" TEXT NOT NULL,
    "proposalText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "evalResult" TEXT,
    "dismissalNote" TEXT,
    "shippedInCommit" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TuningProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TuningProposal_projectId_status_idx" ON "TuningProposal"("projectId", "status");

-- RedefineTables: upgrade RetroLearning.proposalId from a bare Int into a real
-- FK relation to TuningProposal. SQLite has no ALTER TABLE ADD CONSTRAINT, so
-- Prisma rebuilds the table: create new_RetroLearning with the FK, copy every
-- row across unchanged, drop the old table, then rename the new one back.
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RetroLearning" (
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
    CONSTRAINT "RetroLearning_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RetroLearning_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "TuningProposal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RetroLearning" ("id", "projectId", "missionId", "source", "severity", "attributedAgent", "targetSurface", "pattern", "fingerprint", "title", "detail", "status", "proposalId", "createdAt")
SELECT "id", "projectId", "missionId", "source", "severity", "attributedAgent", "targetSurface", "pattern", "fingerprint", "title", "detail", "status", "proposalId", "createdAt" FROM "RetroLearning";
DROP TABLE "RetroLearning";
ALTER TABLE "new_RetroLearning" RENAME TO "RetroLearning";
CREATE INDEX "RetroLearning_projectId_status_idx" ON "RetroLearning"("projectId", "status");
CREATE INDEX "RetroLearning_fingerprint_idx" ON "RetroLearning"("fingerprint");
CREATE INDEX "RetroLearning_missionId_idx" ON "RetroLearning"("missionId");
CREATE UNIQUE INDEX "RetroLearning_projectId_missionId_fingerprint_key" ON "RetroLearning"("projectId", "missionId", "fingerprint");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
