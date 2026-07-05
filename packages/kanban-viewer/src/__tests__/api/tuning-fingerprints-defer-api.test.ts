import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { POST } from '@/app/api/tuning/fingerprints/[slug]/defer/route';

/**
 * Integration tests for POST /api/tuning/fingerprints/{slug}/defer — the
 * collapsed verb set's durable "not now" (FR-8), replacing the old
 * reject/demote verbs.
 *
 * Unlike the old reject/demote (which required an *existing* TuningProposal
 * id, forcing a throwaway `propose` call just to dismiss a fresh candidate),
 * defer is fingerprint-scoped: it sets Fingerprint.deferredAtMissions to the
 * fingerprint's CURRENT distinctMissions (computed the same way
 * @/lib/corroboration's getCorroboration does), with no proposal involved at
 * all. GET /api/tuning/candidates (see tuning-candidates-api.test.ts) is what
 * actually consumes the watermark to compute `actionable`.
 *
 * Real SQLite dev DB, like the sibling tuning-* API tests — the AC (the
 * watermark write reading a real distinct-mission count) executes inside a
 * DB write + the getCorroboration lib, which a mocked Prisma client would not
 * exercise.
 */

const PROJECT_ID = 'test-fp-defer-project';
const OTHER_PROJECT_ID = 'test-fp-defer-project-other';

const TEST_FINGERPRINTS = ['fp-defer-me', 'fp-defer-zero', 'fp-defer-redefer'];

function callDefer(slug: string, projectId: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  const request = new Request(`http://localhost:3000/api/tuning/fingerprints/${slug}/defer`, {
    method: 'POST',
    headers,
  });
  return POST(request, { params: Promise.resolve({ slug }) });
}

async function seedFingerprint(slug: string) {
  return prisma.fingerprint.upsert({
    where: { slug },
    update: { deferredAtMissions: null },
    create: { slug, pattern: `pat:${slug}`, severity: 'medium' },
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

async function seedLearning(fingerprint: string, opts: { projectId?: string; missionId?: string | null } = {}) {
  return prisma.retroLearning.create({
    data: {
      projectId: opts.projectId ?? PROJECT_ID,
      missionId: opts.missionId ?? null,
      source: 'stockwell',
      severity: 'high',
      attributedAgent: 'ba',
      targetSurface: 'skill:defensive-coding',
      pattern: `pat:${fingerprint}`,
      fingerprint,
      title: `title:${fingerprint}`,
      detail: null,
      status: 'open',
    },
  });
}

beforeEach(async () => {
  for (const id of [PROJECT_ID, OTHER_PROJECT_ID]) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: { id, name: `Fingerprint Defer Test Project ${id}` },
    });
  }
  await prisma.retroLearning.deleteMany({ where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } } });
  await prisma.fingerprint.deleteMany({ where: { slug: { in: TEST_FINGERPRINTS } } });
  await prisma.mission.deleteMany({ where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } } });
});

describe('POST /api/tuning/fingerprints/{slug}/defer', () => {
  it('sets deferredAtMissions to the CURRENT distinctMissions count, across different projects', async () => {
    await seedFingerprint('fp-defer-me');
    await seedMission(PROJECT_ID, 'M-defer-a');
    await seedMission(PROJECT_ID, 'M-defer-b');
    await seedMission(OTHER_PROJECT_ID, 'M-defer-c');
    await seedLearning('fp-defer-me', { missionId: 'M-defer-a' });
    await seedLearning('fp-defer-me', { missionId: 'M-defer-b' });
    await seedLearning('fp-defer-me', { projectId: OTHER_PROJECT_ID, missionId: 'M-defer-c' });

    const res = await callDefer('fp-defer-me', PROJECT_ID);

    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data).toMatchObject({ slug: 'fp-defer-me', deferredAtMissions: 3, distinctMissions: 3 });

    // NFR-3: durable/immediate — a fresh read reflects it.
    const persisted = await prisma.fingerprint.findUnique({ where: { slug: 'fp-defer-me' } });
    expect(persisted?.deferredAtMissions).toBe(3);
  });

  it('sets deferredAtMissions to 0 for a fingerprint with no mission-linked learnings yet', async () => {
    await seedFingerprint('fp-defer-zero');

    const res = await callDefer('fp-defer-zero', PROJECT_ID);

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ deferredAtMissions: 0, distinctMissions: 0 });
  });

  it('re-deferring overwrites the watermark with the current (higher) distinctMissions count', async () => {
    await seedFingerprint('fp-defer-redefer');
    await seedMission(PROJECT_ID, 'M-redefer-a');
    await seedLearning('fp-defer-redefer', { missionId: 'M-redefer-a' });

    const first = await callDefer('fp-defer-redefer', PROJECT_ID);
    expect((await first.json()).data).toMatchObject({ deferredAtMissions: 1 });

    await seedMission(PROJECT_ID, 'M-redefer-b');
    await seedLearning('fp-defer-redefer', { missionId: 'M-redefer-b' });

    const second = await callDefer('fp-defer-redefer', PROJECT_ID);
    expect(second.status).toBe(200);
    const { data } = await second.json();
    expect(data).toMatchObject({ deferredAtMissions: 2, distinctMissions: 2 });

    const persisted = await prisma.fingerprint.findUnique({ where: { slug: 'fp-defer-redefer' } });
    expect(persisted?.deferredAtMissions).toBe(2);
  });

  it('returns 404 FINGERPRINT_NOT_FOUND for an unknown slug and writes nothing', async () => {
    const res = await callDefer('fp-does-not-exist-anywhere', PROJECT_ID);

    expect(res.status).toBe(404);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('FINGERPRINT_NOT_FOUND');
  });

  it.each([
    ['missing', null],
    ['an empty string', ''],
    ['invalid (contains a space)', 'bad id'],
  ])('returns 400 VALIDATION_ERROR when the X-Project-ID header is %s', async (_label, projectId) => {
    await seedFingerprint('fp-defer-me');

    const res = await callDefer('fp-defer-me', projectId as string | null);

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
  });
});
