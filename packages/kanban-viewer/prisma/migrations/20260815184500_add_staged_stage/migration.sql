-- DataMigration: Add the 'staged' Stage row between probing/review and done.
-- Data-only migration: schema.prisma is unchanged (Stage table already exists).
-- Idempotent: safe to apply more than once. Does not touch the Item table.

-- Insert the staged row only if it doesn't already exist.
INSERT OR IGNORE INTO "Stage" ("id", "name", "order", "wipLimit")
VALUES ('staged', 'Staged', 6, NULL);

-- Shift done/blocked order to make room for staged. Unconditional — safe to re-run.
UPDATE "Stage" SET "order" = 7 WHERE "id" = 'done';
UPDATE "Stage" SET "order" = 8 WHERE "id" = 'blocked';
