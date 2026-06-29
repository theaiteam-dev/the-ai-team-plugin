import { NextRequest } from 'next/server';
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/hooks/token-usage/route';
import { prisma } from '@/lib/db';

/**
 * Tests for POST /api/hooks/token-usage (WI-171).
 *
 * Capture endpoint that receives per-message usage records from the
 * Stop/SubagentStop hooks and upserts them into MessageTokenUsage keyed by
 * messageId. projectId comes from the X-Project-ID header and missionId is
 * resolved from the current (non-archived) mission, mirroring /api/hooks/events.
 */

const PROJECT_ID = 'test-token-usage-project';
const MISSION_ID = 'M-20260628-tu-route-test';
// A project that deliberately has no current mission, to exercise missionId=null.
const NO_MISSION_PROJECT_ID = 'test-token-usage-no-mission';

/** Build a NextRequest for the route. Omit projectId to drop the header. */
function makeRequest(body: unknown, projectId?: string | null): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (projectId !== undefined && projectId !== null) {
    headers['X-Project-ID'] = projectId;
  }
  return new NextRequest('http://localhost:3000/api/hooks/token-usage', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** A complete, valid per-message record. */
function record(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'msg_default_0001',
    agentName: 'murdock',
    model: 'claude-opus-4-8',
    inputTokens: 100,
    outputTokens: 200,
    cacheCreationTokens: 50,
    cacheReadTokens: 25,
    timestamp: '2026-06-28T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Token Usage Route Test Project' },
  });
  await prisma.project.upsert({
    where: { id: NO_MISSION_PROJECT_ID },
    update: {},
    create: { id: NO_MISSION_PROJECT_ID, name: 'Token Usage No-Mission Project' },
  });

  // Wipe rows + missions so each test starts clean.
  await prisma.messageTokenUsage.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.messageTokenUsage.deleteMany({ where: { projectId: NO_MISSION_PROJECT_ID } });
  await prisma.mission.deleteMany({ where: { projectId: NO_MISSION_PROJECT_ID } });

  await prisma.mission.upsert({
    where: { id: MISSION_ID },
    update: { archivedAt: null },
    create: {
      id: MISSION_ID,
      name: 'Token Usage Route Test Mission',
      state: 'running',
      prdPath: '/prd/test.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
    },
  });
});

describe('POST /api/hooks/token-usage', () => {
  it('returns 200 and creates one row per distinct messageId, stamped with projectId and missionId', async () => {
    const body = [
      record({ messageId: 'msg_a', agentName: 'murdock', inputTokens: 10, outputTokens: 20 }),
      record({ messageId: 'msg_b', agentName: 'ba', inputTokens: 30, outputTokens: 40 }),
    ];

    const response = await POST(makeRequest(body, PROJECT_ID));
    const data = await response.json();

    // Acceptance: HTTP 200, not 201.
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    const rows = await prisma.messageTokenUsage.findMany({
      where: { projectId: PROJECT_ID },
      orderBy: { messageId: 'asc' },
    });
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      messageId: 'msg_a',
      projectId: PROJECT_ID,
      missionId: MISSION_ID,
      agentName: 'murdock',
      model: 'claude-opus-4-8',
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 50,
      cacheReadTokens: 25,
    });
    expect(rows[1]).toMatchObject({
      messageId: 'msg_b',
      projectId: PROJECT_ID,
      missionId: MISSION_ID,
      agentName: 'ba',
      inputTokens: 30,
      outputTokens: 40,
    });
  });

  it('upserts on messageId so posting twice leaves exactly one row with the latest token values', async () => {
    await POST(
      makeRequest(
        [record({ messageId: 'msg_dup', inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0 })],
        PROJECT_ID
      )
    );

    const second = await POST(
      makeRequest(
        [record({ messageId: 'msg_dup', inputTokens: 999, outputTokens: 888, cacheCreationTokens: 7, cacheReadTokens: 6 })],
        PROJECT_ID
      )
    );
    expect(second.status).toBe(200);

    const rows = await prisma.messageTokenUsage.findMany({
      where: { projectId: PROJECT_ID, messageId: 'msg_dup' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inputTokens: 999,
      outputTokens: 888,
      cacheCreationTokens: 7,
      cacheReadTokens: 6,
    });
  });

  it('stamps missionId as null when the project has no current (non-archived) mission', async () => {
    const response = await POST(
      makeRequest([record({ messageId: 'msg_nomission' })], NO_MISSION_PROJECT_ID)
    );
    expect(response.status).toBe(200);

    const row = await prisma.messageTokenUsage.findUnique({
      where: { messageId: 'msg_nomission' },
    });
    expect(row).not.toBeNull();
    expect(row!.projectId).toBe(NO_MISSION_PROJECT_ID);
    expect(row!.missionId).toBeNull();
  });

  it('returns 400 with a validation error when the X-Project-ID header is missing', async () => {
    const response = await POST(makeRequest([record({ messageId: 'msg_noheader' })], null));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');

    const row = await prisma.messageTokenUsage.findUnique({
      where: { messageId: 'msg_noheader' },
    });
    expect(row).toBeNull();
  });

  it('returns 400 with a validation error when the X-Project-ID header is invalid', async () => {
    const response = await POST(makeRequest([record({ messageId: 'msg_badheader' })], 'bad id!'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a record missing a required field (model) with 400 and writes no partial rows', async () => {
    const body = [
      record({ messageId: 'msg_valid_partner' }),
      record({ messageId: 'msg_missing_model', model: undefined }),
    ];

    const response = await POST(makeRequest(body, PROJECT_ID));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');

    // No partial writes: the valid sibling in the same batch must not be persisted.
    const rows = await prisma.messageTokenUsage.findMany({
      where: { messageId: { in: ['msg_valid_partner', 'msg_missing_model'] } },
    });
    expect(rows).toHaveLength(0);
  });

  it('rejects a record missing messageId with 400 and writes no rows', async () => {
    const response = await POST(
      makeRequest([record({ messageId: undefined, model: 'claude-opus-4-8' })], PROJECT_ID)
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');

    const count = await prisma.messageTokenUsage.count({ where: { projectId: PROJECT_ID } });
    expect(count).toBe(0);
  });

  it('does not collide synthetic sessionId-namespaced messageIds at the same index across agents', async () => {
    // Two id-less messages from different sessions arrive with synthetic keys
    // namespaced by sessionId (`${sessionId}:idx:0`). They must upsert into two
    // distinct rows rather than overwriting one another.
    const body = [
      record({ messageId: 'session-aaa:idx:0', agentName: 'murdock', inputTokens: 11 }),
      record({ messageId: 'session-bbb:idx:0', agentName: 'ba', inputTokens: 22 }),
    ];

    const response = await POST(makeRequest(body, PROJECT_ID));
    expect(response.status).toBe(200);

    const rows = await prisma.messageTokenUsage.findMany({
      where: { messageId: { in: ['session-aaa:idx:0', 'session-bbb:idx:0'] } },
      orderBy: { messageId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ messageId: 'session-aaa:idx:0', agentName: 'murdock', inputTokens: 11 });
    expect(rows[1]).toMatchObject({ messageId: 'session-bbb:idx:0', agentName: 'ba', inputTokens: 22 });
  });
});
