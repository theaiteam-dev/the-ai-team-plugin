/**
 * API Route: /api/missions/[missionId]/token-usage
 *
 * POST - Aggregate token usage from HookEvents into MissionTokenUsage rows
 * GET  - Return per-agent breakdown and mission totals
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { calculateTokenCost } from '@/lib/token-cost';
import type { ApiError } from '@/types/api';

interface RouteContext {
  params: Promise<{ missionId: string }>;
}

interface AgentRow {
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

interface Totals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

function sumTotals(agents: AgentRow[]): Totals {
  return agents.reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + row.cacheCreationTokens,
      cacheReadTokens: acc.cacheReadTokens + row.cacheReadTokens,
      estimatedCostUsd: acc.estimatedCostUsd + row.estimatedCostUsd,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 }
  );
}

/**
 * POST /api/missions/:missionId/token-usage
 *
 * Reads HookEvent rows for the mission using dedup logic:
 * - subagent_stop events for all agents (subagents)
 * - stop events WHERE agentName = 'hannibal' only
 *
 * Groups by agentName+model, sums tokens, calculates cost, upserts MissionTokenUsage.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { missionId } = await context.params;

    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    // Fetch deduplicated hook events:
    // - All subagent_stop events (covers all subagents)
    // - stop events only where agentName = 'hannibal'
    const hookEvents = await prisma.hookEvent.findMany({
      where: {
        missionId,
        projectId,
        OR: [
          { eventType: 'subagent_stop', agentName: { not: 'hannibal' } },
          { eventType: 'stop', agentName: 'hannibal' },
        ],
        inputTokens: { not: null },
        model: { not: null },
      },
      select: {
        agentName: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
      },
    });

    // Warn if hook events were excluded due to missing token data
    const totalEventCount = await prisma.hookEvent.count({
      where: {
        missionId,
        projectId,
        OR: [
          { eventType: 'subagent_stop', agentName: { not: 'hannibal' } },
          { eventType: 'stop', agentName: 'hannibal' },
        ],
      },
    });

    if (totalEventCount > hookEvents.length) {
      console.warn(
        `[token-aggregation] Mission ${missionId}: ${totalEventCount - hookEvents.length} hook event(s) excluded (missing token/model data)`
      );
    }

    // Group by agentName+model
    const groups = new Map<string, { agentName: string; model: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }>();

    for (const event of hookEvents) {
      const key = `${event.agentName}:${event.model}`;
      const existing = groups.get(key);
      if (existing) {
        existing.inputTokens += event.inputTokens ?? 0;
        existing.outputTokens += event.outputTokens ?? 0;
        existing.cacheCreationTokens += event.cacheCreationTokens ?? 0;
        existing.cacheReadTokens += event.cacheReadTokens ?? 0;
      } else {
        groups.set(key, {
          agentName: event.agentName,
          model: event.model!,
          inputTokens: event.inputTokens ?? 0,
          outputTokens: event.outputTokens ?? 0,
          cacheCreationTokens: event.cacheCreationTokens ?? 0,
          cacheReadTokens: event.cacheReadTokens ?? 0,
        });
      }
    }

    // Upsert each group into MissionTokenUsage
    const agents: AgentRow[] = [];

    for (const group of groups.values()) {
      const { totalUsd } = calculateTokenCost(
        {
          inputTokens: group.inputTokens,
          outputTokens: group.outputTokens,
          cacheCreationTokens: group.cacheCreationTokens,
          cacheReadTokens: group.cacheReadTokens,
        },
        group.model
      );

      await prisma.missionTokenUsage.upsert({
        where: {
          missionId_agentName_model: {
            missionId,
            agentName: group.agentName,
            model: group.model,
          },
        },
        create: {
          missionId,
          projectId,
          agentName: group.agentName,
          model: group.model,
          inputTokens: group.inputTokens,
          outputTokens: group.outputTokens,
          cacheCreationTokens: group.cacheCreationTokens,
          cacheReadTokens: group.cacheReadTokens,
          estimatedCostUsd: totalUsd,
        },
        update: {
          inputTokens: group.inputTokens,
          outputTokens: group.outputTokens,
          cacheCreationTokens: group.cacheCreationTokens,
          cacheReadTokens: group.cacheReadTokens,
          estimatedCostUsd: totalUsd,
        },
      });

      agents.push({ ...group, estimatedCostUsd: totalUsd });
    }

    return NextResponse.json({
      success: true,
      data: {
        missionId,
        agents,
        totals: sumTotals(agents),
      },
    });
  } catch (error) {
    console.error('POST /api/missions/[missionId]/token-usage error:', error);
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to aggregate token usage',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}

/**
 * GET /api/missions/:missionId/token-usage
 *
 * Returns existing MissionTokenUsage rows for the mission.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { missionId } = await context.params;

    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    const rows = await prisma.missionTokenUsage.findMany({
      where: { missionId, projectId },
      select: {
        agentName: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
        estimatedCostUsd: true,
      },
    });

    const agents: AgentRow[] = rows.map((r) => ({
      agentName: r.agentName,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheCreationTokens: r.cacheCreationTokens,
      cacheReadTokens: r.cacheReadTokens,
      estimatedCostUsd: r.estimatedCostUsd,
    }));

    return NextResponse.json({
      success: true,
      data: {
        missionId,
        agents,
        totals: sumTotals(agents),
      },
    });
  } catch (error) {
    console.error('GET /api/missions/[missionId]/token-usage error:', error);
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch token usage',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
