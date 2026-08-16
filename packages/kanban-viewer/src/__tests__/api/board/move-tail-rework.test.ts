import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import type { MoveItemRequest } from '@/types/api';

/**
 * WI-794: Count tail-triggered rework moves against the rejection cap.
 *
 * Requirement 8 of the PRD says a backward move OUT of `staged` (Hannibal
 * executing Frankie/Stockwell's rework decision via POST /api/board/move,
 * since no agent holds a claim on the item by tail time — agentStop's
 * rejection path is unavailable, see adr/0005) must count against the SAME
 * rejection cap Lynch/Amy rejections use via agentStop, and escalate to
 * `blocked` at the cap exactly like agentStop's rejection branch
 * (src/app/api/agents/stop/route.ts lines 211-273, cap config at 32-54).
 *
 * Design decisions made here (Murdock, no impl authority — flagging for
 * B.A./Lynch to confirm or push back on):
 *
 * 1. Distinct work_log marker: action `'tail_rework'`. The item's context
 *    is explicit — "tail-triggered rework DOES carry a distinct work_log
 *    marker, separate from Lynch/Amy rejections... do not collapse the
 *    marker into the generic rejection shape." Lynch/Amy rejections write
 *    action:'rejected' via agentStop; reusing that value for a
 *    claim-less, Hannibal-driven move would be exactly the collapse the
 *    refinement gate ruled out. The DB's WorkLog.action column is a plain
 *    String (see prisma/schema.prisma) — not FK/enum-constrained — so this
 *    does not require widening the WorkLogAction union type to compile;
 *    that widening is optional/B.A.'s call if type-safety at the call site
 *    is wanted.
 * 2. Work-log `agent` field: `'Hannibal'`. board-move's request body has no
 *    agent field, and per context Hannibal is the actor executing the tail
 *    rework move.
 * 3. WIP-limit check target on escalation: when the increment reaches the
 *    cap, the item resolves to `blocked` (which this codebase's Stage rows
 *    always leave at wipLimit:null/unlimited) BEFORE the WIP check runs —
 *    not against the originally-requested `testing`/`implementing`. The
 *    context explicitly says "do not remove the WIP check" (ADR 0005
 *    flagged agentStop's rejection branch as having NO wip check, unlike
 *    its completion branch — board-move already has one and must keep
 *    it), but checking a full testing/implementing column's capacity
 *    against a move that isn't actually going to land there would block a
 *    rejection-cap escalation on WIP capacity of a stage the item is about
 *    to leave — nonsensical. Escalation must resolve the destination
 *    stage BEFORE the WIP check runs, matching agentStop's own resolve
 *    the target stage before evaluating it pattern (its rejected branch:
 *    targetStage = escalated ? 'blocked' : returnTo, THEN uses
 *    targetStage below).
 *
 * Mock design: separate `txMock` (the $transaction callback's client) from
 * `mockPrisma` (the top-level client) — not a shared-object mock — so a
 * bug where the rejectionCount increment or work_log write escapes the
 * transaction (AC6: "the increment and the stage change happen in the same
 * transaction") is actually detectable. See
 * final-review-promotion-atomicity.test.ts for the precedent/rationale;
 * vi.spyOn(prisma, '$transaction') does not work against the real Prisma 7
 * client in this environment, so vi.mock('@/lib/db', ...) is required
 * (module-wide per file — this file owns its own mock instance).
 */

const txMock = vi.hoisted(() => ({
  item: { count: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  stage: { findUnique: vi.fn() },
  workLog: { create: vi.fn() },
}));

const mockPrisma = vi.hoisted(() => ({
  item: { findFirst: vi.fn(), update: vi.fn() }, // .update must NEVER be hit directly — only via txMock
  stage: { findUnique: vi.fn() },
  workLog: { create: vi.fn() }, // must NEVER be hit directly — only via txMock
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const STAGE_ROWS: Record<string, { id: string; wipLimit: number | null }> = {
  staged: { id: 'staged', wipLimit: null },
  ready: { id: 'ready', wipLimit: 10 },
  testing: { id: 'testing', wipLimit: 3 },
  implementing: { id: 'implementing', wipLimit: 3 },
  review: { id: 'review', wipLimit: 3 },
  done: { id: 'done', wipLimit: null },
  blocked: { id: 'blocked', wipLimit: null },
};

/** currentCount keyed by stageId — how many items already occupy that
 * stage, for WIP-limit evaluation. Mutable per test via a closure so each
 * test can set its own occupancy. */
let stageCounts: Record<string, number> = {};

function baseItem(overrides: Partial<{ id: string; stageId: string; rejectionCount: number }> = {}) {
  return {
    id: 'WI-500',
    title: 'Tail rework subject',
    description: 'desc',
    type: 'feature',
    priority: 'high',
    stageId: 'staged',
    assignedAgent: null,
    rejectionCount: 0,
    createdAt: new Date('2026-08-16T00:00:00Z'),
    updatedAt: new Date('2026-08-16T00:00:00Z'),
    completedAt: null,
    archivedAt: null,
    projectId: 'test-project',
    dependsOn: [],
    workLogs: [],
    ...overrides,
  };
}

function buildRequest(body: MoveItemRequest) {
  return new NextRequest('http://localhost:3000/api/board/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/board/move — WI-794: tail-triggered rework counts against the rejection cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stageCounts = {};

    mockPrisma.stage.findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve(STAGE_ROWS[id] ?? null)
    );
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)
    );
    txMock.item.count.mockImplementation(({ where: { stageId } }: { where: { stageId: string } }) =>
      Promise.resolve(stageCounts[stageId] ?? 0)
    );
    txMock.stage.findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve(STAGE_ROWS[id] ?? null)
    );
    // Default: the in-transaction re-read observes the same row the
    // pre-transaction read did. Tests that exercise the TOCTOU window
    // override this with a DIFFERENT row so it is visible which read the
    // escalation decision actually came from.
    txMock.item.findFirst.mockImplementation((...args: unknown[]) =>
      mockPrisma.item.findFirst(...args)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('AC1: staged -> testing increments rejectionCount by 1 and writes a tail_rework work_log entry (not "rejected")', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 0 }));
    txMock.item.update.mockResolvedValue(baseItem({ stageId: 'testing', rejectionCount: 1 }));
    txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

    const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.rejectionCount).toBe(1);
    expect(data.data.item.stageId).toBe('testing');

    expect(txMock.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'WI-500' },
        data: expect.objectContaining({ rejectionCount: { increment: 1 }, stageId: 'testing' }),
      })
    );
    expect(txMock.workLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ itemId: 'WI-500', action: 'tail_rework' }),
      })
    );
    // Distinct from the generic Lynch/Amy rejection shape — never 'rejected'.
    const workLogCallArg = txMock.workLog.create.mock.calls[0][0];
    expect(workLogCallArg.data.action).not.toBe('rejected');
  });

  it('AC1: staged -> implementing also increments rejectionCount and writes a tail_rework entry (both targets, not just testing)', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 0 }));
    txMock.item.update.mockResolvedValue(baseItem({ stageId: 'implementing', rejectionCount: 1 }));
    txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

    const res = await callMove({ itemId: 'WI-500', toStage: 'implementing' as MoveItemRequest['toStage'] });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.rejectionCount).toBe(1);
    expect(txMock.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rejectionCount: { increment: 1 }, stageId: 'implementing' }),
      })
    );
    expect(txMock.workLog.create).toHaveBeenCalled();
  });

  it('AC2: when the increment reaches the configured cap, the item escalates to blocked instead of the requested stage', async () => {
    // Default cap is 4 (matches agents/stop's DEFAULT_REJECTION_CAP) — an
    // item already at 3 hits 4 on this move and must escalate.
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 3 }));
    txMock.item.update.mockResolvedValue(baseItem({ stageId: 'blocked', rejectionCount: 4 }));
    txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

    const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.rejectionCount).toBe(4);
    expect(data.data.item.stageId).toBe('blocked');
    expect(txMock.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rejectionCount: { increment: 1 }, stageId: 'blocked' }),
      })
    );
  });

  it('AC3: the cap is read from ATEAM_REJECTION_CAP (not a second hardcoded default) — a custom cap of 2 escalates earlier than the default of 4', async () => {
    vi.stubEnv('ATEAM_REJECTION_CAP', '2');
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 1 }));
    txMock.item.update.mockResolvedValue(baseItem({ stageId: 'blocked', rejectionCount: 2 }));
    txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

    const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.stageId).toBe('blocked');
    expect(txMock.item.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stageId: 'blocked' }) })
    );
  });

  it('AC3: an unset/invalid ATEAM_REJECTION_CAP falls back to the default of 4, same as agents/stop', async () => {
    vi.stubEnv('ATEAM_REJECTION_CAP', undefined);
    // rejectionCount 2 -> 3 on this move: under the default cap of 4, must NOT escalate.
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 2 }));
    txMock.item.update.mockResolvedValue(baseItem({ stageId: 'testing', rejectionCount: 3 }));
    txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

    const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.stageId).toBe('testing');
    expect(data.data.item.rejectionCount).toBe(3);
    // Assert the actual increment call, not just the mocked return value —
    // otherwise this test would pass vacuously against today's code, which
    // never touches rejectionCount at all and would still produce a 200
    // with whatever txMock.item.update was told to resolve.
    expect(txMock.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rejectionCount: { increment: 1 }, stageId: 'testing' }),
      })
    );
  });

  it('AC4: staged -> done (the promotion path) does NOT increment rejectionCount and does NOT write a tail_rework entry', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 2 }));
    txMock.item.update.mockResolvedValue(baseItem({ stageId: 'done', rejectionCount: 2 }));

    const res = await callMove({ itemId: 'WI-500', toStage: 'done' as MoveItemRequest['toStage'] });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.rejectionCount).toBe(2);
    expect(data.data.item.stageId).toBe('done');

    const updateCallArg = txMock.item.update.mock.calls[0][0];
    expect(updateCallArg.data).not.toHaveProperty('rejectionCount');
    expect(txMock.workLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.workLog.create).not.toHaveBeenCalled();
  });

  it('AC5: a move that does not originate in staged (e.g. review -> implementing) is unaffected — no rejectionCount change, no tail_rework entry', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(
      baseItem({ id: 'WI-600', stageId: 'review', rejectionCount: 1 })
    );
    txMock.item.update.mockResolvedValue(
      baseItem({ id: 'WI-600', stageId: 'implementing', rejectionCount: 1 })
    );

    const res = await callMove({ itemId: 'WI-600', toStage: 'implementing' as MoveItemRequest['toStage'] });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.rejectionCount).toBe(1);
    expect(data.data.item.stageId).toBe('implementing');

    const updateCallArg = txMock.item.update.mock.calls[0][0];
    expect(updateCallArg.data).not.toHaveProperty('rejectionCount');
    expect(txMock.workLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.workLog.create).not.toHaveBeenCalled();
  });

  // Lynch REJECTED (rework): AC1's own text enumerates only "testing or
  // implementing" as tail-rework destinations, and staged->ready sits in
  // the same structural position TRANSITION_MATRIX gives probing->ready —
  // which CLAUDE.md documents as existing "for manual operator recovery...
  // but no pipeline agent uses it as a rejection target." A staged->ready
  // move is Hannibal re-decomposing a stuck item, not a Frankie/Stockwell
  // tail rework, and must not count against the rejection cap — otherwise
  // repeated legitimate recovery actions could silently escalate an
  // otherwise-healthy item to blocked. Mirrors AC5's shape exactly, scoped
  // to the one destination AC5's "non-staged-origin" framing doesn't cover
  // (this move DOES originate in staged — it's the destination, not the
  // origin, that must exclude it).
  it('staged -> ready (manual operator recovery, not tail rework) does NOT increment rejectionCount and does NOT write a tail_rework entry', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 1 }));
    txMock.item.update.mockResolvedValue(baseItem({ stageId: 'ready', rejectionCount: 1 }));

    const res = await callMove({ itemId: 'WI-500', toStage: 'ready' as MoveItemRequest['toStage'] });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.rejectionCount).toBe(1);
    expect(data.data.item.stageId).toBe('ready');

    const updateCallArg = txMock.item.update.mock.calls[0][0];
    expect(updateCallArg.data).not.toHaveProperty('rejectionCount');
    expect(txMock.workLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.workLog.create).not.toHaveBeenCalled();
  });

  it('AC6: the rejectionCount increment and the work_log write happen via the transaction-scoped client, never the top-level client directly', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 0 }));
    txMock.item.update.mockResolvedValue(baseItem({ stageId: 'testing', rejectionCount: 1 }));
    txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

    await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.item.update).toHaveBeenCalled();
    expect(txMock.workLog.create).toHaveBeenCalled();
    // The top-level client must never perform either write directly —
    // that would defeat AC6's atomicity guarantee even if the values end
    // up correct in the common case.
    expect(mockPrisma.item.update).not.toHaveBeenCalled();
    expect(mockPrisma.workLog.create).not.toHaveBeenCalled();
  });

  it('AC6: a WIP-limit failure on the target stage aborts before any write — rejectionCount is NOT counted for a move that never lands', async () => {
    stageCounts.testing = 3; // at the WIP limit of 3, and rejectionCount 0 -> 1 does NOT reach the default cap of 4, so this is a genuine (non-escalating) attempt to land in testing.
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 0 }));

    const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('WIP_LIMIT_EXCEEDED');
    expect(txMock.item.update).not.toHaveBeenCalled();
    expect(txMock.workLog.create).not.toHaveBeenCalled();
  });

  it('escalation to blocked is not blocked by testing being at WIP capacity — the WIP check must apply to the resolved destination (blocked, unlimited), not the originally-requested stage', async () => {
    stageCounts.testing = 3; // testing is completely full...
    // ...but this move escalates (rejectionCount 3 -> 4 hits the default cap of 4), so the
    // real destination is 'blocked', which has no WIP limit in this fixture set.
    mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 3 }));
    txMock.item.update.mockResolvedValue(baseItem({ stageId: 'blocked', rejectionCount: 4 }));
    txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

    const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.item.stageId).toBe('blocked');
  });

  // ---------------------------------------------------------------------
  // Response contract: an escalation silently rewrites the destination to
  // 'blocked'. A caller that asked for 'testing' and got a 200 back has no
  // way to learn that happened without diffing item.stageId against its own
  // request. The sibling rejection path (POST /api/agents/stop, outcome
  // 'rejected') already returns `escalated` + `rejectionCount` for exactly
  // this reason — the tail-rework path must report the same two fields with
  // the same names and semantics.
  // ---------------------------------------------------------------------
  describe('response contract: escalated / rejectionCount', () => {
    it('reports escalated:false and the new rejectionCount on a tail-rework move that stays under the cap', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 1 }));
      txMock.item.update.mockResolvedValue(baseItem({ stageId: 'testing', rejectionCount: 2 }));
      txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

      const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.escalated).toBe(false);
      expect(data.data.rejectionCount).toBe(2);
    });

    it('reports escalated:true and the capped rejectionCount when the move escalates to blocked', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 3 }));
      txMock.item.update.mockResolvedValue(baseItem({ stageId: 'blocked', rejectionCount: 4 }));
      txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

      const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.escalated).toBe(true);
      expect(data.data.rejectionCount).toBe(4);
      // The caller asked for testing and is being told, in the response
      // itself, that it landed in blocked instead.
      expect(data.data.item.stageId).toBe('blocked');
      expect(data.data.wipStatus.stageId).toBe('blocked');
    });

    it('omits escalated / rejectionCount on moves that are not tail rework (staged -> done), matching agents/stop, where the fields are rejection-only', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 2 }));
      txMock.item.update.mockResolvedValue(baseItem({ stageId: 'done', rejectionCount: 2 }));

      const res = await callMove({ itemId: 'WI-500', toStage: 'done' as MoveItemRequest['toStage'] });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.escalated).toBeUndefined();
      expect(data.data.rejectionCount).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // TOCTOU: the rejectionCount that drives the escalation decision must be
  // read INSIDE the transaction that performs the increment. Reading it from
  // the pre-transaction findFirst leaves a window where two concurrent
  // tail-rework moves both observe the same count — they then either both
  // escalate (one item, two 'blocked' resolutions) or both decline to
  // escalate and overshoot the cap.
  //
  // The mock makes the two reads return DIFFERENT counts; only the
  // in-transaction value may influence the outcome.
  // ---------------------------------------------------------------------
  describe('escalation decides on the in-transaction rejectionCount, not the pre-transaction read', () => {
    it('escalates when the in-transaction count reaches the cap even though the pre-transaction read was well under it', async () => {
      // Pre-transaction read: 0 -> 1, nowhere near the default cap of 4.
      mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 0 }));
      // A concurrent tail-rework move committed in between: the row now
      // reads 3, so THIS move is the one that hits 4.
      txMock.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 3 }));
      txMock.item.update.mockResolvedValue(baseItem({ stageId: 'blocked', rejectionCount: 4 }));
      txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

      const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.escalated).toBe(true);
      expect(data.data.rejectionCount).toBe(4);
      expect(txMock.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rejectionCount: { increment: 1 }, stageId: 'blocked' }),
        })
      );
    });

    it('does NOT escalate when the in-transaction count is below the cap even though the pre-transaction read was at it', async () => {
      // Pre-transaction read says 3 -> 4 (escalate)...
      mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 3 }));
      // ...but the authoritative in-transaction row says 0 -> 1. Escalating
      // here would send a healthy item to blocked on a stale read.
      txMock.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 0 }));
      txMock.item.update.mockResolvedValue(baseItem({ stageId: 'testing', rejectionCount: 1 }));
      txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

      const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.data.escalated).toBe(false);
      expect(data.data.rejectionCount).toBe(1);
      expect(data.data.item.stageId).toBe('testing');
      expect(txMock.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rejectionCount: { increment: 1 }, stageId: 'testing' }),
        })
      );
    });

    it('the in-transaction re-read happens against the same item and project scope', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 0 }));
      txMock.item.update.mockResolvedValue(baseItem({ stageId: 'testing', rejectionCount: 1 }));
      txMock.workLog.create.mockResolvedValue({ id: 1, agent: 'Hannibal', action: 'tail_rework', summary: 'x' });

      await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });

      expect(txMock.item.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'WI-500', projectId: 'test-project' }),
        })
      );
    });

    it('does not count the rework when the item left staged between the two reads', async () => {
      // The pre-transaction read saw 'staged', but by the time the
      // transaction opened, another writer had already moved the item.
      // Counting a second tail rework here would double-charge the cap.
      mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 1 }));
      txMock.item.findFirst.mockResolvedValue(baseItem({ stageId: 'testing', rejectionCount: 2 }));
      txMock.item.update.mockResolvedValue(baseItem({ stageId: 'testing', rejectionCount: 2 }));

      const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
      const data = await res.json();

      expect(res.status).toBe(200);
      const updateCallArg = txMock.item.update.mock.calls[0][0];
      expect(updateCallArg.data).not.toHaveProperty('rejectionCount');
      expect(txMock.workLog.create).not.toHaveBeenCalled();
      expect(data.data.escalated).toBeUndefined();
      expect(data.data.rejectionCount).toBeUndefined();
    });

    it('returns ITEM_NOT_FOUND when the item disappears between the pre-transaction read and the transaction', async () => {
      mockPrisma.item.findFirst.mockResolvedValue(baseItem({ rejectionCount: 1 }));
      txMock.item.findFirst.mockResolvedValue(null);

      const res = await callMove({ itemId: 'WI-500', toStage: 'testing' as MoveItemRequest['toStage'] });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error.code).toBe('ITEM_NOT_FOUND');
      expect(txMock.item.update).not.toHaveBeenCalled();
      expect(txMock.workLog.create).not.toHaveBeenCalled();
    });
  });
});

async function callMove(body: MoveItemRequest) {
  const { POST } = await import('@/app/api/board/move/route');
  return POST(buildRequest(body));
}

// ── Cross-artifact contract: openapi.yaml ────────────────────────────────────

/**
 * The route writes action:'tail_rework' and src/types/item.ts declares it in
 * the WorkLogAction union, but openapi.yaml is a hand-maintained duplicate of
 * that same enum — it shipped without the value and drifted. Pin the two so
 * the next value added to the union cannot land spec-less either.
 */
describe('openapi.yaml — WorkLogAction enum matches the TS union', () => {
  const readOpenapi = () => readFileSync(join(process.cwd(), 'openapi.yaml'), 'utf-8');

  /** Hand-parse the single spelled-out WorkLogAction enum rather than pulling in a YAML dep. */
  function specWorkLogActions(): string[] {
    const match = readOpenapi().match(
      /WorkLogAction:\s*\n\s*type:\s*string\s*\n\s*enum:\s*\[([^\]]+)\]/
    );
    expect(match, 'openapi.yaml should define a WorkLogAction enum').not.toBeNull();
    return match![1].split(',').map((v) => v.trim());
  }

  it('documents tail_rework, the action the tail-rework move writes', () => {
    expect(specWorkLogActions()).toContain('tail_rework');
  });

  it('documents every value in the WorkLogAction union, in the same order', () => {
    // Read the union out of src/types/item.ts rather than restating it here — a
    // second hand-maintained copy would drift exactly the way the spec just did.
    const typesSrc = readFileSync(join(process.cwd(), 'src', 'types', 'item.ts'), 'utf-8');
    const union = typesSrc.match(/export type WorkLogAction =([^;]+);/);
    expect(union, 'src/types/item.ts should declare the WorkLogAction union').not.toBeNull();
    const unionValues = union![1]
      .split('|')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);

    expect(unionValues).toContain('tail_rework'); // guard against an empty parse passing vacuously
    expect(specWorkLogActions()).toEqual(unionValues);
  });
});
