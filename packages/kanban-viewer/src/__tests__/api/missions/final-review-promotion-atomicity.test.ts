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
  workLog: { create: vi.fn() },
  activityLog: { create: vi.fn() },
}));

const mockPrisma = vi.hoisted(() => ({
  mission: { findFirst: vi.fn(), update: vi.fn() }, // .update must NEVER be called directly if properly wrapped
  item: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() }, // same
  workLog: { create: vi.fn() },
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
    txMock.item.findMany.mockResolvedValue([{ id: 'WI-001' }]);
    txMock.item.update.mockResolvedValue({ id: 'WI-001', stageId: 'done' });
    txMock.mission.update.mockResolvedValue({ ...mockMission, finalReview: APPROVED_REPORT });
    txMock.workLog.create.mockResolvedValue({});

    const req = buildRequest('project-a', { finalReview: APPROVED_REPORT });
    const res = await POST(req, buildContext('M-001'));

    expect(res.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // The actual persistence must go through tx...
    expect(txMock.mission.update).toHaveBeenCalled();

    // ...and the top-level (non-transactional) client must NEVER perform
    // either write directly — that's exactly the bug this AC prevents.
    expect(mockPrisma.mission.update).not.toHaveBeenCalled();
    expect(mockPrisma.item.update).not.toHaveBeenCalled();
  });

  it('if the transaction callback throws partway through, the route surfaces an error and the top-level client never persists anything as a fallback', async () => {
    txMock.item.findMany.mockResolvedValue([{ id: 'WI-001' }]);
    txMock.item.update.mockRejectedValue(new Error('simulated mid-promotion failure'));

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
  });
});
