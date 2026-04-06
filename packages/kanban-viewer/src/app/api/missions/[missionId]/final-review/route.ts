/**
 * API Route: /api/missions/[missionId]/final-review
 *
 * POST - Store a final review report on the mission record
 * GET  - Return the stored final review report
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
 * POST /api/missions/:missionId/final-review
 *
 * Body: { finalReview: string }
 *
 * Stores the final review report markdown on the mission record.
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
    const { finalReview } = body as { finalReview: string };

    const mission = await prisma.mission.findUnique({ where: { id: missionId } });
    if (!mission) {
      return NextResponse.json(
        { success: false, error: { code: 'MISSION_NOT_FOUND', message: `Mission ${missionId} not found` } },
        { status: 404 }
      );
    }

    await prisma.mission.update({
      where: { id: missionId },
      data: { finalReview },
    });

    return NextResponse.json({
      success: true,
      data: { missionId },
    });
  } catch (error) {
    console.error('POST /api/missions/[missionId]/final-review error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to store final review report', error).toResponse(),
      { status: 500 }
    );
  }
}

/**
 * GET /api/missions/:missionId/final-review
 *
 * Returns the stored final review report for the mission.
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
      select: { finalReview: true },
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
        finalReview: mission.finalReview,
      },
    });
  } catch (error) {
    console.error('GET /api/missions/[missionId]/final-review error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch final review report', error).toResponse(),
      { status: 500 }
    );
  }
}
