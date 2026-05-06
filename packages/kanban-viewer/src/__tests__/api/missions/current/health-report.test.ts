import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for GET /api/missions/current/health-report
 *
 * Pure data-layer endpoint: returns activity timestamps & counts for
 * in-flight items so callers can decide what (if anything) to do.
 *
 * No `likelyIssue`, no `suggestedAction`, no thresholds for action —
 * only `missionIdle` (an aggregate of `idleSeconds > 600` per item).
 */

const FROZEN_NOW = new Date('2026-05-02T12:00:00.000Z');

// ---- Mocks ----

const mockPrismaClient = vi.hoisted(() => ({
  mission: {
    findFirst: vi.fn(),
  },
  item: {
    findMany: vi.fn(),
  },
  agentClaim: {
    findMany: vi.fn(),
  },
  workLog: {
    findMany: vi.fn(),
  },
  hookEvent: {
    findMany: vi.fn(),
  },
  activityLog: {
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

// Import route handler — should fail to resolve until implementation exists.
import { GET } from '@/app/api/missions/current/health-report/route';

// ---- Fixtures ----

const PROJECT_ID = 'test-project';
const MISSION_ID = 'M-20260502-001';

const activeMission = {
  id: MISSION_ID,
  name: 'Active Mission',
  state: 'running',
  prdPath: '/prd/x.md',
  projectId: PROJECT_ID,
  startedAt: new Date('2026-05-01T00:00:00.000Z'),
  completedAt: null,
  archivedAt: null,
};

function makeItem(overrides: Partial<{ id: string; title: string; stageId: string }>) {
  return {
    id: overrides.id ?? 'WI-001',
    title: overrides.title ?? 'Item',
    description: 'desc',
    type: 'feature',
    priority: 'medium',
    stageId: overrides.stageId ?? 'implementing',
    projectId: PROJECT_ID,
    assignedAgent: null,
    rejectionCount: 0,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    completedAt: null,
    archivedAt: null,
    objective: null,
    acceptance: null,
    context: null,
    outputTest: null,
    outputImpl: null,
    outputTypes: null,
  };
}

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/missions/current/health-report', {
    headers,
  });
}

function resetMocks() {
  mockPrismaClient.mission.findFirst.mockReset();
  mockPrismaClient.item.findMany.mockReset();
  mockPrismaClient.agentClaim.findMany.mockReset();
  mockPrismaClient.workLog.findMany.mockReset();
  mockPrismaClient.hookEvent.findMany.mockReset();
  mockPrismaClient.activityLog.findMany.mockReset();

  // Sensible empty defaults so any test only sets what it needs.
  mockPrismaClient.item.findMany.mockResolvedValue([]);
  mockPrismaClient.agentClaim.findMany.mockResolvedValue([]);
  mockPrismaClient.workLog.findMany.mockResolvedValue([]);
  mockPrismaClient.hookEvent.findMany.mockResolvedValue([]);
  mockPrismaClient.activityLog.findMany.mockResolvedValue([]);
}

describe('GET /api/missions/current/health-report', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    resetMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns 400 when X-Project-ID header is missing', async () => {
    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('X-Project-ID');
    expect(mockPrismaClient.mission.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 with descriptive error when project has no active mission', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(null);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.message.toLowerCase()).toMatch(/active mission|no active|not found/);

    // Filters by projectId AND archivedAt: null
    const where = mockPrismaClient.mission.findFirst.mock.calls[0][0].where;
    expect(where.projectId).toBe(PROJECT_ID);
    expect(where.archivedAt).toBeNull();
  });

  it('returns empty inFlightItems and missionIdle=true when no items are in flight', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    // item.findMany returns [] from default

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.missionId).toBe(MISSION_ID);
    expect(body.data.generatedAt).toBe(FROZEN_NOW.toISOString());
    expect(body.data.missionIdle).toBe(true);
    expect(body.data.inFlightItems).toEqual([]);
  });

  it('queries items only in stages testing, implementing, review, probing', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);

    await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));

    expect(mockPrismaClient.item.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrismaClient.item.findMany.mock.calls[0][0].where;
    const stageFilter = where.stageId?.in ?? where.stage?.in;
    expect(stageFilter).toBeDefined();
    expect(new Set(stageFilter)).toEqual(
      new Set(['testing', 'implementing', 'review', 'probing']),
    );
    // Sanity: excluded stages are not in the filter
    for (const excluded of ['briefings', 'ready', 'done', 'blocked']) {
      expect(stageFilter).not.toContain(excluded);
    }
  });

  it('populates assignedAgent and claimedAt from AgentClaim, null when no claim exists', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const claimedItem = makeItem({ id: 'WI-100', title: 'Claimed', stageId: 'implementing' });
    const unclaimedItem = makeItem({ id: 'WI-101', title: 'Unclaimed', stageId: 'testing' });
    mockPrismaClient.item.findMany.mockResolvedValue([claimedItem, unclaimedItem]);

    const claimedAt = new Date('2026-05-02T11:00:00.000Z');
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'ba', itemId: 'WI-100', claimedAt },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    const byId = Object.fromEntries(
      body.data.inFlightItems.map((i: { itemId: string }) => [i.itemId, i]),
    );
    expect(byId['WI-100'].assignedAgent).toBe('ba');
    expect(byId['WI-100'].claimedAt).toBe(claimedAt.toISOString());
    expect(byId['WI-101'].assignedAgent).toBeNull();
    expect(byId['WI-101'].claimedAt).toBeNull();
  });

  it('selects lastActivityAt as the freshest of hook/activity/workLog/claim and records its source', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const item = makeItem({ id: 'WI-200', stageId: 'implementing' });
    mockPrismaClient.item.findMany.mockResolvedValue([item]);

    const claimedAt = new Date('2026-05-02T10:00:00.000Z');
    const workLogTs = new Date('2026-05-02T10:30:00.000Z');
    const activityTs = new Date('2026-05-02T11:00:00.000Z');
    const hookTs = new Date('2026-05-02T11:45:00.000Z'); // freshest

    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'ba', itemId: 'WI-200', claimedAt },
    ]);
    mockPrismaClient.workLog.findMany.mockResolvedValue([
      { id: 1, itemId: 'WI-200', agent: 'ba', action: 'note', summary: 'wip', timestamp: workLogTs },
    ]);
    mockPrismaClient.activityLog.findMany.mockResolvedValue([
      {
        id: 1,
        missionId: MISSION_ID,
        projectId: PROJECT_ID,
        agent: 'ba',
        message: 'something',
        level: 'info',
        timestamp: activityTs,
      },
    ]);
    mockPrismaClient.hookEvent.findMany.mockResolvedValue([
      {
        id: 1,
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        eventType: 'post_tool_use',
        agentName: 'ba',
        toolName: 'Edit',
        status: 'success',
        durationMs: 10,
        summary: 'edit',
        payload: JSON.stringify({ itemId: 'WI-200' }),
        correlationId: null,
        timestamp: hookTs,
        inputTokens: null,
        outputTokens: null,
        cacheCreationTokens: null,
        cacheReadTokens: null,
        model: null,
      },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const out = body.data.inFlightItems[0];
    expect(out.lastActivityAt).toBe(hookTs.toISOString());
    expect(out.lastActivitySource).toBe('hook_event');
  });

  it('falls back to agent_claim source when no logs/events exist', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const item = makeItem({ id: 'WI-300', stageId: 'testing' });
    mockPrismaClient.item.findMany.mockResolvedValue([item]);

    const claimedAt = new Date('2026-05-02T09:00:00.000Z');
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'murdock', itemId: 'WI-300', claimedAt },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const out = body.data.inFlightItems[0];
    expect(out.lastActivityAt).toBe(claimedAt.toISOString());
    expect(out.lastActivitySource).toBe('agent_claim');
  });

  it('computes idleSeconds as floor((generatedAt - lastActivityAt) / 1000), never negative', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const stale = makeItem({ id: 'WI-400', stageId: 'review' });
    const future = makeItem({ id: 'WI-401', stageId: 'review' });
    mockPrismaClient.item.findMany.mockResolvedValue([stale, future]);

    const staleClaimedAt = new Date(FROZEN_NOW.getTime() - 49_230_500); // ~49230.5s ago
    const futureClaimedAt = new Date(FROZEN_NOW.getTime() + 60_000); // future (clock skew)
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'lynch', itemId: 'WI-400', claimedAt: staleClaimedAt },
      { id: 2, agentName: 'lynch', itemId: 'WI-401', claimedAt: futureClaimedAt },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const byId = Object.fromEntries(
      body.data.inFlightItems.map((i: { itemId: string }) => [i.itemId, i]),
    );
    expect(byId['WI-400'].idleSeconds).toBe(49230);
    expect(byId['WI-401'].idleSeconds).toBe(0);
    expect(byId['WI-401'].idleSeconds).toBeGreaterThanOrEqual(0);
  });

  it('returns recentActivity (max 5) merging hook + activity rows for an item, sorted desc', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const item = makeItem({ id: 'WI-500', stageId: 'probing' });
    mockPrismaClient.item.findMany.mockResolvedValue([item]);
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      {
        id: 1,
        agentName: 'amy',
        itemId: 'WI-500',
        claimedAt: new Date('2026-05-02T08:00:00.000Z'),
      },
    ]);

    const hookEvents = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      projectId: PROJECT_ID,
      missionId: MISSION_ID,
      eventType: 'post_tool_use',
      agentName: 'amy',
      toolName: 'Read',
      status: 'success',
      durationMs: 5,
      summary: 'read',
      payload: JSON.stringify({ itemId: 'WI-500' }),
      correlationId: null,
      timestamp: new Date(`2026-05-02T11:0${i}:00.000Z`),
      inputTokens: null,
      outputTokens: null,
      cacheCreationTokens: null,
      cacheReadTokens: null,
      model: null,
    }));
    mockPrismaClient.hookEvent.findMany.mockResolvedValue(hookEvents);

    const activityRows = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1,
      missionId: MISSION_ID,
      projectId: PROJECT_ID,
      agent: 'amy',
      message: `msg ${i}`,
      level: 'info',
      timestamp: new Date(`2026-05-02T11:1${i}:00.000Z`),
    }));
    mockPrismaClient.activityLog.findMany.mockResolvedValue(activityRows);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const recent = body.data.inFlightItems[0].recentActivity;
    expect(recent).toHaveLength(5);
    // Verify desc order
    const timestamps = recent.map((r: { timestamp: string }) => r.timestamp);
    const sorted = [...timestamps].sort().reverse();
    expect(timestamps).toEqual(sorted);
    // Newest is the latest activity row at 11:12:00
    expect(recent[0].timestamp).toBe(new Date('2026-05-02T11:12:00.000Z').toISOString());
  });

  it('attaches lastWorkLogEntry as the most recent workLog row, or null when none', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const withLog = makeItem({ id: 'WI-600', stageId: 'implementing' });
    const withoutLog = makeItem({ id: 'WI-601', stageId: 'implementing' });
    mockPrismaClient.item.findMany.mockResolvedValue([withLog, withoutLog]);
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      {
        id: 1,
        agentName: 'ba',
        itemId: 'WI-600',
        claimedAt: new Date('2026-05-02T08:00:00.000Z'),
      },
      {
        id: 2,
        agentName: 'ba',
        itemId: 'WI-601',
        claimedAt: new Date('2026-05-02T08:00:00.000Z'),
      },
    ]);

    const olderTs = new Date('2026-05-02T09:00:00.000Z');
    const newerTs = new Date('2026-05-02T10:30:00.000Z');
    mockPrismaClient.workLog.findMany.mockResolvedValue([
      { id: 1, itemId: 'WI-600', agent: 'ba', action: 'note', summary: 'older', timestamp: olderTs },
      { id: 2, itemId: 'WI-600', agent: 'ba', action: 'note', summary: 'newest', timestamp: newerTs },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const byId = Object.fromEntries(
      body.data.inFlightItems.map((i: { itemId: string }) => [i.itemId, i]),
    );
    expect(byId['WI-600'].lastWorkLogEntry).toEqual({
      agent: 'ba',
      summary: 'newest',
      timestamp: newerTs.toISOString(),
    });
    expect(byId['WI-601'].lastWorkLogEntry).toBeNull();
  });

  it('missionIdle=true iff every in-flight item has idleSeconds > 600', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const idle = makeItem({ id: 'WI-700', stageId: 'implementing' });
    const active = makeItem({ id: 'WI-701', stageId: 'testing' });
    mockPrismaClient.item.findMany.mockResolvedValue([idle, active]);

    const idleTs = new Date(FROZEN_NOW.getTime() - 700_000); // 700s idle
    const activeTs = new Date(FROZEN_NOW.getTime() - 60_000); // 60s idle
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'ba', itemId: 'WI-700', claimedAt: idleTs },
      { id: 2, agentName: 'murdock', itemId: 'WI-701', claimedAt: activeTs },
    ]);

    let response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    let body = await response.json();
    expect(body.data.missionIdle).toBe(false);

    // Now make both stale
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'ba', itemId: 'WI-700', claimedAt: idleTs },
      { id: 2, agentName: 'murdock', itemId: 'WI-701', claimedAt: idleTs },
    ]);

    response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    body = await response.json();
    expect(body.data.missionIdle).toBe(true);
  });

  it('returns null lastActivityAt/source/idleSeconds for an in-flight item with no signals', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const item = makeItem({ id: 'WI-900', stageId: 'implementing' });
    mockPrismaClient.item.findMany.mockResolvedValue([item]);
    // No claim, no hooks, no activity, no work logs (defaults).

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const out = body.data.inFlightItems[0];
    expect(out.itemId).toBe('WI-900');
    expect(out.lastActivityAt).toBeNull();
    expect(out.lastActivitySource).toBeNull();
    expect(out.idleSeconds).toBeNull();
  });

  it('does not leak hook events tagged with payload.itemId across items sharing an assignedAgent', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const itemA = makeItem({ id: 'WI-A', stageId: 'implementing' });
    const itemB = makeItem({ id: 'WI-B', stageId: 'implementing' });
    mockPrismaClient.item.findMany.mockResolvedValue([itemA, itemB]);

    const claimedAt = new Date('2026-05-02T08:00:00.000Z');
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'ba-1', itemId: 'WI-A', claimedAt },
      { id: 2, agentName: 'ba-1', itemId: 'WI-B', claimedAt },
    ]);

    const hookForA = new Date('2026-05-02T11:30:00.000Z');
    mockPrismaClient.hookEvent.findMany.mockResolvedValue([
      {
        id: 1,
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        eventType: 'post_tool_use',
        agentName: 'ba-1',
        toolName: 'Edit',
        status: 'success',
        durationMs: 5,
        summary: 'edit on WI-A',
        payload: JSON.stringify({ itemId: 'WI-A' }),
        correlationId: null,
        timestamp: hookForA,
        inputTokens: null,
        outputTokens: null,
        cacheCreationTokens: null,
        cacheReadTokens: null,
        model: null,
      },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const byId = Object.fromEntries(
      body.data.inFlightItems.map((i: { itemId: string }) => [i.itemId, i]),
    );

    // Item A: hook event is attributed (its lastActivityAt reflects the hook).
    expect(byId['WI-A'].lastActivityAt).toBe(hookForA.toISOString());
    expect(byId['WI-A'].lastActivitySource).toBe('hook_event');
    expect(byId['WI-A'].recentActivity).toHaveLength(1);
    expect(byId['WI-A'].recentActivity[0].timestamp).toBe(hookForA.toISOString());

    // Item B: payload.itemId tagged the event for A only — B must NOT see it,
    // even though both items share the same assignedAgent.
    expect(byId['WI-B'].lastActivityAt).not.toBe(hookForA.toISOString());
    expect(byId['WI-B'].lastActivitySource).not.toBe('hook_event');
    expect(byId['WI-B'].recentActivity).toHaveLength(0);
  });

  it('treats null idleSeconds as idle when computing missionIdle', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const noSignals = makeItem({ id: 'WI-N', stageId: 'implementing' });
    const stale = makeItem({ id: 'WI-S', stageId: 'review' });
    mockPrismaClient.item.findMany.mockResolvedValue([noSignals, stale]);

    const staleClaimedAt = new Date(FROZEN_NOW.getTime() - 700_000); // 700s idle
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'lynch', itemId: 'WI-S', claimedAt: staleClaimedAt },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const byId = Object.fromEntries(
      body.data.inFlightItems.map((i: { itemId: string }) => [i.itemId, i]),
    );
    expect(byId['WI-N'].idleSeconds).toBeNull();
    expect(byId['WI-S'].idleSeconds).toBeGreaterThan(600);
    expect(body.data.missionIdle).toBe(true);
  });

  it('matches activity by agent within mission when no itemId linkage exists', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const item = makeItem({ id: 'WI-800', stageId: 'implementing' });
    mockPrismaClient.item.findMany.mockResolvedValue([item]);
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      {
        id: 1,
        agentName: 'ba',
        itemId: 'WI-800',
        claimedAt: new Date('2026-05-02T08:00:00.000Z'),
      },
    ]);

    // ActivityLog row has no itemId field at all — should match via missionId + agent
    const activityTs = new Date('2026-05-02T11:30:00.000Z');
    mockPrismaClient.activityLog.findMany.mockResolvedValue([
      {
        id: 1,
        missionId: MISSION_ID,
        projectId: PROJECT_ID,
        agent: 'ba',
        message: 'agent-only match',
        level: 'info',
        timestamp: activityTs,
      },
      // Different agent — must NOT match
      {
        id: 2,
        missionId: MISSION_ID,
        projectId: PROJECT_ID,
        agent: 'murdock',
        message: 'wrong agent',
        level: 'info',
        timestamp: new Date('2026-05-02T11:45:00.000Z'),
      },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const out = body.data.inFlightItems[0];
    expect(out.lastActivityAt).toBe(activityTs.toISOString());
    expect(out.lastActivitySource).toBe('activity_log');
    expect(out.recentActivity.every((r: { agent: string }) => r.agent === 'ba')).toBe(true);
  });

  // Fix 1: uses createNoActiveMissionError() factory — code must be NO_ACTIVE_MISSION
  it('returns error code NO_ACTIVE_MISSION (not NOT_FOUND) when no active mission exists', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(null);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NO_ACTIVE_MISSION');
  });

  // Fix 1: uses createValidationError() factory — code must be VALIDATION_ERROR
  it('returns error code VALIDATION_ERROR (factory shape) when X-Project-ID header is missing', async () => {
    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // Factory message must still mention X-Project-ID
    expect(body.error.message).toContain('X-Project-ID');
  });

  // Fix A (active-mission predicate): completed mission with archivedAt: null must NOT be returned.
  // The findFirst query must include state: { notIn: ['completed', 'failed', 'archived'] }
  // so that stale completed/failed missions don't bleed into the health report.
  it('excludes completed-but-not-archived mission: findFirst must filter by active state', async () => {
    // Simulate: findFirst returns null when state filter is applied (no truly active mission)
    // and would return a completed mission if only archivedAt: null were used.
    mockPrismaClient.mission.findFirst.mockResolvedValue(null);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    expect(response.status).toBe(404);

    // The where clause MUST include a state filter that excludes completed/failed/archived.
    const where = mockPrismaClient.mission.findFirst.mock.calls[0][0].where;
    expect(where.projectId).toBe(PROJECT_ID);
    // Must have state.notIn — not just archivedAt: null
    expect(where.state).toBeDefined();
    expect(where.state.notIn).toBeDefined();
    expect(where.state.notIn).toContain('completed');
    expect(where.state.notIn).toContain('failed');
  });

  // Fix 2: item query must be scoped to current mission via MissionItem join table,
  // not just projectId — an in-flight item from a different mission must NOT appear.
  it('does not include in-flight items from other missions (scoped to current missionId)', async () => {
    const OTHER_MISSION_ID = 'M-OTHER-001';
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);

    // Active mission has NO items; only the other mission has an in-flight item.
    // With the bug (project-only scoping) findMany returns the other-mission item.
    // After the fix (missionItems: { some: { missionId } }) it must return nothing.
    const otherMissionItem = makeItem({ id: 'WI-OTHER', stageId: 'implementing' });
    mockPrismaClient.item.findMany.mockImplementation(
      (args: { where?: { missionItems?: { some?: { missionId?: string } } } }) => {
        const missionFilter = args?.where?.missionItems?.some?.missionId;
        if (missionFilter === MISSION_ID) {
          // Correctly scoped — current mission has no items
          return Promise.resolve([]);
        }
        // Fallback simulates old project-only scoping returning the foreign item
        return Promise.resolve([otherMissionItem]);
      },
    );

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // Must be empty: the only item belongs to OTHER_MISSION_ID, not the active mission
    expect(body.data.inFlightItems).toEqual([]);
    // Verify missionId was actually passed in the query
    const itemFindManyCall = mockPrismaClient.item.findMany.mock.calls[0][0];
    expect(itemFindManyCall.where.missionItems).toBeDefined();
    expect(itemFindManyCall.where.missionItems.some.missionId).toBe(MISSION_ID);
    // OTHER_MISSION_ID reference to suppress unused-var lint
    expect(OTHER_MISSION_ID).toBe('M-OTHER-001');
  });

  // Fix B (claim-window constraint): hook event from assignedAgent BEFORE claimedAt
  // must NOT appear in recentActivity or influence lastActivityAt.
  it('excludes pre-claim hook events from assignedAgent when payload.itemId is absent', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const item = makeItem({ id: 'WI-PRE', stageId: 'implementing' });
    mockPrismaClient.item.findMany.mockResolvedValue([item]);

    const claimedAt = new Date('2026-05-02T10:00:00.000Z');
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'ba', itemId: 'WI-PRE', claimedAt },
    ]);

    // Pre-claim event: timestamp < claimedAt, no payload.itemId (would match by agent only)
    const preClaimTs = new Date('2026-05-02T09:00:00.000Z'); // 1 hour before claim
    // Post-claim event: timestamp > claimedAt, no payload.itemId (should match)
    const postClaimTs = new Date('2026-05-02T11:00:00.000Z'); // 1 hour after claim

    mockPrismaClient.hookEvent.findMany.mockResolvedValue([
      {
        id: 1,
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        eventType: 'post_tool_use',
        agentName: 'ba',
        toolName: 'Read',
        status: 'success',
        durationMs: 5,
        summary: 'pre-claim work on prior item',
        payload: null, // no itemId — only agent fallback applies
        correlationId: null,
        timestamp: preClaimTs,
        inputTokens: null,
        outputTokens: null,
        cacheCreationTokens: null,
        cacheReadTokens: null,
        model: null,
      },
      {
        id: 2,
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        eventType: 'post_tool_use',
        agentName: 'ba',
        toolName: 'Edit',
        status: 'success',
        durationMs: 5,
        summary: 'post-claim work on this item',
        payload: null, // no itemId — only agent fallback applies
        correlationId: null,
        timestamp: postClaimTs,
        inputTokens: null,
        outputTokens: null,
        cacheCreationTokens: null,
        cacheReadTokens: null,
        model: null,
      },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const out = body.data.inFlightItems[0];

    // The post-claim event SHOULD be included
    expect(out.recentActivity.some((r: { timestamp: string }) => r.timestamp === postClaimTs.toISOString())).toBe(true);

    // The pre-claim event MUST NOT be included
    expect(out.recentActivity.some((r: { timestamp: string }) => r.timestamp === preClaimTs.toISOString())).toBe(false);

    // lastActivityAt must reflect the post-claim event, not the pre-claim one
    expect(out.lastActivityAt).toBe(postClaimTs.toISOString());
    expect(out.lastActivitySource).toBe('hook_event');
  });

  // Fix B (claim-window constraint): activity log entry from assignedAgent BEFORE claimedAt
  // must NOT appear in recentActivity or influence lastActivityAt.
  it('excludes pre-claim activity log entries from assignedAgent when claimedAt is set', async () => {
    mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
    const item = makeItem({ id: 'WI-ACT-PRE', stageId: 'implementing' });
    mockPrismaClient.item.findMany.mockResolvedValue([item]);

    const claimedAt = new Date('2026-05-02T10:00:00.000Z');
    mockPrismaClient.agentClaim.findMany.mockResolvedValue([
      { id: 1, agentName: 'ba', itemId: 'WI-ACT-PRE', claimedAt },
    ]);

    const preClaimActivityTs = new Date('2026-05-02T09:30:00.000Z'); // before claim
    const postClaimActivityTs = new Date('2026-05-02T10:30:00.000Z'); // after claim

    mockPrismaClient.activityLog.findMany.mockResolvedValue([
      {
        id: 1,
        missionId: MISSION_ID,
        projectId: PROJECT_ID,
        agent: 'ba',
        message: 'pre-claim activity on prior item',
        level: 'info',
        timestamp: preClaimActivityTs,
      },
      {
        id: 2,
        missionId: MISSION_ID,
        projectId: PROJECT_ID,
        agent: 'ba',
        message: 'post-claim activity on this item',
        level: 'info',
        timestamp: postClaimActivityTs,
      },
    ]);

    const response = await GET(buildRequest({ 'X-Project-ID': PROJECT_ID }));
    const body = await response.json();

    const out = body.data.inFlightItems[0];

    // Post-claim activity SHOULD be included
    expect(out.recentActivity.some((r: { timestamp: string }) => r.timestamp === postClaimActivityTs.toISOString())).toBe(true);

    // Pre-claim activity MUST NOT be included
    expect(out.recentActivity.some((r: { timestamp: string }) => r.timestamp === preClaimActivityTs.toISOString())).toBe(false);

    // lastActivityAt must be the post-claim one
    expect(out.lastActivityAt).toBe(postClaimActivityTs.toISOString());
  });
});
