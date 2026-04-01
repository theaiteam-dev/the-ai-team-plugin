import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createValidationError } from '@/lib/errors';
import { getAndValidateProjectId, ensureProject } from '@/lib/project-utils';
import { safeJsonParse } from '@/lib/json-utils';
import type { CreateMissionRequest, CreateMissionResponse, ApiError } from '@/types/api';
import type { Mission, MissionState, MissionPrecheckOutput } from '@/types/mission';
import type { ScalingRationale } from '@/types/mission-scaling';

/**
 * GET /api/missions
 * Returns array of all missions for the specified project.
 *
 * Query parameters:
 * - projectId (string, required): Filter missions by project ID
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: projectValidation.error,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    const stateFilter = request.nextUrl.searchParams.get('state');

    const VALID_MISSION_STATES: MissionState[] = [
      'initializing',
      'prechecking',
      'precheck_failure',
      'running',
      'postchecking',
      'completed',
      'failed',
      'archived',
    ];

    if (stateFilter && !(VALID_MISSION_STATES as string[]).includes(stateFilter)) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid state filter' } },
        { status: 400 }
      );
    }

    const where: { projectId: string; state?: MissionState } = { projectId };
    if (stateFilter) {
      where.state = stateFilter as MissionState;
    }

    const missions = await prisma.mission.findMany({ where });

    const data = missions.map((m) => ({
      id: m.id,
      name: m.name,
      state: m.state as MissionState,
      prdPath: m.prdPath,
      startedAt: m.startedAt,
      completedAt: m.completedAt,
      archivedAt: m.archivedAt,
      precheckBlockers: safeJsonParse<string[]>(m.precheckBlockers),
      precheckOutput: safeJsonParse<MissionPrecheckOutput>(m.precheckOutput),
      scalingRationale: safeJsonParse<ScalingRationale>(m.scalingRationale),
    }));

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch missions',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}

/**
 * Generates a mission ID in M-YYYYMMDD-NNN format.
 * NNN is a sequential number that increments for missions created on the same day.
 */
async function generateMissionId(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `M-${year}${month}${day}`;

  // Count existing missions for today to determine sequence number
  const countToday = await prisma.mission.count({
    where: {
      id: {
        startsWith: datePrefix,
      },
    },
  });

  const sequenceNumber = String(countToday + 1).padStart(3, '0');
  return `${datePrefix}-${sequenceNumber}`;
}

/**
 * POST /api/missions
 * Creates a new mission. Archives current active mission if one exists.
 *
 * Query parameters:
 * - projectId (string, required): Project ID for the new mission
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: projectValidation.error,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    // Parse and validate request body
    let body: CreateMissionRequest;
    try {
      body = await request.json();
    } catch {
      const apiError: ApiError = {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        },
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    // Validate required fields
    if (!body.name) {
      return NextResponse.json(createValidationError('name is required').toResponse(), { status: 400 });
    }

    if (!body.prdPath) {
      return NextResponse.json(createValidationError('prdPath is required').toResponse(), { status: 400 });
    }

    // Check for active mission (not archived and not completed) for this project
    // When force: true, find ANY non-archived mission (including failed ones)
    const activeMission = await prisma.mission.findFirst({
      where: {
        projectId,
        archivedAt: null,
        ...(body.force ? {} : {
          state: {
            notIn: ['completed', 'failed', 'archived'],
          },
        }),
      },
    });

    // Guard: if an active mission exists and force is not set, return 409
    if (activeMission && !body.force) {
      const conflictMessage = activeMission.state === 'precheck_failure'
        ? 'Mission is in precheck_failure state. Fix the issues and re-run /ai-team:run to retry, or use force: true to archive and start fresh.'
        : 'An active mission already exists. Use force: true to archive it and start fresh, or re-run /ai-team:run to continue.';

      const conflictError: ApiError = {
        success: false,
        error: {
          code: 'CONFLICT',
          message: conflictMessage,
        },
      };
      return NextResponse.json(conflictError, { status: 409 });
    }

    // Archive active mission and its items in a transaction to ensure consistency
    if (activeMission) {
      const archiveTimestamp = new Date();

      // Get item IDs linked to this mission before starting the transaction
      const missionItems = await prisma.missionItem.findMany({
        where: { missionId: activeMission.id },
        select: { itemId: true },
      });
      const itemIds = missionItems.map((mi) => mi.itemId);

      // Archive mission and items atomically
      const archiveOperations = [
        prisma.mission.update({
          where: { id: activeMission.id },
          data: {
            state: 'archived',
            archivedAt: archiveTimestamp,
          },
        }),
      ];

      if (itemIds.length > 0) {
        archiveOperations.push(
          prisma.item.updateMany({
            where: { id: { in: itemIds } },
            data: { archivedAt: archiveTimestamp },
          }) as never
        );
      }

      await prisma.$transaction(archiveOperations);
    }

    // Ensure project exists (auto-create if not)
    await ensureProject(projectId);

    // Generate mission ID
    const missionId = await generateMissionId();

    // Create new mission in initializing state
    const newMission = await prisma.mission.create({
      data: {
        id: missionId,
        name: body.name,
        prdPath: body.prdPath,
        projectId,
        state: 'initializing',
        startedAt: new Date(),
        ...(body.scalingRationale != null
          ? { scalingRationale: JSON.stringify(body.scalingRationale) }
          : {}),
      },
    });

    const response: CreateMissionResponse = {
      success: true,
      data: newMission as Mission,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create mission',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
