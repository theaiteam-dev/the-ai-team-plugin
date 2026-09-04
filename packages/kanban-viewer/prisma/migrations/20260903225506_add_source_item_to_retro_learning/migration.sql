-- AlterTable
ALTER TABLE "RetroLearning" ADD COLUMN "sourceItemId" TEXT;

-- CreateIndex
-- sourceItemId is nullable and SQLite treats every NULL as distinct in a
-- unique index, so a plain (non-partial) index here is already correct:
-- rows with no source item never collide with each other or with anything
-- on this constraint.
CREATE UNIQUE INDEX "RetroLearning_projectId_missionId_sourceItemId_key" ON "RetroLearning"("projectId", "missionId", "sourceItemId");

-- DropIndex + CreateIndex (partial) — WI-936 rework, AC5 (Amy's rejection)
--
-- The (projectId, missionId, fingerprint) unique index from the earlier
-- 20260702160000_add_retro_learning_unique_dedupe migration is dropped and
-- redefined below as a PARTIAL index.
--
-- Root cause: fingerprint is NOT NULL on every RetroLearning row, so a plain
-- (non-partial) unique index on it applies to ALL rows, including
-- source-item-derived ones. That makes it impossible for two DIFFERENT
-- source items to share one fingerprint under the same mission (AC5's exact
-- requirement) — the second insert collides on the fingerprint constraint
-- even though the two rows are perfectly distinct under the sourceItemId
-- constraint above. Restricting the fingerprint index to
-- WHERE "sourceItemId" IS NULL scopes fingerprint-keyed dedupe back to
-- exactly the rows it always governed (captures with no source item);
-- source-item-derived rows are governed by the sourceItemId index instead.
--
-- Prisma's `@@unique` schema attribute cannot express a partial index, so
-- schema.prisma documents this constraint in a comment rather than a
-- `@@unique` declaration — see the RetroLearning model comment in
-- prisma/schema.prisma. This is a deliberate, known drift between the
-- declarative schema and the actual database for this one constraint.
DROP INDEX IF EXISTS "RetroLearning_projectId_missionId_fingerprint_key";

CREATE UNIQUE INDEX "RetroLearning_projectId_missionId_fingerprint_key" ON "RetroLearning"("projectId", "missionId", "fingerprint") WHERE "sourceItemId" IS NULL;
