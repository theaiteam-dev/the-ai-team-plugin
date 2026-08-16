/**
 * API Route: /api/missions/[missionId]/final-review
 *
 * POST - Store a final review report on the mission record. When the report's
 *        verdict is FINAL APPROVED, every item in this project sitting in the
 *        'staged' stage is promoted to 'done' in the SAME transaction that
 *        persists the review — a crash mid-promotion rolls back the review
 *        write too, so an approval can never be recorded against a
 *        half-promoted board (WI-790).
 * GET  - Return the stored final review report
 *
 * Both endpoints return 404 when the mission does not exist.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError } from '@/lib/errors';
import { parseFinalReviewVerdict } from '@/lib/final-review-verdict';
import type { ApiError } from '@/types/api';
import type { WorkLogAction } from '@/types/item';

interface RouteContext {
  params: Promise<{ missionId: string }>;
}

// Stage IDs are plain strings on the Item model (no shared enum import here
// to keep this route's promotion logic dependency-free of @ai-team/shared's
// full stage graph — it only ever moves items in exactly one direction).
const STAGED_STAGE_ID = 'staged';
const DONE_STAGE_ID = 'done';

// WorkLog.agent is a free-form string (not tied to AgentClaim) — this names
// the system as the actor since no agent claim drives this promotion.
const PROMOTION_AGENT = 'system';

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

    const verdict = parseFinalReviewVerdict(finalReview);
    const { projectId } = projectValidation;

    // Safe to update by unique id now that we've confirmed the mission belongs to this project.
    // The review write and the staged->done promotion share one transaction so a failure
    // partway through promotion rolls back the review persistence too (WI-790 AC2).
    const promotedCount = await prisma.$transaction(async (tx) => {
      await tx.mission.update({
        where: { id: missionId },
        data: { finalReview },
      });

      if (verdict !== 'approved') {
        return 0;
      }

      const stagedItems = await tx.item.findMany({
        where: { projectId, stageId: STAGED_STAGE_ID },
        select: { id: true },
      });

      for (const { id } of stagedItems) {
        await tx.item.update({
          where: { id },
          data: { stageId: DONE_STAGE_ID },
        });
        await tx.workLog.create({
          data: {
            itemId: id,
            agent: PROMOTION_AGENT,
            action: 'note' as WorkLogAction,
            summary: `Promoted to done — Stockwell's final review for mission ${missionId} was FINAL APPROVED`,
          },
        });
      }

      return stagedItems.length;
    });

    return NextResponse.json({
      success: true,
      data: { missionId, promotedCount },
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
