import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { safeJsonParse } from '@/lib/json-utils';
import type { GetCurrentMissionResponse, ApiError } from '@/types/api';
import type { Mission } from '@/types/mission';
import type { ScalingRationale } from '@/types/mission-scaling';

/**
 * GET /api/missions/current
 * Returns the current active mission (not archived) for the specified project or null if none exists.
 *
 * Query parameters:
 * - projectId (string, required): Filter by project ID
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

    const mission = await prisma.mission.findFirst({
      where: {
        projectId,
        archivedAt: null,
      },
    });

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
