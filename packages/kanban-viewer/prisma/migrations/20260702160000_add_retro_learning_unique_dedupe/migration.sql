-- CreateIndex: back the per-mission dedupe key with a DB-level unique constraint
-- so concurrent POST /api/learnings inserts can't race past the app-level
-- findFirst check and double-count a mission's recurrence. SQLite treats NULLs
-- as distinct, so null-missionId backfill rows remain unconstrained by design.
CREATE UNIQUE INDEX "RetroLearning_projectId_missionId_fingerprint_key" ON "RetroLearning"("projectId", "missionId", "fingerprint");
