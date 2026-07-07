import { prisma } from '@/lib/db';

/**
 * Single source of truth for the global corroboration threshold: a
 * fingerprint is corroborated once its learnings span this many DISTINCT
 * missions. Callers must import this rather than re-deriving it.
 */
export const CORROBORATION_THRESHOLD = 3;

/**
 * Single source of truth for the defer resurface bar: a deferred fingerprint
 * (Fingerprint.deferredAtMissions set to the distinctMissions count at defer
 * time) stays hidden from the actionable candidate walk until distinctMissions
 * climbs this many missions past that watermark. "Not now", not "never" — the
 * watermark plus margin is what turns it back into an actionable card.
 */
export const DEFER_MARGIN = 2;

export interface CorroborationResult {
  distinctMissions: number;
  corroborated: boolean;
}

/**
 * Global, fingerprint-centric corroboration signal (Phase A). Tuning
 * improves the plugin itself — a surface shared across every project that
 * installs it — so corroboration is no longer split per-project: it counts
 * COUNT(DISTINCT missionId) across ALL of a fingerprint's RetroLearning rows,
 * across every project, excluding rows with a NULL missionId (backfill rows
 * carry no mission and cannot corroborate on their own). The old "in-project
 * hits >= 3 OR cross-project hit" rule is replaced by this single global
 * distinct-mission count.
 */
export async function getCorroboration(fingerprint: string): Promise<CorroborationResult> {
  const rows = await prisma.retroLearning.findMany({
    where: { fingerprint, missionId: { not: null } },
    select: { missionId: true },
    distinct: ['missionId'],
  });

  const distinctMissions = rows.length;
  const corroborated = distinctMissions >= CORROBORATION_THRESHOLD;

  return { distinctMissions, corroborated };
}

/**
 * FR-9/FR-15 promotion gate, shared by proposal creation (accept-on-POST)
 * and the accept/edit verbs on an existing proposal: a proposal promotes
 * only when EVERY one of its linked fingerprints is individually
 * corroborated. An empty fingerprint list never passes — a proposal about
 * nothing cannot be promoted.
 */
export async function areAllCorroborated(fingerprints: string[]): Promise<boolean> {
  if (fingerprints.length === 0) {
    return false;
  }
  const results = await Promise.all(fingerprints.map((fp) => getCorroboration(fp)));
  return results.every((r) => r.corroborated);
}
