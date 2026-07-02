import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for POST /api/learnings (WI-196).
 *
 * This route captures RetroLearning rows for the retro agent's Debrief and the
 * corpus backfill. Behavior under test:
 *
 * 1. A valid body creates a row scoped to the X-Project-ID header and returns
 *    201 with the new row id.
 * 2. The projectId comes from the header, NOT the body — a body-supplied
 *    projectId cannot redirect the write to another project.
 * 3. Dedupe is per-mission and at write time: a second POST with the same
 *    (missionId, fingerprint) does not create a second row and returns the
 *    existing one (200).
 * 4. The dedupe key includes missionId — the same fingerprint under a different
 *    mission is a distinct row (recurrence is counted per mission).
 * 5. Null-missionId rows are ALWAYS inserted and never deduped against each
 *    other (backfill of stalled drafts), even when a matching row exists.
 * 6. Missing required body fields, and a missing/invalid X-Project-ID header,
 *    both return 400 VALIDATION_ERROR without touching the DB.
 *
 * Convention: response shape { success, data: { id } }, mirroring the
 * final-review route. New rows return 201; a deduped (already-existing) row
 * returns 200 to distinguish "created" from "returned existing".
 */

const mockPrisma = vi.hoisted(() => ({
  retroLearning: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

import { POST } from '@/app/api/learnings/route';

function buildRequest(projectId: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  return new Request('http://localhost:3000/api/learnings', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    source: 'stockwell',
    severity: 'high',
    attributedAgent: 'ba',
    targetSurface: 'agents/ba.md',
    pattern: 'missing-error-handling',
    fingerprint: 'fp-1',
    title: 'B.A. skips error handling on async calls',
    detail: 'Three rejections traced to unhandled promise rejections.',
    missionId: 'm-20260702-001',
    ...overrides,
  };
}

const REQUIRED_FIELDS = [
  'source',
  'severity',
  'attributedAgent',
  'targetSurface',
  'pattern',
  'fingerprint',
  'title',
];

describe('POST /api/learnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: any non-null missionId is owned by the requesting project, so
    // the ownership guard passes and the dedupe/create path runs. Tests that
    // exercise a missing/foreign mission override this to resolve null.
    mockPrisma.mission.findFirst.mockResolvedValue({ id: 'owned-mission', projectId: 'project-a' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a row scoped to the X-Project-ID header and returns 201 with the row id', async () => {
    mockPrisma.retroLearning.findFirst.mockResolvedValue(null);
    mockPrisma.retroLearning.create.mockResolvedValue({ id: 42 });

    const res = await POST(buildRequest('project-a', validBody({ fingerprint: 'fp-create' })));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.id).toBe(42);

    expect(mockPrisma.retroLearning.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.retroLearning.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-a',
        missionId: 'm-20260702-001',
        source: 'stockwell',
        severity: 'high',
        attributedAgent: 'ba',
        targetSurface: 'agents/ba.md',
        pattern: 'missing-error-handling',
        fingerprint: 'fp-create',
        title: 'B.A. skips error handling on async calls',
        detail: 'Three rejections traced to unhandled promise rejections.',
      }),
    });
  });

  it('scopes the row to the header project, ignoring any projectId supplied in the body', async () => {
    mockPrisma.retroLearning.findFirst.mockResolvedValue(null);
    mockPrisma.retroLearning.create.mockResolvedValue({ id: 5 });

    await POST(buildRequest('project-a', { ...validBody(), projectId: 'attacker-project' }));

    const createArg = mockPrisma.retroLearning.create.mock.calls[0][0];
    expect(createArg.data.projectId).toBe('project-a');
    expect(createArg.data.projectId).not.toBe('attacker-project');
  });

  it('collapses a duplicate (missionId, fingerprint) to one row and returns the existing row', async () => {
    // First POST: no existing row for this (mission, fingerprint) -> insert.
    mockPrisma.retroLearning.findFirst.mockResolvedValueOnce(null);
    mockPrisma.retroLearning.create.mockResolvedValue({ id: 7 });

    const first = await POST(
      buildRequest('project-a', validBody({ fingerprint: 'dupe', missionId: 'm-1' }))
    );
    expect(first.status).toBe(201);
    expect((await first.json()).data.id).toBe(7);

    // Second POST with the same (missionId, fingerprint): existing row found -> no insert.
    mockPrisma.retroLearning.findFirst.mockResolvedValueOnce({ id: 7 });

    const second = await POST(
      buildRequest('project-a', validBody({ fingerprint: 'dupe', missionId: 'm-1' }))
    );

    expect(second.status).toBe(200);
    expect((await second.json()).data.id).toBe(7);
    // create must have been called exactly once across both requests.
    expect(mockPrisma.retroLearning.create).toHaveBeenCalledTimes(1);
  });

  it('creates separate rows for the same fingerprint under different missions', async () => {
    mockPrisma.retroLearning.findFirst.mockResolvedValue(null);
    mockPrisma.retroLearning.create
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 });

    const a = await POST(
      buildRequest('project-a', validBody({ fingerprint: 'shared', missionId: 'm-a' }))
    );
    const b = await POST(
      buildRequest('project-a', validBody({ fingerprint: 'shared', missionId: 'm-b' }))
    );

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(mockPrisma.retroLearning.create).toHaveBeenCalledTimes(2);

    const missionIds = mockPrisma.retroLearning.create.mock.calls.map((c) => c[0].data.missionId);
    expect(missionIds).toEqual(['m-a', 'm-b']);
  });

  it('always inserts null-missionId rows and never dedupes them, even when a match exists', async () => {
    // Even if a dedupe lookup WOULD return a row, null-mission rows must never be
    // collapsed — the route must insert both and return the freshly created ids.
    mockPrisma.retroLearning.findFirst.mockResolvedValue({ id: 99 });
    mockPrisma.retroLearning.create
      .mockResolvedValueOnce({ id: 10 })
      .mockResolvedValueOnce({ id: 11 });

    const a = await POST(
      buildRequest('project-a', validBody({ fingerprint: 'nullmiss', missionId: null }))
    );
    const b = await POST(
      buildRequest('project-a', validBody({ fingerprint: 'nullmiss', missionId: null }))
    );

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await a.json()).data.id).toBe(10);
    expect((await b.json()).data.id).toBe(11);
    expect(mockPrisma.retroLearning.create).toHaveBeenCalledTimes(2);
    // A null missionId has no owner to check — the ownership guard must be skipped
    // entirely (otherwise a null-scoped lookup would 404 and block the insert).
    expect(mockPrisma.mission.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['belonging to a different project', 'm-victim-mission'],
    ['that does not exist', 'm-does-not-exist'],
  ])(
    'returns 404 MISSION_NOT_FOUND (no cross-tenant link, no FK crash) for a missionId %s',
    async (_label, missionId) => {
      // A project-scoped ownership lookup returns null both when the mission
      // belongs to another project and when it does not exist — the two cases are
      // indistinguishable to the caller, which is the point (existence is not
      // leaked). This must be caught BEFORE create, so no row is inserted with a
      // mismatched projectId/missionId and no FK violation surfaces as a 500.
      mockPrisma.mission.findFirst.mockResolvedValue(null);

      const res = await POST(buildRequest('project-a', validBody({ missionId })));

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('MISSION_NOT_FOUND');
      expect(mockPrisma.retroLearning.create).not.toHaveBeenCalled();

      // The ownership lookup must be scoped to the requesting project.
      expect(mockPrisma.mission.findFirst).toHaveBeenCalledWith({
        where: { id: missionId, projectId: 'project-a' },
      });
    }
  );

  it.each(REQUIRED_FIELDS)(
    'returns 400 VALIDATION_ERROR when required field "%s" is missing',
    async (field) => {
      const body = validBody();
      delete (body as Record<string, unknown>)[field];

      const res = await POST(buildRequest('project-a', body));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(mockPrisma.retroLearning.create).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['missing', null],
    ['an empty string', ''],
    ['invalid (contains a space)', 'bad id'],
    ['invalid (contains punctuation)', 'proj!'],
  ])('returns 400 when the X-Project-ID header is %s', async (_label, projectId) => {
    const res = await POST(buildRequest(projectId as string | null, validBody()));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.retroLearning.create).not.toHaveBeenCalled();
  });
});
