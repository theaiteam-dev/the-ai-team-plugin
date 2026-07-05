import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { getCorroboration, CORROBORATION_THRESHOLD } from '@/lib/corroboration';
import { GET } from '@/app/api/tuning/corroboration/route';

/**
 * Integration tests for the Phase A corroboration signal (global,
 * fingerprint-centric — see /tmp/.../phase-a-spec.md "Target model").
 *
 * Two surfaces are under test:
 *   1. getCorroboration(fingerprint) — the shared lib in
 *      packages/kanban-viewer/src/lib/corroboration.ts. It is the single
 *      source of truth for the corroboration threshold: a fingerprint is
 *      corroborated once its learnings span CORROBORATION_THRESHOLD (3)
 *      DISTINCT missions, GLOBALLY (no project split, no per-project
 *      counting) — rows with a null missionId (backfill rows) never count.
 *   2. GET /api/tuning/corroboration — a thin route wrapper over
 *      getCorroboration (X-Project-ID + fingerprint validation, envelope).
 *      The project header is still required for auth consistency with the
 *      rest of the API, but it does NOT scope the corroboration count.
 *
 * These run against the real SQLite dev DB ON PURPOSE: the ACs — the
 * DISTINCT missionId aggregation and the derived corroborated flag — all
 * execute inside the DB query. A mocked Prisma client would return whatever
 * rows the test handed it, so miscounting or losing the missionId-NOT-NULL
 * filter would not fail a mocked test.
 *
 * Rows are inserted directly via the Prisma client (not the capture route),
 * so the ownership guard on POST /api/learnings does not apply here. Each
 * RetroLearning row's `fingerprint` is a real FK to Fingerprint.slug (Stage 1
 * migration), so every fingerprint used here is seeded first.
 */

const P1 = 'test-corrob-p1';
const P2 = 'test-corrob-p2';
const FP = 'api-input-validation-depth';

async function seedFingerprint(slug: string) {
  return prisma.fingerprint.upsert({
    where: { slug },
    update: {},
    create: { slug, pattern: `pat:${slug}`, severity: 'medium' },
  });
}

async function seed(
  projectId: string,
  fingerprint: string,
  opts: { missionId?: string | null; title?: string; detail?: string | null; status?: string } = {}
) {
  return prisma.retroLearning.create({
    data: {
      projectId,
      missionId: opts.missionId ?? null,
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

async function seedMission(projectId: string, missionId: string) {
  await prisma.mission.upsert({
    where: { id: missionId },
    update: {},
    create: {
      id: missionId,
      name: `Mission ${missionId}`,
      state: 'running',
      prdPath: '/prd/test.md',
      projectId,
      startedAt: new Date(),
    },
  });
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
  await prisma.mission.deleteMany({ where: { projectId: { in: [P1, P2] } } });
  await seedFingerprint(FP);
});

describe('getCorroboration(fingerprint)', () => {
  it('returns zero/false for a fingerprint with no rows anywhere', async () => {
    const result = await getCorroboration(FP);
    expect(result).toEqual({ distinctMissions: 0, corroborated: false });
  });

  it('excludes rows with a null missionId from the distinct-mission count', async () => {
    await seed(P1, FP, { missionId: null });
    await seed(P1, FP, { missionId: null });
    await seed(P1, FP, { missionId: null });

    const result = await getCorroboration(FP);
    expect(result).toEqual({ distinctMissions: 0, corroborated: false });
  });

  it('is not corroborated at 2 distinct missions', async () => {
    await seedMission(P1, 'M-corrob-1');
    await seedMission(P1, 'M-corrob-2');
    await seed(P1, FP, { missionId: 'M-corrob-1' });
    await seed(P1, FP, { missionId: 'M-corrob-2' });

    const result = await getCorroboration(FP);
    expect(result).toMatchObject({ distinctMissions: 2, corroborated: false });
  });

  it('is corroborated at exactly the threshold (3) distinct missions in ONE project', async () => {
    await seedMission(P1, 'M-corrob-3a');
    await seedMission(P1, 'M-corrob-3b');
    await seedMission(P1, 'M-corrob-3c');
    await seed(P1, FP, { missionId: 'M-corrob-3a' });
    await seed(P1, FP, { missionId: 'M-corrob-3b' });
    await seed(P1, FP, { missionId: 'M-corrob-3c' });

    const result = await getCorroboration(FP);
    expect(result).toEqual({ distinctMissions: 3, corroborated: true });
  });

  it('is corroborated at the threshold when the 3 distinct missions span TWO different projects (global, not per-project)', async () => {
    await seedMission(P1, 'M-corrob-cross-a');
    await seedMission(P1, 'M-corrob-cross-b');
    await seedMission(P2, 'M-corrob-cross-c');
    await seed(P1, FP, { missionId: 'M-corrob-cross-a' });
    await seed(P1, FP, { missionId: 'M-corrob-cross-b' });
    await seed(P2, FP, { missionId: 'M-corrob-cross-c' });

    const result = await getCorroboration(FP);
    expect(result).toEqual({ distinctMissions: 3, corroborated: true });
  });

  it('does not double-count multiple rows from the same mission (distinct, not row count)', async () => {
    await seedMission(P1, 'M-corrob-dup');
    // Two learnings referencing the SAME mission (one per project, since
    // @@unique([projectId, missionId, fingerprint]) forbids a second row for
    // the identical (project, mission, fingerprint) triple) — still just 1
    // distinct mission for the corroboration count.
    await seed(P1, FP, { missionId: 'M-corrob-dup' });
    await seed(P2, FP, { missionId: 'M-corrob-dup' });

    const result = await getCorroboration(FP);
    expect(result).toMatchObject({ distinctMissions: 1, corroborated: false });
  });

  it('counts only the requested fingerprint, not other fingerprints', async () => {
    await seedFingerprint('some-other-fingerprint');
    await seedMission(P1, 'M-corrob-scope-a');
    await seedMission(P1, 'M-corrob-scope-b');
    await seedMission(P1, 'M-corrob-scope-c');
    await seed(P1, FP, { missionId: 'M-corrob-scope-a' });
    await seed(P1, 'some-other-fingerprint', { missionId: 'M-corrob-scope-b' });
    await seed(P1, 'some-other-fingerprint', { missionId: 'M-corrob-scope-c' });

    const result = await getCorroboration(FP);
    expect(result.distinctMissions).toBe(1);
  });

  it('exports CORROBORATION_THRESHOLD as the single source of truth (currently 3)', () => {
    expect(CORROBORATION_THRESHOLD).toBe(3);
  });
});

describe('GET /api/tuning/corroboration', () => {
  it('returns 200 with the corroboration object for a valid fingerprint + X-Project-ID', async () => {
    await seedMission(P1, 'M-route-a');
    await seedMission(P1, 'M-route-b');
    await seedMission(P1, 'M-route-c');
    await seed(P1, FP, { missionId: 'M-route-a' });
    await seed(P1, FP, { missionId: 'M-route-b' });
    await seed(P1, FP, { missionId: 'M-route-c' });

    const res = await GET(buildRequest(P1, FP));

    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data).toEqual({ distinctMissions: 3, corroborated: true });
  });

  it('is not scoped by the requesting project — the count reflects missions across every project', async () => {
    await seedMission(P1, 'M-route-global-a');
    await seedMission(P2, 'M-route-global-b');
    await seed(P1, FP, { missionId: 'M-route-global-a' });
    await seed(P2, FP, { missionId: 'M-route-global-b' });

    const resFromP1 = await GET(buildRequest(P1, FP));
    const resFromP2 = await GET(buildRequest(P2, FP));

    const { data: dataFromP1 } = await resFromP1.json();
    const { data: dataFromP2 } = await resFromP2.json();
    expect(dataFromP1).toEqual({ distinctMissions: 2, corroborated: false });
    expect(dataFromP2).toEqual(dataFromP1);
  });

  it('never leaks any other project\'s row fields — only the aggregate counts and the flag', async () => {
    const SECRET_TITLE = 'LEAK-CANARY-TITLE-p2';
    const SECRET_DETAIL = 'LEAK-CANARY-DETAIL-p2';
    await seedMission(P1, 'M-leak-a');
    await seedMission(P2, 'M-leak-b');
    await seed(P1, FP, { missionId: 'M-leak-a' });
    await seed(P2, FP, { missionId: 'M-leak-b', title: SECRET_TITLE, detail: SECRET_DETAIL });

    const res = await GET(buildRequest(P1, FP));
    expect(res.status).toBe(200);

    const bodyText = JSON.stringify(await res.clone().json());
    expect(bodyText).not.toContain(SECRET_TITLE);
    expect(bodyText).not.toContain(SECRET_DETAIL);

    const { data } = await res.json();
    expect(Object.keys(data).sort()).toEqual(['corroborated', 'distinctMissions']);
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
