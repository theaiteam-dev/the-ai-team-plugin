import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/lib/db';
import { GET } from '@/app/api/tuning/candidates/route';

/**
 * Integration tests for GET /api/tuning/candidates — the tuning walk's
 * ordered list (FR-8), updated for the collapsed verb set's durable defer
 * watermark (reject/demote and the old Fingerprint.status dismiss/resurface
 * toggle are gone).
 *
 * The route returns recurrence-ranked GLOBAL fingerprints (across every
 * project — tuning improves the plugin itself, a surface shared by every
 * installation): >=1 open/recurred learning, hits = full historical row
 * count incl resolved/dismissed, ordered by hits DESC, each row carrying
 * `distinctMissions`/`corroborated`/`deferredAtMissions`/`actionable`. Every
 * candidate is always listed — deferring a fingerprint never removes it from
 * this response, it only flips `actionable` to false until distinctMissions
 * climbs DEFER_MARGIN past the watermark recorded at defer time.
 * ?actionable=true restricts the response to `actionable: true` rows only.
 *
 * These run against the real SQLite dev DB ON PURPOSE: the ACs — recurrence
 * grouping and the watermark-vs-distinctMissions comparison — all execute
 * inside DB queries. A mocked Prisma client would return whatever rows the
 * test handed it, so deleting the watermark filter or the corroboration
 * threshold would not fail a mocked test.
 *
 * Every RetroLearning.fingerprint is a real FK to Fingerprint.slug, so every
 * fingerprint used here is seeded as a Fingerprint row first (never deferred
 * by default, or deferred at a given watermark where the test needs it).
 */

const PROJECT_ID = 'test-candidates-project';
const OTHER_PROJECT_ID = 'test-candidates-project-other';

// Every fingerprint slug used anywhere in this file — Fingerprint is global
// now (no projectId), so it must be cleaned up by name in beforeEach or it
// accumulates across repeated `npm test` runs against the real dev DB.
const TEST_FINGERPRINTS = [
  'fp-hot',
  'fp-cold',
  'fp-live',
  'fp-corroborated',
  'fp-deferred',
  'fp-resurf',
  'fp-actionable',
  'fp-not-yet',
  'fp-still-deferred',
];

function buildRequest(projectId: string | null, query: Record<string, string> = {}): Request {
  const url = new URL('http://localhost:3000/api/tuning/candidates');
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  const headers: Record<string, string> = {};
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  return new Request(url.toString(), { method: 'GET', headers });
}

async function seedFingerprint(slug: string, opts: { deferredAtMissions?: number | null } = {}) {
  return prisma.fingerprint.upsert({
    where: { slug },
    update: { deferredAtMissions: opts.deferredAtMissions ?? null },
    create: {
      slug,
      pattern: `pat:${slug}`,
      severity: 'medium',
      deferredAtMissions: opts.deferredAtMissions ?? null,
    },
  });
}

async function seedMission(projectId: string, missionId: string) {
  return prisma.mission.upsert({
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

async function seedLearning(
  projectId: string,
  fingerprint: string,
  opts: {
    status?: string;
    missionId?: string | null;
    severity?: string;
    pattern?: string;
    targetSurface?: string;
  } = {}
) {
  return prisma.retroLearning.create({
    data: {
      projectId,
      missionId: opts.missionId ?? null,
      source: 'stockwell',
      severity: opts.severity ?? 'high',
      attributedAgent: 'ba',
      targetSurface: opts.targetSurface ?? `surface:${fingerprint}`,
      pattern: opts.pattern ?? `pat:${fingerprint}`,
      fingerprint,
      title: `title:${fingerprint}`,
      detail: null,
      status: opts.status ?? 'open',
    },
  });
}

beforeEach(async () => {
  for (const id of [PROJECT_ID, OTHER_PROJECT_ID]) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: { id, name: `Candidates Test Project ${id}` },
    });
  }
  await prisma.retroLearning.deleteMany({
    where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
  });
  await prisma.fingerprint.deleteMany({ where: { slug: { in: TEST_FINGERPRINTS } } });
  await prisma.mission.deleteMany({
    where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
  });
});

describe('GET /api/tuning/candidates', () => {
  it('ranks live fingerprints globally by full-history hits DESC, carries distinctMissions/corroborated/actionable, and never defers by default', async () => {
    await seedFingerprint('fp-hot');
    await seedFingerprint('fp-cold');
    // fp-hot recurred across history: 2 resolved + 1 recurred = 3 hits (full
    // history weight, incl resolved), qualifies via its recurred row. Only 1
    // distinct mission -> not corroborated -> not actionable.
    await seedMission(PROJECT_ID, 'M-hot');
    await seedLearning(PROJECT_ID, 'fp-hot', { status: 'resolved', missionId: 'M-hot' });
    await seedLearning(PROJECT_ID, 'fp-hot', { status: 'resolved', missionId: null });
    await seedLearning(PROJECT_ID, 'fp-hot', { status: 'recurred', missionId: null });
    // fp-cold: a single open hit.
    await seedLearning(PROJECT_ID, 'fp-cold', { status: 'open' });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);

    // The candidate set is GLOBAL, so the real dev DB may carry unrelated
    // fingerprints from other tests/usage — assert on OUR two entries and
    // their relative order rather than the full array.
    type Row = {
      fingerprint: string;
      hits: number;
      distinctMissions: number;
      corroborated: boolean;
      deferredAtMissions: number | null;
      actionable: boolean;
    };
    const fingerprints = data.map((r: Row) => r.fingerprint);
    const hotIndex = fingerprints.indexOf('fp-hot');
    const coldIndex = fingerprints.indexOf('fp-cold');
    expect(hotIndex).toBeGreaterThanOrEqual(0);
    expect(coldIndex).toBeGreaterThanOrEqual(0);
    expect(hotIndex).toBeLessThan(coldIndex);

    const hot = data.find((r: Row) => r.fingerprint === 'fp-hot');
    const cold = data.find((r: Row) => r.fingerprint === 'fp-cold');
    expect(hot).toMatchObject({
      hits: 3,
      distinctMissions: 1,
      corroborated: false,
      deferredAtMissions: null,
      actionable: false,
    });
    expect(cold).toMatchObject({ hits: 1, deferredAtMissions: null });
  });

  it('marks a never-deferred corroborated fingerprint actionable, and lists it (not excluded) even though it has never been deferred', async () => {
    await seedFingerprint('fp-live');
    await seedLearning(PROJECT_ID, 'fp-live', { status: 'open' });

    await seedFingerprint('fp-corroborated');
    await seedMission(PROJECT_ID, 'M-corrob-a');
    await seedMission(PROJECT_ID, 'M-corrob-b');
    await seedMission(PROJECT_ID, 'M-corrob-c');
    await seedLearning(PROJECT_ID, 'fp-corroborated', { status: 'open', missionId: 'M-corrob-a' });
    await seedLearning(PROJECT_ID, 'fp-corroborated', { status: 'open', missionId: 'M-corrob-b' });
    await seedLearning(PROJECT_ID, 'fp-corroborated', { status: 'open', missionId: 'M-corrob-c' });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    const fingerprints = data.map((r: { fingerprint: string }) => r.fingerprint);
    expect(fingerprints).toContain('fp-live');
    expect(fingerprints).toContain('fp-corroborated');
    const corroborated = data.find((r: { fingerprint: string }) => r.fingerprint === 'fp-corroborated');
    expect(corroborated).toMatchObject({ corroborated: true, actionable: true, deferredAtMissions: null });
  });

  it('a deferred fingerprint below watermark+DEFER_MARGIN is listed (never hidden) but marked actionable:false', async () => {
    // Deferred at distinctMissions=3 (the watermark). Still only 3 distinct
    // missions now, spanning two DIFFERENT projects — corroborated globally,
    // but below the watermark+DEFER_MARGIN(2)=5 resurface bar.
    await seedFingerprint('fp-deferred', { deferredAtMissions: 3 });
    await seedMission(PROJECT_ID, 'M-def-a');
    await seedMission(PROJECT_ID, 'M-def-b');
    await seedMission(OTHER_PROJECT_ID, 'M-def-c');
    await seedLearning(PROJECT_ID, 'fp-deferred', { status: 'resolved', missionId: 'M-def-a' });
    await seedLearning(PROJECT_ID, 'fp-deferred', { status: 'open', missionId: 'M-def-b' });
    await seedLearning(OTHER_PROJECT_ID, 'fp-deferred', { status: 'open', missionId: 'M-def-c' });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    const entry = data.find((r: { fingerprint: string }) => r.fingerprint === 'fp-deferred');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      fingerprint: 'fp-deferred',
      hits: 3,
      distinctMissions: 3,
      corroborated: true,
      deferredAtMissions: 3,
      actionable: false,
    });
  });

  it('a deferred fingerprint becomes actionable again once distinctMissions climbs DEFER_MARGIN past the watermark', async () => {
    // Deferred at distinctMissions=3; now at 5 (3 + DEFER_MARGIN(2)) -> back
    // over the resurface bar -> actionable again.
    await seedFingerprint('fp-resurf', { deferredAtMissions: 3 });

    await seedMission(PROJECT_ID, 'M-resurf-a');
    await seedMission(PROJECT_ID, 'M-resurf-b');
    await seedMission(OTHER_PROJECT_ID, 'M-resurf-c');
    await seedMission(PROJECT_ID, 'M-resurf-d');
    await seedMission(PROJECT_ID, 'M-resurf-e');
    await seedLearning(PROJECT_ID, 'fp-resurf', { status: 'resolved', missionId: 'M-resurf-a' });
    await seedLearning(PROJECT_ID, 'fp-resurf', { status: 'open', missionId: 'M-resurf-b' });
    await seedLearning(OTHER_PROJECT_ID, 'fp-resurf', { status: 'open', missionId: 'M-resurf-c' });
    await seedLearning(PROJECT_ID, 'fp-resurf', { status: 'open', missionId: 'M-resurf-d' });
    await seedLearning(PROJECT_ID, 'fp-resurf', { status: 'open', missionId: 'M-resurf-e' });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    const entry = data.find((r: { fingerprint: string }) => r.fingerprint === 'fp-resurf');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      fingerprint: 'fp-resurf',
      hits: 5,
      distinctMissions: 5,
      corroborated: true,
      deferredAtMissions: 3,
      actionable: true,
    });
  });

  it('?actionable=true restricts the response to actionable:true rows only (corroborated AND past any defer watermark)', async () => {
    await seedFingerprint('fp-actionable');
    await seedFingerprint('fp-not-yet');
    // fp-still-deferred: corroborated (3 distinct missions) but deferred at
    // watermark=3 with no new evidence since -> not actionable.
    await seedFingerprint('fp-still-deferred', { deferredAtMissions: 3 });
    await seedMission(PROJECT_ID, 'M-action-a');
    await seedMission(PROJECT_ID, 'M-action-b');
    await seedMission(PROJECT_ID, 'M-action-c');
    await seedLearning(PROJECT_ID, 'fp-actionable', { status: 'open', missionId: 'M-action-a' });
    await seedLearning(PROJECT_ID, 'fp-actionable', { status: 'open', missionId: 'M-action-b' });
    await seedLearning(PROJECT_ID, 'fp-actionable', { status: 'open', missionId: 'M-action-c' });
    await seedLearning(PROJECT_ID, 'fp-not-yet', { status: 'open', missionId: 'M-action-a' });
    await seedLearning(PROJECT_ID, 'fp-still-deferred', { status: 'open', missionId: 'M-action-a' });
    await seedLearning(PROJECT_ID, 'fp-still-deferred', { status: 'open', missionId: 'M-action-b' });
    await seedLearning(PROJECT_ID, 'fp-still-deferred', { status: 'open', missionId: 'M-action-c' });

    const resAll = await GET(buildRequest(PROJECT_ID));
    const { data: allData } = await resAll.json();
    expect(allData.map((r: { fingerprint: string }) => r.fingerprint)).toEqual(
      expect.arrayContaining(['fp-actionable', 'fp-not-yet', 'fp-still-deferred'])
    );

    const resActionable = await GET(buildRequest(PROJECT_ID, { actionable: 'true' }));
    expect(resActionable.status).toBe(200);
    const { data } = await resActionable.json();
    // The candidate set is GLOBAL, so the real dev DB may carry other
    // already-actionable fingerprints — assert on OUR three entries rather
    // than the full array length.
    type Row = { fingerprint: string; actionable: boolean };
    const ourFingerprints = data
      .filter((r: Row) => ['fp-actionable', 'fp-not-yet', 'fp-still-deferred'].includes(r.fingerprint))
      .map((r: Row) => r.fingerprint);
    expect(ourFingerprints).toEqual(['fp-actionable']);
    expect(data.every((r: Row) => r.actionable)).toBe(true);
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
  });

  it('imports the corroboration threshold and defer margin from the shared lib rather than re-deriving them', async () => {
    // The route MUST import CORROBORATION_THRESHOLD and DEFER_MARGIN from the
    // shared lib and never re-derive either locally (single-source-of-truth
    // constraint).
    const routeSource = readFileSync(
      join(process.cwd(), 'src/app/api/tuning/candidates/route.ts'),
      'utf-8'
    );
    expect(routeSource).toMatch(/from ['"]@\/lib\/corroboration['"]/);
    expect(routeSource).toMatch(/CORROBORATION_THRESHOLD/);
    expect(routeSource).toMatch(/DEFER_MARGIN/);
  });
});
