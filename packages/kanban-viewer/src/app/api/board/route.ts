import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createDatabaseError } from '@/lib/errors';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { transformItemWithRelationsToResponse } from '@/lib/item-transform';
import { isStageId, isAgentName } from '@/lib/api-validation';
import type { GetBoardResponse, ApiError } from '@/types/api';
import type { BoardState, Stage, StageId } from '@/types/board';
import type { AgentClaim, AgentName } from '@/types/agent';
import type { Mission, MissionState } from '@/types/mission';

/**
 * GET /api/board
 *
 * Returns the full board state including stages, items, claims, and current mission.
 *
 * Query parameters:
 * - projectId (string, required): Filter data by project ID
 * - includeCompleted (boolean, default: false): Include items in the 'done' stage
 *
 * Always excludes archived items (archivedAt IS NOT NULL).
 */
export async function GET(request: NextRequest): Promise<NextResponse<GetBoardResponse | ApiError>> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    const includeCompleted = request.nextUrl.searchParams.get('includeCompleted') === 'true';

    if (!projectValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: projectValidation.error,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const projectId = projectValidation.projectId;

    // Build item filter with projectId
    const itemFilter: { archivedAt: null; projectId: string; stageId?: { not: string } } = {
      archivedAt: null,
      projectId,
    };

    if (!includeCompleted) {
      itemFilter.stageId = { not: 'done' };
    }

    // Query all data in parallel
    const [stages, items, claims, currentMission] = await Promise.all([
      prisma.stage.findMany({
        orderBy: { order: 'asc' },
      }),
      prisma.item.findMany({
        where: itemFilter,
        include: {
          dependsOn: true,
          workLogs: true,
        },
      }),
      prisma.agentClaim.findMany({
        where: {
          item: {
            projectId,
          },
        },
      }),
      prisma.mission.findFirst({
        where: {
          archivedAt: null,
          projectId,
          state: {
            in: ['initializing', 'prechecking', 'precheck_failure', 'running', 'postchecking'],
          },
        },
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    // Transform items to ItemWithRelations format using shared transform
    const transformedItems = items.map(transformItemWithRelationsToResponse);

    // Transform stages to Stage format
    const transformedStages: Stage[] = stages
      .filter((stage) => isStageId(stage.id))
      .map((stage) => ({
        id: stage.id as StageId,
        name: stage.name,
        order: stage.order,
        wipLimit: stage.wipLimit,
      }));

    // Transform claims to AgentClaim format
    const transformedClaims: AgentClaim[] = claims
      .filter((claim) => isAgentName(claim.agentName))
      .map((claim) => ({
        agentName: claim.agentName as AgentName,
        itemId: claim.itemId,
        claimedAt: claim.claimedAt,
      }));

    const safeJsonParse = <T>(value: string | null): T | null => {
      if (!value) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    };

    // Transform mission to Mission format
    const transformedMission: Mission | null = currentMission
      ? {
          id: currentMission.id,
          name: currentMission.name,
          state: currentMission.state as MissionState,
          prdPath: currentMission.prdPath,
          startedAt: currentMission.startedAt,
          completedAt: currentMission.completedAt,
          archivedAt: currentMission.archivedAt,
          precheckBlockers: safeJsonParse<string[]>(currentMission.precheckBlockers),
          precheckOutput: safeJsonParse(currentMission.precheckOutput),
        }
      : null;

    const boardState: BoardState = {
      stages: transformedStages,
      items: transformedItems,
      claims: transformedClaims,
      currentMission: transformedMission,
    };

    const response: GetBoardResponse = {
      success: true,
      data: boardState,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(createDatabaseError('Failed to fetch board data from database', error).toResponse(), { status: 500 });
  }
}
