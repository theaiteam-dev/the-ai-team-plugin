import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { PATCH } from '@/app/api/tuning/proposals/[id]/route';

/**
 * Integration tests for PATCH /api/tuning/proposals/{id} — the merge verb,
 * updated for the collapsed verb set (reject/demote are gone, folded into the
 * durable `defer` watermark — see tuning-fingerprints-defer-api.test.ts and
 * tuning-proposals-verb-api.test.ts for accept/edit/merge's promotion gate).
 *
 *   - merge (FR-7): de-alias a duplicate fingerprint slug into a canonical
 *     one so hit counts sum, GLOBALLY (fingerprints have no project scope
 *     anymore) — re-points EVERY RetroLearning row sharing the SOURCE
 *     fingerprint(s) (the proposal's currently-linked fingerprints, minus the
 *     target) to the target fingerprint, across every project and status,
 *     and folds the Fingerprint rows/relations together. It MUST reject a
 *     same-mission merge with 422: if the source and target fingerprint(s)
 *     share ANY missionId, they are distinct facets of ONE mission's
 *     evidence, not independent corroboration, and merging can never
 *     legitimately reach the distinct-mission threshold.
 *
 * Real SQLite dev DB, mirroring tuning-proposals-verb-api.test.ts — the ACs
 * are DB writes/reads (re-pointing rows, m-n relation surgery, immediate
 * persistence per NFR-3) that a mocked Prisma client would not exercise.
 */

const PROJECT_ID = 'test-verb-dismissal-project';
const OTHER_PROJECT_ID = 'test-verb-dismissal-other';

// Every fingerprint slug used anywhere in this file.
const TEST_FINGERPRINTS = [
  'fp-src',
  'fp-target',
  'fp-unrelated',
  'fp-facet-a',
  'fp-facet-b',
  'fp-clean-src',
  'fp-clean-target',
  'fp-src-missing-target',
];

function callPatch(id: string | number, projectId: string | null, body: Record<string, unknown>) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  const request = new Request(`http://localhost:3000/api/tuning/proposals/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ id: String(id) }) });
}

async function seedFingerprint(slug: string) {
  return prisma.fingerprint.upsert({
    where: { slug },
    update: {},
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

function seedLearning(
  fingerprint: string,
  opts: { projectId?: string; missionId?: string | null; status?: string } = {}
) {
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
      status: opts.status ?? 'open',
    },
  });
}

function seedProposal(
  fingerprints: string[],
  opts: { altitude?: string; proposalText?: string; status?: string; targetSurface?: string } = {}
) {
  return prisma.tuningProposal.create({
    data: {
      targetSurface: opts.targetSurface ?? 'skill:defensive-coding',
      altitude: opts.altitude ?? 'skill-text',
      proposalText: opts.proposalText ?? 'original proposal text',
      status: opts.status ?? 'accepted',
      fingerprints: { connect: fingerprints.map((slug) => ({ slug })) },
    },
  });
}

beforeEach(async () => {
  for (const id of [PROJECT_ID, OTHER_PROJECT_ID]) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: { id, name: `Verb Dismissal Test Project ${id}` },
    });
  }
  await prisma.retroLearning.deleteMany({ where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } } });
  // TuningProposal/Fingerprint are global now (no projectId to scope a
  // deleteMany by), so every test run against the real dev DB would
  // otherwise accumulate rows across repeated `npm test` invocations —
  // clean up every fingerprint slug this file seeds, by name, each time.
  await prisma.tuningProposal.deleteMany({
    where: { fingerprints: { some: { slug: { in: TEST_FINGERPRINTS } } } },
  });
  await prisma.fingerprint.deleteMany({ where: { slug: { in: TEST_FINGERPRINTS } } });
  await prisma.mission.deleteMany({ where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } } });
});

describe('PATCH /api/tuning/proposals/{id} — merge', () => {
  it('re-points EVERY row sharing the source fingerprint (every project, every status) to the target, and folds the Fingerprint rows', async () => {
    await seedFingerprint('fp-src');
    await seedFingerprint('fp-target');
    await seedMission(PROJECT_ID, 'M-merge-src');
    await seedMission(OTHER_PROJECT_ID, 'M-merge-target');
    const proposal = await seedProposal(['fp-src']);

    // Rows sharing the source fingerprint, spanning multiple projects and
    // statuses — ALL must re-point (no project scoping any more).
    await seedLearning('fp-src', { status: 'open', missionId: 'M-merge-src' });
    await seedLearning('fp-src', { status: 'resolved', missionId: null });
    await seedLearning('fp-src', { projectId: OTHER_PROJECT_ID, status: 'dismissed', missionId: null });
    // The target fingerprint's own row, on a DIFFERENT mission than the source.
    await seedLearning('fp-target', { projectId: OTHER_PROJECT_ID, status: 'open', missionId: 'M-merge-target' });
    // An unrelated fingerprint — must NOT be touched.
    await seedFingerprint('fp-unrelated');
    await seedLearning('fp-unrelated', { status: 'open' });

    const res = await callPatch(proposal.id, PROJECT_ID, {
      verb: 'merge',
      mergeIntoFingerprint: 'fp-target',
    });

    expect(res.status).toBe(200);

    // Every fp-src row (3, across two projects and three statuses) is now
    // fp-target; none remain under the source fingerprint.
    expect(await prisma.retroLearning.count({ where: { fingerprint: 'fp-src' } })).toBe(0);
    expect(await prisma.retroLearning.count({ where: { fingerprint: 'fp-target' } })).toBe(4);

    // The source Fingerprint row is gone; the target remains; the unrelated
    // fingerprint is untouched.
    expect(await prisma.fingerprint.findUnique({ where: { slug: 'fp-src' } })).toBeNull();
    expect(await prisma.fingerprint.findUnique({ where: { slug: 'fp-target' } })).not.toBeNull();
    expect(await prisma.retroLearning.count({ where: { fingerprint: 'fp-unrelated' } })).toBe(1);

    // The proposal's fingerprint link now points at the target, not the source.
    const reloaded = await prisma.tuningProposal.findUnique({
      where: { id: proposal.id },
      include: { fingerprints: { select: { slug: true } } },
    });
    expect(reloaded?.fingerprints.map((f) => f.slug)).toEqual(['fp-target']);
  });

  it('rejects a same-mission merge with 422 and makes no writes', async () => {
    await seedFingerprint('fp-facet-a');
    await seedFingerprint('fp-facet-b');
    await seedMission(PROJECT_ID, 'M-shared');
    // Both fingerprints are learnings from the SAME mission — distinct
    // facets of one mission's evidence, not independent corroboration.
    await seedLearning('fp-facet-a', { missionId: 'M-shared' });
    await seedLearning('fp-facet-b', { missionId: 'M-shared' });
    const proposal = await seedProposal(['fp-facet-a']);

    const res = await callPatch(proposal.id, PROJECT_ID, {
      verb: 'merge',
      mergeIntoFingerprint: 'fp-facet-b',
    });

    expect(res.status).toBe(422);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(JSON.stringify(error)).toMatch(/mission/i);

    // No writes happened: both fingerprints and their rows are untouched.
    expect(await prisma.retroLearning.count({ where: { fingerprint: 'fp-facet-a' } })).toBe(1);
    expect(await prisma.retroLearning.count({ where: { fingerprint: 'fp-facet-b' } })).toBe(1);
    expect(await prisma.fingerprint.findUnique({ where: { slug: 'fp-facet-a' } })).not.toBeNull();
  });

  it('allows a merge when source and target fingerprints share NO mission, even if each has other missions', async () => {
    await seedFingerprint('fp-clean-src');
    await seedFingerprint('fp-clean-target');
    await seedMission(PROJECT_ID, 'M-clean-src');
    await seedMission(PROJECT_ID, 'M-clean-target');
    await seedLearning('fp-clean-src', { missionId: 'M-clean-src' });
    await seedLearning('fp-clean-target', { missionId: 'M-clean-target' });
    const proposal = await seedProposal(['fp-clean-src']);

    const res = await callPatch(proposal.id, PROJECT_ID, {
      verb: 'merge',
      mergeIntoFingerprint: 'fp-clean-target',
    });

    expect(res.status).toBe(200);
    expect(await prisma.retroLearning.count({ where: { fingerprint: 'fp-clean-target' } })).toBe(2);
  });

  it('returns 400 when mergeIntoFingerprint is missing', async () => {
    await seedFingerprint('fp-src-missing-target');
    await seedLearning('fp-src-missing-target');
    const proposal = await seedProposal(['fp-src-missing-target']);

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'merge' });

    expect(res.status).toBe(400);
    const { success } = await res.json();
    expect(success).toBe(false);
  });

  it('returns 400 when the proposal has no fingerprints to merge (other than the target)', async () => {
    const proposal = await prisma.tuningProposal.create({
      data: { targetSurface: 'skill:x', altitude: 'skill-text', proposalText: 'orphan' },
    });

    const res = await callPatch(proposal.id, PROJECT_ID, {
      verb: 'merge',
      mergeIntoFingerprint: 'fp-anything',
    });

    expect(res.status).toBe(400);
    const { success } = await res.json();
    expect(success).toBe(false);
  });
});
