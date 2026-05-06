import { NextRequest } from 'next/server';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * Tests for GET /api/missions/[missionId]/skill-usage
 *
 * This endpoint returns a per-agent breakdown of Skill tool
 * invocations, keyed by skill name. It reads from the HookEvent
 * table, filters toolName === 'Skill', parses the JSON `payload`
 * column to extract `skill_name` and `args_hash`, then reports
 * invocation count and distinct-args count per (agent, skill).
 *
 * These tests use the real Prisma/SQLite database following the
 * pattern in hooks-events-api.test.ts. This is TDD: the route file
 * does not yet exist, so the import below fails with a
 * module-not-found error until GREEN phase. That is the correct
 * RED-phase signal.
 */

// NOTE: This import MUST fail during RED phase (route not implemented).
import { GET } from '@/app/api/missions/[missionId]/skill-usage/route';

const PROJECT_A = 'test-skill-a';
const PROJECT_B = 'test-skill-b';
const MISSION_ID = 'M-20260418-101';
const OTHER_MISSION_ID = 'M-20260418-102';

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
    `http://localhost:3000/api/missions/${missionId}/skill-usage`,
    { headers }
  );
}

async function seedSkillEvent(params: {
  projectId: string;
  missionId: string | null;
  agentName: string;
  skillName: string;
  argsHash: string;
}) {
  await prisma.hookEvent.create({
    data: {
      projectId: params.projectId,
      missionId: params.missionId ?? undefined,
      agentName: params.agentName,
      toolName: 'Skill',
      eventType: 'pre_tool_use',
      status: 'pending',
      summary: `Skill: ${params.skillName}`,
      payload: JSON.stringify({
        skill_name: params.skillName,
        args_hash: params.argsHash,
      }),
    },
  });
}

async function seedRawEvent(params: {
  projectId: string;
  missionId: string | null;
  agentName: string;
  toolName: string | null;
  eventType: string;
  payload?: string;
}) {
  await prisma.hookEvent.create({
    data: {
      projectId: params.projectId,
      missionId: params.missionId ?? undefined,
      agentName: params.agentName,
      toolName: params.toolName ?? undefined,
      eventType: params.eventType,
      status: 'pending',
      summary: 'seeded',
      payload: params.payload ?? '{}',
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

describe('GET /api/missions/[missionId]/skill-usage', () => {
  beforeEach(async () => {
    await cleanup();

    for (const id of [PROJECT_A, PROJECT_B]) {
      await prisma.project.upsert({
        where: { id },
        create: { id, name: id },
        update: {},
      });
    }

    await prisma.mission.create({
      data: {
        id: MISSION_ID,
        projectId: PROJECT_A,
        name: 'Skill Mission A',
        state: 'running',
        prdPath: '/prd/skill.md',
      },
    });
    await prisma.mission.create({
      data: {
        id: OTHER_MISSION_ID,
        projectId: PROJECT_A,
        name: 'Other Skill Mission A',
        state: 'running',
        prdPath: '/prd/other-skill.md',
      },
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('returns per-agent skill invocations with counts and distinct-args counts', async () => {
    // murdock used teams-messaging 3x total, 2 distinct args;
    // murdock used retro 1x.
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      skillName: 'teams-messaging',
      argsHash: 'aaaaaaaaaaaa',
    });
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      skillName: 'teams-messaging',
      argsHash: 'aaaaaaaaaaaa', // same args as first — not distinct
    });
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      skillName: 'teams-messaging',
      argsHash: 'bbbbbbbbbbbb',
    });
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      skillName: 'retro',
      argsHash: 'cccccccccccc',
    });

    // ba used ateam-cli 2x, both with distinct args.
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'ba',
      skillName: 'ateam-cli',
      argsHash: 'dddddddddddd',
    });
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'ba',
      skillName: 'ateam-cli',
      argsHash: 'eeeeeeeeeeee',
    });

    const res = await GET(
      buildRequest(MISSION_ID, { projectId: PROJECT_A }),
      buildContext(MISSION_ID)
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const agents: Array<{
      agentName: string;
      skills: Array<{ skillName: string; invocations: number; distinctArgs: number }>;
    }> = body.data.agents;

    expect(agents.map((a) => a.agentName).sort()).toEqual(['ba', 'murdock']);

    const murdock = agents.find((a) => a.agentName === 'murdock')!;
    const murdockSkills = Object.fromEntries(
      murdock.skills.map((s) => [s.skillName, s])
    );
    expect(murdockSkills['teams-messaging'].invocations).toBe(3);
    expect(murdockSkills['teams-messaging'].distinctArgs).toBe(2);
    expect(murdockSkills['retro'].invocations).toBe(1);
    expect(murdockSkills['retro'].distinctArgs).toBe(1);

    const ba = agents.find((a) => a.agentName === 'ba')!;
    expect(ba.skills).toHaveLength(1);
    expect(ba.skills[0]).toMatchObject({
      skillName: 'ateam-cli',
      invocations: 2,
      distinctArgs: 2,
    });
  });

  it('ignores non-Skill tool-call events', async () => {
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      skillName: 'teams-messaging',
      argsHash: 'aaaaaaaaaaaa',
    });
    // Noise: plain tool calls that must NOT register as skills.
    await seedRawEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      toolName: 'Read',
      eventType: 'pre_tool_use',
    });
    await seedRawEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      toolName: 'Bash',
      eventType: 'pre_tool_use',
    });
    await seedRawEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      toolName: null,
      eventType: 'stop',
    });

    const res = await GET(
      buildRequest(MISSION_ID, { projectId: PROJECT_A }),
      buildContext(MISSION_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const murdock = body.data.agents.find(
      (a: { agentName: string }) => a.agentName === 'murdock'
    );
    expect(murdock.skills).toHaveLength(1);
    expect(murdock.skills[0].skillName).toBe('teams-messaging');
    expect(murdock.skills[0].invocations).toBe(1);
  });

  it('skips Skill events with malformed or missing payload without crashing', async () => {
    // Good event
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'lynch',
      skillName: 'code-review',
      argsHash: '111111111111',
    });
    // Bad: malformed JSON in payload
    await seedRawEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'lynch',
      toolName: 'Skill',
      eventType: 'pre_tool_use',
      payload: '{not valid json',
    });
    // Bad: valid JSON but missing skill_name
    await seedRawEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'lynch',
      toolName: 'Skill',
      eventType: 'pre_tool_use',
      payload: JSON.stringify({ args_hash: '222222222222' }),
    });
    // Bad: empty payload
    await seedRawEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'lynch',
      toolName: 'Skill',
      eventType: 'pre_tool_use',
      payload: '{}',
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
    expect(lynch.skills).toHaveLength(1);
    expect(lynch.skills[0]).toMatchObject({
      skillName: 'code-review',
      invocations: 1,
      distinctArgs: 1,
    });
  });

  it('scopes results to the requested mission (excludes other missions)', async () => {
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'amy',
      skillName: 'perspective-test',
      argsHash: 'aaaaaaaaaaaa',
    });
    // Same skill, same agent, different mission — must not leak in.
    for (let i = 0; i < 5; i++) {
      await seedSkillEvent({
        projectId: PROJECT_A,
        missionId: OTHER_MISSION_ID,
        agentName: 'amy',
        skillName: 'perspective-test',
        argsHash: `other${i}${i}${i}${i}${i}${i}${i}`,
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
    expect(amy.skills[0].invocations).toBe(1);
    expect(amy.skills[0].distinctArgs).toBe(1);
  });

  it('scopes results to the requesting project (ignores other projects)', async () => {
    await seedSkillEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      skillName: 'teams-messaging',
      argsHash: 'aaaaaaaaaaaa',
    });
    // Project B rows tied to the SAME missionId — must not leak into
    // project A's response. Sharing missionId ensures the projectId
    // filter is what excludes them, not the missionId filter.
    for (let i = 0; i < 4; i++) {
      await seedSkillEvent({
        projectId: PROJECT_B,
        missionId: MISSION_ID,
        agentName: 'murdock',
        skillName: 'teams-messaging',
        argsHash: `bbbbbbbbbbb${i}`,
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
    expect(murdock.skills[0].invocations).toBe(1);
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

  it('filters to pre_tool_use only (does not double-count post_tool_use pairs)', async () => {
    // Real production data fires BOTH pre_tool_use AND post_tool_use for
    // every Skill invocation. Without an eventType filter, each invocation
    // is counted twice. Seed the same logical invocation as both events
    // (same agent, skill, args_hash) and verify it counts as ONE.
    await seedRawEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      toolName: 'Skill',
      eventType: 'pre_tool_use',
      payload: JSON.stringify({
        skill_name: 'teams-messaging',
        args_hash: 'aaaaaaaaaaaa',
      }),
    });
    await seedRawEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      toolName: 'Skill',
      eventType: 'post_tool_use',
      payload: JSON.stringify({
        skill_name: 'teams-messaging',
        args_hash: 'aaaaaaaaaaaa',
      }),
    });

    const res = await GET(
      buildRequest(MISSION_ID, { projectId: PROJECT_A }),
      buildContext(MISSION_ID)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const murdock = body.data.agents.find(
      (a: { agentName: string }) => a.agentName === 'murdock'
    );
    expect(murdock.skills).toHaveLength(1);
    expect(murdock.skills[0]).toMatchObject({
      skillName: 'teams-messaging',
      invocations: 1,
      distinctArgs: 1,
    });
  });

  it('returns { agents: [] } when the mission has no Skill events', async () => {
    // Seed only non-Skill events so we prove the filter, not just absence.
    await seedRawEvent({
      projectId: PROJECT_A,
      missionId: MISSION_ID,
      agentName: 'murdock',
      toolName: 'Read',
      eventType: 'pre_tool_use',
    });

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
