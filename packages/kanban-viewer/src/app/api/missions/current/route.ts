import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { safeJsonParse } from '@/lib/json-utils';
import type { GetCurrentMissionResponse, ApiError } from '@/types/api';
import type { Mission } from '@/types/mission';
import type { ScalingRationale } from '@/types/mission-scaling';

/**
 * Mission lifecycle states that mean a mission is no longer in flight.
 * Matches the predicate every other mission-scoped route uses
 * (`/api/missions/current/health-report`, `/api/scaling/compute`).
 */
const OVER_STATES = ['completed', 'failed', 'archived'];

/**
 * GET /api/missions/current
 * Returns the current mission for the specified project, or null if none exists.
 *
 * SELECTION PRECEDENCE (both tiers exclude archived missions):
 *   1. The newest ACTIVE mission — `state notIn (completed|failed|archived)`,
 *      ordered by `startedAt desc`.
 *   2. Only if there is no active mission: the newest non-archived mission,
 *      i.e. the just-finished one, ordered by `startedAt desc`.
 *
 * Tier 1 is the fix: this route used to be a bare
 * `findFirst({ projectId, archivedAt: null })` with no state filter and no
 * ordering, so SQLite returned the LOWEST rowid — a stale completed-but-
 * unarchived mission M1 while M2 was actually running. Hannibal's Stop gates
 * then checked M1's evidence bundle (`.qa-evidence/M1/report.md`, a permanent
 * unclearable STALE deadlock) and let M1's completed state and approved
 * verdict satisfy M2's review/post-check gates.
 *
 * Tier 2 exists because "current mission" legitimately outlives the mission's
 * completion: `/ai-team:retro` (commands/retro.md) reads this endpoint AFTER
 * post-checks have moved the mission to `completed`, and warns when the state
 * is anything else. Dropping completed missions entirely would break the
 * Debrief. Consumers that must distinguish the two cases read `state` — the
 * Stop gates do exactly that (see checkPostcheck in
 * scripts/hooks/lib/stop-gates.js).
 *
 * Headers:
 * - X-Project-ID (string, required): Filter by project ID
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: projectValidation.error,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    const mission =
      (await prisma.mission.findFirst({
        where: {
          projectId,
          archivedAt: null,
          state: { notIn: OVER_STATES },
        },
        orderBy: { startedAt: 'desc' },
      })) ??
      // No mission in flight — fall back to the most recently started
      // non-archived mission so the just-completed one stays addressable.
      (await prisma.mission.findFirst({
        where: {
          projectId,
          archivedAt: null,
        },
        orderBy: { startedAt: 'desc' },
      }));

    const data = mission
      ? {
          id: mission.id,
          name: mission.name,
          state: mission.state,
          prdPath: mission.prdPath,
          startedAt: mission.startedAt,
          completedAt: mission.completedAt,
          archivedAt: mission.archivedAt,
          scalingRationale: safeJsonParse<ScalingRationale>(mission.scalingRationale),
        }
      : null;

    const response: GetCurrentMissionResponse = {
      success: true,
      data: data as Mission | null,
    };

    return NextResponse.json(response);
  } catch (error) {
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch current mission',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
