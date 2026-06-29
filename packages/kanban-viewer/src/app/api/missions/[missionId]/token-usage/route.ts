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
import { baseAgentName } from '@/lib/agent-name';
import { createDatabaseError } from '@/lib/errors';
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
 * Reads MessageTokenUsage rows for the mission, groups by (baseAgentName, model),
 * SUMs the four token fields per group, prices each group at its own model rate,
 * then upserts one MissionTokenUsage row per (baseAgent, model).
 *
 * Pool instances of one role (murdock, murdock-1, murdock-2) roll up into a
 * single base-role row via `baseAgentName`. Re-aggregation is idempotent:
 * prior MissionTokenUsage rows are cleared before re-computing.
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

    // Fetch all per-message usage rows for this mission.
    const messageRows = await prisma.messageTokenUsage.findMany({
      where: { missionId, projectId },
      select: {
        agentName: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
      },
    });

    // Group by (baseAgentName, model), summing token deltas per group.
    const groups = new Map<string, { agentName: string; model: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }>();

    for (const row of messageRows) {
      const role = baseAgentName(row.agentName);
      const key = `${role}:${row.model}`;
      const existing = groups.get(key);
      if (existing) {
        existing.inputTokens += row.inputTokens;
        existing.outputTokens += row.outputTokens;
        existing.cacheCreationTokens += row.cacheCreationTokens;
        existing.cacheReadTokens += row.cacheReadTokens;
      } else {
        groups.set(key, {
          agentName: role,
          model: row.model,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheCreationTokens: row.cacheCreationTokens,
          cacheReadTokens: row.cacheReadTokens,
        });
      }
    }

    // Upsert each group into MissionTokenUsage atomically
    const agents: AgentRow[] = [];

    await prisma.$transaction(async (tx) => {
      // Clear prior rows for this mission first so re-aggregation is idempotent.
      // Without this, re-running aggregation after the agent-variant consolidation
      // change leaves stale per-instance rows (murdock-1, murdock-2, ...) alongside
      // the new consolidated base-role row (murdock), double-listing the cost.
      await tx.missionTokenUsage.deleteMany({ where: { missionId } });

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

        await tx.missionTokenUsage.upsert({
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
    });

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
    return NextResponse.json(
      createDatabaseError('Failed to aggregate token usage', error).toResponse(),
      { status: 500 }
    );
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
    return NextResponse.json(
      createDatabaseError('Failed to fetch token usage', error).toResponse(),
      { status: 500 }
    );
  }
}
