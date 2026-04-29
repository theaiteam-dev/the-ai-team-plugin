import { NextRequest } from 'next/server';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * Tests for GET /api/missions/[missionId]/tool-histogram
 *
 * This endpoint returns a per-agent breakdown of tool-call counts
 * grouped by tool name, so the kanban UI can show "which agent
 * used which tools, and how often". It reads from the HookEvent
 * table, counts only tool-call events (pre_tool_use), and scopes
 * by mission + project.
 *
 * These tests talk to the real Prisma/SQLite database following the
 * pattern used by hooks-events-api.test.ts and hook-event-pruning.test.ts.
 * This is TDD: the route file does not yet exist, so the import below
 * will fail with a module-not-found error until GREEN phase. That is
 * the correct RED-phase signal.
 */

// NOTE: This import MUST fail during RED phase (route not implemented).
import { GET } from '@/app/api/missions/[missionId]/tool-histogram/route';

const PROJECT_A = 'test-histo-a';
const PROJECT_B = 'test-histo-b';
const MISSION_ID = 'M-20260418-001';
const OTHER_MISSION_ID = 'M-20260418-002';

interface RouteContext {
  params: Promise<{ missionId: string }>;
}

function buildContext(missionId: string): RouteContext {
  return { params: Promise.resolve({ missionId }) };
}

function buildRequest(
  missionId: string,
  opts: { projectId?: string | null } = {}
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.projectId !== null && opts.projectId !== undefined) {
    headers['X-Project-ID'] = opts.projectId;
  }
  return new NextRequest(
    `http://localhost:3000/api/missions/${missionId}/tool-histogram`,
    { headers }
  );
}

async function seedEvent(params: {
  projectId: string;
  missionId: string | null;
  agentName: string;
  toolName: string | null;
  eventType: string;
}) {
  await prisma.hookEvent.create({
    data: {
      projectId: params.projectId,
      missionId: params.missionId ?? undefined,
      agentName: params.agentName,
      toolName: params.toolName ?? undefined,
      eventType: params.eventType,
      status: params.eventType.startsWith('pre_') ? 'pending' : 'success',
      summary: `${params.toolName ?? params.eventType} by ${params.agentName}`,
    },
  });
}

async function cleanup() {
  await prisma.hookEvent.deleteMany({
    where: { projectId: { in: [PROJECT_A, PROJECT_B] } },
  });
  await prisma.mission.deleteMany({
    where: { projectId: { in: [PROJECT_A, PROJECT_B] } },
  });
}

describe('GET /api/missions/[missionId]/tool-histogram', () => {
  beforeEach(async () => {
    await cleanup();

    // Ensure projects exist so FK on HookEvent.projectId is satisfied.
    for (const id of [PROJECT_A, PROJECT_B]) {
      await prisma.project.upsert({
        where: { id },
        create: { id, name: id },
        update: {},
      });
    }

    // Ensure missions exist so FK on HookEvent.missionId is satisfied.
    await prisma.mission.create({
      data: {
        id: MISSION_ID,
        projectId: PROJECT_A,
        name: 'Histogram Mission A',
        state: 'running',
        prdPath: '/prd/histo.md',
      },
    });
    await prisma.mission.create({
      data: {
        id: OTHER_MISSION_ID,
        projectId: PROJECT_A,
        name: 'Other Mission A',
        state: 'running',
        prdPath: '/prd/other.md',
      },
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('returns per-agent, per-tool counts for tool-call events', async () => {
    // Murdock: 5 Read, 3 Edit
    for (let i = 0; i < 5; i++) {
      await seedEvent({
        projectId: PROJECT_A,
        missionId: MISSION_ID,
        agentName: 'murdock',
        toolName: 'Read',
        eventType: 'pre_tool_use',
      });
    }
    for (let i = 0; i < 3; i++) {
      await seedEvent({
        projectId: PROJECT_A,
        missionId: MISSION_ID,
        agentName: 'murdock',
        toolName: 'Edit',
        eventType: 'pre_tool_use',
      });
    }
    // B.A.: 7 Write, 2 Bash
    for (let i = 0; i < 7; i++) {
      await seedEvent({
        projectId: PROJECT_A,
        missionId: MISSION_ID,
        agentName: 'ba',
        toolName: 'Write',
        eventType: 'pre_tool_use',
      });
    }
    for (let i = 0; i < 2; i++) {
      await seedEvent({
        projectId: PROJECT_A,
        missionId: MISSION_ID,
        agentName: 'ba',
        toolName: 'Bash',
        eventType: 'pre_tool_use',
      });
    }

    const res = await GET(
      buildRequest(MISSION_ID, { projectId: PROJECT_A }),
      buildContext(MISSION_ID)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.agents)).toBe(true);

    const agents: Array<{ agentName: string; tools: Array<{ toolName: string; count: number }> }> =
      body.data.agents;
    const byAgent = Object.fromEntries(agents.map((a) => [a.agentName, a.tools]));

    expect(Object.keys(byAgent).sort()).toEqual(['ba', 'murdock']);

    const murdock = Object.fromEntries(
      byAgent['murdock'].map((t) => [t.toolName, t.count])
    );
    expect(murdock).toEqual({ Read: 5, Edit: 3 });

    const ba = Object.fromEntries(byAgent['ba'].map((t) => [t.toolName, t.count]));
    expect(ba).toEqual({ Write: 7, Bash: 2 });
  });

  it('counts only tool-call events (pre_tool_use) and ignores lifecycle events', async () => {
    // 4 real tool-call events
    for (let i = 0; i < 4; i++) {
      await seedEvent({
        projectId: PROJECT_A,
        missionId: MISSION_ID,
        agentName: 'lynch',
        toolName: 'Read',
        eventType: 'pre_tool_use',
      });
    }
    // Noise that must NOT count toward histogram:
    //  - post_tool_use pairs (would double-count every tool call)
    //  - subagent_start/subagent_stop (no tool)
    //  - stop events
    for (let i = 0; i < 4; i++) {
      await seedEvent({
        projectId: PROJECT_A,
        missionId: MISSION_ID,
        agentName: 'lynch',
        toolName: 'Read',
        eventType: 'post_tool_use',
      });
    }
    await seedEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'lynch',
      toolName: null,
      eventType: 'subagent_start',
    });
    await seedEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'lynch',
      toolName: null,
      eventType: 'subagent_stop',
    });
    await seedEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'lynch',
      toolName: null,
      eventType: 'stop',
    });

    const res = await GET(
      buildRequest(MISSION_ID, { projectId: PROJECT_A }),
      buildContext(MISSION_ID)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const lynch = body.data.agents.find(
      (a: { agentName: string }) => a.agentName === 'lynch'
    );
    expect(lynch).toBeDefined();
    const readCount = lynch.tools.find(
      (t: { toolName: string }) => t.toolName === 'Read'
    ).count;
    // Must be 4 (pre only) not 8 (pre + post).
    expect(readCount).toBe(4);
  });

  it('scopes counts to the requested mission (excludes other missions)', async () => {
    // Target mission
    for (let i = 0; i < 3; i++) {
      await seedEvent({
        projectId: PROJECT_A,
        missionId: MISSION_ID,
        agentName: 'amy',
        toolName: 'Grep',
        eventType: 'pre_tool_use',
      });
    }
    // Other mission in same project — must NOT leak in.
    for (let i = 0; i < 10; i++) {
      await seedEvent({
        projectId: PROJECT_A,
        missionId: OTHER_MISSION_ID,
        agentName: 'amy',
        toolName: 'Grep',
        eventType: 'pre_tool_use',
      });
    }

    const res = await GET(
      buildRequest(MISSION_ID, { projectId: PROJECT_A }),
      buildContext(MISSION_ID)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const amy = body.data.agents.find(
      (a: { agentName: string }) => a.agentName === 'amy'
    );
    const grepCount = amy.tools.find(
      (t: { toolName: string }) => t.toolName === 'Grep'
    ).count;
    expect(grepCount).toBe(3);
  });

  it('scopes counts to the requesting project (ignores other projects)', async () => {
    // Project A events on the requested mission
    for (let i = 0; i < 2; i++) {
      await seedEvent({
        projectId: PROJECT_A,
        missionId: MISSION_ID,
        agentName: 'murdock',
        toolName: 'Read',
        eventType: 'pre_tool_use',
      });
    }
    // Project B events that share the SAME missionId — must not leak
    // into project A's response. Sharing missionId ensures the
    // projectId filter is what excludes them, not the missionId filter.
    for (let i = 0; i < 5; i++) {
      await seedEvent({
        projectId: PROJECT_B,
        missionId: MISSION_ID,
        agentName: 'murdock',
        toolName: 'Read',
        eventType: 'pre_tool_use',
      });
    }

    const res = await GET(
      buildRequest(MISSION_ID, { projectId: PROJECT_A }),
      buildContext(MISSION_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const murdock = body.data.agents.find(
      (a: { agentName: string }) => a.agentName === 'murdock'
    );
    const readCount = murdock.tools.find(
      (t: { toolName: string }) => t.toolName === 'Read'
    ).count;
    expect(readCount).toBe(2);
  });

  it('returns 400 VALIDATION_ERROR when X-Project-ID header is missing', async () => {
    const res = await GET(
      buildRequest(MISSION_ID, { projectId: null }),
      buildContext(MISSION_ID)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns { agents: [] } when the mission has no hook events', async () => {
    const res = await GET(
      buildRequest(MISSION_ID, { projectId: PROJECT_A }),
      buildContext(MISSION_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.agents).toEqual([]);
  });
});
