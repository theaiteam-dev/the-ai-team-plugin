/**
 * API Route Handler for POST /api/agents/stop
 *
 * Allows an agent to stop work on a claimed item, performing:
 * - Delete agent claim
 * - Clear assignedAgent on item
 * - Create WorkLog entry with provided summary
 * - Move item to next stage based on outcome
 *
 * outcome='rejected': moves item backward to returnTo stage, increments rejectionCount.
 * Escalates to 'blocked' when rejectionCount reaches REJECTION_ESCALATION_THRESHOLD.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  createValidationError,
  createItemNotFoundError,
  createDatabaseError,
} from '@/lib/errors';
import { getAndValidateProjectId } from '@/lib/project-utils';
import type { AgentStopRequest, AgentStopResponse, ApiError } from '@/types/api';
import type { AgentName } from '@/types/agent';
import type { StageId } from '@/types/board';
import type { WorkLogEntry, WorkLogAction } from '@/types/item';
import { PIPELINE_STAGES, isValidAgent, type StageId as SharedStageId } from '@ai-team/shared';
import { logApiError } from '@/lib/api-logger';

const VALID_OUTCOMES = ['completed', 'blocked', 'rejected'] as const;
const VALID_RETURN_TO_STAGES: StageId[] = ['ready', 'testing', 'implementing', 'review', 'probing'];
const REJECTION_ESCALATION_THRESHOLD = 2;

/**
 * POST /api/agents/stop
 *
 * Stop work on a claimed item, releasing claim and moving to next stage.
 *
 * Request body: AgentStopRequest { itemId: string, agent: AgentName, summary: string, outcome?: 'completed' | 'blocked' }
 * Response: AgentStopResponse with workLogEntry and nextStage
 *
 * Error codes:
 * - VALIDATION_ERROR (400): Missing or invalid request fields
 * - ITEM_NOT_FOUND (404): Item does not exist
 * - NOT_CLAIMED (400): Item has no active claim
 * - CLAIM_MISMATCH (403): Item claimed by different agent
 * - DATABASE_ERROR (500): Database operation failed
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<AgentStopResponse | ApiError>> {
  try {
    // Extract and validate projectId from header
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: projectValidation.error.code,
          message: 'X-Project-ID header is required',
        },
      };
      logApiError('POST /api/agents/stop', 400, errorResponse.error.code, errorResponse.error.message);
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    // Parse request body
    let body: AgentStopRequest;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(createValidationError('Invalid JSON body').toResponse(), { status: 400 });
    }

    // Validate required fields
    if (!body.itemId) {
      logApiError('POST /api/agents/stop', 400, 'VALIDATION_ERROR', 'itemId is required', { agent: body.agent });
      return NextResponse.json(createValidationError('itemId is required').toResponse(), { status: 400 });
    }

    if (!body.agent) {
      logApiError('POST /api/agents/stop', 400, 'VALIDATION_ERROR', 'agent is required', { itemId: body.itemId });
      return NextResponse.json(createValidationError('agent is required').toResponse(), { status: 400 });
    }

    if (!body.summary) {
      logApiError('POST /api/agents/stop', 400, 'VALIDATION_ERROR', 'summary is required', { agent: body.agent, itemId: body.itemId });
      return NextResponse.json(createValidationError('summary is required').toResponse(), { status: 400 });
    }

    // Validate agent name
    if (!isValidAgent(body.agent)) {
      logApiError('POST /api/agents/stop', 400, 'VALIDATION_ERROR', `Invalid agent name: ${body.agent}`, { agent: body.agent, itemId: body.itemId });
      return NextResponse.json(createValidationError(`Invalid agent name: ${body.agent}`).toResponse(), { status: 400 });
    }

    // Validate outcome if provided
    if (body.outcome !== undefined && !VALID_OUTCOMES.includes(body.outcome)) {
      logApiError('POST /api/agents/stop', 400, 'VALIDATION_ERROR', 'Invalid outcome value', { agent: body.agent, itemId: body.itemId, outcome: body.outcome });
      return NextResponse.json(createValidationError('Invalid outcome value').toResponse(), { status: 400 });
    }

    // returnTo is only valid with outcome=rejected, and required when outcome=rejected
    if (body.outcome === 'rejected' && !body.returnTo) {
      logApiError('POST /api/agents/stop', 400, 'VALIDATION_ERROR', 'returnTo is required when outcome=rejected', { agent: body.agent, itemId: body.itemId });
      return NextResponse.json(createValidationError('returnTo is required when outcome=rejected').toResponse(), { status: 400 });
    }

    if (body.returnTo && body.outcome !== 'rejected') {
      logApiError('POST /api/agents/stop', 400, 'VALIDATION_ERROR', 'returnTo is only valid when outcome=rejected', { agent: body.agent, itemId: body.itemId });
      return NextResponse.json(createValidationError('returnTo is only valid when outcome=rejected').toResponse(), { status: 400 });
    }

    if (body.returnTo && !VALID_RETURN_TO_STAGES.includes(body.returnTo as StageId)) {
      logApiError('POST /api/agents/stop', 400, 'VALIDATION_ERROR', `Invalid returnTo stage: ${body.returnTo}`, { agent: body.agent, itemId: body.itemId });
      return NextResponse.json(createValidationError(`Invalid returnTo stage: ${body.returnTo}`).toResponse(), { status: 400 });
    }

    // Check if item exists and belongs to the specified project
    const item = await prisma.item.findFirst({
      where: { id: body.itemId, projectId },
    });

    if (!item) {
      logApiError('POST /api/agents/stop', 404, 'ITEM_NOT_FOUND', `Item not found: ${body.itemId}`, { agent: body.agent, itemId: body.itemId });
      return NextResponse.json(createItemNotFoundError(body.itemId).toResponse(), { status: 404 });
    }

    // Check if item has an active claim
    const claim = await prisma.agentClaim.findFirst({
      where: { itemId: body.itemId },
    });

    if (!claim) {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'NOT_CLAIMED',
          message: `Item ${body.itemId} is not currently claimed`,
        },
      };
      logApiError('POST /api/agents/stop', 400, 'NOT_CLAIMED', errorResponse.error.message, { agent: body.agent, itemId: body.itemId, currentStage: item.stageId });
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Verify claim belongs to requesting agent
    if (claim.agentName !== body.agent) {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'CLAIM_MISMATCH',
          message: `Item ${body.itemId} is claimed by ${claim.agentName}, not ${body.agent}`,
          details: { claimedBy: claim.agentName },
        },
      };
      logApiError('POST /api/agents/stop', 403, 'CLAIM_MISMATCH', errorResponse.error.message, { agent: body.agent, itemId: body.itemId, claimedBy: claim.agentName });
      return NextResponse.json(errorResponse, { status: 403 });
    }

    const outcome = body.outcome ?? 'completed';

    // Determine target stage for the completed/blocked path up front (read-only, safe outside tx)
    let nextStage: StageId = 'review';
    let action: WorkLogAction = 'completed';
    if (outcome !== 'rejected') {
      if (outcome === 'blocked') {
        nextStage = 'blocked';
      } else {
        const pipelineInfo = PIPELINE_STAGES[item.stageId as SharedStageId];
        nextStage = (pipelineInfo?.nextStage as StageId) ?? 'review';
      }
      action = outcome === 'blocked' ? 'note' : 'completed';
    }

    const advance = body.advance !== false;

    // Execute claim release + work log + item update atomically inside a transaction.
    // This prevents a race where two concurrent stops both pass the WIP check and both advance.
    type TxResult =
      | {
          kind: 'rejected';
          workLog: { id: number; agent: string; action: string; summary: string; timestamp: Date };
          targetStage: StageId;
          newRejectionCount: number;
          escalated: boolean;
        }
      | {
          kind: 'completed';
          workLog: { id: number; agent: string; action: string; summary: string; timestamp: Date };
          wipExceeded: boolean;
          shouldAdvance: boolean;
          nextStage: StageId;
        };

    const txResult: TxResult = await prisma.$transaction(async (tx) => {
      // Always release the claim — the work happened regardless of what comes next
      const deleted = await tx.agentClaim.deleteMany({
        where: { itemId: body.itemId },
      });

      // Handle rejection path: increment counter, maybe escalate, move backward
      if (outcome === 'rejected') {
        const returnTo = body.returnTo as StageId;
        const newRejectionCount = item.rejectionCount + 1;
        const escalated = newRejectionCount >= REJECTION_ESCALATION_THRESHOLD;
        const targetStage: StageId = escalated ? 'blocked' : returnTo;

        const workLog = await tx.workLog.create({
          data: {
            agent: body.agent,
            action: 'rejected' as WorkLogAction,
            summary: body.summary,
            itemId: body.itemId,
          },
        });

        await tx.item.update({
          where: { id: body.itemId },
          data: {
            stageId: targetStage,
            assignedAgent: null,
            rejectionCount: { increment: 1 },
          },
        });

        return {
          kind: 'rejected' as const,
          workLog,
          targetStage,
          newRejectionCount,
          escalated,
        };
      }

      // Completed / blocked path — create the work log first so it's recorded regardless of WIP
      const workLog = await tx.workLog.create({
        data: {
          agent: body.agent,
          action,
          summary: body.summary,
          itemId: body.itemId,
        },
      });

      // Check WIP limits on the target stage when advance=true (default).
      // Running the check inside the transaction ensures the count we observe cannot change
      // before we write the stage update — two concurrent agents cannot both pass the check.
      let wipExceeded = false;
      if (advance) {
        const targetStageRow = await tx.stage.findUnique({ where: { id: nextStage } });
        if (targetStageRow != null && targetStageRow.wipLimit != null) {
          const currentCount = await tx.item.count({
            where: { stageId: nextStage, projectId, archivedAt: null },
          });
          if (currentCount >= targetStageRow.wipLimit) {
            wipExceeded = true;
          }
        }
      }

      // Update item: clear assignedAgent, advance stage only when not WIP-blocked
      const shouldAdvance = advance && !wipExceeded;
      await tx.item.update({
        where: { id: body.itemId },
        data: {
          ...(shouldAdvance ? { stageId: nextStage } : {}),
          assignedAgent: null,
        },
      });

      return {
        kind: 'completed' as const,
        workLog,
        wipExceeded,
        shouldAdvance,
        nextStage,
      };
    });

    // Rejection response (short-circuit — mission completion check doesn't apply)
    if (txResult.kind === 'rejected') {
      const workLogEntry: WorkLogEntry = {
        id: txResult.workLog.id,
        agent: txResult.workLog.agent,
        action: txResult.workLog.action as WorkLogAction,
        summary: txResult.workLog.summary,
        timestamp: txResult.workLog.timestamp,
      };

      const response: AgentStopResponse = {
        success: true,
        data: {
          itemId: body.itemId,
          agent: body.agent,
          workLogEntry,
          nextStage: txResult.targetStage,
          rejectionCount: txResult.newRejectionCount,
          escalated: txResult.escalated,
        },
      };

      return NextResponse.json(response);
    }

    // Completed/blocked path — extract results from the transaction
    const { workLog, wipExceeded, shouldAdvance } = txResult;

    // Check if all mission items are now in done stage (mission complete)
    let missionComplete = false;
    if (shouldAdvance && nextStage === 'done') {
      try {
        const missionItem = await prisma.missionItem.findFirst({
          where: { itemId: body.itemId },
          select: { missionId: true },
        });
        if (missionItem) {
          const missionItemIds = await prisma.missionItem.findMany({
            where: { missionId: missionItem.missionId },
            select: { itemId: true },
          });
          const allItemIds = missionItemIds.map((mi) => mi.itemId);
          const nonDoneCount = await prisma.item.count({
            where: {
              id: { in: allItemIds },
              stageId: { not: 'done' },
              archivedAt: null,
            },
          });
          missionComplete = nonDoneCount === 0;
        }
      } catch {
        // Mission lookup failed (no mission context) — not an error, just no signal
      }
    }

    // Build response work log entry
    const workLogEntry: WorkLogEntry = {
      id: workLog.id,
      agent: workLog.agent,
      action: workLog.action as WorkLogAction,
      summary: workLog.summary,
      timestamp: workLog.timestamp,
    };

    // Return success response (work log always recorded)
    const response: AgentStopResponse = {
      success: true,
      data: {
        itemId: body.itemId,
        agent: body.agent,
        workLogEntry,
        nextStage: shouldAdvance ? nextStage : (item.stageId as StageId),
        ...(wipExceeded ? { wipExceeded: true, blockedStage: nextStage } : {}),
        ...(missionComplete ? { missionComplete: true } : {}),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('POST /api/agents/stop error:', error);
    return NextResponse.json(createDatabaseError('Database error', error).toResponse(), { status: 500 });
  }
}
