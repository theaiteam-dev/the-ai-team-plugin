import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * WI-790 AC2: the review persistence and the batch staged->done promotion
 * must happen inside ONE prisma transaction, so a promotion failure rolls
 * back the finalReview write too.
 *
 * This lives in its own file (separate from final-review-promotion.test.ts,
 * which covers every other AC on this item against the real database)
 * because vi.mock('@/lib/db', ...) applies module-wide per file, and a full
 * module mock is the only reliable way to intercept prisma.$transaction
 * here: vi.spyOn(prisma, '$transaction') does NOT work against the real
 * Prisma 7 client in this environment — `typeof prisma.$transaction`
 * reports 'function', but vi.spyOn() itself throws "can only spy on a
 * function. Received undefined" (reproduced directly; the client's methods
 * sit behind an internal Proxy that vi.spyOn's property-descriptor lookup
 * can't see).
 *
 * Design: the mock's $transaction callback receives a SEPARATE tx object
 * (txMock) from the top-level prisma client (mockPrisma) — NOT the same
 * shared object this codebase's other $transaction mocks typically reuse
 * (e.g. stop-advance.test.ts). That distinguishes "the write happened via
 * tx (inside the transaction)" from "the write happened via the top-level
 * client (outside it)", which a shared-object mock cannot: with a shared
 * object, tx.mission.update and prisma.mission.update are literally the
 * same spy, so a bug where the review write escapes the transaction would
 * be invisible to the test. That escape is exactly the defect class AC2
 * exists to prevent, so this file uses the stronger two-object design.
 */

const txMock = vi.hoisted(() => ({
  mission: { update: vi.fn() },
  item: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  workLog: { create: vi.fn(), createMany: vi.fn() },
  activityLog: { create: vi.fn() },
}));

const mockPrisma = vi.hoisted(() => ({
  mission: { findFirst: vi.fn(), update: vi.fn() }, // .update must NEVER be called directly if properly wrapped
  item: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, // same
  workLog: { create: vi.fn(), createMany: vi.fn() },
  activityLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

import { POST } from '@/app/api/missions/[missionId]/final-review/route';

function buildRequest(projectId: string, body?: unknown): Request {
  return new Request('http://localhost:3000/api/missions/M-001/final-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': projectId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function buildContext(missionId: string) {
  return { params: Promise.resolve({ missionId }) };
}

const APPROVED_REPORT = '## Final Mission Review\n\nVERDICT: FINAL APPROVED\n\nAll good.';

const mockMission = { id: 'M-001', projectId: 'project-a', name: 'Test Mission', finalReview: null };

describe('POST /api/missions/[missionId]/final-review — AC2 transaction atomicity (mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.mission.findFirst.mockResolvedValue(mockMission);
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches both the review write and the item promotion through the transaction-scoped client, never the top-level client directly', async () => {
    txMock.item.findMany.mockResolvedValue([{ id: 'WI-001', stageId: 'staged' }]);
    txMock.item.updateMany.mockResolvedValue({ count: 1 });
    txMock.mission.update.mockResolvedValue({ ...mockMission, finalReview: APPROVED_REPORT });
    txMock.workLog.createMany.mockResolvedValue({ count: 1 });

    const req = buildRequest('project-a', { finalReview: APPROVED_REPORT });
    const res = await POST(req, buildContext('M-001'));

    expect(res.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // The actual persistence must go through tx...
    expect(txMock.mission.update).toHaveBeenCalled();
    expect(txMock.item.updateMany).toHaveBeenCalled();

    // ...and the top-level (non-transactional) client must NEVER perform
    // either write directly — that's exactly the bug this AC prevents.
    expect(mockPrisma.mission.update).not.toHaveBeenCalled();
    expect(mockPrisma.item.update).not.toHaveBeenCalled();
    expect(mockPrisma.item.updateMany).not.toHaveBeenCalled();
  });

  it('if the transaction callback throws partway through, the route surfaces an error and the top-level client never persists anything as a fallback', async () => {
    txMock.item.findMany.mockResolvedValue([{ id: 'WI-001', stageId: 'staged' }]);
    txMock.mission.update.mockResolvedValue({ ...mockMission, finalReview: APPROVED_REPORT });
    txMock.item.updateMany.mockRejectedValue(new Error('simulated mid-promotion failure'));

    const req = buildRequest('project-a', { finalReview: APPROVED_REPORT });
    const res = await POST(req, buildContext('M-001'));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);

    // The rollback guarantee depends on nothing having escaped the
    // transaction — the top-level client must never be used as a
    // side-channel to persist the review despite the promotion failing.
    expect(mockPrisma.mission.update).not.toHaveBeenCalled();
  });

  it('selects promotion candidates scoped to THIS mission via MissionItem and excludes archived items', async () => {
    // The behavioural proof lives in final-review-promotion.test.ts against a
    // real database; this asserts the query issued inside the transaction is
    // the mission-scoped one, so the scoping can never be silently dropped
    // back to a project-wide sweep (which promoted other missions' leftover
    // staged items and credited this review in their work logs).
    //
    // The query deliberately does NOT filter on stageId: the route reads the
    // mission's whole non-archived population in one round-trip so it can BOTH
    // enforce the all-items-finished precondition and pick the staged subset.
    txMock.item.findMany.mockResolvedValue([]);
    txMock.mission.update.mockResolvedValue({ ...mockMission, finalReview: APPROVED_REPORT });

    const res = await POST(buildRequest('project-a', { finalReview: APPROVED_REPORT }), buildContext('M-001'));
    expect(res.status).toBe(200);

    expect(txMock.item.findMany).toHaveBeenCalledTimes(1);
    const [{ where }] = txMock.item.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(where).toMatchObject({
      projectId: 'project-a',
      archivedAt: null,
      missionItems: { some: { missionId: 'M-001' } },
    });
  });

  it('a rejected verdict does not require touching the promotion machinery at all (sanity: this file only asserts the approved/atomicity path)', async () => {
    const REJECTED_REPORT = '## Final Mission Review\n\nVERDICT: FINAL REJECTED\n\nNeeds rework.';
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)
    );
    txMock.mission.update.mockResolvedValue({ ...mockMission, finalReview: REJECTED_REPORT });

    const req = buildRequest('project-a', { finalReview: REJECTED_REPORT });
    const res = await POST(req, buildContext('M-001'));

    expect(res.status).toBe(200);
    // No promotion machinery should fire for a rejected verdict.
    expect(txMock.item.findMany).not.toHaveBeenCalled();
    expect(txMock.item.update).not.toHaveBeenCalled();
    expect(txMock.item.updateMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/missions/[missionId]/final-review — batching and transaction budget (mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.mission.findFirst.mockResolvedValue(mockMission);
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)
    );
    txMock.mission.update.mockResolvedValue({ ...mockMission, finalReview: APPROVED_REPORT });
    txMock.item.updateMany.mockResolvedValue({ count: 0 });
    txMock.workLog.createMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('promotes N items with ONE updateMany and ONE createMany, not 2N serialized queries', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `WI-${String(i + 1).padStart(3, '0')}`);
    txMock.item.findMany.mockResolvedValue(ids.map((id) => ({ id, stageId: 'staged' })));

    const res = await POST(buildRequest('project-a', { finalReview: APPROVED_REPORT }), buildContext('M-001'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.promotedCount).toBe(40);

    // Batched, not looped — a per-item loop is what blows the transaction budget.
    expect(txMock.item.update).not.toHaveBeenCalled();
    expect(txMock.workLog.create).not.toHaveBeenCalled();
    expect(txMock.item.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.workLog.createMany).toHaveBeenCalledTimes(1);

    const [updateArgs] = txMock.item.updateMany.mock.calls[0] as [
      { where: { id: { in: string[] } }; data: { stageId: string } },
    ];
    expect(updateArgs.where.id.in).toEqual(ids);
    expect(updateArgs.data).toEqual({ stageId: 'done' });

    // Same work-log row shape the per-item creates used to write, one per item.
    const [createArgs] = txMock.workLog.createMany.mock.calls[0] as [
      { data: Array<{ itemId: string; agent: string; action: string; summary: string }> },
    ];
    expect(createArgs.data).toHaveLength(40);
    expect(createArgs.data.map((row) => row.itemId)).toEqual(ids);
    for (const row of createArgs.data) {
      expect(row.agent).toBe('system');
      expect(row.action).toBe('note');
      expect(row.summary).toContain('M-001');
      expect(row.summary).toMatch(/final review/i);
    }
  });

  it('raises the interactive-transaction timeout above Prisma\'s 5s default so a large promotion cannot roll the review back', async () => {
    txMock.item.findMany.mockResolvedValue([]);

    await POST(buildRequest('project-a', { finalReview: APPROVED_REPORT }), buildContext('M-001'));

    const [, options] = mockPrisma.$transaction.mock.calls[0] as [unknown, { timeout?: number } | undefined];
    expect(options?.timeout).toBeGreaterThanOrEqual(15_000);
  });

  it('writes nothing at all when the mission still has unfinished items — 409 MISSION_NOT_READY', async () => {
    txMock.item.findMany.mockResolvedValue([
      { id: 'WI-001', stageId: 'staged' },
      { id: 'WI-002', stageId: 'implementing' },
      { id: 'WI-003', stageId: 'blocked' },
      { id: 'WI-004', stageId: 'done' },
    ]);

    const res = await POST(buildRequest('project-a', { finalReview: APPROVED_REPORT }), buildContext('M-001'));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('MISSION_NOT_READY');
    expect(data.error.details.pendingItemIds).toEqual(['WI-002', 'WI-003']);

    // The review write is refused too — an approval must never be recorded
    // against a half-finished mission, in the transaction or outside it.
    expect(txMock.mission.update).not.toHaveBeenCalled();
    expect(mockPrisma.mission.update).not.toHaveBeenCalled();
    expect(txMock.item.updateMany).not.toHaveBeenCalled();
    expect(txMock.workLog.createMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body with 400 VALIDATION_ERROR instead of a 500 database error', async () => {
    const req = new Request('http://localhost:3000/api/missions/M-001/final-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'project-a' },
      body: '{ "finalReview": ',
    });

    const res = await POST(req, buildContext('M-001'));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toMatch(/invalid json/i);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
