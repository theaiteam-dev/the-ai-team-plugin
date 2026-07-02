/**
 * API Route: /api/learnings/fingerprints
 *
 * GET - Return the project's top-50 existing RetroLearning fingerprints,
 *       ranked by recency-weighted hit count, so the retro agent can decide
 *       match-or-create instead of minting a duplicate slug.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError } from '@/lib/errors';
import type { ApiError } from '@/types/api';

const MAX_RESULTS = 50;

interface FingerprintSummary {
  fingerprint: string;
  pattern: string;
  title: string;
  hitCount: number;
}

interface FingerprintGroup extends FingerprintSummary {
  mostRecentCreatedAt: Date;
}

/**
 * Weight a fingerprint's most recent activity so that, all else equal, more
 * recent activity ranks higher. Grouping in JS (rather than raw SQL) because
 * SQLite has no clean built-in for a recency-decayed aggregate.
 */
function recencyWeight(mostRecentCreatedAt: Date, now: number): number {
  const ageDays = Math.max(now - mostRecentCreatedAt.getTime(), 0) / (1000 * 60 * 60 * 24);
  return 1 / (1 + ageDays);
}

/**
 * GET /api/learnings/fingerprints
 *
 * Reads all RetroLearning rows for the project (every status — capture never
 * filters on status, so dismissed/resolved fingerprints still surface for
 * matching), groups them by fingerprint, and ranks the groups by
 * recency-weighted hit count, best-first, capped at 50.
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
    });

    const groups = new Map<string, FingerprintGroup>();
    for (const row of rows) {
      const existing = groups.get(row.fingerprint);
      if (!existing) {
        groups.set(row.fingerprint, {
          fingerprint: row.fingerprint,
          pattern: row.pattern,
          title: row.title,
          hitCount: 1,
          mostRecentCreatedAt: row.createdAt,
        });
      } else {
        existing.hitCount += 1;
        if (row.createdAt > existing.mostRecentCreatedAt) {
          existing.mostRecentCreatedAt = row.createdAt;
        }
      }
    }

    const now = Date.now();
    const ranked = Array.from(groups.values())
      .sort(
        (a, b) =>
          b.hitCount * recencyWeight(b.mostRecentCreatedAt, now) -
          a.hitCount * recencyWeight(a.mostRecentCreatedAt, now)
      )
      .slice(0, MAX_RESULTS)
      .map(({ fingerprint, pattern, title, hitCount }): FingerprintSummary => ({
        fingerprint,
        pattern,
        title,
        hitCount,
      }));

    return NextResponse.json({ success: true, data: ranked });
  } catch (error) {
    console.error('GET /api/learnings/fingerprints error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch learning fingerprints', error).toResponse(),
      { status: 500 }
    );
  }
}
