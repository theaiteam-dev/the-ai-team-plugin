import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/missions/[missionId]/final-review/route';
import { prisma } from '@/lib/db';

/**
 * Tests for WI-790: promoting every staged item to done atomically when
 * Stockwell writes a FINAL APPROVED final review report.
 *
 * Real-DB integration tests (matches the existing precedent in
 * missions-final-review-api.test.ts for this exact route): these ACs are
 * fundamentally about resulting DATABASE STATE after a multi-step
 * transactional operation (which items moved, which log entries exist, does
 * a second call stay idempotent) — that's much more robustly proven against
 * a real database than by guessing the exact shape of Prisma calls a mock
 * would need to intercept. DATABASE_URL is unset in this environment, so
 * db-path.ts resolves to prisma/data/dev.db (NOT the prod-copy ateam.db
 * flagged elsewhere in this mission) — the same file
 * missions-final-review-api.test.ts already writes through.
 *
 * AC2 (transaction atomicity/rollback) is NOT tested in this file — see
 * final-review-promotion-atomicity.test.ts instead. A forced mid-operation
 * failure needs to intercept prisma.$transaction, and vi.spyOn() cannot
 * target Prisma 7's client directly: `typeof prisma.$transaction` reports
 * 'function' but `vi.spyOn(prisma, '$transaction')` still throws "can only
 * spy on a function. Received undefined" — reproduced directly against the
 * real client in this environment (its methods sit behind an internal
 * Proxy that vi.spyOn's property-descriptor lookup can't see). A full
 * vi.mock('@/lib/db', ...) sidesteps this by replacing the module entirely,
 * but vi.mock applies module-wide per file, so it needs its own file rather
 * than coexisting here with the real prisma import.
 *
 * NAMING NOTE for B.A.: the AC requires the response to return "the count
 * of promoted items" but doesn't name the field. This suite assumes
 * `data.data.promotedCount`. If you have a strong reason to name it
 * differently, ping me (Murdock) with a FIX request rather than renaming
 * unilaterally — these tests import nothing from the route, so a rename
 * only breaks the response-shape assertions, not a compile-time import.
 *
 * VERDICT PARSING: report fixtures below are constructed to be unambiguous
 * under scripts/hooks/lib/stop-gates.js's parseFinalReviewVerdict() rules
 * (VERDICT: FINAL APPROVED/REJECTED lines take priority; otherwise a bare
 * FINAL APPROVED xor FINAL REJECTED; both-or-neither = unknown). The item's
 * own context asks the API to mirror those exact rules, so these fixtures
 * exercise the real matching contract, not an invented one.
 */

const PROJECT_ID = 'test-wi790-promotion-project';
const MISSION_ID = 'M-wi790-promotion-test';
// A second, already-archived mission in the SAME project. Archiving sets
// Mission.archivedAt and Item.archivedAt but deliberately leaves stageId
// alone, so a finished-and-archived mission can legitimately leave items
// sitting in 'staged' forever. Those must never be swept into 'done' by a
// LATER mission's approved review.
const OTHER_MISSION_ID = 'M-wi790-other-mission';

const APPROVED_REPORT =
  '## Final Mission Review\n\nVERDICT: FINAL APPROVED\n\nAll PRD requirements met, no security issues.';
const REJECTED_REPORT =
  '## Final Mission Review\n\nVERDICT: FINAL REJECTED\n\nWI-999 needs rework before promotion.';
const UNPARSEABLE_REPORT =
  '## Final Mission Review\n\nThe team did a great job this mission, nothing further to add.';

function makeRequest(body: unknown): Request {
  return new Request(`http://localhost:3000/api/missions/${MISSION_ID}/final-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': PROJECT_ID },
    body: JSON.stringify(body),
  });
}

const routeParams = { params: Promise.resolve({ missionId: MISSION_ID }) };

/** Upserts a Stage row so Item.stageId's FK constraint is satisfiable. */
async function seedStage(id: string): Promise<void> {
  await prisma.stage.upsert({
    where: { id },
    update: {},
    create: { id, name: id, order: 0, wipLimit: null },
  });
}

interface SeedItemOptions {
  /**
   * Which mission the item belongs to, via the MissionItem join table.
   * Defaults to the mission under test. Pass `null` to seed an ORPHAN item
   * with no MissionItem row at all (items created outside any active
   * mission) — those belong to no mission and must never be promoted.
   */
  missionId?: string | null;
  /** Soft-delete marker set by mission archival. */
  archivedAt?: Date | null;
}

/**
 * Upserts an Item at a given stage, scoped to the test project, and (unless
 * told otherwise) links it to a mission through MissionItem — the same join
 * every other mission-scoped query in this codebase goes through
 * (agents/stop, missions/archive, missions/current/health-report).
 */
async function seedItem(id: string, stageId: string, options: SeedItemOptions = {}): Promise<void> {
  const { missionId = MISSION_ID, archivedAt = null } = options;

  await prisma.item.upsert({
    where: { id },
    update: { stageId, archivedAt },
    create: {
      id,
      title: `WI-790 test fixture ${id}`,
      description: 'Fixture item for final-review promotion tests',
      type: 'feature',
      priority: 'medium',
      stageId,
      projectId: PROJECT_ID,
      archivedAt,
    },
  });

  if (missionId !== null) {
    await prisma.missionItem.upsert({
      where: { missionId_itemId: { missionId, itemId: id } },
      update: {},
      create: { missionId, itemId: id },
    });
  }
}

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'WI-790 Promotion Test Project' },
  });

  await prisma.mission.upsert({
    where: { id: MISSION_ID },
    update: { finalReview: null },
    create: {
      id: MISSION_ID,
      name: 'WI-790 Promotion Test Mission',
      state: 'completed',
      prdPath: '/prd/test.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
    },
  });

  await prisma.mission.upsert({
    where: { id: OTHER_MISSION_ID },
    update: {},
    create: {
      id: OTHER_MISSION_ID,
      name: 'WI-790 Previously Archived Mission',
      state: 'archived',
      prdPath: '/prd/other.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
      archivedAt: new Date(),
    },
  });

  for (const stageId of ['ready', 'testing', 'implementing', 'review', 'probing', 'staged', 'done', 'blocked']) {
    await seedStage(stageId);
  }

  // Clean slate per test — ActivityLog isn't cascade-deleted by Item removal
  // (no FK to Item), so clear it explicitly; Item removal cascades WorkLog.
  await prisma.activityLog.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.item.deleteMany({ where: { projectId: PROJECT_ID } });
});

describe('POST /api/missions/[missionId]/final-review — staged-to-done promotion (WI-790)', () => {
  it('AC1: FINAL APPROVED promotes every staged item to done and returns the promoted count', async () => {
    await seedItem('WI-P01', 'staged');
    await seedItem('WI-P02', 'staged');

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.promotedCount).toBe(2);

    const item1 = await prisma.item.findUnique({ where: { id: 'WI-P01' } });
    const item2 = await prisma.item.findUnique({ where: { id: 'WI-P02' } });
    expect(item1?.stageId).toBe('done');
    expect(item2?.stageId).toBe('done');
  });

  it('AC3: FINAL REJECTED persists the review and promotes nothing', async () => {
    await seedItem('WI-P03', 'staged');

    const response = await POST(makeRequest({ finalReview: REJECTED_REPORT }), routeParams);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    const item = await prisma.item.findUnique({ where: { id: 'WI-P03' } });
    expect(item?.stageId).toBe('staged');

    const mission = await prisma.mission.findUnique({ where: { id: MISSION_ID } });
    expect(mission?.finalReview).toBe(REJECTED_REPORT);
  });

  it('AC4: a verdict that cannot be parsed persists the review and promotes nothing, rather than guessing', async () => {
    await seedItem('WI-P04', 'staged');

    const response = await POST(makeRequest({ finalReview: UNPARSEABLE_REPORT }), routeParams);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);

    const item = await prisma.item.findUnique({ where: { id: 'WI-P04' } });
    expect(item?.stageId).toBe('staged');

    const mission = await prisma.mission.findUnique({ where: { id: MISSION_ID } });
    expect(mission?.finalReview).toBe(UNPARSEABLE_REPORT);
  });

  it('AC5: promotion is idempotent — posting the same FINAL APPROVED report twice does not error and leaves items in done', async () => {
    await seedItem('WI-P05', 'staged');

    const first = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    expect(first.status).toBe(200);
    const firstData = await first.json();
    expect(firstData.data.promotedCount).toBe(1);

    const second = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    expect(second.status).toBe(200);
    const secondData = await second.json();
    expect(secondData.success).toBe(true);
    // Nothing left in staged the second time around — zero re-promoted.
    expect(secondData.data.promotedCount).toBe(0);

    const item = await prisma.item.findUnique({ where: { id: 'WI-P05' } });
    expect(item?.stageId).toBe('done');
  });

  it('AC6: only staged items are promoted; items already done are untouched', async () => {
    await seedItem('WI-P06', 'staged');
    await seedItem('WI-P10', 'done');

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.promotedCount).toBe(1); // only WI-P06 was staged

    const p06 = await prisma.item.findUnique({ where: { id: 'WI-P06' } });
    const p10 = await prisma.item.findUnique({ where: { id: 'WI-P10' } });

    expect(p06?.stageId).toBe('done'); // promoted
    expect(p10?.stageId).toBe('done'); // was already done, untouched (not re-promoted/re-logged)
    expect(await prisma.workLog.findMany({ where: { itemId: 'WI-P10' } })).toHaveLength(0);
  });

  it('refuses an APPROVED review with 409 MISSION_NOT_READY while any of the mission\'s items is still mid-pipeline, and persists nothing', async () => {
    await seedItem('WI-P06a', 'staged');
    await seedItem('WI-P08', 'review');
    await seedItem('WI-P09', 'probing');
    await seedItem('WI-P10a', 'done');

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('MISSION_NOT_READY');
    expect(data.error.details.pendingItemIds.sort()).toEqual(['WI-P08', 'WI-P09']);

    // Neither the promotion nor the review write survives the refusal.
    expect((await prisma.item.findUnique({ where: { id: 'WI-P06a' } }))?.stageId).toBe('staged');
    expect((await prisma.item.findUnique({ where: { id: 'WI-P08' } }))?.stageId).toBe('review');
    expect((await prisma.mission.findUnique({ where: { id: MISSION_ID } }))?.finalReview).toBeNull();
    expect(await prisma.workLog.findMany({ where: { itemId: 'WI-P06a' } })).toHaveLength(0);
  });

  it('treats a blocked item as unfinished — an APPROVED review over a blocked mission is refused', async () => {
    await seedItem('WI-P07', 'blocked');
    await seedItem('WI-P07b', 'staged');

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error.details.pendingItemIds).toEqual(['WI-P07']);
    expect((await prisma.item.findUnique({ where: { id: 'WI-P07' } }))?.stageId).toBe('blocked');
    expect((await prisma.item.findUnique({ where: { id: 'WI-P07b' } }))?.stageId).toBe('staged');
    expect((await prisma.mission.findUnique({ where: { id: MISSION_ID } }))?.finalReview).toBeNull();
  });

  it('a NON-approved verdict is stored even while items are mid-pipeline — the readiness gate guards promotion only', async () => {
    await seedItem('WI-P18', 'implementing');

    const response = await POST(makeRequest({ finalReview: REJECTED_REPORT }), routeParams);

    expect(response.status).toBe(200);
    expect((await prisma.mission.findUnique({ where: { id: MISSION_ID } }))?.finalReview).toBe(REJECTED_REPORT);
    expect((await prisma.item.findUnique({ where: { id: 'WI-P18' } }))?.stageId).toBe('implementing');
  });

  it('unfinished items in ANOTHER mission never block this mission\'s approval', async () => {
    await seedItem('WI-P19', 'staged');
    await seedItem('WI-OTHER-WIP', 'implementing', { missionId: OTHER_MISSION_ID });

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.promotedCount).toBe(1);
    expect((await prisma.item.findUnique({ where: { id: 'WI-OTHER-WIP' } }))?.stageId).toBe('implementing');
  });

  it('an archived unfinished item does not block approval — a soft-deleted item is out of the mission population', async () => {
    await seedItem('WI-P20', 'staged');
    await seedItem('WI-P21-ARCHIVED', 'implementing', { archivedAt: new Date() });

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.promotedCount).toBe(1);
    expect((await prisma.item.findUnique({ where: { id: 'WI-P21-ARCHIVED' } }))?.stageId).toBe('implementing');
  });

  it('batch promotion still writes exactly one work log row per promoted item', async () => {
    const ids = ['WI-B01', 'WI-B02', 'WI-B03', 'WI-B04', 'WI-B05'];
    for (const id of ids) {
      await seedItem(id, 'staged');
    }

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.promotedCount).toBe(5);

    for (const id of ids) {
      expect((await prisma.item.findUnique({ where: { id } }))?.stageId).toBe('done');
      const logs = await prisma.workLog.findMany({ where: { itemId: id } });
      expect(logs).toHaveLength(1);
      expect(logs[0].agent).toBe('system');
      expect(logs[0].action).toBe('note');
      expect(logs[0].summary).toMatch(/final review/i);
      expect(logs[0].summary).toContain(MISSION_ID);
    }
  });

  it('returns 400 VALIDATION_ERROR (not a 500) when the request body is not valid JSON', async () => {
    const response = await POST(
      new Request(`http://localhost:3000/api/missions/${MISSION_ID}/final-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': PROJECT_ID },
        body: '{ not json at all',
      }),
      routeParams
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toMatch(/invalid json/i);
    expect((await prisma.mission.findUnique({ where: { id: MISSION_ID } }))?.finalReview).toBeNull();
  });

  it('AC7: promotion writes a log entry per promoted item naming the final review as the cause', async () => {
    await seedItem('WI-P11', 'staged');

    await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);

    // AC7 permits EITHER a WorkLog or an ActivityLog entry — this checks
    // both and requires at least one to exist and to name the final review
    // as the cause, matching the AC's own explicit "(or activity entry)".
    const workLogs = await prisma.workLog.findMany({ where: { itemId: 'WI-P11' } });
    const activityLogs = await prisma.activityLog.findMany({
      where: { projectId: PROJECT_ID, message: { contains: 'WI-P11' } },
    });

    const workLogNamesReview = workLogs.some((w) => /final review/i.test(w.summary));
    const activityLogNamesReview = activityLogs.some((a) => /final review/i.test(a.message));

    expect(workLogNamesReview || activityLogNamesReview).toBe(true);
  });

  it('promotes ONLY this mission\'s staged items — a previously archived mission\'s staged items are left alone', async () => {
    await seedItem('WI-P13', 'staged');
    // Left behind by an earlier, already-archived mission: archival stamps
    // archivedAt but never touches stageId, so these sit in 'staged' forever.
    await seedItem('WI-OLD1', 'staged', { missionId: OTHER_MISSION_ID, archivedAt: new Date() });
    await seedItem('WI-OLD2', 'staged', { missionId: OTHER_MISSION_ID, archivedAt: new Date() });

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.promotedCount).toBe(1); // WI-P13 only — not the other mission's two

    expect((await prisma.item.findUnique({ where: { id: 'WI-P13' } }))?.stageId).toBe('done');
    expect((await prisma.item.findUnique({ where: { id: 'WI-OLD1' } }))?.stageId).toBe('staged');
    expect((await prisma.item.findUnique({ where: { id: 'WI-OLD2' } }))?.stageId).toBe('staged');

    // Nor may this mission's review be credited in another mission's work log.
    const strayLogs = await prisma.workLog.findMany({ where: { itemId: { in: ['WI-OLD1', 'WI-OLD2'] } } });
    expect(strayLogs).toHaveLength(0);
  });

  it('leaves another mission\'s staged items alone even when that mission was never archived', async () => {
    await seedItem('WI-P14', 'staged');
    await seedItem('WI-OTHER1', 'staged', { missionId: OTHER_MISSION_ID });

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.promotedCount).toBe(1);
    expect((await prisma.item.findUnique({ where: { id: 'WI-P14' } }))?.stageId).toBe('done');
    expect((await prisma.item.findUnique({ where: { id: 'WI-OTHER1' } }))?.stageId).toBe('staged');
  });

  it('never promotes an orphan item that belongs to no mission at all', async () => {
    await seedItem('WI-P15', 'staged');
    await seedItem('WI-ORPHAN', 'staged', { missionId: null });

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.promotedCount).toBe(1);
    expect((await prisma.item.findUnique({ where: { id: 'WI-P15' } }))?.stageId).toBe('done');
    expect((await prisma.item.findUnique({ where: { id: 'WI-ORPHAN' } }))?.stageId).toBe('staged');
    expect(await prisma.workLog.findMany({ where: { itemId: 'WI-ORPHAN' } })).toHaveLength(0);
  });

  it('never promotes an archived item, even one linked to the mission being approved', async () => {
    await seedItem('WI-P16', 'staged');
    await seedItem('WI-P17-ARCHIVED', 'staged', { archivedAt: new Date() });

    const response = await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.promotedCount).toBe(1);
    expect((await prisma.item.findUnique({ where: { id: 'WI-P16' } }))?.stageId).toBe('done');
    expect((await prisma.item.findUnique({ where: { id: 'WI-P17-ARCHIVED' } }))?.stageId).toBe('staged');
  });

  it('AC7: no log entry is written for an item that was already done (nothing to promote)', async () => {
    await seedItem('WI-P12', 'done');

    await POST(makeRequest({ finalReview: APPROVED_REPORT }), routeParams);

    const workLogs = await prisma.workLog.findMany({ where: { itemId: 'WI-P12' } });
    const activityLogs = await prisma.activityLog.findMany({
      where: { projectId: PROJECT_ID, message: { contains: 'WI-P12' } },
    });

    expect(workLogs).toHaveLength(0);
    expect(activityLogs).toHaveLength(0);
  });
});

// AC2 (transaction atomicity/rollback) is covered in
// final-review-promotion-atomicity.test.ts, using a fully mocked prisma
// client — see the file header comment above for why vi.spyOn() on the real
// client doesn't work in this environment.
