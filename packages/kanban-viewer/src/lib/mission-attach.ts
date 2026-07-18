/**
 * Mission attribution for incoming hook telemetry.
 *
 * Hook events and per-message token usage arrive with only a projectId; the
 * mission they belong to is resolved server-side. Previously that resolution
 * was "newest un-archived mission of the project" with no state filter, which
 * made every completed-but-not-yet-archived mission absorb ALL later activity
 * in the project — real prod example: sessions on 2026-07-14 attributed to an
 * autocut mission that completed on 2026-07-01.
 *
 * The bounded rule implemented here:
 * - An ACTIVE mission (state not completed/failed) receives events, as before.
 * - A completed/failed mission receives events only within a grace window
 *   after completedAt — post-mission work (postcheck, Tawnia's docs commit,
 *   the detached retro) legitimately trails completion.
 * - Outside the window, events are stored unattributed (missionId null)
 *   rather than poisoning a finished mission's telemetry.
 */

import { prisma } from '@/lib/db';

const DEFAULT_ATTACH_GRACE_MINUTES = 60;

/**
 * Grace window (minutes) during which a completed/failed mission still
 * receives telemetry. Overridable via ATEAM_MISSION_ATTACH_GRACE_MINUTES;
 * non-integer or non-positive values fall back to the default (mirrors the
 * ATEAM_REJECTION_CAP validation pattern).
 */
export function getMissionAttachGraceMinutes(): number {
  const raw = process.env.ATEAM_MISSION_ATTACH_GRACE_MINUTES;
  if (raw === undefined || raw === '') return DEFAULT_ATTACH_GRACE_MINUTES;
  // Strict decimal digits only: Number() would also accept exponential forms
  // ('1e3') and padded whitespace, which read as typos more than intent.
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_ATTACH_GRACE_MINUTES;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_ATTACH_GRACE_MINUTES;
  return parsed;
}

/**
 * Resolve the mission id that incoming telemetry for this project should
 * attach to, or null when nothing is attributable.
 */
export async function findAttributableMissionId(projectId: string): Promise<string | null> {
  // Prefer a still-ACTIVE mission outright, even if a newer terminal mission
  // exists. Taking only the newest-by-startedAt row would return null for an
  // active mission's events whenever a later-started mission had already
  // finished and aged out of the grace window.
  const active = await prisma.mission.findFirst({
    where: {
      projectId,
      archivedAt: null,
      state: { notIn: ['completed', 'failed'] },
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  if (active) return active.id;

  const terminal = await prisma.mission.findFirst({
    where: { projectId, archivedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true, completedAt: true, startedAt: true },
  });
  if (!terminal) return null;

  // Terminal but unarchived: attach only within the grace window. Some failure
  // paths never stamp completedAt — anchor on startedAt then, so a fresh
  // failure still receives its trailing events while an old one can't absorb
  // later sessions indefinitely.
  const anchor = terminal.completedAt ?? terminal.startedAt;
  const graceMs = getMissionAttachGraceMinutes() * 60_000;
  return Date.now() - anchor.getTime() <= graceMs ? terminal.id : null;
}
