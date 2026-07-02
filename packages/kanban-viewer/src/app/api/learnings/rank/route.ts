/**
 * API Route: /api/learnings/rank
 *
 * GET - Rank the project's RetroLearning fingerprints by cross-mission
 *       recurrence, surfacing only fingerprints with live demand.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError } from '@/lib/errors';
import type { ApiError } from '@/types/api';

const LIVE_STATUSES = new Set(['open', 'recurred']);

interface RankRow {
  fingerprint: string;
  pattern: string;
  targetSurface: string;
  severity: string;
  hits: number;
}

interface RankGroup extends RankRow {
  hasLiveRow: boolean;
}

/**
 * GET /api/learnings/rank
 *
 * Reads all RetroLearning rows for the project, groups them by fingerprint,
 * excludes groups with no 'open' or 'recurred' row (HAVING SUM(open|recurred)
 * > 0), and orders the rest by hits (COUNT of every row in the group,
 * including resolved/dismissed ones) DESC. pattern/targetSurface/severity are
 * taken from the first row seen since a fingerprint's rows share them.
 */
export async function GET(request: Request) {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const rows = await prisma.retroLearning.findMany({
      where: { projectId: projectValidation.projectId },
      select: { fingerprint: true, pattern: true, targetSurface: true, severity: true, status: true },
    });

    const groups = new Map<string, RankGroup>();
    for (const row of rows) {
      const existing = groups.get(row.fingerprint);
      if (!existing) {
        groups.set(row.fingerprint, {
          fingerprint: row.fingerprint,
          pattern: row.pattern,
          targetSurface: row.targetSurface,
          severity: row.severity,
          hits: 1,
          hasLiveRow: LIVE_STATUSES.has(row.status),
        });
      } else {
        existing.hits += 1;
        if (LIVE_STATUSES.has(row.status)) {
          existing.hasLiveRow = true;
        }
      }
    }

    const ranked = Array.from(groups.values())
      .filter((group) => group.hasLiveRow)
      .sort((a, b) => b.hits - a.hits)
      .map(({ fingerprint, pattern, targetSurface, severity, hits }): RankRow => ({
        fingerprint,
        pattern,
        targetSurface,
        severity,
        hits,
      }));

    return NextResponse.json({ success: true, data: ranked });
  } catch (error) {
    console.error('GET /api/learnings/rank error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch ranked learnings', error).toResponse(),
      { status: 500 }
    );
  }
}
