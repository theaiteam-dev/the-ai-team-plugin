/*
  Warnings:

  - You are about to drop the column `dismissalNote` on the `Fingerprint` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Fingerprint` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Fingerprint" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "pattern" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "deferredAtMissions" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Fingerprint" ("createdAt", "pattern", "severity", "slug", "updatedAt") SELECT "createdAt", "pattern", "severity", "slug", "updatedAt" FROM "Fingerprint";
DROP TABLE "Fingerprint";
ALTER TABLE "new_Fingerprint" RENAME TO "Fingerprint";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
