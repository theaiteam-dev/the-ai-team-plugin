import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { GET } from '@/app/api/learnings/rank/route';

/**
 * Integration tests for GET /api/learnings/rank (WI-198).
 *
 * This is the FR-6 recurrence-rank read surface: GROUP BY fingerprint,
 * HAVING SUM(status IN ('open','recurred')) > 0, ORDER BY hits DESC — where
 * hits = COUNT of ALL rows of the fingerprint (full history weight).
 *
 * These run against the real SQLite dev DB (like the RetroLearning schema test)
 * rather than a mocked Prisma client ON PURPOSE: the ACs under test — status
 * exclusion (HAVING), full-history COUNT, and recurrence ordering — all execute
 * inside the aggregation query. A mocked client would return whatever rows the
 * test handed it, so deleting the HAVING/ORDER BY clause would not fail a mocked
 * test. Seeding real rows and asserting the ranked HTTP output is the only way
 * to verify the aggregation actually does what the ACs require.
 *
 * Rows are inserted directly via the Prisma client (not the capture route), so
 * the ownership guard on POST /api/learnings does not apply here.
 *
 * Response envelope: { success, data: RankRow[] } where
 * RankRow = { fingerprint, pattern, targetSurface, severity, hits }, ordered by
 * hits DESC.
 */

const PROJECT_ID = 'test-rank-project';
const OTHER_PROJECT_ID = 'test-rank-project-other';
const EMPTY_PROJECT_ID = 'test-rank-project-empty';
const MISSION_IDS = ['m-rank-1', 'm-rank-2', 'm-rank-3'];

function buildRequest(projectId: string | null): Request {
  const headers: Record<string, string> = {};
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  return new Request('http://localhost:3000/api/learnings/rank', {
    method: 'GET',
    headers,
  });
}

async function seed(
  projectId: string,
  fingerprint: string,
  status: string,
  opts: {
    missionId?: string | null;
    pattern?: string;
    targetSurface?: string;
    severity?: string;
    createdAt?: Date;
  } = {}
) {
  // RetroLearning.fingerprint is a real FK to Fingerprint.slug (Phase A's
  // global_fingerprint_tuning migration) — ensure the parent row exists
  // before inserting a learning that references it.
  await prisma.fingerprint.upsert({
    where: { slug: fingerprint },
    update: {},
    create: { slug: fingerprint, pattern: opts.pattern ?? `pat:${fingerprint}`, severity: opts.severity ?? 'high' },
  });

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
      status,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

beforeEach(async () => {
  for (const id of [PROJECT_ID, OTHER_PROJECT_ID, EMPTY_PROJECT_ID]) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: { id, name: `Rank Test Project ${id}` },
    });
  }

  for (const id of MISSION_IDS) {
    await prisma.mission.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name: `Rank Test Mission ${id}`,
        state: 'running',
        prdPath: '/prd/test.md',
        projectId: PROJECT_ID,
        startedAt: new Date(),
      },
    });
  }

  await prisma.retroLearning.deleteMany({
    where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID, EMPTY_PROJECT_ID] } },
  });
});

describe('GET /api/learnings/rank', () => {
  it('ranks fingerprints by total hit count DESC with the expected fields', async () => {
    // One fingerprint recurring across 3 missions (3 rows) must outrank a
    // single-hit fingerprint (recurrence ranking, not per-mission priority).
    await seed(PROJECT_ID, 'fp-three', 'open', {
      missionId: MISSION_IDS[0],
      pattern: 'pat-three',
      targetSurface: 'agents/ba.md',
      severity: 'critical',
    });
    await seed(PROJECT_ID, 'fp-three', 'open', {
      missionId: MISSION_IDS[1],
      pattern: 'pat-three',
      targetSurface: 'agents/ba.md',
      severity: 'critical',
    });
    await seed(PROJECT_ID, 'fp-three', 'open', {
      missionId: MISSION_IDS[2],
      pattern: 'pat-three',
      targetSurface: 'agents/ba.md',
      severity: 'critical',
    });
    await seed(PROJECT_ID, 'fp-one', 'open', { missionId: MISSION_IDS[0] });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data.map((r: { fingerprint: string }) => r.fingerprint)).toEqual(['fp-three', 'fp-one']);

    expect(data[0]).toMatchObject({
      fingerprint: 'fp-three',
      pattern: 'pat-three',
      targetSurface: 'agents/ba.md',
      severity: 'critical',
      hits: 3,
    });
    expect(data[1]).toMatchObject({ fingerprint: 'fp-one', hits: 1 });
  });

  it('returns only fingerprints with at least one open or recurred row, excluding fully resolved/dismissed ones', async () => {
    await seed(PROJECT_ID, 'fp-live', 'open', { missionId: MISSION_IDS[0] });
    // fp-dead has no open/recurred row -> excluded by HAVING SUM(open|recurred) > 0.
    await seed(PROJECT_ID, 'fp-dead', 'resolved', { missionId: MISSION_IDS[0] });
    await seed(PROJECT_ID, 'fp-dead', 'dismissed', { missionId: MISSION_IDS[1] });

    const res = await GET(buildRequest(PROJECT_ID));
    const { data } = await res.json();

    const fingerprints = data.map((r: { fingerprint: string }) => r.fingerprint);
    expect(fingerprints).toContain('fp-live');
    expect(fingerprints).not.toContain('fp-dead');
  });

  it('counts ALL rows (full history weight) once a fingerprint has re-recurred, not just the live row', async () => {
    // Shipped twice (resolved), then recurred: qualifies via the recurred row and
    // re-enters at its full historical count of 3, not 1.
    await seed(PROJECT_ID, 'fp-recurred', 'resolved', { missionId: MISSION_IDS[0] });
    await seed(PROJECT_ID, 'fp-recurred', 'resolved', { missionId: MISSION_IDS[1] });
    await seed(PROJECT_ID, 'fp-recurred', 'recurred', { missionId: MISSION_IDS[2] });
    // A fresher fingerprint with 2 all-open hits must rank below the 3-hit one.
    await seed(PROJECT_ID, 'fp-fresh', 'open', { missionId: MISSION_IDS[0] });
    await seed(PROJECT_ID, 'fp-fresh', 'open', { missionId: MISSION_IDS[1] });

    const res = await GET(buildRequest(PROJECT_ID));
    const { data } = await res.json();

    expect(data.map((r: { fingerprint: string }) => r.fingerprint)).toEqual(['fp-recurred', 'fp-fresh']);
    const recurred = data.find((r: { fingerprint: string }) => r.fingerprint === 'fp-recurred');
    expect(recurred.hits).toBe(3);
  });

  it('reports the max-ordinal severity and the most-recent pattern/targetSurface for a fingerprint whose severity escalated on recurrence, not the first-filed row', async () => {
    // Mirrors the gitignore-db corpus case: filed `low` first, then refiled
    // `critical` weeks later with a drifted pattern/targetSurface. rank must
    // surface what's currently hottest (critical) and the latest surface, not
    // the stale low-severity first insert.
    await seed(PROJECT_ID, 'fp-escalated', 'open', {
      missionId: MISSION_IDS[0],
      severity: 'low',
      pattern: 'pat-first-filed',
      targetSurface: 'agents/old-surface.md',
      createdAt: new Date('2026-05-17T00:00:00.000Z'),
    });
    await seed(PROJECT_ID, 'fp-escalated', 'open', {
      missionId: MISSION_IDS[1],
      severity: 'critical',
      pattern: 'pat-recurred',
      targetSurface: 'agents/new-surface.md',
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
    });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    const group = data.find((r: { fingerprint: string }) => r.fingerprint === 'fp-escalated');
    expect(group).toMatchObject({
      fingerprint: 'fp-escalated',
      severity: 'critical',
      pattern: 'pat-recurred',
      targetSurface: 'agents/new-surface.md',
      hits: 2,
    });
  });

  it('scopes results to the requesting project', async () => {
    await seed(PROJECT_ID, 'fp-mine', 'open', { missionId: MISSION_IDS[0] });
    await seed(OTHER_PROJECT_ID, 'fp-theirs', 'open', { missionId: null });

    const res = await GET(buildRequest(PROJECT_ID));
    const { data } = await res.json();

    const fingerprints = data.map((r: { fingerprint: string }) => r.fingerprint);
    expect(fingerprints).toContain('fp-mine');
    expect(fingerprints).not.toContain('fp-theirs');
  });

  it('returns an empty array with 200 for a project with no learnings', async () => {
    const res = await GET(buildRequest(EMPTY_PROJECT_ID));

    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data).toEqual([]);
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
});
