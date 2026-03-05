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
 * Reads HookEvent rows for the mission using dedup logic:
 * - subagent_stop events: SUM all (each is an independent process with its own totals)
 * - stop events (all agents): take LATEST only per agent+model (cumulative session totals)
 *   Used as FALLBACK — only populates a group if no subagent_stop data exists for that key.
 *   This prevents double-counting for legacy subagents (which have both event types)
 *   while correctly capturing native teammates (which only fire stop events).
 *
 * Groups by agentName+model, calculates cost, upserts MissionTokenUsage.
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

    // --- Subagent events: sum all (each subagent_stop is independent) ---
    const subagentEvents = await prisma.hookEvent.findMany({
      where: {
        missionId,
        projectId,
        eventType: 'subagent_stop',
        agentName: { not: 'hannibal' },
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

    // --- Stop events (all agents): take only the latest per agent+model ---
    // stop events report cumulative session-to-date totals, so summing
    // multiple stop events would massively over-count. We take only the
    // most recent event (highest id) per agent+model combination.
    // No agentName filter — include hannibal AND native teammates (murdock, ba, etc.)
    const stopEvents = await prisma.hookEvent.findMany({
      where: {
        missionId,
        projectId,
        eventType: 'stop',
        inputTokens: { not: null },
        model: { not: null },
      },
      select: {
        id: true,
        agentName: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
      },
      orderBy: { id: 'desc' },
    });

    // Keep only the latest stop event per agent+model
    const latestStopByKey = new Map<string, typeof stopEvents[number]>();
    for (const event of stopEvents) {
      const key = `${event.agentName}:${event.model}`;
      if (!latestStopByKey.has(key)) {
        latestStopByKey.set(key, event);
      }
    }

    // Warn if hook events were excluded due to missing token data
    const totalEventCount = await prisma.hookEvent.count({
      where: {
        missionId,
        projectId,
        OR: [
          { eventType: 'subagent_stop', agentName: { not: 'hannibal' } },
          { eventType: 'stop' },
        ],
      },
    });

    const includedCount = subagentEvents.length + latestStopByKey.size;
    // Note: for stop events, we intentionally use only the latest per agent+model,
    // so excluded count reflects both missing-data exclusions and cumulative dedup
    const excludedForMissingData = totalEventCount - subagentEvents.length - stopEvents.length;
    if (excludedForMissingData > 0) {
      console.warn(
        `[token-aggregation] Mission ${missionId}: ${excludedForMissingData} hook event(s) excluded (missing token/model data)`
      );
    }

    // Group subagent events by agentName+model (sum all)
    const groups = new Map<string, { agentName: string; model: string; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }>();

    for (const event of subagentEvents) {
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

    // Add latest stop events as FALLBACK only (no summing — each is already cumulative).
    // Only populate if no subagent_stop data exists for this agent+model.
    // This prevents double-counting for legacy subagents (which have both event types)
    // while correctly capturing native teammates and hannibal (which only fire stop).
    for (const event of latestStopByKey.values()) {
      const key = `${event.agentName}:${event.model}`;
      if (!groups.has(key)) {
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

    // Upsert each group into MissionTokenUsage atomically
    const agents: AgentRow[] = [];

    await prisma.$transaction(async (tx) => {
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
