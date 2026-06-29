import { describe, it, expect, beforeEach } from 'vitest';
import { POST, GET } from '@/app/api/missions/[missionId]/token-usage/route';
import { prisma } from '@/lib/db';
import { calculateTokenCost } from '@/lib/token-cost';

/**
 * Tests for mission token-usage aggregation derived from MessageTokenUsage (WI-173).
 *
 * POST /api/missions/:missionId/token-usage now SUMs per-message token deltas
 * from the MessageTokenUsage table — the faithful per-message source of truth —
 * grouped by (baseAgentName(agentName), model). Each group is priced at its OWN
 * model rate via calculateTokenCost and upserted into one MissionTokenUsage row
 * per (baseAgent, model). This replaces the lossy HookEvent "latest cumulative
 * snapshot per session + last-model" logic, eliminating the cross-model
 * double-count and model mis-attribution for drifting sessions (e.g. Hannibal).
 *
 * Re-aggregation clears prior MissionTokenUsage rows then recomputes, so it is
 * idempotent and leaves no stale per-instance rows.
 *
 * GET continues to return stored MissionTokenUsage rows + mission totals in the
 * same response shape: { success, data: { missionId, agents, totals } }.
 *
 * These are integration tests against the real Prisma test DB (matching the
 * existing token-aggregation.test.ts pattern), seeding MessageTokenUsage rows.
 */

const PROJECT_ID = 'test-msg-token-agg-project';
const MISSION_ID = 'M-20260629-msg-agg-test';

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

const routeParams = { params: Promise.resolve({ missionId: MISSION_ID }) };

interface SeedMsg {
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

let messageSeq = 0;

/** Seed one MessageTokenUsage row with a unique messageId. */
async function seedMessages(messages: SeedMsg[]): Promise<void> {
  for (const m of messages) {
    messageSeq += 1;
    await prisma.messageTokenUsage.create({
      data: {
        messageId: `msg_${MISSION_ID}_${messageSeq}`,
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        agentName: m.agentName,
        model: m.model,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheCreationTokens: m.cacheCreationTokens,
        cacheReadTokens: m.cacheReadTokens,
      },
    });
  }
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

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Message Token Agg Test Project' },
  });

  await prisma.mission.upsert({
    where: { id: MISSION_ID },
    update: {},
    create: {
      id: MISSION_ID,
      name: 'Message Token Aggregation Test Mission',
      state: 'running',
      prdPath: '/prd/test.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
    },
  });

  // Clean slate for both source rows and aggregated rows.
  await prisma.missionTokenUsage.deleteMany({ where: { missionId: MISSION_ID } });
  await prisma.messageTokenUsage.deleteMany({ where: { missionId: MISSION_ID } });
});

describe('POST token-usage - SUM per-message deltas grouped by (baseAgent, model)', () => {
  it('sums all per-message deltas for one agent under one model into a single row', async () => {
    await seedMessages([
      { agentName: 'murdock', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 500, cacheReadTokens: 800 },
      { agentName: 'murdock', model: 'claude-sonnet-4-6', inputTokens: 500, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 200 },
      { agentName: 'murdock', model: 'claude-sonnet-4-6', inputTokens: 250, outputTokens: 50, cacheCreationTokens: 100, cacheReadTokens: 0 },
    ]);

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.missionId).toBe(MISSION_ID);

    const agents: AgentRow[] = data.data.agents;
    expect(agents).toHaveLength(1);

    const murdock = agents[0];
    expect(murdock.agentName).toBe('murdock');
    expect(murdock.model).toBe('claude-sonnet-4-6');
    expect(murdock.inputTokens).toBe(1750);        // 1000 + 500 + 250
    expect(murdock.outputTokens).toBe(350);        // 200 + 100 + 50
    expect(murdock.cacheCreationTokens).toBe(600); // 500 + 0 + 100
    expect(murdock.cacheReadTokens).toBe(1000);    // 800 + 200 + 0
  });
});

describe('POST token-usage - single-model deterministic fixture (exact equality)', () => {
  it('produces a MissionTokenUsage row equal to the exact hand-computed SUM of seeded deltas', async () => {
    // Fixed fixture with known per-message deltas; the aggregated row must equal
    // the exact SUM on every token field and be priced at the model's own rate.
    const deltas: SeedMsg[] = [
      { agentName: 'ba', model: 'claude-sonnet-4-6', inputTokens: 1234, outputTokens: 321, cacheCreationTokens: 77, cacheReadTokens: 4096 },
      { agentName: 'ba', model: 'claude-sonnet-4-6', inputTokens: 9000, outputTokens: 1500, cacheCreationTokens: 0, cacheReadTokens: 250 },
    ];
    await seedMessages(deltas);

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();
    expect(response.status).toBe(200);

    const expected = {
      inputTokens: 1234 + 9000,
      outputTokens: 321 + 1500,
      cacheCreationTokens: 77 + 0,
      cacheReadTokens: 4096 + 250,
    };
    const expectedCost = calculateTokenCost(expected, 'claude-sonnet-4-6').totalUsd;

    const agents: AgentRow[] = data.data.agents;
    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual({
      agentName: 'ba',
      model: 'claude-sonnet-4-6',
      inputTokens: expected.inputTokens,
      outputTokens: expected.outputTokens,
      cacheCreationTokens: expected.cacheCreationTokens,
      cacheReadTokens: expected.cacheReadTokens,
      estimatedCostUsd: expectedCost,
    });

    // Persisted row matches exactly too.
    const persisted = await prisma.missionTokenUsage.findMany({ where: { missionId: MISSION_ID } });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].inputTokens).toBe(expected.inputTokens);
    expect(persisted[0].outputTokens).toBe(expected.outputTokens);
    expect(persisted[0].cacheCreationTokens).toBe(expected.cacheCreationTokens);
    expect(persisted[0].cacheReadTokens).toBe(expected.cacheReadTokens);
    expect(persisted[0].estimatedCostUsd).toBe(expectedCost);
  });
});

describe('POST token-usage - model drift produces two rows priced per-model', () => {
  it('splits one agent across its two models into two rows, each priced at its own rate (never collapsed, never double-counted)', async () => {
    // Hannibal's session drifts across models: some messages on opus, some on
    // sonnet. The faithful aggregation must keep them as TWO rows — one per model
    // — each summing only that model's per-message deltas and priced at that
    // model's rate. NOT one row stamped with the last model, and NOT the same
    // cumulative total counted under both models.
    await seedMessages([
      { agentName: 'hannibal', model: 'claude-opus-4-6', inputTokens: 5000, outputTokens: 1200, cacheCreationTokens: 2000, cacheReadTokens: 8000 },
      { agentName: 'hannibal', model: 'claude-opus-4-6', inputTokens: 3000, outputTokens: 800, cacheCreationTokens: 0, cacheReadTokens: 6000 },
      { agentName: 'hannibal', model: 'claude-opus-4-6', inputTokens: 1000, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 500 },
      { agentName: 'hannibal', model: 'claude-sonnet-4-6', inputTokens: 400, outputTokens: 90, cacheCreationTokens: 0, cacheReadTokens: 1200 },
      { agentName: 'hannibal', model: 'claude-sonnet-4-6', inputTokens: 600, outputTokens: 110, cacheCreationTokens: 0, cacheReadTokens: 800 },
    ]);

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();
    expect(response.status).toBe(200);

    const agents: AgentRow[] = data.data.agents;
    const hannibalRows = agents.filter((a) => a.agentName === 'hannibal');
    expect(hannibalRows).toHaveLength(2);

    const opus = hannibalRows.find((r) => r.model === 'claude-opus-4-6')!;
    const sonnet = hannibalRows.find((r) => r.model === 'claude-sonnet-4-6')!;

    // Opus row = sum of the three opus deltas only.
    expect(opus.inputTokens).toBe(9000);        // 5000 + 3000 + 1000
    expect(opus.outputTokens).toBe(2100);       // 1200 + 800 + 100
    expect(opus.cacheCreationTokens).toBe(2000);
    expect(opus.cacheReadTokens).toBe(14500);   // 8000 + 6000 + 500

    // Sonnet row = sum of the two sonnet deltas only.
    expect(sonnet.inputTokens).toBe(1000);      // 400 + 600
    expect(sonnet.outputTokens).toBe(200);      // 90 + 110
    expect(sonnet.cacheCreationTokens).toBe(0);
    expect(sonnet.cacheReadTokens).toBe(2000);  // 1200 + 800

    // Each row priced at its OWN model rate (not both at the last model's rate).
    expect(opus.estimatedCostUsd).toBe(
      calculateTokenCost(
        { inputTokens: 9000, outputTokens: 2100, cacheCreationTokens: 2000, cacheReadTokens: 14500 },
        'claude-opus-4-6'
      ).totalUsd
    );
    expect(sonnet.estimatedCostUsd).toBe(
      calculateTokenCost(
        { inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 2000 },
        'claude-sonnet-4-6'
      ).totalUsd
    );
    // Sanity: the two models price differently, so this is a real per-model split.
    expect(opus.estimatedCostUsd).not.toBe(sonnet.estimatedCostUsd);
  });
});

describe('POST token-usage - variant rollup (pool instances)', () => {
  it('rolls murdock, murdock-1, murdock-2 messages into a single base-role murdock group per model', async () => {
    await seedMessages([
      { agentName: 'murdock', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 100, cacheReadTokens: 500 },
      { agentName: 'murdock-1', model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 300, cacheCreationTokens: 200, cacheReadTokens: 700 },
      { agentName: 'murdock-2', model: 'claude-sonnet-4-6', inputTokens: 3000, outputTokens: 500, cacheCreationTokens: 300, cacheReadTokens: 800 },
    ]);

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();
    expect(response.status).toBe(200);

    const agents: AgentRow[] = data.data.agents;

    // Exactly one consolidated murdock row — no raw instance names leak through.
    const murdockRows = agents.filter((a) => a.agentName === 'murdock');
    expect(murdockRows).toHaveLength(1);
    expect(agents.some((a) => /-\d+$/.test(a.agentName))).toBe(false);

    const murdock = murdockRows[0];
    expect(murdock.model).toBe('claude-sonnet-4-6');
    expect(murdock.inputTokens).toBe(6000);        // 1000 + 2000 + 3000
    expect(murdock.outputTokens).toBe(1000);       // 200 + 300 + 500
    expect(murdock.cacheCreationTokens).toBe(600); // 100 + 200 + 300
    expect(murdock.cacheReadTokens).toBe(2000);    // 500 + 700 + 800

    // Persisted as a single base-role row, no per-instance rows.
    const persisted = await prisma.missionTokenUsage.findMany({ where: { missionId: MISSION_ID } });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].agentName).toBe('murdock');
  });
});

describe('POST token-usage - no-double-count grand-total invariant', () => {
  it('mission grand total equals the hand-summed total of all distinct MessageTokenUsage rows (each counted once)', async () => {
    const seeded: SeedMsg[] = [
      { agentName: 'hannibal', model: 'claude-opus-4-6', inputTokens: 5000, outputTokens: 1200, cacheCreationTokens: 2000, cacheReadTokens: 8000 },
      { agentName: 'hannibal', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 2000 },
      { agentName: 'murdock', model: 'claude-sonnet-4-6', inputTokens: 1500, outputTokens: 350, cacheCreationTokens: 600, cacheReadTokens: 1000 },
      { agentName: 'murdock-1', model: 'claude-sonnet-4-6', inputTokens: 750, outputTokens: 80, cacheCreationTokens: 0, cacheReadTokens: 300 },
      { agentName: 'ba', model: 'claude-sonnet-4-6', inputTokens: 4000, outputTokens: 900, cacheCreationTokens: 0, cacheReadTokens: 5000 },
    ];
    await seedMessages(seeded);

    const response = await POST(makeRequest('POST'), routeParams);
    const data = await response.json();
    expect(response.status).toBe(200);

    const handInput = seeded.reduce((s, m) => s + m.inputTokens, 0);
    const handOutput = seeded.reduce((s, m) => s + m.outputTokens, 0);
    const handCacheCreation = seeded.reduce((s, m) => s + m.cacheCreationTokens, 0);
    const handCacheRead = seeded.reduce((s, m) => s + m.cacheReadTokens, 0);

    const totals = data.data.totals;
    // Each per-message delta counted exactly once — exact equality (stronger
    // than the AC's "within 1%").
    expect(totals.inputTokens).toBe(handInput);
    expect(totals.outputTokens).toBe(handOutput);
    expect(totals.cacheCreationTokens).toBe(handCacheCreation);
    expect(totals.cacheReadTokens).toBe(handCacheRead);
    expect(totals.estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe('POST token-usage - re-aggregation is idempotent', () => {
  it('clears prior rows and recomputes identically with no stale per-instance rows on re-run', async () => {
    await seedMessages([
      { agentName: 'lynch', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 0 },
      { agentName: 'lynch-1', model: 'claude-sonnet-4-6', inputTokens: 500, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 },
    ]);

    // Pre-seed a STALE per-instance row that a prior aggregation scheme might have
    // left behind. The clear-then-recompute must remove it.
    await prisma.missionTokenUsage.create({
      data: {
        missionId: MISSION_ID,
        projectId: PROJECT_ID,
        agentName: 'lynch-1',
        model: 'claude-sonnet-4-6',
        inputTokens: 999999,
        outputTokens: 999999,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        estimatedCostUsd: 123.45,
      },
    });

    const first = await (await POST(makeRequest('POST'), routeParams)).json();
    const second = await (await POST(makeRequest('POST'), routeParams)).json();

    // Identical results across runs.
    expect(second.data.agents).toEqual(first.data.agents);
    expect(second.data.totals).toEqual(first.data.totals);

    // Exactly one consolidated lynch row in the DB — the stale lynch-1 row is gone.
    const rows = await prisma.missionTokenUsage.findMany({ where: { missionId: MISSION_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe('lynch');
    expect(rows[0].inputTokens).toBe(1500); // 1000 + 500 consolidated, not the stale 999999
    expect(rows.some((r) => /-\d+$/.test(r.agentName))).toBe(false);
  });
});

describe('GET token-usage - response shape unchanged', () => {
  it('returns the stored MissionTokenUsage rows and mission totals after aggregation', async () => {
    await seedMessages([
      { agentName: 'ba', model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 400, cacheCreationTokens: 0, cacheReadTokens: 0 },
      { agentName: 'hannibal', model: 'claude-opus-4-6', inputTokens: 3000, outputTokens: 600, cacheCreationTokens: 1000, cacheReadTokens: 500 },
    ]);

    await POST(makeRequest('POST'), routeParams);

    const response = await GET(makeRequest('GET'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.missionId).toBe(MISSION_ID);

    const agents: AgentRow[] = data.data.agents;
    expect(agents).toHaveLength(2);
    // Each row carries the full AgentRow field set (shape unchanged).
    for (const row of agents) {
      expect(row).toHaveProperty('agentName');
      expect(row).toHaveProperty('model');
      expect(row).toHaveProperty('inputTokens');
      expect(row).toHaveProperty('outputTokens');
      expect(row).toHaveProperty('cacheCreationTokens');
      expect(row).toHaveProperty('cacheReadTokens');
      expect(row).toHaveProperty('estimatedCostUsd');
    }

    const totals = data.data.totals;
    expect(totals.inputTokens).toBe(5000);  // 2000 + 3000
    expect(totals.outputTokens).toBe(1000); // 400 + 600
    expect(totals.cacheCreationTokens).toBe(1000);
    expect(totals.cacheReadTokens).toBe(500);
    expect(totals.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('returns an empty breakdown and zero totals when no message data exists', async () => {
    const response = await GET(makeRequest('GET'), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.agents).toEqual([]);
    expect(data.data.totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      estimatedCostUsd: 0,
    });
  });
});
