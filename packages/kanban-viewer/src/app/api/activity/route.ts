/**
 * API Route: /api/activity
 *
 * GET - Retrieve activity log entries
 * POST - Create a new activity log entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createValidationError } from '@/lib/errors';
import { getAndValidateProjectId } from '@/lib/project-utils';
import type {
  GetActivityResponse,
  LogActivityRequest,
  LogActivityResponse,
  ApiError,
} from '@/types/api';

/** Valid log levels for activity entries. */
const VALID_LEVELS = ['info', 'warn', 'error'] as const;
type LogLevel = (typeof VALID_LEVELS)[number];

/**
 * GET /api/activity
 *
 * Retrieve activity log entries with optional filtering.
 *
 * Query parameters:
 * - projectId (string, required): Filter data by project ID
 * - limit: Maximum number of entries to return (default: 100)
 * - missionId: Filter by specific mission ID (default: current mission)
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

    // Parse limit parameter (default 100). Non-positive and non-numeric values
    // also fall back to the default: the Go CLI's unset int flag serializes as
    // limit=0, and honoring that literally returned a silently empty feed
    // indistinguishable from "no data" (found by the M-20260812-001 retro).
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const parsedLimit = limitParam === null ? NaN : parseInt(limitParam, 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;

    // Parse missionId parameter
    const missionIdParam = searchParams.get('missionId');
    let missionId: string | null = null;

    if (missionIdParam) {
      // Use provided missionId
      missionId = missionIdParam;
    } else {
      // Try to find current mission for this project
      const currentMission = await prisma.mission.findFirst({
        where: {
          archivedAt: null,
          projectId,
          state: {
            notIn: ['completed', 'failed', 'archived'],
          },
        },
        orderBy: { startedAt: 'desc' },
      });
      missionId = currentMission?.id ?? null;
    }

    // Build query options
    // When a mission is active, filter to that mission's logs
    // When no mission is active, return all project-level logs (any mission or no mission)
    const queryOptions = {
      take: limit,
      orderBy: {
        timestamp: 'desc' as const,
      },
      where: {
        projectId,
        ...(missionId ? { missionId } : {}),
      },
    };

    // Fetch activity log entries
    const entries = await prisma.activityLog.findMany(queryOptions);

    const response: GetActivityResponse = {
      success: true,
      data: {
        entries: entries.map((entry) => ({
          id: entry.id,
          missionId: entry.missionId,
          agent: entry.agent,
          message: entry.message,
          level: entry.level as LogLevel,
          timestamp: entry.timestamp,
        })),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('GET /api/activity error:', error);
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch activity log',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}

/**
 * POST /api/activity
 *
 * Create a new activity log entry.
 *
 * Query parameters:
 * - projectId (string, required): Project to create activity for
 *
 * Request body:
 * - message: The log message (required)
 * - agent: Optional agent name
 * - level: Optional log level ('info', 'warn', 'error'), defaults to 'info'
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

    // Parse request body
    let body: LogActivityRequest;
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
    if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
      return NextResponse.json(createValidationError('message is required and cannot be empty').toResponse(), { status: 400 });
    }

    // Validate level if provided
    const level = body.level ?? 'info';
    if (!VALID_LEVELS.includes(level as LogLevel)) {
      return NextResponse.json(createValidationError(`level must be one of: ${VALID_LEVELS.join(', ')}`).toResponse(), { status: 400 });
    }

    // Find current mission for this project
    const currentMission = await prisma.mission.findFirst({
      where: {
        archivedAt: null,
        projectId,
        state: {
          notIn: ['completed', 'failed', 'archived'],
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    // Create activity log entry with projectId
    const createdEntry = await prisma.activityLog.create({
      data: {
        projectId,
        missionId: currentMission?.id ?? null,
        agent: body.agent ?? null,
        message: body.message,
        level: level,
      },
    });

    const response: LogActivityResponse = {
      success: true,
      data: {
        logged: true,
        timestamp: createdEntry.timestamp,
      },
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('POST /api/activity error:', error);
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create activity log entry',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
