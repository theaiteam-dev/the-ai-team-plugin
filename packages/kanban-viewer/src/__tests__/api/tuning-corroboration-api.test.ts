import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { getCorroboration } from '@/lib/corroboration';
import { GET } from '@/app/api/tuning/corroboration/route';

/**
 * Integration tests for WI-212: the corroboration signal.
 *
 * Two surfaces are under test:
 *   1. getCorroboration(projectId, fingerprint) — the shared lib in
 *      packages/kanban-viewer/src/lib/corroboration.ts. It is the single source
 *      of truth for the ">=3 in-project OR >=1 cross-project" threshold that
 *      FR-8 resurfacing and FR-9/FR-15 promotion gating both depend on, so the
 *      threshold logic is asserted here directly rather than only through HTTP.
 *   2. GET /api/tuning/corroboration — a thin route wrapper over getCorroboration
 *      (X-Project-ID + fingerprint validation, envelope), following the
 *      src/app/api/learnings/rank/route.ts conventions.
 *
 * These run against the real SQLite dev DB (like the rank/schema tests) ON
 * PURPOSE: the ACs — in-project COUNT, cross-project presence, and the derived
 * corroborated flag — all execute inside the DB query. A mocked Prisma client
 * would return whatever rows the test handed it, so deleting the cross-project
 * scoping or miscounting would not fail a mocked test. Seeding real rows across
 * two projects and asserting the aggregate is the only way to verify the ACs.
 *
 * Rows are inserted directly via the Prisma client (not the capture route), so
 * the ownership guard on POST /api/learnings does not apply here.
 *
 * Envelope: the route follows the rank sibling — { success: true, data: {...} }
 * where data = { inProjectHits, crossProject, corroborated }.
 */

const P1 = 'test-corrob-p1';
const P2 = 'test-corrob-p2';
const FP = 'api-input-validation-depth';

async function seed(
  projectId: string,
  fingerprint: string,
  opts: { title?: string; detail?: string | null; status?: string } = {}
) {
  return prisma.retroLearning.create({
    data: {
      projectId,
      // missionId stays null so the @@unique([projectId, missionId, fingerprint])
      // constraint (NULLs distinct in SQLite) lets us stack many rows of one
      // fingerprint in one project to exercise the in-project hit count.
      missionId: null,
      source: 'stockwell',
      severity: 'high',
      attributedAgent: 'ba',
      targetSurface: `surface:${fingerprint}`,
      pattern: `pat:${fingerprint}`,
      fingerprint,
      title: opts.title ?? `title:${fingerprint}`,
      detail: opts.detail ?? null,
      status: opts.status ?? 'open',
    },
  });
}

function buildRequest(
  projectId: string | null,
  fingerprint: string | null | undefined
): Request {
  const url = new URL('http://localhost:3000/api/tuning/corroboration');
  // `undefined` -> omit the param entirely; '' -> present but empty.
  if (fingerprint !== undefined && fingerprint !== null) {
    url.searchParams.set('fingerprint', fingerprint);
  }
  const headers: Record<string, string> = {};
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  return new Request(url.toString(), { method: 'GET', headers });
}

beforeEach(async () => {
  for (const id of [P1, P2]) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: { id, name: `Corroboration Test Project ${id}` },
    });
  }
  await prisma.retroLearning.deleteMany({ where: { projectId: { in: [P1, P2] } } });
});

describe('getCorroboration(projectId, fingerprint)', () => {
  it('returns all-zero/false for a fingerprint with no rows anywhere', async () => {
    const result = await getCorroboration(P1, FP);
    expect(result).toEqual({ inProjectHits: 0, crossProject: false, corroborated: false });
  });

  it('is not corroborated at 2 in-project hits with no cross-project rows', async () => {
    await seed(P1, FP);
    await seed(P1, FP);

    const result = await getCorroboration(P1, FP);
    expect(result).toMatchObject({ inProjectHits: 2, crossProject: false, corroborated: false });
  });

  it('is corroborated at 3 in-project hits via the >=3 threshold alone (no cross-project)', async () => {
    await seed(P1, FP);
    await seed(P1, FP);
    await seed(P1, FP);

    const result = await getCorroboration(P1, FP);
    expect(result).toMatchObject({ inProjectHits: 3, crossProject: false, corroborated: true });
  });

  it('is corroborated at 1 in-project hit when the same fingerprint exists under another project', async () => {
    await seed(P1, FP);
    await seed(P2, FP);

    const result = await getCorroboration(P1, FP);
    expect(result).toMatchObject({ inProjectHits: 1, crossProject: true, corroborated: true });
  });

  it('is corroborated purely on cross-project presence when the requesting project has zero rows', async () => {
    await seed(P2, FP);

    const result = await getCorroboration(P1, FP);
    expect(result).toMatchObject({ inProjectHits: 0, crossProject: true, corroborated: true });
  });

  it('never sets crossProject from the requesting project\'s own rows, even at high hit counts', async () => {
    // 10 rows, all in P1, none elsewhere: crossProject counts ONLY rows whose
    // projectId differs from the requester, so it must stay false regardless of
    // how many in-project rows exist (tenant isolation of the signal).
    for (let i = 0; i < 10; i++) await seed(P1, FP);

    const result = await getCorroboration(P1, FP);
    expect(result).toMatchObject({ inProjectHits: 10, crossProject: false });
  });

  it('counts only the requested fingerprint, not other fingerprints in the project', async () => {
    await seed(P1, FP);
    await seed(P1, 'some-other-fingerprint');
    await seed(P1, 'some-other-fingerprint');

    const result = await getCorroboration(P1, FP);
    expect(result.inProjectHits).toBe(1);
  });
});

describe('GET /api/tuning/corroboration', () => {
  it('returns 200 with the corroboration object for a valid fingerprint + X-Project-ID', async () => {
    await seed(P1, FP);
    await seed(P1, FP);
    await seed(P1, FP);

    const res = await GET(buildRequest(P1, FP));

    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data).toMatchObject({ inProjectHits: 3, crossProject: false, corroborated: true });
  });

  it('reflects cross-project corroboration through the route', async () => {
    await seed(P1, FP);
    await seed(P2, FP);

    const res = await GET(buildRequest(P1, FP));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ inProjectHits: 1, crossProject: true, corroborated: true });
  });

  it('never leaks any other project\'s row fields — only the aggregate counts and the flag', async () => {
    // A cross-project row with distinctive title/detail must contribute to the
    // signal (crossProject:true) without any of its content appearing in the
    // response body (NFR-4 tenant isolation: counts, not row content).
    const SECRET_TITLE = 'LEAK-CANARY-TITLE-p2';
    const SECRET_DETAIL = 'LEAK-CANARY-DETAIL-p2';
    await seed(P1, FP);
    await seed(P2, FP, { title: SECRET_TITLE, detail: SECRET_DETAIL });

    const res = await GET(buildRequest(P1, FP));
    expect(res.status).toBe(200);

    const bodyText = JSON.stringify(await res.clone().json());
    expect(bodyText).not.toContain(SECRET_TITLE);
    expect(bodyText).not.toContain(SECRET_DETAIL);
    expect(bodyText).not.toContain(P2);

    const { data } = await res.json();
    expect(Object.keys(data).sort()).toEqual(['corroborated', 'crossProject', 'inProjectHits']);
    expect(data).toMatchObject({ inProjectHits: 1, crossProject: true, corroborated: true });
  });

  it.each([
    ['missing', undefined],
    ['an empty string', ''],
  ])('returns 400 VALIDATION_ERROR when the fingerprint param is %s', async (_label, fingerprint) => {
    const res = await GET(buildRequest(P1, fingerprint as string | undefined));

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['missing', null],
    ['an empty string', ''],
    ['invalid (contains a space)', 'bad id'],
    ['invalid (contains punctuation)', 'proj!'],
  ])('returns 400 VALIDATION_ERROR when the X-Project-ID header is %s', async (_label, projectId) => {
    const res = await GET(buildRequest(projectId as string | null, FP));

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
  });
});
