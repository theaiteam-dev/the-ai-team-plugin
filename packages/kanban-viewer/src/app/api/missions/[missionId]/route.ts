import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { safeJsonParse } from '@/lib/json-utils';
import type { ApiError } from '@/types/api';
import type { MissionState, MissionPrecheckOutput } from '@/types/mission';
import type { ScalingRationale } from '@/types/mission-scaling';

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

    const projectId = projectValidation.projectId;
    const { missionId } = await params;

    const mission = await prisma.mission.findUnique({
      where: { id: missionId, projectId },
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

    const responseData = {
      id: mission.id,
      name: mission.name,
      state: mission.state as MissionState,
      prdPath: mission.prdPath,
      startedAt: mission.startedAt,
      completedAt: mission.completedAt,
      archivedAt: mission.archivedAt,
      precheckBlockers: safeJsonParse<string[]>(mission.precheckBlockers),
      precheckOutput: safeJsonParse<MissionPrecheckOutput>(mission.precheckOutput),
      scalingRationale: safeJsonParse<ScalingRationale>(mission.scalingRationale),
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

/**
 * PATCH /api/missions/:missionId
 *
 * Updates mission fields. Currently supports updating scalingRationale.
 * Requires X-Project-ID header.
 */
export async function PATCH(
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

    const projectId = projectValidation.projectId;
    const { missionId } = await params;

    let body: { scalingRationale?: ScalingRationale };
    try {
      body = await request.json();
    } catch {
      const apiError: ApiError = {
        success: false,
        error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    const mission = await prisma.mission.findUnique({
      where: { id: missionId, projectId },
    });

    if (!mission) {
      const apiError: ApiError = {
        success: false,
        error: { code: 'MISSION_NOT_FOUND', message: `Mission ${missionId} not found` },
      };
      return NextResponse.json(apiError, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.scalingRationale !== undefined) {
      updateData.scalingRationale = JSON.stringify(body.scalingRationale);
    }

    const updated = await prisma.mission.update({
      where: { id: missionId, projectId },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        scalingRationale: safeJsonParse<ScalingRationale>(updated.scalingRationale),
      },
    });
  } catch (error) {
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to update mission',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
