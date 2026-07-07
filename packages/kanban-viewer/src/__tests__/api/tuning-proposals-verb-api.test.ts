import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/lib/db';
import { PATCH } from '@/app/api/tuning/proposals/[id]/route';

/**
 * Integration tests for PATCH /api/tuning/proposals/{id} — the accept / edit
 * verbs plus the FR-9 promotion gate, updated for the collapsed verb set
 * (merge lives in tuning-proposals-verb-merge-api.test.ts; reject/demote are
 * gone, folded into the durable `defer` watermark — see
 * tuning-fingerprints-defer-api.test.ts — and `defer` no longer applies to an
 * existing proposal at all, so it has no test here anymore).
 *
 * accept and edit promote a proposal to status='accepted' (the mission stops
 * there — eval/shipped is Phase 3) and are gated: they return 422 unless
 * EVERY fingerprint linked to the proposal (the m-n Fingerprint relation) is
 * individually corroborated. Corroboration is now a GLOBAL signal —
 * COUNT(DISTINCT missionId) across ALL of a fingerprint's learnings,
 * regardless of project — computed by the shared @/lib/corroboration lib,
 * never re-derived locally. edit can also re-target targetSurface/altitude
 * as a first-class edit of the proposal (folds re-targeting into edit rather
 * than requiring a separate demote-and-recreate).
 *
 * Real SQLite dev DB, like the sibling tuning-* API tests — the ACs (status
 * transitions, the corroboration gate reading real distinct-mission counts,
 * immediate persistence) execute inside DB writes/reads + the
 * getCorroboration lib, none of which a mocked Prisma client would exercise.
 */

const PROJECT_ID = 'test-verb-project';

// Every fingerprint slug used anywhere in this file — Fingerprint/
// TuningProposal are global now (no projectId), so they must be cleaned up
// by name in beforeEach or they accumulate across repeated `npm test` runs
// against the real dev DB.
const TEST_FINGERPRINTS = [
  'fp-accept',
  'fp-edit',
  'fp-retarget',
  'fp-weak',
  'fp-xproj',
  'fp-unknown',
  'fp-noproj',
  'fp-removed-reject',
  'fp-removed-demote',
  'fp-removed-defer',
  'fp-terminal-shipped',
  'fp-terminal-dismissed',
  'fp-bad-altitude',
  'fp-empty-surface',
  'fp-malformed-json',
];

interface PatchBody {
  verb?: string;
  proposalText?: string;
  targetSurface?: string;
  altitude?: string;
}

function callPatch(id: string | number, projectId: string | null, body: PatchBody) {
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
    update: { deferredAtMissions: null },
    create: { slug, pattern: `pat:${slug}`, severity: 'medium' },
  });
}

async function seedMission(missionId: string) {
  return prisma.mission.upsert({
    where: { id: missionId },
    update: {},
    create: {
      id: missionId,
      name: `Mission ${missionId}`,
      state: 'running',
      prdPath: '/prd/test.md',
      projectId: PROJECT_ID,
      startedAt: new Date(),
    },
  });
}

async function seedLearning(fingerprint: string, missionId: string | null) {
  return prisma.retroLearning.create({
    data: {
      projectId: PROJECT_ID,
      missionId,
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

async function seedProposal(fingerprints: string[], opts: { altitude?: string; proposalText?: string; status?: string; targetSurface?: string } = {}) {
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

/** A proposal whose single fingerprint is corroborated by 3 distinct missions. */
async function seedCorroboratedProposal(fingerprint: string, missionPrefix: string, opts: { altitude?: string; proposalText?: string; status?: string } = {}) {
  await seedFingerprint(fingerprint);
  for (const suffix of ['a', 'b', 'c']) {
    const missionId = `M-${missionPrefix}-${suffix}`;
    await seedMission(missionId);
    await seedLearning(fingerprint, missionId);
  }
  return seedProposal([fingerprint], opts);
}

/** A proposal whose single fingerprint is NOT corroborated (2 distinct missions). */
async function seedUncorroboratedProposal(
  fingerprint: string,
  missionPrefix: string,
  opts: { altitude?: string; proposalText?: string } = {},
  status = 'accepted'
) {
  await seedFingerprint(fingerprint);
  for (const suffix of ['a', 'b']) {
    const missionId = `M-${missionPrefix}-${suffix}`;
    await seedMission(missionId);
    await seedLearning(fingerprint, missionId);
  }
  return seedProposal([fingerprint], { ...opts, status });
}

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Verb Test Project' },
  });
  await prisma.retroLearning.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.tuningProposal.deleteMany({
    where: { fingerprints: { some: { slug: { in: TEST_FINGERPRINTS } } } },
  });
  await prisma.fingerprint.deleteMany({ where: { slug: { in: TEST_FINGERPRINTS } } });
  await prisma.mission.deleteMany({ where: { projectId: PROJECT_ID } });
});

describe('PATCH /api/tuning/proposals/{id}', () => {
  it('accept promotes a corroborated proposal to status=accepted and persists it immediately', async () => {
    const proposal = await seedCorroboratedProposal('fp-accept', 'accept');

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'accept' });

    expect(res.status).toBe(200);
    const { success } = await res.json();
    expect(success).toBe(true);
    // NFR-3: the write is durable/immediate — a fresh read reflects it.
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('accepted');
  });

  it('edit stores the amended proposalText and sets status=accepted on a corroborated proposal', async () => {
    const proposal = await seedCorroboratedProposal('fp-edit', 'edit', { proposalText: 'original proposal text' });

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'edit', proposalText: 'amended proposal text' });

    expect(res.status).toBe(200);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('accepted');
    expect(persisted?.proposalText).toBe('amended proposal text');
  });

  it('edit re-targets targetSurface/altitude as a first-class edit (no new row created)', async () => {
    const proposal = await seedCorroboratedProposal('fp-retarget', 'retarget', {
      altitude: 'skill-text',
      proposalText: 'text',
    });

    const res = await callPatch(proposal.id, PROJECT_ID, {
      verb: 'edit',
      targetSurface: 'agents/ba.md',
      altitude: 'agent-prompt',
    });

    expect(res.status).toBe(200);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.targetSurface).toBe('agents/ba.md');
    expect(persisted?.altitude).toBe('agent-prompt');
    expect(persisted?.status).toBe('accepted');

    // No second row was created — re-targeting edits the same proposal.
    const total = await prisma.tuningProposal.count({ where: { id: proposal.id } });
    expect(total).toBe(1);
  });

  it('accept on an uncorroborated proposal is blocked with 422 and does not change status', async () => {
    // status: 'draft' simulates a freshly-demoted, not-yet-accepted proposal —
    // the one realistic way a proposal exists without already being
    // 'accepted' under the post-agreement model (see the demote verb).
    const proposal = await seedUncorroboratedProposal('fp-weak', 'weak', { }, 'draft');

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'accept' });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    // The response states WHY it was blocked.
    expect(JSON.stringify(body)).toMatch(/corroborat/i);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).not.toBe('accepted');
  });

  it('accept is blocked when a proposal has no linked fingerprints at all', async () => {
    const proposal = await prisma.tuningProposal.create({
      data: { targetSurface: 'skill:x', altitude: 'skill-text', proposalText: 'orphan' },
    });

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'accept' });

    expect(res.status).toBe(422);
  });

  it('accept passes the gate when corroboration comes from missions spanning TWO different projects (global signal)', async () => {
    const OTHER_PROJECT_ID = 'test-verb-project-other';
    await prisma.project.upsert({
      where: { id: OTHER_PROJECT_ID },
      update: {},
      create: { id: OTHER_PROJECT_ID, name: 'Other Verb Test Project' },
    });

    await seedFingerprint('fp-xproj');
    await seedMission('M-xproj-a');
    await seedMission('M-xproj-b');
    await prisma.mission.upsert({
      where: { id: 'M-xproj-c' },
      update: {},
      create: {
        id: 'M-xproj-c',
        name: 'Mission M-xproj-c',
        state: 'running',
        prdPath: '/prd/test.md',
        projectId: OTHER_PROJECT_ID,
        startedAt: new Date(),
      },
    });
    await seedLearning('fp-xproj', 'M-xproj-a');
    await seedLearning('fp-xproj', 'M-xproj-b');
    await prisma.retroLearning.create({
      data: {
        projectId: OTHER_PROJECT_ID,
        missionId: 'M-xproj-c',
        source: 'stockwell',
        severity: 'high',
        attributedAgent: 'ba',
        targetSurface: 'skill:defensive-coding',
        pattern: 'pat:fp-xproj',
        fingerprint: 'fp-xproj',
        title: 'title:fp-xproj',
        detail: null,
        status: 'open',
      },
    });
    const proposal = await seedProposal(['fp-xproj']);

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'accept' });

    expect(res.status).toBe(200);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('accepted');

    await prisma.retroLearning.deleteMany({ where: { projectId: OTHER_PROJECT_ID } });
    await prisma.mission.deleteMany({ where: { projectId: OTHER_PROJECT_ID } });
  });

  it('returns 400 for an unknown verb', async () => {
    const proposal = await seedCorroboratedProposal('fp-unknown', 'unknown');

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'frobnicate' });

    expect(res.status).toBe(400);
    const { success } = await res.json();
    expect(success).toBe(false);
  });

  it.each(['reject', 'demote', 'defer'])(
    'returns 400 for the removed %s verb (collapsed verb set — reject/demote are gone, defer moved to /api/tuning/fingerprints/{slug}/defer)',
    async (verb) => {
      const proposal = await seedCorroboratedProposal(`fp-removed-${verb}`, `removed-${verb}`);

      const res = await callPatch(proposal.id, PROJECT_ID, { verb });

      expect(res.status).toBe(400);
      const { success } = await res.json();
      expect(success).toBe(false);
    }
  );

  it('returns 404 when the proposal id does not exist', async () => {
    const res = await callPatch(999999, PROJECT_ID, { verb: 'accept' });

    expect(res.status).toBe(404);
    const { success } = await res.json();
    expect(success).toBe(false);
  });

  it.each([
    ['missing', null],
    ['an empty string', ''],
    ['invalid (contains a space)', 'bad id'],
  ])('returns 400 VALIDATION_ERROR when the X-Project-ID header is %s', async (_label, projectId) => {
    const proposal = await seedCorroboratedProposal('fp-noproj', 'noproj');

    const res = await callPatch(proposal.id, projectId as string | null, { verb: 'accept' });

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('imports the corroboration signal from the shared lib rather than re-deriving it', async () => {
    const routeSource = readFileSync(
      join(process.cwd(), 'src/app/api/tuning/proposals/[id]/route.ts'),
      'utf-8'
    );
    expect(routeSource).toMatch(/from ['"]@\/lib\/corroboration['"]/);
    expect(routeSource).toMatch(/areAllCorroborated/);
  });

  it.each(['shipped', 'dismissed'])(
    'accept on a %s (terminal) proposal is blocked with 409 and does not change status',
    async (status) => {
      const proposal = await seedCorroboratedProposal(`fp-terminal-${status}`, `terminal-${status}`, { status });

      const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'accept' });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.success).toBe(false);
      const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
      expect(persisted?.status).toBe(status);
    }
  );

  it('edit on a shipped (terminal) proposal is blocked with 409 and does not change status', async () => {
    const proposal = await seedCorroboratedProposal('fp-terminal-shipped', 'terminal-edit', { status: 'shipped' });

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'edit', proposalText: 'should not apply' });

    expect(res.status).toBe(409);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('shipped');
    expect(persisted?.proposalText).not.toBe('should not apply');
  });

  it('edit with an invalid altitude is rejected with 400 and does not mutate the proposal', async () => {
    const proposal = await seedCorroboratedProposal('fp-bad-altitude', 'bad-altitude', { altitude: 'skill-text' });

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'edit', altitude: 'nonsense' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.altitude).toBe('skill-text');
  });

  it('edit with an empty targetSurface is rejected with 400 and does not mutate the proposal', async () => {
    const proposal = await seedCorroboratedProposal('fp-empty-surface', 'empty-surface', {
    });

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'edit', targetSurface: '' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.targetSurface).toBe('skill:defensive-coding');
  });

  it('returns 400 (not 500) when the request body is malformed JSON', async () => {
    const proposal = await seedCorroboratedProposal('fp-malformed-json', 'malformed-json');

    const request = new Request(`http://localhost:3000/api/tuning/proposals/${proposal.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'X-Project-ID': PROJECT_ID },
      body: '{not json',
    });
    const res = await PATCH(request, { params: Promise.resolve({ id: String(proposal.id) }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
