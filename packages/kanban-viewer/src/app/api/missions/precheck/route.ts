import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import type { ApiError } from '@/types/api';

const VALID_PRECHECK_STATES = ['initializing', 'precheck_failure'];

/**
 * POST /api/missions/precheck
 *
 * Accepts a pre-computed precheck result { passed, blockers, output } from the MCP tool.
 * Does NOT execute shell commands itself.
 *
 * State transitions:
 * - passed=true:  initializing|precheck_failure -> running
 * - passed=false: initializing|precheck_failure -> precheck_failure
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

    // Find active mission (not archived) for this project
    const mission = await prisma.mission.findFirst({
      where: {
        projectId,
        archivedAt: null,
      },
    });

    if (!mission) {
      const apiError: ApiError = {
        success: false,
        error: {
          code: 'NO_ACTIVE_MISSION',
          message: 'No active mission found',
        },
      };
      return NextResponse.json(apiError, { status: 404 });
    }

    // Only accept missions in initializing or precheck_failure state
    if (!VALID_PRECHECK_STATES.includes(mission.state)) {
      const apiError: ApiError = {
        success: false,
        error: {
          code: 'INVALID_MISSION_STATE',
          message: `Mission must be in initializing or precheck_failure state to run precheck. Current state: ${mission.state}`,
        },
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    const body = await request.json();
    const { passed, blockers = [], output = {} } = body;

    const newState = passed ? 'running' : 'precheck_failure';

    const updateData: Record<string, unknown> = { state: newState };

    if (passed) {
      // Clear precheck fields on success
      updateData.precheckBlockers = null;
      updateData.precheckOutput = null;
    } else {
      // Store blockers and output as JSON strings in SQLite TEXT columns
      updateData.precheckBlockers = JSON.stringify(blockers);
      updateData.precheckOutput = JSON.stringify(output);
    }

    await prisma.$transaction([
      prisma.mission.update({
        where: { id: mission.id },
        data: updateData,
      }),
      prisma.activityLog.create({
        data: {
          projectId,
          missionId: mission.id,
          agent: null,
          message: passed
            ? 'Precheck passed: mission transitioning to running'
            : `Precheck failed: ${blockers.join(', ')}`,
          level: passed ? 'info' : 'error',
        },
      }),
    ]);

    const responseData: Record<string, unknown> = {
      allPassed: passed,
    };

    if (!passed) {
      responseData.retryable = true;
      responseData.blockers = blockers;
    }

    return NextResponse.json({ success: true, data: responseData });
  } catch (error) {
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to run precheck',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
