/**
 * API Route: /api/missions/[missionId]/skill-usage
 *
 * GET - Return per-agent Skill invocation counts and distinct-args counts.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError } from '@/lib/errors';
import type { ApiError } from '@/types/api';

interface RouteContext {
  params: Promise<{ missionId: string }>;
}

interface SkillUsage {
  skillName: string;
  invocations: number;
  distinctArgs: number;
}

interface AgentSkillUsage {
  agentName: string;
  skills: SkillUsage[];
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

    // TODO(scale): consider MissionSkillUsage materialization (mirror MissionTokenUsage) once mission event volume exceeds ~10k Skill events.
    const events = await prisma.hookEvent.findMany({
      where: {
        missionId,
        projectId,
        toolName: 'Skill',
        eventType: 'pre_tool_use',
      },
      select: {
        agentName: true,
        payload: true,
      },
    });

    const byAgent = new Map<string, Map<string, { invocations: number; argHashes: Set<string> }>>();

    for (const event of events) {
      if (!event.payload) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.payload);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const obj = parsed as Record<string, unknown>;
      const skillName = obj.skill_name;
      if (typeof skillName !== 'string' || skillName.length === 0) continue;
      const argsHash = typeof obj.args_hash === 'string' ? obj.args_hash : '';

      let skills = byAgent.get(event.agentName);
      if (!skills) {
        skills = new Map();
        byAgent.set(event.agentName, skills);
      }
      let entry = skills.get(skillName);
      if (!entry) {
        entry = { invocations: 0, argHashes: new Set() };
        skills.set(skillName, entry);
      }
      entry.invocations += 1;
      if (argsHash) entry.argHashes.add(argsHash);
    }

    const agents: AgentSkillUsage[] = Array.from(byAgent.entries())
      .map(([agentName, skillMap]) => ({
        agentName,
        skills: Array.from(skillMap.entries())
          .map(([skillName, entry]) => ({
            skillName,
            invocations: entry.invocations,
            distinctArgs: entry.argHashes.size,
          }))
          .sort((a, b) => b.invocations - a.invocations || a.skillName.localeCompare(b.skillName)),
      }))
      .sort((a, b) => a.agentName.localeCompare(b.agentName));

    return NextResponse.json({
      success: true,
      data: { missionId, agents },
    });
  } catch (error) {
    console.error('GET /api/missions/[missionId]/skill-usage error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch skill usage', error).toResponse(),
      { status: 500 }
    );
  }
}
