import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET } from '@/app/api/missions/[missionId]/token-usage/route';
import { prisma } from '@/lib/db';

/**
 * Tests for mission token aggregation endpoints (WI-281).
 *
 * POST /api/missions/:missionId/token-usage
 *   Reads HookEvent rows for the mission (eventType IN subagent_stop, stop),
 *   groups by agentName+model, sums token fields, computes estimatedCostUsd,
 *   upserts into MissionTokenUsage.
 *
 * GET /api/missions/:missionId/token-usage
 *   Returns per-agent rows and mission-level totals.
 *
 * Response shape:
 *   { success: true, data: { missionId, agents: [...], totals: {...} } }
 */

const PROJECT_ID = 'test-token-agg-project';
const MISSION_ID = 'M-20260227-agg-test';

/** Helper to build a NextRequest-like object for dynamic route handlers. */
function makeRequest(method: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/missions/${MISSION_ID}/token-usage`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Project-ID': PROJECT_ID,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Route params object passed to Next.js dynamic route handlers. */
const routeParams = { params: Promise.resolve({ missionId: MISSION_ID }) };

beforeEach(async () => {
  // Seed project and mission
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Token Agg Test Project' },
  });

  await prisma.mission.upsert({
    where: { id: MISSION_ID },
    update: {},
    create: {
      id: MISSION_ID,
      name: 'Token Aggregation Test Mission',
      state: 'running',
      prdPath: '/prd/test.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
    },
  });

  // Clean up token usage and hook events from previous runs
  await prisma.missionTokenUsage.deleteMany({ where: { missionId: MISSION_ID } });
  await prisma.hookEvent.deleteMany({ where: { projectId: PROJECT_ID } });
});

describe('POST /api/missions/:missionId/token-usage - aggregation', () => {
  it('should sum subagent_stop events and use latest stop event for hannibal', async () => {
    // subagent_stop events are independent (from separate processes) → sum all.
    // stop events are cumulative session totals → take only the latest.
    const ts = new Date().toISOString();
    await prisma.hookEvent.createMany({
      data: [
        // Two independent subagent_stop events for murdock → should be summed
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'subagent_stop',
          agentName: 'murdock',
          status: 'completed',
          summary: 'murdock completed',
          timestamp: new Date(ts),
          inputTokens: 1000,
          outputTokens: 200,
          cacheCreationTokens: 500,
          cacheReadTokens: 800,
          model: 'claude-sonnet-4-6',
        },
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'subagent_stop',
          agentName: 'murdock',
          status: 'completed',
          summary: 'murdock completed second pass',
          timestamp: new Date(new Date(ts).getTime() + 1000),
          inputTokens: 500,
          outputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 200,
          model: 'claude-sonnet-4-6',
        },
        // Single stop event for hannibal → use as-is
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'hannibal stopped',
          timestamp: new Date(new Date(ts).getTime() + 2000),
          inputTokens: 5000,
          outputTokens: 1000,
          cacheCreationTokens: 2000,
          cacheReadTokens: 8000,
          model: 'claude-opus-4-6',
        },
      ],
    });

    const request = makeRequest('POST');
    const response = await POST(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.missionId).toBe(MISSION_ID);

    // Verify per-agent rows
    const agents: Array<{
      agentName: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      estimatedCostUsd: number;
    }> = data.data.agents;

    const murdockRow = agents.find((a) => a.agentName === 'murdock');
    expect(murdockRow).toBeDefined();
    expect(murdockRow!.model).toBe('claude-sonnet-4-6');
    expect(murdockRow!.inputTokens).toBe(1500);          // 1000 + 500 (summed)
    expect(murdockRow!.outputTokens).toBe(300);          // 200 + 100
    expect(murdockRow!.cacheCreationTokens).toBe(500);   // 500 + 0
    expect(murdockRow!.cacheReadTokens).toBe(1000);      // 800 + 200
    expect(murdockRow!.estimatedCostUsd).toBeGreaterThan(0);

    const hannibalRow = agents.find((a) => a.agentName === 'hannibal');
    expect(hannibalRow).toBeDefined();
    expect(hannibalRow!.model).toBe('claude-opus-4-6');
    expect(hannibalRow!.inputTokens).toBe(5000);
    expect(hannibalRow!.outputTokens).toBe(1000);
  });

  it('should use only the latest stop event when hannibal has multiple cumulative stop events', async () => {
    // Hannibal fires a stop event on every turn, each containing cumulative
    // session-to-date totals. Summing them would massively over-count.
    // The aggregation must take only the latest (highest id) stop event.
    const ts = new Date();
    await prisma.hookEvent.createMany({
      data: [
        // Turn 1: cumulative total so far
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'hannibal turn 1',
          timestamp: new Date(ts.getTime()),
          inputTokens: 1000,
          outputTokens: 200,
          cacheCreationTokens: 500,
          cacheReadTokens: 3000,
          model: 'claude-opus-4-6',
        },
        // Turn 2: larger cumulative total (includes turn 1)
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'hannibal turn 2',
          timestamp: new Date(ts.getTime() + 1000),
          inputTokens: 2500,
          outputTokens: 600,
          cacheCreationTokens: 1200,
          cacheReadTokens: 8000,
          model: 'claude-opus-4-6',
        },
        // Turn 3: final cumulative total (includes turns 1+2)
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'hannibal turn 3',
          timestamp: new Date(ts.getTime() + 2000),
          inputTokens: 5000,
          outputTokens: 1000,
          cacheCreationTokens: 2000,
          cacheReadTokens: 15000,
          model: 'claude-opus-4-6',
        },
      ],
    });

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    const hannibal = data.data.agents.find((a: { agentName: string }) => a.agentName === 'hannibal');
    expect(hannibal).toBeDefined();

    // Should use only the latest (turn 3) values, NOT sum all three turns
    // Buggy behavior would give: 1000+2500+5000 = 8500 input tokens
    expect(hannibal.inputTokens).toBe(5000);        // latest only
    expect(hannibal.outputTokens).toBe(1000);       // latest only
    expect(hannibal.cacheCreationTokens).toBe(2000); // latest only
    expect(hannibal.cacheReadTokens).toBe(15000);    // latest only
  });
});

describe('GET /api/missions/:missionId/token-usage - retrieval', () => {
  it('should return per-agent breakdown and mission totals after aggregation', async () => {
    // Seed and aggregate first
    const ts = new Date().toISOString();
    await prisma.hookEvent.createMany({
      data: [
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'subagent_stop',
          agentName: 'ba',
          status: 'completed',
          summary: 'ba completed',
          timestamp: new Date(ts),
          inputTokens: 2000,
          outputTokens: 400,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          model: 'claude-sonnet-4-6',
        },
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'hannibal stopped',
          timestamp: new Date(new Date(ts).getTime() + 1000),
          inputTokens: 3000,
          outputTokens: 600,
          cacheCreationTokens: 1000,
          cacheReadTokens: 500,
          model: 'claude-opus-4-6',
        },
      ],
    });

    // Trigger aggregation
    await POST(makeRequest('POST'), routeParams);

    // Now fetch via GET
    const getRequest = makeRequest('GET');
    const response = await GET(getRequest, routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.missionId).toBe(MISSION_ID);

    // Per-agent breakdown
    expect(Array.isArray(data.data.agents)).toBe(true);
    expect(data.data.agents.length).toBeGreaterThanOrEqual(2);

    // Mission totals
    const totals = data.data.totals;
    expect(totals).toHaveProperty('inputTokens');
    expect(totals).toHaveProperty('outputTokens');
    expect(totals).toHaveProperty('cacheCreationTokens');
    expect(totals).toHaveProperty('cacheReadTokens');
    expect(totals).toHaveProperty('estimatedCostUsd');
    expect(totals.inputTokens).toBe(5000);   // 2000 + 3000
    expect(totals.outputTokens).toBe(1000);  // 400 + 600
    expect(totals.estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe('POST /api/missions/:missionId/token-usage - re-aggregation (upsert)', () => {
  it('should update totals on re-aggregation without creating duplicate rows', async () => {
    const ts = new Date().toISOString();
    // First event batch
    await prisma.hookEvent.create({
      data: {
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        eventType: 'subagent_stop',
        agentName: 'lynch',
        status: 'completed',
        summary: 'lynch completed',
        timestamp: new Date(ts),
        inputTokens: 1000,
        outputTokens: 200,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        model: 'claude-sonnet-4-6',
      },
    });

    await POST(makeRequest('POST'), routeParams);

    // Add a second event for the same agent+model
    await prisma.hookEvent.create({
      data: {
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        eventType: 'subagent_stop',
        agentName: 'lynch',
        status: 'completed',
        summary: 'lynch completed again',
        timestamp: new Date(new Date(ts).getTime() + 1000),
        inputTokens: 500,
        outputTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        model: 'claude-sonnet-4-6',
      },
    });

    // Re-aggregate
    await POST(makeRequest('POST'), routeParams);

    // Check DB directly — should be exactly one row for lynch+sonnet
    const rows = await prisma.missionTokenUsage.findMany({
      where: { missionId: MISSION_ID, agentName: 'lynch', model: 'claude-sonnet-4-6' },
    });

    expect(rows).toHaveLength(1);
    // Updated totals, not duplicated
    expect(rows[0].inputTokens).toBe(1500);   // 1000 + 500
    expect(rows[0].outputTokens).toBe(300);   // 200 + 100
  });
});

describe('GET /api/missions/:missionId/token-usage - empty mission', () => {
  it('should return empty agents array and zero totals when no token data exists', async () => {
    // No HookEvents seeded, no MissionTokenUsage rows
    const getRequest = makeRequest('GET');
    const response = await GET(getRequest, routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.agents).toEqual([]);
    expect(data.data.totals.inputTokens).toBe(0);
    expect(data.data.totals.outputTokens).toBe(0);
    expect(data.data.totals.cacheCreationTokens).toBe(0);
    expect(data.data.totals.cacheReadTokens).toBe(0);
    expect(data.data.totals.estimatedCostUsd).toBe(0);
  });
});

describe('POST /api/missions/:missionId/token-usage - double-counting prevention', () => {
  it('should not double-count when same agent has both subagent_stop and stop events', async () => {
    // Claude Code fires TWO hooks when a subagent completes:
    //   1. SubagentStop in the main session → eventType: 'subagent_stop', agentName: 'murdock'
    //   2. Murdock's own Stop hook        → eventType: 'stop',         agentName: 'murdock'
    // Both carry identical token counts from the same transcript.
    // The aggregation must deduplicate: use subagent_stop for subagents,
    // use stop only for hannibal (who has no subagent_stop event).
    await prisma.hookEvent.createMany({
      data: [
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'subagent_stop',
          agentName: 'murdock',
          status: 'success',
          summary: 'Tests complete',
          timestamp: new Date(),
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 100,
          cacheReadTokens: 800,
          model: 'claude-sonnet-4-6',
        },
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'murdock',
          status: 'success',
          summary: 'Tests complete',
          timestamp: new Date(),
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 100,
          cacheReadTokens: 800,
          model: 'claude-sonnet-4-6',
        },
      ],
    });

    const postResponse = await POST(makeRequest('POST'), { params: Promise.resolve({ missionId: MISSION_ID }) });
    expect(postResponse.status).toBe(200);
    const postData = await postResponse.json();

    // Should NOT double-count — only subagent_stop for subagents
    const murdock = postData.data.agents.find((a: { agentName: string }) => a.agentName === 'murdock');
    expect(murdock).toBeDefined();
    expect(murdock.inputTokens).toBe(1000);  // NOT 2000
    expect(murdock.outputTokens).toBe(500);  // NOT 1000
  });
});

describe('POST /api/missions/:missionId/token-usage - native teammate stop events', () => {
  it('should include native teammate stop events when no subagent_stop exists', async () => {
    // Native teammates (e.g., amy in teams mode) only fire stop events,
    // not subagent_stop. These must be included in aggregation.
    const ts = new Date();
    await prisma.hookEvent.createMany({
      data: [
        // amy fires multiple cumulative stop events (native teammate)
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'amy',
          status: 'stopped',
          summary: 'amy turn 1',
          timestamp: new Date(ts.getTime()),
          inputTokens: 2000,
          outputTokens: 400,
          cacheCreationTokens: 100,
          cacheReadTokens: 1500,
          model: 'claude-sonnet-4-6',
        },
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'amy',
          status: 'stopped',
          summary: 'amy turn 2 (cumulative)',
          timestamp: new Date(ts.getTime() + 1000),
          inputTokens: 4000,
          outputTokens: 800,
          cacheCreationTokens: 200,
          cacheReadTokens: 3000,
          model: 'claude-sonnet-4-6',
        },
        // hannibal also fires stop events
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'hannibal stopped',
          timestamp: new Date(ts.getTime() + 2000),
          inputTokens: 5000,
          outputTokens: 1000,
          cacheCreationTokens: 2000,
          cacheReadTokens: 8000,
          model: 'claude-opus-4-6',
        },
      ],
    });

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Amy should appear with latest (cumulative) values only
    const amy = data.data.agents.find((a: { agentName: string }) => a.agentName === 'amy');
    expect(amy).toBeDefined();
    expect(amy.inputTokens).toBe(4000);   // latest only, NOT 2000+4000
    expect(amy.outputTokens).toBe(800);
    expect(amy.model).toBe('claude-sonnet-4-6');

    // Hannibal should still work as before
    const hannibal = data.data.agents.find((a: { agentName: string }) => a.agentName === 'hannibal');
    expect(hannibal).toBeDefined();
    expect(hannibal.inputTokens).toBe(5000);
  });

  it('should prefer subagent_stop over stop to prevent double-counting', async () => {
    // Legacy subagents fire BOTH subagent_stop AND stop with identical data.
    // The aggregation must use subagent_stop and skip the stop event.
    const ts = new Date();
    await prisma.hookEvent.createMany({
      data: [
        // murdock subagent_stop (from Hannibal's session)
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'subagent_stop',
          agentName: 'murdock',
          status: 'success',
          summary: 'Tests complete',
          timestamp: new Date(ts.getTime()),
          inputTokens: 3000,
          outputTokens: 600,
          cacheCreationTokens: 200,
          cacheReadTokens: 2000,
          model: 'claude-sonnet-4-6',
        },
        // murdock stop (from murdock's own session) — should be skipped
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'murdock',
          status: 'stopped',
          summary: 'murdock session end',
          timestamp: new Date(ts.getTime() + 100),
          inputTokens: 3000,
          outputTokens: 600,
          cacheCreationTokens: 200,
          cacheReadTokens: 2000,
          model: 'claude-sonnet-4-6',
        },
      ],
    });

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    const murdock = data.data.agents.find((a: { agentName: string }) => a.agentName === 'murdock');
    expect(murdock).toBeDefined();
    // Should be 3000, not 6000 (no double-counting)
    expect(murdock.inputTokens).toBe(3000);
    expect(murdock.outputTokens).toBe(600);
  });

  it('should handle mixed mode — some agents with subagent_stop, others with stop only', async () => {
    // Real-world scenario: legacy subagent (murdock) has subagent_stop,
    // native teammate (amy) has only stop, hannibal has only stop.
    const ts = new Date();
    await prisma.hookEvent.createMany({
      data: [
        // murdock: legacy subagent (subagent_stop + stop)
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'subagent_stop',
          agentName: 'murdock',
          status: 'success',
          summary: 'murdock subagent_stop',
          timestamp: new Date(ts.getTime()),
          inputTokens: 2000,
          outputTokens: 400,
          cacheCreationTokens: 0,
          cacheReadTokens: 1000,
          model: 'claude-sonnet-4-6',
        },
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'murdock',
          status: 'stopped',
          summary: 'murdock stop (duplicate)',
          timestamp: new Date(ts.getTime() + 100),
          inputTokens: 2000,
          outputTokens: 400,
          cacheCreationTokens: 0,
          cacheReadTokens: 1000,
          model: 'claude-sonnet-4-6',
        },
        // amy: native teammate (stop only)
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'amy',
          status: 'stopped',
          summary: 'amy stop',
          timestamp: new Date(ts.getTime() + 1000),
          inputTokens: 5000,
          outputTokens: 1000,
          cacheCreationTokens: 300,
          cacheReadTokens: 4000,
          model: 'claude-sonnet-4-6',
        },
        // hannibal: orchestrator (stop only)
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'hannibal stop',
          timestamp: new Date(ts.getTime() + 2000),
          inputTokens: 8000,
          outputTokens: 2000,
          cacheCreationTokens: 3000,
          cacheReadTokens: 12000,
          model: 'claude-opus-4-6',
        },
      ],
    });

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);

    const agents: Array<{ agentName: string; inputTokens: number }> = data.data.agents;
    expect(agents).toHaveLength(3);

    // murdock: subagent_stop used, stop skipped
    const murdock = agents.find((a) => a.agentName === 'murdock');
    expect(murdock!.inputTokens).toBe(2000);

    // amy: stop used (no subagent_stop exists)
    const amy = agents.find((a) => a.agentName === 'amy');
    expect(amy!.inputTokens).toBe(5000);

    // hannibal: stop used (no subagent_stop exists)
    const hannibal = agents.find((a) => a.agentName === 'hannibal');
    expect(hannibal!.inputTokens).toBe(8000);
  });
});

describe('POST /api/missions/:missionId/token-usage - multiple agents and models', () => {
  it('should group by agentName+model producing separate rows for different combinations', async () => {
    const ts = new Date();
    await prisma.hookEvent.createMany({
      data: [
        // murdock on sonnet
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'subagent_stop',
          agentName: 'murdock',
          status: 'completed',
          summary: 'murdock/sonnet',
          timestamp: new Date(ts.getTime()),
          inputTokens: 1000,
          outputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          model: 'claude-sonnet-4-6',
        },
        // hannibal on opus
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'stop',
          agentName: 'hannibal',
          status: 'stopped',
          summary: 'hannibal/opus',
          timestamp: new Date(ts.getTime() + 1000),
          inputTokens: 8000,
          outputTokens: 2000,
          cacheCreationTokens: 3000,
          cacheReadTokens: 12000,
          model: 'claude-opus-4-6',
        },
        // ba on sonnet (different agent, same model as murdock)
        {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          eventType: 'subagent_stop',
          agentName: 'ba',
          status: 'completed',
          summary: 'ba/sonnet',
          timestamp: new Date(ts.getTime() + 2000),
          inputTokens: 2000,
          outputTokens: 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 1000,
          model: 'claude-sonnet-4-6',
        },
      ],
    });

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);

    const agents: Array<{ agentName: string; model: string }> = data.data.agents;

    // Three distinct agentName+model combinations
    expect(agents).toHaveLength(3);

    const keys = agents.map((a) => `${a.agentName}:${a.model}`).sort();
    expect(keys).toEqual([
      'ba:claude-sonnet-4-6',
      'hannibal:claude-opus-4-6',
      'murdock:claude-sonnet-4-6',
    ]);
  });
});

describe('POST /api/missions/:missionId/token-usage - excluded event warning', () => {
  it('should warn via console.warn when hook events are excluded due to missing token/model data', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const ts = new Date();
      await prisma.hookEvent.createMany({
        data: [
          // Event WITH complete token data — should be included in aggregation
          {
            projectId: PROJECT_ID,
            missionId: MISSION_ID,
            eventType: 'subagent_stop',
            agentName: 'murdock',
            status: 'completed',
            summary: 'murdock completed with token data',
            timestamp: new Date(ts.getTime()),
            inputTokens: 1000,
            outputTokens: 200,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            model: 'claude-sonnet-4-6',
          },
          // Event WITHOUT token data (null inputTokens) — should be excluded and trigger warning
          {
            projectId: PROJECT_ID,
            missionId: MISSION_ID,
            eventType: 'subagent_stop',
            agentName: 'ba',
            status: 'completed',
            summary: 'ba completed without token data',
            timestamp: new Date(ts.getTime() + 1000),
            inputTokens: null,
            outputTokens: null,
            cacheCreationTokens: null,
            cacheReadTokens: null,
            model: null,
          },
        ],
      });

      const request = makeRequest('POST');
      const response = await POST(request, routeParams);
      const data = await response.json();

      // Response should succeed and only include the event with token data
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      const agents: Array<{ agentName: string }> = data.data.agents;
      expect(agents).toHaveLength(1);
      expect(agents[0].agentName).toBe('murdock');

      // console.warn should have been called mentioning "excluded"
      expect(warnSpy).toHaveBeenCalled();
      const warnMessage: string = warnSpy.mock.calls[0][0];
      expect(warnMessage).toContain('excluded');
      expect(warnMessage).toContain(MISSION_ID);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
