/*
  Warnings:

  - You are about to drop the column `proposalId` on the `RetroLearning` table. All the data in the column will be lost.
  - You are about to drop the column `projectId` on the `TuningProposal` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "Fingerprint" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "pattern" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dismissalNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Backfill: one Fingerprint row per DISTINCT existing RetroLearning.fingerprint,
-- taking pattern/severity from the most-recent (highest id) learning row for
-- that slug. Must run before the RetroLearning rebuild below adds the
-- fingerprint -> Fingerprint.slug FK (that rebuild runs with foreign_keys=OFF
-- regardless, but backfilling first keeps referential intent correct and
-- avoids ever having an active FK pointing at a still-empty parent table).
INSERT INTO "Fingerprint" ("slug", "pattern", "severity", "createdAt", "updatedAt")
SELECT "rl"."fingerprint", "rl"."pattern", "rl"."severity", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "RetroLearning" "rl"
INNER JOIN (
    SELECT "fingerprint", MAX("id") AS "maxId"
    FROM "RetroLearning"
    GROUP BY "fingerprint"
) "latest" ON "rl"."fingerprint" = "latest"."fingerprint" AND "rl"."id" = "latest"."maxId";

-- Delete pre-agreement draft proposals — proposals now materialize only on
-- accept/edit (post-agreement), so any existing 'draft' rows are browsing
-- cruft from the old eager-propose flow. There are no accepted/shipped
-- proposals to preserve at the time of this migration.
DELETE FROM "TuningProposal" WHERE "status" = 'draft';

-- CreateTable
CREATE TABLE "_FingerprintToTuningProposal" (
    "A" TEXT NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_FingerprintToTuningProposal_A_fkey" FOREIGN KEY ("A") REFERENCES "Fingerprint" ("slug") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_FingerprintToTuningProposal_B_fkey" FOREIGN KEY ("B") REFERENCES "TuningProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
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
    "origin" TEXT NOT NULL DEFAULT 'local',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetroLearning_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RetroLearning_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RetroLearning_fingerprint_fkey" FOREIGN KEY ("fingerprint") REFERENCES "Fingerprint" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RetroLearning" ("attributedAgent", "createdAt", "detail", "fingerprint", "id", "missionId", "pattern", "projectId", "severity", "source", "status", "targetSurface", "title") SELECT "attributedAgent", "createdAt", "detail", "fingerprint", "id", "missionId", "pattern", "projectId", "severity", "source", "status", "targetSurface", "title" FROM "RetroLearning";
DROP TABLE "RetroLearning";
ALTER TABLE "new_RetroLearning" RENAME TO "RetroLearning";
CREATE INDEX "RetroLearning_projectId_status_idx" ON "RetroLearning"("projectId", "status");
CREATE INDEX "RetroLearning_fingerprint_idx" ON "RetroLearning"("fingerprint");
CREATE INDEX "RetroLearning_missionId_idx" ON "RetroLearning"("missionId");
CREATE UNIQUE INDEX "RetroLearning_projectId_missionId_fingerprint_key" ON "RetroLearning"("projectId", "missionId", "fingerprint");
CREATE TABLE "new_TuningProposal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "targetSurface" TEXT NOT NULL,
    "altitude" TEXT NOT NULL,
    "proposalText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "evalResult" TEXT,
    "dismissalNote" TEXT,
    "shippedInCommit" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_TuningProposal" ("altitude", "createdAt", "dismissalNote", "evalResult", "id", "proposalText", "shippedInCommit", "status", "targetSurface", "updatedAt") SELECT "altitude", "createdAt", "dismissalNote", "evalResult", "id", "proposalText", "shippedInCommit", "status", "targetSurface", "updatedAt" FROM "TuningProposal";
DROP TABLE "TuningProposal";
ALTER TABLE "new_TuningProposal" RENAME TO "TuningProposal";
CREATE INDEX "TuningProposal_status_idx" ON "TuningProposal"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Fingerprint_status_idx" ON "Fingerprint"("status");

-- CreateIndex
CREATE UNIQUE INDEX "_FingerprintToTuningProposal_AB_unique" ON "_FingerprintToTuningProposal"("A", "B");

-- CreateIndex
CREATE INDEX "_FingerprintToTuningProposal_B_index" ON "_FingerprintToTuningProposal"("B");
