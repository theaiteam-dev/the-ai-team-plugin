/**
 * API Route: /api/tuning/candidates
 *
 * GET - The tuning walk's ordered candidate list (FR-8): recurrence-ranked
 *       GLOBAL fingerprints (across every project — tuning improves the
 *       plugin itself, a surface shared by every installation), each carrying
 *       an `actionable` flag driven by the defer watermark (see DEFER_MARGIN
 *       below) rather than a hard dismiss/resurface toggle.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError } from '@/lib/errors';
import { CORROBORATION_THRESHOLD, DEFER_MARGIN } from '@/lib/corroboration';
import type { ApiError } from '@/types/api';

const LIVE_STATUSES = new Set(['open', 'recurred']);

const SEVERITY_ORDINAL: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
function severityOrdinal(severity: string): number {
  return SEVERITY_ORDINAL[severity] ?? -1;
}

interface CandidateRow {
  fingerprint: string;
  pattern: string;
  targetSurface: string;
  severity: string;
  hits: number;
  distinctMissions: number;
  corroborated: boolean;
  deferredAtMissions: number | null;
  actionable: boolean;
}

interface FingerprintGroup {
  fingerprint: string;
  pattern: string;
  targetSurface: string;
  severity: string;
  hits: number;
  hasLiveRow: boolean;
  missionIds: Set<string>;
}

/**
 * GET /api/tuning/candidates
 *
 * Groups ALL RetroLearning rows (across every project) by fingerprint, with
 * hits = full historical row count (incl resolved/dismissed) and a
 * representative pattern/targetSurface (latest row wins) / severity
 * (hottest-seen wins). X-Project-ID is still required for auth consistency
 * with the rest of the API, but the candidate set itself is NOT scoped by it.
 *
 * distinctMissions/corroborated are computed here from the same aggregated
 * pass (COUNT(DISTINCT missionId), missionId NOT NULL) rather than by calling
 * getCorroboration() per fingerprint, to avoid N+1 queries — but the
 * threshold itself is imported from the shared lib so it is never re-derived.
 *
 * A corroborated fingerprint is `actionable` only if it has never been
 * deferred (Fingerprint.deferredAtMissions is null) OR distinctMissions has
 * climbed at least DEFER_MARGIN past the watermark recorded at defer time
 * (POST /api/tuning/fingerprints/{slug}/defer). This replaces the old
 * Fingerprint.status dismiss/resurface toggle: deferring never hides a row
 * from this listing, it only flips `actionable` to false until enough new
 * evidence arrives — every candidate is always visible here.
 *
 * ?actionable=true restricts the response to `actionable: true` rows only.
 */
export async function GET(request: Request) {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const actionableOnly = searchParams.get('actionable') === 'true';

    const rows = await prisma.retroLearning.findMany({
      select: {
        fingerprint: true,
        pattern: true,
        targetSurface: true,
        severity: true,
        status: true,
        missionId: true,
      },
      // Oldest-first so the last row iterated per fingerprint is the most
      // recent, matching the representative-field selection below.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const groups = new Map<string, FingerprintGroup>();
    for (const row of rows) {
      let group = groups.get(row.fingerprint);
      if (!group) {
        group = {
          fingerprint: row.fingerprint,
          pattern: row.pattern,
          targetSurface: row.targetSurface,
          severity: row.severity,
          hits: 0,
          hasLiveRow: false,
          missionIds: new Set(),
        };
        groups.set(row.fingerprint, group);
      }
      group.hits += 1;
      if (LIVE_STATUSES.has(row.status)) {
        group.hasLiveRow = true;
      }
      group.pattern = row.pattern;
      group.targetSurface = row.targetSurface;
      if (severityOrdinal(row.severity) > severityOrdinal(group.severity)) {
        group.severity = row.severity;
      }
      if (row.missionId !== null) {
        group.missionIds.add(row.missionId);
      }
    }

    const fingerprintRows = groups.size
      ? await prisma.fingerprint.findMany({
          where: { slug: { in: Array.from(groups.keys()) } },
          select: { slug: true, deferredAtMissions: true },
        })
      : [];
    const fingerprintsBySlug = new Map(fingerprintRows.map((f) => [f.slug, f]));

    const candidates: CandidateRow[] = [];

    for (const group of groups.values()) {
      if (!group.hasLiveRow) {
        continue;
      }

      const distinctMissions = group.missionIds.size;
      const corroborated = distinctMissions >= CORROBORATION_THRESHOLD;
      const deferredAtMissions = fingerprintsBySlug.get(group.fingerprint)?.deferredAtMissions ?? null;
      const actionable =
        corroborated &&
        (deferredAtMissions === null || distinctMissions >= deferredAtMissions + DEFER_MARGIN);

      candidates.push({
        fingerprint: group.fingerprint,
        pattern: group.pattern,
        targetSurface: group.targetSurface,
        severity: group.severity,
        hits: group.hits,
        distinctMissions,
        corroborated,
        deferredAtMissions,
        actionable,
      });
    }

    candidates.sort((a, b) => b.hits - a.hits);

    const data = actionableOnly ? candidates.filter((c) => c.actionable) : candidates;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/tuning/candidates error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch tuning candidates', error).toResponse(),
      { status: 500 }
    );
  }
}
