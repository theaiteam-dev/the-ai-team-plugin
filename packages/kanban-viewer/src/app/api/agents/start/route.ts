/**
 * API Route Handler for POST /api/agents/start
 *
 * Composite operation that allows an agent to start work on an item:
 * - Validates item is in ready stage
 * - Validates all item dependencies are in done stage
 * - Creates agent claim
 * - Moves item to appropriate work stage (testing, implementing, or probing)
 * - Sets assignedAgent on the item
 * - Creates WorkLog entry with action=started
 * - Returns AgentStartResponse with item details and claimedAt
 *
 * Note: Agents CAN claim multiple items simultaneously. The only limit
 * is the WIP limit per stage column.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  createValidationError,
  createItemNotFoundError,
  createDatabaseError,
  createWipLimitExceededError,
} from '@/lib/errors';
import { checkWipLimit } from '@/lib/validation';
import type { StageId } from '@/types/board';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { transformItemWithRelationsToResponse } from '@/lib/item-transform';
import type { AgentStartRequest, AgentStartResponse, ApiError } from '@/types/api';
import type { AgentName } from '@/types/agent';
import { AGENT_DISPLAY_NAMES, PIPELINE_STAGES, isValidAgent, normalizeAgentName, type StageId as SharedStageId } from '@ai-team/shared';
import { logApiError } from '@/lib/api-logger';

/**
 * POST /api/agents/start
 *
 * Start work on an item as an agent.
 *
 * Request body: AgentStartRequest { itemId: string, agent: AgentName }
 * Response: AgentStartResponse with item details and claimedAt
 *
 * Error codes:
 * - VALIDATION_ERROR (400): Missing or invalid request fields
 * - ITEM_NOT_FOUND (404): Item does not exist
 * - INVALID_STAGE (400): Item is not in ready stage
 * - DEPENDENCIES_NOT_MET (400): Not all dependencies are in done stage
 * - WIP_LIMIT_EXCEEDED (400): Target stage has reached WIP limit
 * - DATABASE_ERROR (500): Database operation failed
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<AgentStartResponse | ApiError>> {
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
      logApiError('POST /api/agents/start', 400, errorResponse.error.code, errorResponse.error.message);
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    // Parse request body
    let body: AgentStartRequest;
    try {
      body = await request.json();
    } catch {
      logApiError('POST /api/agents/start', 400, 'VALIDATION_ERROR', 'Invalid JSON body');
      return NextResponse.json(createValidationError('Invalid JSON body').toResponse(), { status: 400 });
    }

    // Validate required fields
    if (!body.itemId) {
      logApiError('POST /api/agents/start', 400, 'VALIDATION_ERROR', 'itemId is required', { agent: body.agent });
      return NextResponse.json(createValidationError('itemId is required').toResponse(), { status: 400 });
    }

    if (!body.agent) {
      logApiError('POST /api/agents/start', 400, 'VALIDATION_ERROR', 'agent is required', { itemId: body.itemId });
      return NextResponse.json(createValidationError('agent is required').toResponse(), { status: 400 });
    }

    // Validate agent name
    if (!isValidAgent(body.agent)) {
      logApiError('POST /api/agents/start', 400, 'VALIDATION_ERROR', `Invalid agent name: ${body.agent}`, { agent: body.agent, itemId: body.itemId });
      return NextResponse.json(createValidationError(`Invalid agent name: ${body.agent}`).toResponse(), { status: 400 });
    }

    // Fetch item with dependencies, filtered by projectId
    const item = await prisma.item.findFirst({
      where: { id: body.itemId, projectId },
      include: {
        dependsOn: {
          include: {
            dependsOn: true,
          },
        },
      },
    });

    if (!item) {
      logApiError('POST /api/agents/start', 404, 'ITEM_NOT_FOUND', `Item not found: ${body.itemId}`, { agent: body.agent, itemId: body.itemId });
      return NextResponse.json(
        createItemNotFoundError(body.itemId).toResponse(),
        { status: 404 }
      );
    }

    // Determine target stage based on agent using PIPELINE_STAGES
    // Find which pipeline stage this agent works in
    let targetStage: string = 'testing'; // default fallback for non-pipeline agents
    let isPipelineAgent = false;
    const normalizedAgent = normalizeAgentName(body.agent);
    for (const [stageId, info] of Object.entries(PIPELINE_STAGES)) {
      if (info && info.agent === normalizedAgent) {
        targetStage = stageId;
        isPipelineAgent = true;
        break;
      }
    }

    const currentStage = item.stageId;
    // Only pipeline agents can claim items already in their work stage
    const isWorkStageClaim = isPipelineAgent && currentStage === targetStage;

    // Validate item stage: must be in 'ready' (first entry) or already in the agent's work stage
    if (currentStage !== 'ready' && !isWorkStageClaim) {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'INVALID_STAGE',
          message: `Item must be in ready or ${targetStage} stage to start, currently in: ${currentStage}`,
          details: {
            itemId: body.itemId,
            currentStage: currentStage,
            requiredStage: targetStage,
          },
        },
      };
      logApiError('POST /api/agents/start', 400, 'INVALID_STAGE', errorResponse.error.message, { agent: body.agent, itemId: body.itemId, currentStage, targetStage });
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Only check dependencies and WIP for items coming from 'ready' stage
    // Items already in their work stage have already passed these checks upstream
    if (!isWorkStageClaim) {
      // Validate all dependencies are in done stage
      const unmetDependencies = item.dependsOn
        .filter((dep) => dep.dependsOn.stageId !== 'done')
        .map((dep) => dep.dependsOnId);

      if (unmetDependencies.length > 0) {
        const errorResponse: ApiError = {
          success: false,
          error: {
            code: 'DEPENDENCIES_NOT_MET',
            message: 'Not all dependencies are completed',
            details: {
              itemId: body.itemId,
              unmetDependencies,
            },
          },
        };
        logApiError('POST /api/agents/start', 400, 'DEPENDENCIES_NOT_MET', 'Not all dependencies are completed', { agent: body.agent, itemId: body.itemId, unmetDependencies });
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Check WIP limit for target stage
      const stage = await prisma.stage.findUnique({
        where: { id: targetStage },
      });

      if (stage && stage.wipLimit !== null) {
        const currentCount = await prisma.item.count({
          where: {
            stageId: targetStage,
            projectId,
            archivedAt: null,
          },
        });

        const wipCheck = checkWipLimit(targetStage as StageId, currentCount, stage.wipLimit);
        if (!wipCheck.allowed) {
          logApiError('POST /api/agents/start', 400, 'WIP_LIMIT_EXCEEDED', `WIP limit exceeded for stage: ${targetStage}`, { agent: body.agent, itemId: body.itemId, targetStage, wipLimit: stage.wipLimit, currentCount });
          return NextResponse.json(
            createWipLimitExceededError(targetStage, stage.wipLimit, currentCount).toResponse(),
            { status: 400 }
          );
        }
      }
    }

    // Execute all operations in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create agent claim
      const claim = await tx.agentClaim.create({
        data: {
          agentName: body.agent,
          itemId: body.itemId,
        },
      });

      // Move item to target stage and set assignedAgent
      const updatedItem = await tx.item.update({
        where: { id: body.itemId },
        data: {
          stageId: targetStage,
          assignedAgent: body.agent,
          updatedAt: new Date(),
        },
        include: {
          dependsOn: true,
          workLogs: true,
        },
      });

      // Create WorkLog entry
      await tx.workLog.create({
        data: {
          itemId: body.itemId,
          agent: body.agent,
          action: 'started',
          summary: 'Started work on item',
        },
      });

      return { claim, updatedItem };
    });

    // Construct response
    const response: AgentStartResponse = {
      success: true,
      data: {
        itemId: body.itemId,
        agent: body.agent as AgentName,
        item: transformItemWithRelationsToResponse(result.updatedItem),
        claimedAt: result.claim.claimedAt,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('POST /api/agents/start error:', error);
    return NextResponse.json(createDatabaseError('Failed to start work on item', error).toResponse(), { status: 500 });
  }
}
