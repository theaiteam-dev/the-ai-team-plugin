import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';

/**
 * Smoke tests for the RetroLearning table (WI-195).
 *
 * RetroLearning is the structured-learning table that lives alongside the
 * existing Mission.retroReport markdown blob. Each row is one captured learning
 * from a mission retro, attributed to an agent and a target surface, ranked by
 * severity, and deduplicated in application code via `fingerprint`.
 *
 * As a "task"-type item, a few smoke tests suffice. They prove behavior the
 * Prisma client actually exposes:
 *   1. a row can be created with every Phase 1 field, `status` defaults to
 *      'open', `createdAt` defaults to now, and `proposalId` defaults to null
 *      (it is a nullable FK relation to TuningProposal, added in WI-211);
 *   2. deleting a mission NULLs `missionId` (onDelete: SetNull) instead of
 *      deleting the learning row;
 *   3. Project and Mission expose a `retroLearnings` back-relation.
 */

const PROJECT_ID = 'test-retro-learning-project';
const MISSION_ID = 'M-20260702-retro-learning-test';

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

  await prisma.retroLearning.deleteMany({ where: { projectId: PROJECT_ID } });
});

describe('RetroLearning table', () => {
  it('creates a row with all Phase 1 fields, defaulting status to "open" and createdAt to now', async () => {
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
        // proposalId omitted -> should default to null (nullable FK to TuningProposal)
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
      proposalId: null,
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

  it('enforces the TuningProposal foreign key on proposalId (WI-211 upgraded it to a real relation)', async () => {
    // WI-211 upgraded proposalId from a bare Int into a real FK relation to
    // TuningProposal. A proposalId that references no existing proposal must now
    // raise a foreign-key constraint error instead of persisting a dangling id.
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
          fingerprint: 'fp-proposal-dangling',
          title: 'Lynch approved without checking coverage',
          detail: null,
          proposalId: 987654,
        },
      })
    ).rejects.toThrow();

    // A valid proposalId links to a real TuningProposal and resolves through the
    // relation.
    const proposal = await prisma.tuningProposal.create({
      data: {
        projectId: PROJECT_ID,
        targetSurface: 'agents/lynch.md',
        altitude: 'agent-prompt',
        proposalText: '',
      },
    });

    const learning = await prisma.retroLearning.create({
      data: {
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        source: 'stockwell',
        severity: 'medium',
        attributedAgent: 'lynch',
        targetSurface: 'agents/lynch.md',
        pattern: 'shallow-review',
        fingerprint: 'fp-proposal-linked',
        title: 'Lynch approved without checking coverage',
        detail: null,
        proposalId: proposal.id,
      },
    });

    const reloaded = await prisma.retroLearning.findUnique({
      where: { id: learning.id },
      include: { proposal: true },
    });
    expect(reloaded).not.toBeNull();
    expect(reloaded!.proposalId).toBe(proposal.id);
    expect(reloaded!.proposal!.id).toBe(proposal.id);
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
