import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import type { ApiError } from '@/types/api';
import type { MissionState, MissionPrecheckOutput } from '@/types/mission';

/**
 * GET /api/missions/:missionId
 *
 * Returns full mission details by ID, including archived missions.
 * Requires X-Project-ID header.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: projectValidation.error,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const { missionId } = await params;

    const mission = await prisma.mission.findUnique({
      where: { id: missionId },
    });

    if (!mission) {
      const apiError: ApiError = {
        success: false,
        error: {
          code: 'MISSION_NOT_FOUND',
          message: `Mission ${missionId} not found`,
        },
      };
      return NextResponse.json(apiError, { status: 404 });
    }

    const parseJsonField = <T>(field: unknown): T | null => {
      if (field === null || field === undefined) return null;
      if (typeof field === 'string') return JSON.parse(field) as T;
      return field as T;
    };

    const responseData = {
      id: mission.id,
      name: mission.name,
      state: mission.state as MissionState,
      prdPath: mission.prdPath,
      startedAt: mission.startedAt,
      completedAt: mission.completedAt,
      archivedAt: mission.archivedAt,
      precheckBlockers: parseJsonField<string[]>(mission.precheckBlockers),
      precheckOutput: parseJsonField<MissionPrecheckOutput>(mission.precheckOutput),
    };

    return NextResponse.json({ success: true, data: responseData });
  } catch (error) {
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch mission',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
