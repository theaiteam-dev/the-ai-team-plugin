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

// Severity is stored as a string; SQL MAX() would order it lexicographically
// (critical < high < low < medium), so the "hottest" severity in a group must
// be derived from an explicit ordinal rather than a raw MAX. Unknown severities
// sort below every known one.
const SEVERITY_ORDINAL: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
function severityOrdinal(severity: string): number {
  return SEVERITY_ORDINAL[severity] ?? -1;
}

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
 * Reads the project's RetroLearning rows (projected — no `detail` blob),
 * groups them by fingerprint, excludes groups with no 'open' or 'recurred' row
 * (HAVING SUM(open|recurred) > 0), and orders the rest by hits (COUNT of every
 * row in the group, including resolved/dismissed ones) DESC.
 *
 * The representative fields are NOT taken from an arbitrary first row: a
 * fingerprint's severity can escalate on recurrence (e.g. filed `low`, refiled
 * `critical`), and its pattern/targetSurface can drift. So `severity` is the
 * MAX across the group by explicit ordinal (surface what's currently hottest),
 * and pattern/targetSurface come from the most-recently-created row (rows are
 * read oldest-first, so the last write wins). Grouping stays in JS rather than
 * a Prisma `groupBy` because neither the ordinal-max severity nor the
 * latest-row field selection is cleanly expressible as a SQL aggregate.
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
      select: { fingerprint: true, pattern: true, targetSurface: true, severity: true, status: true, createdAt: true },
      // Oldest-first so the last row iterated per fingerprint is the most
      // recent; the id tiebreaker keeps representative-field selection
      // deterministic when two rows share a createdAt.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
        // Rows arrive oldest-first: the latest row owns pattern/targetSurface.
        existing.pattern = row.pattern;
        existing.targetSurface = row.targetSurface;
        // Severity is the hottest seen across the whole group, not the latest.
        if (severityOrdinal(row.severity) > severityOrdinal(existing.severity)) {
          existing.severity = row.severity;
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
