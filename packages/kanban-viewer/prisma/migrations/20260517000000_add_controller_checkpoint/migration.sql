-- Migration: add_controller_checkpoint
-- Adds a ControllerCheckpoint table keyed by missionId so the tick-based
-- controller can persist its state outside Claude's context window.
-- Additive only — no existing table or column is altered.

CREATE TABLE "ControllerCheckpoint" (
    "missionId"           TEXT NOT NULL PRIMARY KEY,
    "tickedAt"            DATETIME NOT NULL,
    "activityCursor"      INTEGER NOT NULL,
    "pendingActionIds"    TEXT NOT NULL,
    "confirmedActionIds"  TEXT NOT NULL,
    "retryCounters"       TEXT NOT NULL,
    "lastLaneState"       TEXT NOT NULL,
    CONSTRAINT "ControllerCheckpoint_missionId_fkey"
        FOREIGN KEY ("missionId") REFERENCES "Mission" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
