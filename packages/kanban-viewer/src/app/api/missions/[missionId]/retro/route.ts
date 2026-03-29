/**
 * API Route: /api/missions/[missionId]/retro
 *
 * POST - Store a retrospective report on the mission record
 * GET  - Return the stored retrospective report
 *
 * Both endpoints return 404 when the mission does not exist.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError } from '@/lib/errors';
import type { ApiError } from '@/types/api';

interface RouteContext {
  params: Promise<{ missionId: string }>;
}

/**
 * POST /api/missions/:missionId/retro
 *
 * Body: { retroReport: string }
 *
 * Stores the retrospective report markdown on the mission record.
 * Returns 404 if the mission does not exist.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { missionId } = await context.params;

    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const body = await request.json();
    const { retroReport } = body as { retroReport: string };

    const mission = await prisma.mission.findUnique({ where: { id: missionId } });
    if (!mission) {
      return NextResponse.json(
        { success: false, error: { code: 'MISSION_NOT_FOUND', message: `Mission ${missionId} not found` } },
        { status: 404 }
      );
    }

    await prisma.mission.update({
      where: { id: missionId },
      data: { retroReport },
    });

    return NextResponse.json({
      success: true,
      data: { missionId },
    });
  } catch (error) {
    console.error('POST /api/missions/[missionId]/retro error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to store retro report', error).toResponse(),
      { status: 500 }
    );
  }
}

/**
 * GET /api/missions/:missionId/retro
 *
 * Returns the stored retrospective report for the mission.
 * Returns 404 if the mission does not exist.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { missionId } = await context.params;

    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const mission = await prisma.mission.findUnique({
      where: { id: missionId },
      select: { retroReport: true },
    });

    if (!mission) {
      return NextResponse.json(
        { success: false, error: { code: 'MISSION_NOT_FOUND', message: `Mission ${missionId} not found` } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        missionId,
        retroReport: mission.retroReport,
      },
    });
  } catch (error) {
    console.error('GET /api/missions/[missionId]/retro error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch retro report', error).toResponse(),
      { status: 500 }
    );
  }
}
