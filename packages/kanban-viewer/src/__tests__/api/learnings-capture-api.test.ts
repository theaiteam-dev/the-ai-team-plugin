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
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
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
    // Default: the requesting project already exists, so ensureProject's
    // findUnique short-circuits and create is never reached.
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-a', name: 'project-a' });
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

  it('serializes concurrent duplicate captures via the unique constraint: both succeed, one row, same id', async () => {
    // The app-level findFirst is only a fast-path; two concurrent POSTs can both
    // pass it before either inserts (TOCTOU). The DB-level
    // @@unique([projectId, missionId, fingerprint]) is the real backstop. This
    // in-memory store enforces that same uniqueness and raises P2002 on the
    // losing insert, so the test proves the route converts the race into a safe
    // upsert-on-conflict (200 with the winner's row) rather than a 500.
    const rows: Array<{ id: number; projectId: string; missionId: string | null; fingerprint: string }> = [];
    let nextId = 1;

    mockPrisma.retroLearning.findFirst.mockImplementation(async ({ where }) => {
      return (
        rows.find(
          (r) =>
            r.projectId === where.projectId &&
            r.missionId === where.missionId &&
            r.fingerprint === where.fingerprint
        ) ?? null
      );
    });

    mockPrisma.retroLearning.create.mockImplementation(async ({ data }) => {
      const conflict = rows.find(
        (r) =>
          r.projectId === data.projectId &&
          r.missionId === data.missionId &&
          r.fingerprint === data.fingerprint
      );
      if (conflict) {
        const err = new Error('Unique constraint failed') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const row = {
        id: nextId++,
        projectId: data.projectId,
        missionId: data.missionId,
        fingerprint: data.fingerprint,
      };
      rows.push(row);
      return row;
    });

    const body = validBody({ fingerprint: 'race', missionId: 'm-race' });
    const [resA, resB] = await Promise.all([
      POST(buildRequest('project-a', body)),
      POST(buildRequest('project-a', body)),
    ]);

    // Neither request may surface the race as a 500.
    expect(resA.status).not.toBe(500);
    expect(resB.status).not.toBe(500);

    const dataA = await resA.json();
    const dataB = await resB.json();
    expect(dataA.success).toBe(true);
    expect(dataB.success).toBe(true);
    // Both requests resolve to the same persisted row.
    expect(dataA.data.id).toBe(dataB.data.id);

    // Exactly one insert survived: one 201 (created), one 200 (deduped), one row.
    expect([resA.status, resB.status].sort()).toEqual([200, 201]);
    expect(rows).toHaveLength(1);
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
      // Sourced from createMissionNotFoundError (src/lib/errors.ts) rather than
      // an inline object literal — message content is preserved.
      expect(data.error.message).toBe(`Mission '${missionId}' not found`);
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

  it.each(['low', 'medium', 'high', 'critical'])(
    'accepts severity "%s"',
    async (severity) => {
      mockPrisma.retroLearning.findFirst.mockResolvedValue(null);
      mockPrisma.retroLearning.create.mockResolvedValue({ id: 1 });

      const res = await POST(
        buildRequest('project-a', validBody({ severity, fingerprint: `fp-${severity}` }))
      );

      expect(res.status).toBe(201);
    }
  );

  it.each([
    ['a typo', 'hihg'],
    ['the review vocabulary, which maps at the capture boundary, not here', 'must'],
    ['uppercase', 'High'],
  ])('returns 400 VALIDATION_ERROR when severity is %s ("%s")', async (_label, severity) => {
    const res = await POST(buildRequest('project-a', validBody({ severity })));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('low, medium, high, critical');
    expect(mockPrisma.retroLearning.create).not.toHaveBeenCalled();
  });

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

  it('does not provision a Project row for an invalid body on a never-before-seen project id', async () => {
    // Project auto-provisioning must happen AFTER body validation — otherwise a
    // well-formed X-Project-ID with a garbage body still leaves behind a Project
    // row despite the 400 response.
    mockPrisma.project.findUnique.mockResolvedValue(null);

    const body = validBody();
    delete (body as Record<string, unknown>).fingerprint; // trigger required-field 400

    const res = await POST(buildRequest('never-seen-project', body));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.project.create).not.toHaveBeenCalled();
  });

  it('does not provision a Project row for a bad-severity body on a never-before-seen project id', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    const res = await POST(
      buildRequest('another-new-project', validBody({ severity: 'not-a-severity' }))
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.project.create).not.toHaveBeenCalled();
  });

  it('auto-creates an unknown-but-valid-format project instead of surfacing an FK 500', async () => {
    // A well-formed X-Project-ID that has never been seen before must not reach
    // retroLearning.create() until the project row exists — otherwise the
    // insert violates the FK constraint and the route degrades to a 500.
    mockPrisma.project.findUnique.mockResolvedValue(null);
    mockPrisma.project.create.mockResolvedValue({ id: 'brand-new-project', name: 'brand-new-project' });
    mockPrisma.retroLearning.findFirst.mockResolvedValue(null);
    mockPrisma.retroLearning.create.mockResolvedValue({ id: 1 });

    const res = await POST(
      buildRequest('brand-new-project', validBody({ fingerprint: 'fp-new-project' }))
    );

    expect(res.status).toBe(201);
    expect(mockPrisma.project.create).toHaveBeenCalledWith({
      data: { id: 'brand-new-project', name: 'brand-new-project' },
    });
    // The project must be created before the learning row is inserted.
    expect(mockPrisma.project.create.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.retroLearning.create.mock.invocationCallOrder[0]
    );
  });
});
