/**
 * API Route Handler for POST /api/board/move
 *
 * Moves a work item between stages with full validation:
 * - Validates item exists
 * - Validates stage transition against transition matrix
 * - Checks WIP limits (can be overridden with force flag)
 * - Updates item timestamp
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  createValidationError,
  createItemNotFoundError,
  createInvalidTransitionError,
  createWipLimitExceededError,
  createDatabaseError,
} from '@/lib/errors';
import { isValidTransition, checkWipLimit } from '@/lib/validation';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { transformItemToResponse } from '@/lib/item-transform';
import { getRejectionEscalationThreshold } from '@/app/api/agents/stop/route';
import type { StageId } from '@/types/board';
import type { MoveItemRequest, MoveItemResponse } from '@/types/api';
import type { WorkLogAction } from '@/types/item';

const TAIL_REWORK_AGENT = 'Hannibal';

/** Typed error for WIP limit exceeded within a transaction. */
class WipLimitError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number
  ) {
    super('WIP_LIMIT_EXCEEDED');
  }
}

/** Valid stage IDs for validation */
const VALID_STAGES: StageId[] = [
  'briefings',
  'ready',
  'testing',
  'implementing',
  'probing',
  'review',
  'staged',
  'done',
  'blocked',
];

/**
 * Check if a string is a valid StageId.
 */
function isValidStageId(stage: string): stage is StageId {
  return VALID_STAGES.includes(stage as StageId);
}

/**
 * POST /api/board/move
 *
 * Move an item between stages.
 * Request body: MoveItemRequest { itemId, toStage, force? }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: { code: projectValidation.error.code, message: projectValidation.error.message } },
        { status: 400 }
      );
    }
    const projectId = projectValidation.projectId;

    // Parse request body
    let body: MoveItemRequest;
    try {
      body = await request.json();
    } catch {
      const error = createValidationError('Invalid JSON body');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Validate required fields
    if (!body.itemId) {
      const error = createValidationError('itemId is required');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    if (!body.toStage) {
      const error = createValidationError('toStage is required');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Validate toStage is a valid stage ID
    if (!isValidStageId(body.toStage)) {
      const error = createValidationError(`Invalid stage: ${body.toStage}`);
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    const { itemId, toStage, force = false } = body;

    // Find the item (must belong to the specified project)
    let item;
    try {
      item = await prisma.item.findFirst({
        where: { id: itemId, projectId },
      });
    } catch (dbError) {
      console.error('Database error during item lookup:', dbError);
      return NextResponse.json(createDatabaseError('Database error during item lookup', dbError).toResponse(), { status: 500 });
    }

    // Check item exists and belongs to project
    if (!item) {
      const error = createItemNotFoundError(itemId);
      return NextResponse.json(error.toResponse(), { status: 404 });
    }

    const fromStage = item.stageId as StageId;

    // Validate stage transition (against the originally requested toStage —
    // an escalation override to 'blocked' below bypasses this check the
    // same way agentStop's rejection branch does, since 'blocked' is always
    // a legal landing spot for an item that hit the rejection cap).
    if (!isValidTransition(fromStage, toStage)) {
      const error = createInvalidTransitionError(fromStage, toStage);
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // WI-794: a move out of 'staged' to 'testing' or 'implementing' is
    // Hannibal executing Frankie/Stockwell's tail rework decision — no
    // agent holds a claim on the item by tail time, so agentStop's
    // rejection path is unavailable (adr/0005). This counts against the
    // SAME rejection cap Lynch/Amy rejections use, and escalates to
    // 'blocked' at the cap exactly like agentStop's rejection branch —
    // computed here, before the WIP check, so an escalation's WIP
    // evaluation runs against the RESOLVED destination ('blocked', always
    // unlimited), not the originally-requested stage the item never lands in.
    //
    // Deliberately narrower than "anything but the promotion to done":
    // staged->ready is the manual-operator-recovery transition (structurally
    // identical to probing->ready, which CLAUDE.md documents as existing
    // "for manual operator recovery... but no pipeline agent uses it as a
    // rejection target") — it must NOT count against the cap, or a healthy
    // item repeatedly re-decomposed via that recovery path would eventually
    // escalate to blocked purely from operator recovery actions.
    const isTailRework = fromStage === 'staged' && (toStage === 'testing' || toStage === 'implementing');
    const newRejectionCount = isTailRework ? item.rejectionCount + 1 : item.rejectionCount;
    const escalated = isTailRework && newRejectionCount >= getRejectionEscalationThreshold();
    const resolvedStage: StageId = escalated ? 'blocked' : toStage;

    // Get resolved-stage configuration for WIP limit check
    const targetStage = await prisma.stage.findUnique({
      where: { id: resolvedStage },
    });

    const wipLimit = targetStage?.wipLimit ?? null;

    // Wrap WIP limit check and update (+ tail-rework counting) in a
    // transaction to prevent race conditions where two concurrent requests
    // both pass the WIP check then both execute updates, and so a WIP
    // failure can never leave a counted rejection with the item still in
    // staged (AC6).
    let updatedItem;
    let newCount: number;
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Count items currently in the resolved target stage (for this project only)
        const currentCount = await tx.item.count({
          where: { stageId: resolvedStage, projectId, archivedAt: null },
        });

        // Check WIP limit unless force flag is set
        if (!force) {
          const wipCheck = checkWipLimit(resolvedStage, currentCount, wipLimit);
          if (!wipCheck.allowed) {
            throw new WipLimitError(wipLimit!, currentCount);
          }
        }

        // Update the item
        const item = await tx.item.update({
          where: { id: itemId },
          data: {
            stageId: resolvedStage,
            updatedAt: new Date(),
            ...(isTailRework && { rejectionCount: { increment: 1 } }),
          },
        });

        // Distinct from the generic Lynch/Amy 'rejected' work_log shape —
        // deliberate refinement-gate decision so retros can measure
        // found-by-the-tail independently from found-in-per-item-review.
        if (isTailRework) {
          await tx.workLog.create({
            data: {
              agent: TAIL_REWORK_AGENT,
              action: 'tail_rework' as WorkLogAction,
              summary: `Tail rework: moved from staged to ${resolvedStage}${
                escalated ? ' (rejection cap reached)' : ''
              }`,
              itemId,
            },
          });
        }

        return { item, newCount: currentCount + 1 };
      });

      updatedItem = result.item;
      newCount = result.newCount;
    } catch (dbError) {
      // Check if this is a WIP limit exceeded error from the transaction
      if (dbError instanceof WipLimitError) {
        const error = createWipLimitExceededError(resolvedStage, dbError.limit, dbError.current);
        return NextResponse.json(error.toResponse(), { status: 400 });
      }

      console.error('Database error during item update:', dbError);
      return NextResponse.json(createDatabaseError('Database error during item update', dbError).toResponse(), { status: 500 });
    }

    // Calculate WIP status (after the move)
    const available = wipLimit !== null ? Math.max(0, wipLimit - newCount) : null;

    const response: MoveItemResponse = {
      success: true,
      data: {
        item: transformItemToResponse(updatedItem),
        previousStage: fromStage,
        wipStatus: {
          stageId: resolvedStage,
          limit: wipLimit,
          current: newCount,
          available,
        },
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('POST /api/board/move error:', error);
    return NextResponse.json(createDatabaseError('Internal server error', error).toResponse(), { status: 500 });
  }
}
