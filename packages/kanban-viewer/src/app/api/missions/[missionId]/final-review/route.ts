/**
 * API Route: /api/missions/[missionId]/final-review
 *
 * POST - Store a final review report on the mission record. When the report's
 *        verdict is FINAL APPROVED, every non-archived item belonging to THIS
 *        mission and sitting in the 'staged' stage is promoted to 'done' in
 *        the SAME transaction that persists the review — a crash
 *        mid-promotion rolls back the review write too, so an approval can
 *        never be recorded against a half-promoted board (WI-790).
 *        An APPROVED verdict is refused with 409 MISSION_NOT_READY when any
 *        non-archived item of the mission is still short of 'staged'/'done'.
 *        Pending items sitting in 'blocked' are reported separately and the
 *        409 spells out the human recovery path, since a blocked item never
 *        advances on its own and would otherwise make the review permanently
 *        un-recordable with nothing telling the operator how to clear it.
 * GET  - Return the stored final review report
 *
 * Both endpoints return 404 when the mission does not exist.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError, createValidationError } from '@/lib/errors';
import { isDependencySatisfied, parseFinalReviewVerdict, type StageId } from '@ai-team/shared';
import type { ApiError } from '@/types/api';
import type { WorkLogAction } from '@/types/item';

interface RouteContext {
  params: Promise<{ missionId: string }>;
}

// Stage IDs are plain strings on the Item model.
const STAGED_STAGE_ID = 'staged';
const DONE_STAGE_ID = 'done';

// WorkLog.agent is a free-form string (not tied to AgentClaim) — this names
// the system as the actor since no agent claim drives this promotion.
const PROMOTION_AGENT = 'system';

// Stage id an item sits in once it has exhausted the rejection cap.
const BLOCKED_STAGE_ID = 'blocked';

/**
 * Recovery instructions appended to the MISSION_NOT_READY 409 when one or more
 * of the pending items is 'blocked'. A blocked item cannot advance on its own —
 * no agent picks it up and nothing in the tail retries it — so without this the
 * operator sees only "finish the pipeline for them" and has no way to act. The
 * precondition itself is deliberate and stays as-is; this only names the two
 * human moves that clear it.
 */
const BLOCKED_RECOVERY_HINT =
  "Blocked items never resolve on their own — a human must act: either move each one back into the pipeline " +
  "(`ateam board-move moveItem --itemId <id> --toStage ready`) and let it finish, or archive it so it leaves " +
  "this mission's promotable population (set archivedAt — `ateam missions-archive archiveMission` archives the " +
  'whole mission; for a single item use updateItem/direct DB). Re-POST this review afterwards.';

/**
 * Interactive-transaction budget for the review write + batch promotion.
 * Prisma's 5s default is tight for a large mission on SQLite; a timeout here
 * rolls back the review write and surfaces as an opaque 500, so give the
 * batch room even on a slow/contended database.
 */
const TRANSACTION_TIMEOUT_MS = 15_000;

/**
 * Raised inside the transaction when an APPROVED verdict arrives while the
 * mission still has items short of `staged`/`done`. Throwing (rather than
 * returning) guarantees the review write is rolled back with the promotion:
 * an approval must never be recorded against a half-finished mission.
 */
class MissionNotReadyError extends Error {
  constructor(
    public readonly pendingItemIds: string[],
    /** Subset of pendingItemIds sitting in 'blocked' — needs a human, not time. */
    public readonly blockedItemIds: string[] = []
  ) {
    super('MISSION_NOT_READY');
  }

  /** pendingItemIds that are merely mid-pipeline — they finish on their own. */
  get unfinishedItemIds(): string[] {
    const blocked = new Set(this.blockedItemIds);
    return this.pendingItemIds.filter((id) => !blocked.has(id));
  }
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

    // A malformed body is a client error, not a server fault — parse it in
    // its own guard so it surfaces as 400 VALIDATION_ERROR instead of
    // falling through to the catch-all 500 (same pattern as /api/board/move).
    let body: { finalReview?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(createValidationError('Invalid JSON body').toResponse(), { status: 400 });
    }

    const { finalReview } = body ?? {};

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
    const promotedCount = await prisma.$transaction(
      async (tx) => {
        // Read the mission's promotable population BEFORE writing anything, so
        // a not-ready mission rolls back without ever persisting the review.
        //
        // Scope to items belonging to THIS mission, through the same
        // MissionItem join every other mission-scoped query uses (agents/stop,
        // missions/archive, missions/current/health-report). A project-wide
        // sweep would promote staged leftovers from earlier missions — archival
        // stamps archivedAt but never clears stageId, so an archived mission can
        // legitimately leave items parked in 'staged' — and would credit this
        // mission's review in their work logs. Archived items are excluded even
        // when linked to this mission: a soft-deleted item is not promotable.
        const missionItems =
          verdict === 'approved'
            ? await tx.item.findMany({
                where: {
                  projectId,
                  archivedAt: null,
                  missionItems: { some: { missionId } },
                },
                select: { id: true, stageId: true },
              })
            : [];

        // An APPROVED verdict may only land on a mission whose every item has
        // finished the per-item pipeline. Anything short of 'staged'/'done'
        // (including 'blocked') means the tail was dispatched early: promoting
        // now would half-promote the board and strand the stragglers, since
        // nothing re-runs the tail after this write. Stage membership comes
        // from the shared isDependencySatisfied() so this stays in lockstep
        // with every other "is this item finished?" check (WI-788).
        const pendingItems = missionItems.filter(
          ({ stageId }) => !isDependencySatisfied(stageId as StageId)
        );
        if (pendingItems.length > 0) {
          // Blocked items are called out separately: unlike a mid-pipeline item
          // they will never advance on their own, so the 409 has to name the
          // human recovery path or the review becomes permanently un-recordable.
          throw new MissionNotReadyError(
            pendingItems.map(({ id }) => id),
            pendingItems.filter(({ stageId }) => stageId === BLOCKED_STAGE_ID).map(({ id }) => id)
          );
        }

        await tx.mission.update({
          where: { id: missionId },
          data: { finalReview },
        });

        const stagedIds = missionItems
          .filter(({ stageId }) => stageId === STAGED_STAGE_ID)
          .map(({ id }) => id);

        if (stagedIds.length === 0) {
          return 0;
        }

        // Batch both writes: a per-item loop of two awaited queries serializes
        // 2N round-trips inside the interactive transaction and can blow the
        // timeout on a large mission, rolling back the review write.
        await tx.item.updateMany({
          where: { id: { in: stagedIds } },
          data: { stageId: DONE_STAGE_ID },
        });
        await tx.workLog.createMany({
          data: stagedIds.map((id) => ({
            itemId: id,
            agent: PROMOTION_AGENT,
            action: 'note' as WorkLogAction,
            summary: `Promoted to done — Stockwell's final review for mission ${missionId} was FINAL APPROVED`,
          })),
        });

        return stagedIds.length;
      },
      { timeout: TRANSACTION_TIMEOUT_MS }
    );

    return NextResponse.json({
      success: true,
      data: { missionId, promotedCount },
    });
  } catch (error) {
    if (error instanceof MissionNotReadyError) {
      const { pendingItemIds, blockedItemIds, unfinishedItemIds } = error;
      const blockedClause =
        blockedItemIds.length > 0
          ? ` ${blockedItemIds.length} of them are blocked (${blockedItemIds.join(', ')}). ${BLOCKED_RECOVERY_HINT}`
          : '';
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MISSION_NOT_READY',
            message:
              `Cannot record a FINAL APPROVED review: ${pendingItemIds.length} item(s) in this mission ` +
              `have not reached 'staged' or 'done' yet. Finish the pipeline for them before running the mission tail.` +
              blockedClause,
            details: { pendingItemIds, blockedItemIds, unfinishedItemIds },
          },
        },
        { status: 409 }
      );
    }
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
