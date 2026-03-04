/**
 * POST /api/hooks/events/backfill
 *
 * Retroactively fix NULL missionId on hook events.
 *
 * Missions are strictly sequential per project. Each event's timestamp
 * is matched against [mission.startedAt, mission.archivedAt ?? now()]
 * to find the correct mission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import type { ApiError } from '@/types/api';

interface BackfillResponse {
  success: true;
  data: {
    updated: number;
    unmatched: number;
  };
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<BackfillResponse | ApiError>> {
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

    // Get all missions for this project, ordered by start time
    const missions = await prisma.mission.findMany({
      where: { projectId },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        startedAt: true,
        archivedAt: true,
      },
    });

    if (missions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { updated: 0, unmatched: 0 },
      });
    }

    // Get all orphan events (null missionId) for this project
    const orphanEvents = await prisma.hookEvent.findMany({
      where: {
        projectId,
        missionId: null,
      },
      select: {
        id: true,
        timestamp: true,
      },
    });

    if (orphanEvents.length === 0) {
      return NextResponse.json({
        success: true,
        data: { updated: 0, unmatched: 0 },
      });
    }

    // Match each orphan event to a mission by timestamp range
    const now = new Date();
    let updated = 0;
    let unmatched = 0;

    // Batch updates by missionId for efficiency
    const updatesByMission = new Map<string, number[]>();

    for (const event of orphanEvents) {
      let matched = false;
      for (const mission of missions) {
        const start = mission.startedAt;
        const end = mission.archivedAt ?? now;
        if (event.timestamp >= start && event.timestamp <= end) {
          const ids = updatesByMission.get(mission.id) ?? [];
          ids.push(event.id);
          updatesByMission.set(mission.id, ids);
          matched = true;
          break; // First matching mission wins (ordered by startedAt)
        }
      }
      if (!matched) {
        unmatched++;
      }
    }

    // Execute batch updates
    for (const [missionId, eventIds] of updatesByMission) {
      await prisma.hookEvent.updateMany({
        where: { id: { in: eventIds } },
        data: { missionId },
      });
      updated += eventIds.length;
    }

    return NextResponse.json({
      success: true,
      data: { updated, unmatched },
    });
  } catch (error) {
    console.error('POST /api/hooks/events/backfill error:', error);
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to backfill events',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
