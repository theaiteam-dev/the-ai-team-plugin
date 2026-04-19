/**
 * API Route: /api/missions/[missionId]/tool-histogram
 *
 * GET - Return per-agent, per-tool call counts for a mission.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError } from '@/lib/errors';
import type { ApiError } from '@/types/api';

interface RouteContext {
  params: Promise<{ missionId: string }>;
}

interface ToolCount {
  toolName: string;
  count: number;
}

interface AgentHistogram {
  agentName: string;
  tools: ToolCount[];
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { missionId } = await context.params;

    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    const grouped = await prisma.hookEvent.groupBy({
      by: ['agentName', 'toolName'],
      where: {
        missionId,
        projectId,
        eventType: 'pre_tool_use',
        toolName: { not: null },
      },
      _count: { _all: true },
    });

    const byAgent = new Map<string, ToolCount[]>();
    for (const row of grouped) {
      if (!row.toolName) continue;
      const tools = byAgent.get(row.agentName) ?? [];
      tools.push({ toolName: row.toolName, count: row._count._all });
      byAgent.set(row.agentName, tools);
    }

    const agents: AgentHistogram[] = Array.from(byAgent.entries())
      .map(([agentName, tools]) => ({
        agentName,
        tools: tools.slice().sort((a, b) => b.count - a.count || a.toolName.localeCompare(b.toolName)),
      }))
      .sort((a, b) => a.agentName.localeCompare(b.agentName));

    return NextResponse.json({
      success: true,
      data: { missionId, agents },
    });
  } catch (error) {
    console.error('GET /api/missions/[missionId]/tool-histogram error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch tool histogram', error).toResponse(),
      { status: 500 }
    );
  }
}
