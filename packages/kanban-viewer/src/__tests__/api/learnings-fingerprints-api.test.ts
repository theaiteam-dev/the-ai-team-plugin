import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for GET /api/learnings/fingerprints (WI-197).
 *
 * The retro agent calls this to see the project's existing fingerprints (slug +
 * representative title + hit count) ranked by recency-weighted hit count, so it
 * can decide match-or-create instead of minting a duplicate slug.
 *
 * Behavior under test:
 * 1. Rows are grouped by fingerprint; each result carries the fingerprint, its
 *    pattern slug, a representative title, and the total hit count (row count).
 * 2. Results are ranked by recency-weighted hit count. The ranking assertions
 *    only rely on MONOTONIC properties the AC guarantees — equal counts rank the
 *    newer group first; equal recency ranks the higher count first — never on a
 *    specific decay formula (the item says "a simple monotonic decay is fine").
 * 3. Every status is included — capture never filters on status — so
 *    dismissed/resolved fingerprints still surface for matching.
 * 4. No learnings -> empty array with 200.
 * 5. Results are scoped to the X-Project-ID; a missing/invalid header -> 400.
 * 6. At most 50 fingerprints are returned.
 *
 * Convention: the route reads rows via prisma.retroLearning.findMany scoped by
 * projectId and groups + ranks in application code (recency decay is awkward in
 * SQLite SQL). Response envelope { success, data: FingerprintSummary[] } where
 * FingerprintSummary = { fingerprint, pattern, title, hitCount }, ranked
 * best-first (descending).
 */

const mockPrisma = vi.hoisted(() => ({
  retroLearning: {
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

import { GET } from '@/app/api/learnings/fingerprints/route';

function buildRequest(projectId: string | null): Request {
  const headers: Record<string, string> = {};
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  return new Request('http://localhost:3000/api/learnings/fingerprints', {
    method: 'GET',
    headers,
  });
}

let rowId = 1;

function row(
  fingerprint: string,
  opts: {
    projectId?: string;
    pattern?: string;
    title?: string;
    status?: string;
    createdAt?: Date;
  } = {}
) {
  return {
    id: rowId++,
    projectId: opts.projectId ?? 'project-a',
    missionId: null,
    source: 'stockwell',
    severity: 'high',
    attributedAgent: 'ba',
    targetSurface: 'agents/ba.md',
    pattern: opts.pattern ?? fingerprint,
    fingerprint,
    title: opts.title ?? `title:${fingerprint}`,
    detail: null,
    status: opts.status ?? 'open',
    proposalId: null,
    createdAt: opts.createdAt ?? new Date('2026-07-02T00:00:00.000Z'),
  };
}

describe('GET /api/learnings/fingerprints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rowId = 1;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups rows by fingerprint with total hit count and representative title, scoped to the project', async () => {
    mockPrisma.retroLearning.findMany.mockResolvedValue([
      row('fp-a', { title: 'A title', pattern: 'pat-a' }),
      row('fp-a', { title: 'A title', pattern: 'pat-a' }),
      row('fp-a', { title: 'A title', pattern: 'pat-a' }),
      row('fp-b', { title: 'B title', pattern: 'pat-b' }),
    ]);

    const res = await GET(buildRequest('project-a'));

    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);

    const a = data.find((d: { fingerprint: string }) => d.fingerprint === 'fp-a');
    const b = data.find((d: { fingerprint: string }) => d.fingerprint === 'fp-b');
    expect(a).toMatchObject({ fingerprint: 'fp-a', pattern: 'pat-a', title: 'A title', hitCount: 3 });
    expect(b).toMatchObject({ fingerprint: 'fp-b', pattern: 'pat-b', title: 'B title', hitCount: 1 });

    // The read must be scoped to the requesting project.
    expect(mockPrisma.retroLearning.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'project-a' } })
    );
  });

  it('ranks equal-count fingerprints by recency, newer activity first', async () => {
    const oldDate = new Date('2020-01-01T00:00:00.000Z');
    const newDate = new Date('2026-07-01T00:00:00.000Z');

    // Deliberately supply the older group first: a route that passed DB order
    // straight through (instead of ranking) would fail this.
    mockPrisma.retroLearning.findMany.mockResolvedValue([
      row('fp-old', { createdAt: oldDate }),
      row('fp-old', { createdAt: oldDate }),
      row('fp-new', { createdAt: newDate }),
      row('fp-new', { createdAt: newDate }),
    ]);

    const res = await GET(buildRequest('project-a'));
    const { data } = await res.json();

    // Equal raw counts (2 each) -> recency breaks the tie toward the newer group.
    expect(data.map((d: { fingerprint: string }) => d.fingerprint)).toEqual(['fp-new', 'fp-old']);
  });

  it('ranks a higher hit count above a lower one when recency is equal', async () => {
    const when = new Date('2026-07-01T00:00:00.000Z');

    mockPrisma.retroLearning.findMany.mockResolvedValue([
      row('fp-lo', { createdAt: when }),
      row('fp-hi', { createdAt: when }),
      row('fp-hi', { createdAt: when }),
      row('fp-hi', { createdAt: when }),
    ]);

    const res = await GET(buildRequest('project-a'));
    const { data } = await res.json();

    expect(data.map((d: { fingerprint: string }) => d.fingerprint)).toEqual(['fp-hi', 'fp-lo']);
    expect(data.find((d: { fingerprint: string }) => d.fingerprint === 'fp-hi').hitCount).toBe(3);
  });

  it('includes fingerprints of every status and never filters on status', async () => {
    const when = new Date('2026-07-01T00:00:00.000Z');

    mockPrisma.retroLearning.findMany.mockResolvedValue([
      row('fp-open', { status: 'open', createdAt: when }),
      row('fp-dismissed', { status: 'dismissed', createdAt: when }),
      row('fp-resolved', { status: 'resolved', createdAt: when }),
    ]);

    const res = await GET(buildRequest('project-a'));
    const { data } = await res.json();

    const fingerprints = data.map((d: { fingerprint: string }) => d.fingerprint);
    expect(fingerprints).toContain('fp-open');
    expect(fingerprints).toContain('fp-dismissed');
    expect(fingerprints).toContain('fp-resolved');

    // The query itself must not constrain status.
    const callArg = mockPrisma.retroLearning.findMany.mock.calls[0][0] ?? {};
    expect(callArg.where ?? {}).not.toHaveProperty('status');
  });

  it('returns an empty array with 200 when the project has no learnings', async () => {
    mockPrisma.retroLearning.findMany.mockResolvedValue([]);

    const res = await GET(buildRequest('empty-project'));

    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data).toEqual([]);
  });

  it('caps the result at 50 fingerprints, keeping the most recent by rank', async () => {
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const rows = [];
    for (let i = 0; i < 51; i++) {
      // Each fingerprint has a single hit; strictly increasing recency means
      // i=50 is newest and i=0 is oldest, so ranking is fully deterministic.
      rows.push(row(`fp-${i}`, { createdAt: new Date(base + i * 60_000) }));
    }
    mockPrisma.retroLearning.findMany.mockResolvedValue(rows);

    const res = await GET(buildRequest('project-a'));
    const { data } = await res.json();

    expect(data).toHaveLength(50);
    const fingerprints = data.map((d: { fingerprint: string }) => d.fingerprint);
    expect(fingerprints).toContain('fp-50'); // newest is kept
    expect(fingerprints).not.toContain('fp-0'); // oldest is dropped by the cap
  });

  it.each([
    ['missing', null],
    ['an empty string', ''],
    ['invalid (contains a space)', 'bad id'],
    ['invalid (contains punctuation)', 'proj!'],
  ])('returns 400 VALIDATION_ERROR when the X-Project-ID header is %s', async (_label, projectId) => {
    const res = await GET(buildRequest(projectId as string | null));

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.retroLearning.findMany).not.toHaveBeenCalled();
  });
});
