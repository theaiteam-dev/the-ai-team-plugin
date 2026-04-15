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
    const { finalReview } = body as { finalReview?: unknown };

    // Validate finalReview body field: must be a non-empty string
    if (!finalReview || typeof finalReview !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'finalReview field is required and must be a string',
          },
        },
        { status: 400 }
      );
    }

    // Scope the lookup to the requesting project so one project cannot read or overwrite
    // another project's mission even if it guesses or leaks the mission ID.
    const mission = await prisma.mission.findFirst({
      where: { id: missionId, projectId: projectValidation.projectId },
    });
    if (!mission) {
      return NextResponse.json(
        { success: false, error: { code: 'MISSION_NOT_FOUND', message: `Mission ${missionId} not found` } },
        { status: 404 }
      );
    }

    // Safe to update by unique id now that we've confirmed the mission belongs to this project
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

    // Scope lookup to the requesting project so cross-project existence is not leaked
    const mission = await prisma.mission.findFirst({
      where: { id: missionId, projectId: projectValidation.projectId },
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
