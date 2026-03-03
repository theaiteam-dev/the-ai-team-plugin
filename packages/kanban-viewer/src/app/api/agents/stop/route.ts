/**
 * API Route Handler for POST /api/agents/stop
 *
 * Allows an agent to stop work on a claimed item, performing:
 * - Delete agent claim
 * - Clear assignedAgent on item
 * - Create WorkLog entry with provided summary
 * - Move item to next stage based on outcome
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
import { AGENT_DISPLAY_NAMES, PIPELINE_STAGES, type StageId as SharedStageId } from '@ai-team/shared';

/**
 * Valid agent names for validation.
 */
const VALID_AGENTS: AgentName[] = Object.values(AGENT_DISPLAY_NAMES) as AgentName[];

/**
 * Valid outcome values.
 */
const VALID_OUTCOMES = ['completed', 'blocked'] as const;

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
      return NextResponse.json(createValidationError('itemId is required').toResponse(), { status: 400 });
    }

    if (!body.agent) {
      return NextResponse.json(createValidationError('agent is required').toResponse(), { status: 400 });
    }

    if (!body.summary) {
      return NextResponse.json(createValidationError('summary is required').toResponse(), { status: 400 });
    }

    // Validate agent name
    if (!VALID_AGENTS.includes(body.agent)) {
      return NextResponse.json(createValidationError(`Invalid agent name: ${body.agent}`).toResponse(), { status: 400 });
    }

    // Validate outcome if provided
    if (body.outcome !== undefined && !VALID_OUTCOMES.includes(body.outcome)) {
      return NextResponse.json(createValidationError('Invalid outcome value').toResponse(), { status: 400 });
    }

    // Check if item exists and belongs to the specified project
    const item = await prisma.item.findFirst({
      where: { id: body.itemId, projectId },
    });

    if (!item) {
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
      return NextResponse.json(errorResponse, { status: 403 });
    }

    // Determine next stage and action based on outcome
    const outcome = body.outcome ?? 'completed';
    let nextStage: StageId;
    if (outcome === 'blocked') {
      nextStage = 'blocked';
    } else {
      const pipelineInfo = PIPELINE_STAGES[item.stageId as SharedStageId];
      nextStage = (pipelineInfo?.nextStage as StageId) ?? 'review';
    }
    const action: WorkLogAction = outcome === 'blocked' ? 'note' : 'completed';

    // Delete the agent claim (by itemId, which is unique)
    await prisma.agentClaim.delete({
      where: { itemId: body.itemId },
    });

    // Create work log entry
    const workLog = await prisma.workLog.create({
      data: {
        agent: body.agent,
        action: action,
        summary: body.summary,
        itemId: body.itemId,
      },
    });

    // Update item: clear assignedAgent and move to next stage
    await prisma.item.update({
      where: { id: body.itemId },
      data: {
        stageId: nextStage,
        assignedAgent: null,
      },
    });

    // Build response work log entry
    const workLogEntry: WorkLogEntry = {
      id: workLog.id,
      agent: workLog.agent,
      action: workLog.action as WorkLogAction,
      summary: workLog.summary,
      timestamp: workLog.timestamp,
    };

    // Return success response
    const response: AgentStopResponse = {
      success: true,
      data: {
        itemId: body.itemId,
        agent: body.agent,
        workLogEntry,
        nextStage,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('POST /api/agents/stop error:', error);
    return NextResponse.json(createDatabaseError('Database error', error).toResponse(), { status: 500 });
  }
}
