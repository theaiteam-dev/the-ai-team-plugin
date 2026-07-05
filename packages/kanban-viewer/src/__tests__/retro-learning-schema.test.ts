import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * Smoke tests for the RetroLearning table (WI-195), updated for Phase A's
 * global fingerprint-centric model (Stage 1 migration
 * `global_fingerprint_tuning`).
 *
 * RetroLearning is the structured-learning table that lives alongside the
 * existing Mission.retroReport markdown blob. Each row is one captured learning
 * from a mission retro, attributed to an agent and a target surface, ranked by
 * severity, and deduplicated in application code via `fingerprint`.
 *
 * Phase A replaced the old `proposalId` -> TuningProposal relation (a learning
 * no longer links directly to a proposal) with:
 *   - `origin` (defaults to 'local' — the trust-provenance seam for a future
 *     federation phase; unenforced today)
 *   - a required FK `fingerprint -> Fingerprint.slug` (a learning MUST
 *     reference an existing global Fingerprint row)
 *
 * As a "task"-type item, a few smoke tests suffice. They prove behavior the
 * Prisma client actually exposes:
 *   1. a row can be created with every field, `status` defaults to 'open',
 *      `origin` defaults to 'local', `createdAt` defaults to now;
 *   2. deleting a mission NULLs `missionId` (onDelete: SetNull) instead of
 *      deleting the learning row;
 *   3. Project and Mission expose a `retroLearnings` back-relation;
 *   4. the `fingerprint` column is a real FK to Fingerprint.slug — a learning
 *      referencing a nonexistent slug is rejected, and a valid one resolves
 *      through the `fingerprintRef` relation.
 */

const PROJECT_ID = 'test-retro-learning-project';
const MISSION_ID = 'M-20260702-retro-learning-test';

const TEST_FINGERPRINTS = [
  'fp-abc123',
  'fp-null-mission',
  'fp-dangling-check',
  'fp-fingerprint-linked',
  'fp-setnull',
  'fp-backrel',
];

async function seedFingerprint(slug: string) {
  return prisma.fingerprint.upsert({
    where: { slug },
    update: {},
    create: { slug, pattern: `pat:${slug}`, severity: 'medium' },
  });
}

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Retro Learning Test Project' },
  });

  await prisma.mission.upsert({
    where: { id: MISSION_ID },
    update: {},
    create: {
      id: MISSION_ID,
      name: 'Retro Learning Test Mission',
      state: 'running',
      prdPath: '/prd/test.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
    },
  });

  // RetroLearning first (FKs to Fingerprint), then the Fingerprint rows
  // themselves, so re-seeding in each test starts from a clean slate.
  await prisma.retroLearning.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.fingerprint.deleteMany({ where: { slug: { in: TEST_FINGERPRINTS } } });

  for (const slug of TEST_FINGERPRINTS) {
    if (slug !== 'fp-dangling-check') {
      // fp-dangling-check is deliberately NOT seeded — it exercises the FK
      // rejection case below.
      await seedFingerprint(slug);
    }
  }
});

describe('RetroLearning table', () => {
  it('creates a row with all fields, defaulting status to "open", origin to "local", and createdAt to now', async () => {
    const before = Date.now();

    const created = await prisma.retroLearning.create({
      data: {
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        source: 'stockwell',
        severity: 'high',
        attributedAgent: 'ba',
        targetSurface: 'agents/ba.md',
        pattern: 'missing-error-handling',
        fingerprint: 'fp-abc123',
        title: 'B.A. skips error handling on async calls',
        detail: 'Three rejections traced to unhandled promise rejections.',
        // status omitted -> should default to 'open'
        // origin omitted -> should default to 'local'
        // createdAt omitted -> should default to now
      },
    });

    expect(typeof created.id).toBe('number');
    expect(created).toMatchObject({
      projectId: PROJECT_ID,
      missionId: MISSION_ID,
      source: 'stockwell',
      severity: 'high',
      attributedAgent: 'ba',
      targetSurface: 'agents/ba.md',
      pattern: 'missing-error-handling',
      fingerprint: 'fp-abc123',
      title: 'B.A. skips error handling on async calls',
      detail: 'Three rejections traced to unhandled promise rejections.',
      status: 'open',
      origin: 'local',
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('accepts a null missionId and null detail (both nullable)', async () => {
    const created = await prisma.retroLearning.create({
      data: {
        projectId: PROJECT_ID,
        missionId: null,
        source: 'amy',
        severity: 'low',
        attributedAgent: 'murdock',
        targetSurface: 'skills/test-writing/SKILL.md',
        pattern: 'weak-assertion',
        fingerprint: 'fp-null-mission',
        title: 'Murdock wrote a tautological assertion',
        detail: null,
      },
    });

    expect(created.missionId).toBeNull();
    expect(created.detail).toBeNull();
  });

  it('enforces the Fingerprint foreign key on `fingerprint` (Stage 1 upgraded it to a real relation)', async () => {
    // Phase A's migration added a real FK: RetroLearning.fingerprint ->
    // Fingerprint.slug. A fingerprint referencing no existing Fingerprint row
    // must raise a foreign-key constraint error instead of silently
    // persisting an orphaned slug.
    await expect(
      prisma.retroLearning.create({
        data: {
          projectId: PROJECT_ID,
          missionId: MISSION_ID,
          source: 'stockwell',
          severity: 'medium',
          attributedAgent: 'lynch',
          targetSurface: 'agents/lynch.md',
          pattern: 'shallow-review',
          fingerprint: 'fp-dangling-check',
          title: 'Lynch approved without checking coverage',
          detail: null,
        },
      })
    ).rejects.toThrow();

    // A fingerprint referencing an EXISTING Fingerprint row links and
    // resolves through the fingerprintRef relation.
    const learning = await prisma.retroLearning.create({
      data: {
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        source: 'stockwell',
        severity: 'medium',
        attributedAgent: 'lynch',
        targetSurface: 'agents/lynch.md',
        pattern: 'shallow-review',
        fingerprint: 'fp-fingerprint-linked',
        title: 'Lynch approved without checking coverage',
        detail: null,
      },
    });

    const reloaded = await prisma.retroLearning.findUnique({
      where: { id: learning.id },
      include: { fingerprintRef: true },
    });
    expect(reloaded).not.toBeNull();
    expect(reloaded!.fingerprint).toBe('fp-fingerprint-linked');
    expect(reloaded!.fingerprintRef.slug).toBe('fp-fingerprint-linked');
  });

  it('sets missionId to NULL when the mission is deleted (onDelete: SetNull), keeping the learning row', async () => {
    const deletableMissionId = 'M-20260702-retro-learning-delete';
    await prisma.mission.upsert({
      where: { id: deletableMissionId },
      update: {},
      create: {
        id: deletableMissionId,
        name: 'Retro Learning Deletable Mission',
        state: 'running',
        prdPath: '/prd/test.md',
        projectId: PROJECT_ID,
        startedAt: new Date(),
      },
    });

    const learning = await prisma.retroLearning.create({
      data: {
        projectId: PROJECT_ID,
        missionId: deletableMissionId,
        source: 'stockwell',
        severity: 'high',
        attributedAgent: 'ba',
        targetSurface: 'agents/ba.md',
        pattern: 'flaky-fix',
        fingerprint: 'fp-setnull',
        title: 'Fix reintroduced a previously-closed bug',
        detail: null,
      },
    });

    await prisma.mission.delete({ where: { id: deletableMissionId } });

    const afterDelete = await prisma.retroLearning.findUnique({ where: { id: learning.id } });
    expect(afterDelete).not.toBeNull();
    expect(afterDelete!.missionId).toBeNull();
  });

  it('exposes a retroLearnings back-relation on Project and Mission', async () => {
    const learning = await prisma.retroLearning.create({
      data: {
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        source: 'amy',
        severity: 'critical',
        attributedAgent: 'ba',
        targetSurface: 'agents/ba.md',
        pattern: 'security-hole',
        fingerprint: 'fp-backrel',
        title: 'Unsanitized input reached a shell command',
        detail: null,
      },
    });

    const project = await prisma.project.findUnique({
      where: { id: PROJECT_ID },
      include: { retroLearnings: true },
    });
    expect(project!.retroLearnings.map((l) => l.id)).toContain(learning.id);

    const mission = await prisma.mission.findUnique({
      where: { id: MISSION_ID },
      include: { retroLearnings: true },
    });
    expect(mission!.retroLearnings.map((l) => l.id)).toContain(learning.id);
  });
});
