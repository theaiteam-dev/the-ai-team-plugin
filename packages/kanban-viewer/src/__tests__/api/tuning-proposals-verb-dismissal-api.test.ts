import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { PATCH } from '@/app/api/tuning/proposals/[id]/route';

/**
 * Integration tests for WI-220: PATCH /api/tuning/proposals/{id} — the
 * merge / demote / reject branches that WI-219 stubbed to 501.
 *
 * These verbs are NOT promotions, so unlike accept/edit they are not gated by
 * FR-9 corroboration — the seeded proposals here are deliberately uncorroborated
 * to prove the dismissal/merge path runs regardless.
 *
 *   - merge  (FR-7): collapse a duplicate fingerprint into an existing one so
 *     hit counts sum. Per the team-lead note and §6.3, the route re-points EVERY
 *     RetroLearning row in the project that shares the SOURCE fingerprint — across
 *     every status (open/recurred/resolved/dismissed), not just the proposal's
 *     currently-linked open subset — to the target fingerprint. Project-scoped:
 *     a same-fingerprint row in another project is untouched.
 *   - reject (FR-8): durable dismissal — status='dismissed' + a persisted
 *     dismissalNote so the taste boundary is not re-litigated blind.
 *   - demote (FR-8 + §6.3): the rule is real but belongs lower. A durable
 *     dismissed record is written on the ORIGINAL altitude carrying the note, and
 *     the rule is re-scoped down to the supplied lower altitude (the only way to
 *     represent "re-scoped down" given TuningProposal has no target-altitude
 *     column is a proposal row AT the lower altitude).
 *
 * Real SQLite dev DB, mirroring tuning-proposals-verb-api.test.ts (WI-219) — the
 * ACs are DB writes/reads (re-pointing rows, durable dismissals, immediate
 * persistence per NFR-3) that a mocked Prisma client would not exercise.
 */

const PROJECT_ID = 'test-verb-dismissal-project';
const OTHER_PROJECT_ID = 'test-verb-dismissal-other';

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

function seedProposal(opts: { altitude?: string; proposalText?: string; status?: string; targetSurface?: string } = {}) {
  return prisma.tuningProposal.create({
    data: {
      projectId: PROJECT_ID,
      targetSurface: opts.targetSurface ?? 'skill:defensive-coding',
      altitude: opts.altitude ?? 'skill-text',
      proposalText: opts.proposalText ?? 'original proposal text',
      status: opts.status ?? 'draft',
    },
  });
}

function seedLearning(
  fingerprint: string,
  opts: { projectId?: string; proposalId?: number; status?: string } = {}
) {
  return prisma.retroLearning.create({
    data: {
      projectId: opts.projectId ?? PROJECT_ID,
      missionId: null,
      source: 'stockwell',
      severity: 'high',
      attributedAgent: 'ba',
      targetSurface: 'skill:defensive-coding',
      pattern: `pat:${fingerprint}`,
      fingerprint,
      title: `title:${fingerprint}`,
      detail: null,
      status: opts.status ?? 'open',
      ...(opts.proposalId !== undefined ? { proposalId: opts.proposalId } : {}),
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
  await prisma.tuningProposal.deleteMany({ where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } } });
});

describe('PATCH /api/tuning/proposals/{id} — merge', () => {
  it('re-points EVERY project row sharing the source fingerprint (all statuses, not just linked) to the target, and is project-scoped', async () => {
    const proposal = await seedProposal();

    // The proposal's currently-linked (open) subset — the only rows the naive
    // "re-point what's linked" reading would touch.
    await seedLearning('fp-src', { proposalId: proposal.id, status: 'open' });
    await seedLearning('fp-src', { proposalId: proposal.id, status: 'open' });
    // Historical rows sharing the SAME fingerprint but NOT linked to the proposal
    // and already closed out — these must ALSO re-point so hit counts sum.
    await seedLearning('fp-src', { status: 'resolved' });
    await seedLearning('fp-src', { status: 'dismissed' });
    // A same-fingerprint row in another project — must NOT be touched (scoped).
    await seedLearning('fp-src', { projectId: OTHER_PROJECT_ID, status: 'open' });
    // An unrelated fingerprint in this project — must NOT be touched.
    await seedLearning('fp-unrelated', { status: 'open' });

    const res = await callPatch(proposal.id, PROJECT_ID, {
      verb: 'merge',
      mergeIntoFingerprint: 'fp-target',
    });

    expect(res.status).toBe(200);

    // Every in-project fp-src row (4: 2 linked-open + 1 resolved + 1 dismissed)
    // is now fp-target; none remain under the source fingerprint.
    expect(await prisma.retroLearning.count({ where: { projectId: PROJECT_ID, fingerprint: 'fp-src' } })).toBe(0);
    expect(await prisma.retroLearning.count({ where: { projectId: PROJECT_ID, fingerprint: 'fp-target' } })).toBe(4);

    // The other project's fp-src row is untouched (project-scoped updateMany).
    expect(await prisma.retroLearning.count({ where: { projectId: OTHER_PROJECT_ID, fingerprint: 'fp-src' } })).toBe(1);
    expect(await prisma.retroLearning.count({ where: { projectId: OTHER_PROJECT_ID, fingerprint: 'fp-target' } })).toBe(0);

    // The unrelated fingerprint is untouched.
    expect(await prisma.retroLearning.count({ where: { projectId: PROJECT_ID, fingerprint: 'fp-unrelated' } })).toBe(1);
  });

  it('returns 400 when mergeIntoFingerprint is missing', async () => {
    const proposal = await seedProposal();
    await seedLearning('fp-src', { proposalId: proposal.id });

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'merge' });

    expect(res.status).toBe(400);
    const { success } = await res.json();
    expect(success).toBe(false);
  });
});

describe('PATCH /api/tuning/proposals/{id} — reject', () => {
  it('sets status=dismissed and persists the dismissalNote (FR-8 durable dismissal), reflected on an immediate read', async () => {
    const proposal = await seedProposal();

    const res = await callPatch(proposal.id, PROJECT_ID, {
      verb: 'reject',
      dismissalNote: 'Intentional style choice, not a defect.',
    });

    expect(res.status).toBe(200);
    const { success } = await res.json();
    expect(success).toBe(true);

    // NFR-3: the write is durable/immediate — a fresh read reflects it.
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('dismissed');
    expect(persisted?.dismissalNote).toBe('Intentional style choice, not a defect.');
  });

  it.each([
    ['missing', undefined],
    ['an empty string', ''],
  ])('returns 400 when dismissalNote is %s', async (_label, dismissalNote) => {
    const proposal = await seedProposal();

    const body: Record<string, unknown> = { verb: 'reject' };
    if (dismissalNote !== undefined) body.dismissalNote = dismissalNote;
    const res = await callPatch(proposal.id, PROJECT_ID, body);

    expect(res.status).toBe(400);
    const { success } = await res.json();
    expect(success).toBe(false);
    // The proposal must NOT have been dismissed on a rejected request.
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('draft');
  });
});

describe('PATCH /api/tuning/proposals/{id} — demote', () => {
  it('writes a durable dismissed record on the original altitude carrying the note, and re-scopes the rule down to the new altitude', async () => {
    const proposal = await seedProposal({ altitude: 'skill-text' });

    const res = await callPatch(proposal.id, PROJECT_ID, {
      verb: 'demote',
      dismissalNote: 'Right instinct, wrong altitude — belongs in the agent prompt.',
      altitude: 'agent-prompt',
    });

    expect(res.status).toBe(200);

    // A durable dismissed record exists on the ORIGINAL altitude, carrying the note.
    const dismissed = await prisma.tuningProposal.findMany({
      where: { projectId: PROJECT_ID, altitude: 'skill-text', status: 'dismissed' },
    });
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].dismissalNote).toBe('Right instinct, wrong altitude — belongs in the agent prompt.');

    // The rule is re-scoped down: a live (non-dismissed) proposal now exists at
    // the lower altitude.
    const rescoped = await prisma.tuningProposal.findMany({
      where: { projectId: PROJECT_ID, altitude: 'agent-prompt' },
    });
    expect(rescoped).toHaveLength(1);
    expect(rescoped[0].status).not.toBe('dismissed');
  });

  it.each([
    ['missing', undefined],
    ['an empty string', ''],
  ])('returns 400 when dismissalNote is %s', async (_label, dismissalNote) => {
    const proposal = await seedProposal({ altitude: 'skill-text' });

    const body: Record<string, unknown> = { verb: 'demote', altitude: 'agent-prompt' };
    if (dismissalNote !== undefined) body.dismissalNote = dismissalNote;
    const res = await callPatch(proposal.id, PROJECT_ID, body);

    expect(res.status).toBe(400);
    const { success } = await res.json();
    expect(success).toBe(false);
    // No dismissed record should have been written on a rejected request.
    expect(
      await prisma.tuningProposal.count({ where: { projectId: PROJECT_ID, status: 'dismissed' } })
    ).toBe(0);
  });
});
