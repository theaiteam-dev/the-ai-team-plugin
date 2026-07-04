import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/lib/db';
import { PATCH } from '@/app/api/tuning/proposals/[id]/route';

/**
 * Integration tests for WI-219: PATCH /api/tuning/proposals/{id} — apply a
 * tuning verb (accept | edit | defer) plus the FR-9 promotion gate.
 *
 * The handler's verb dispatch enumerates ALL SIX verbs. This file covers
 * accept/edit/defer plus the FR-9 promotion gate; merge/demote/reject (filled in
 * by WI-220) are covered in tuning-proposals-verb-dismissal-api.test.ts. accept
 * and edit promote a proposal to status='accepted' (the mission stops there —
 * eval/shipped is Phase 3) and are gated: because every valid altitude
 * (skill-text|agent-prompt|hook) is a system-rule altitude, accept/edit return
 * 422 unless the proposal's fingerprint is corroborated. Corroboration is the
 * WI-212 signal (>=3 in-project hits OR a cross-project hit) and MUST come from
 * that shared lib, never a re-derived threshold.
 *
 * Real SQLite dev DB, like learnings-rank-api.test.ts — the ACs (status
 * transitions, the corroboration gate, immediate persistence per NFR-3) execute
 * inside DB writes/reads + the getCorroboration lib, none of which a mocked
 * Prisma client would exercise.
 *
 * PROPOSAL -> FINGERPRINT link: TuningProposal has no fingerprint column. The
 * draft route (WI-213) clusters a surface's live learnings into the proposal via
 * RetroLearning.proposalId, so a proposal's fingerprint(s) come from its linked
 * learnings. Each seeded proposal here links learnings that all share ONE
 * fingerprint, so "the fingerprint is corroborated" is unambiguous; corroboration
 * is then dialed purely by how many in-project rows of that fingerprint exist.
 */

const PROJECT_ID = 'test-verb-project';
const OTHER_PROJECT_ID = 'test-verb-project-other';

interface PatchBody {
  verb?: string;
  proposalText?: string;
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

async function seedProposal(opts: { altitude?: string; proposalText?: string; status?: string; targetSurface?: string } = {}) {
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

async function seedLearning(
  fingerprint: string,
  opts: { projectId?: string; proposalId?: number; targetSurface?: string; status?: string } = {}
) {
  return prisma.retroLearning.create({
    data: {
      projectId: opts.projectId ?? PROJECT_ID,
      missionId: null,
      source: 'stockwell',
      severity: 'high',
      attributedAgent: 'ba',
      targetSurface: opts.targetSurface ?? 'skill:defensive-coding',
      pattern: `pat:${fingerprint}`,
      fingerprint,
      title: `title:${fingerprint}`,
      detail: null,
      status: opts.status ?? 'open',
      ...(opts.proposalId !== undefined ? { proposalId: opts.proposalId } : {}),
    },
  });
}

/** A proposal whose single fingerprint is corroborated by >=3 in-project hits. */
async function seedCorroboratedProposal(fingerprint: string, opts: { altitude?: string; proposalText?: string } = {}) {
  const proposal = await seedProposal(opts);
  for (let i = 0; i < 3; i++) {
    await seedLearning(fingerprint, { proposalId: proposal.id });
  }
  return proposal;
}

/** A proposal whose single fingerprint is NOT corroborated (2 in-project hits, no cross-project). */
async function seedUncorroboratedProposal(fingerprint: string, opts: { altitude?: string; proposalText?: string } = {}) {
  const proposal = await seedProposal(opts);
  for (let i = 0; i < 2; i++) {
    await seedLearning(fingerprint, { proposalId: proposal.id });
  }
  return proposal;
}

beforeEach(async () => {
  for (const id of [PROJECT_ID, OTHER_PROJECT_ID]) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: { id, name: `Verb Test Project ${id}` },
    });
  }
  await prisma.retroLearning.deleteMany({ where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } } });
  await prisma.tuningProposal.deleteMany({ where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } } });
});

describe('PATCH /api/tuning/proposals/{id}', () => {
  it('accept promotes a corroborated proposal to status=accepted and persists it immediately', async () => {
    const proposal = await seedCorroboratedProposal('fp-accept');

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'accept' });

    expect(res.status).toBe(200);
    const { success } = await res.json();
    expect(success).toBe(true);
    // NFR-3: the write is durable/immediate — a fresh read reflects it.
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('accepted');
  });

  it('edit stores the amended proposalText and sets status=accepted on a corroborated proposal', async () => {
    const proposal = await seedCorroboratedProposal('fp-edit', { proposalText: 'original proposal text' });

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'edit', proposalText: 'amended proposal text' });

    expect(res.status).toBe(200);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('accepted');
    expect(persisted?.proposalText).toBe('amended proposal text');
  });

  it('defer leaves the proposal and its linked learnings unchanged (and is not blocked by the gate)', async () => {
    // Uncorroborated on purpose: defer is not a promotion, so the gate must not
    // apply and the proposal must survive untouched to resurface next round.
    const proposal = await seedUncorroboratedProposal('fp-defer', { proposalText: 'keep me as-is' });

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'defer' });

    expect(res.status).toBe(200);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('draft');
    expect(persisted?.proposalText).toBe('keep me as-is');
    const linkedCount = await prisma.retroLearning.count({ where: { proposalId: proposal.id } });
    expect(linkedCount).toBe(2);
  });

  it('accept on an uncorroborated system-rule proposal is blocked with 422 and does not change status', async () => {
    const proposal = await seedUncorroboratedProposal('fp-weak');

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'accept' });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.success).toBe(false);
    // The response states WHY it was blocked.
    expect(JSON.stringify(body)).toMatch(/corroborat/i);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('draft');
  });

  it('accept passes the gate when corroboration comes only from a cross-project hit (uses the WI-212 signal)', async () => {
    // 1 in-project hit (below the >=3 threshold) + the same fingerprint under a
    // different project. Only getCorroboration's cross-project branch can pass
    // this, proving the shared signal is wired in rather than re-derived.
    const proposal = await seedProposal();
    await seedLearning('fp-xproj', { proposalId: proposal.id });
    await seedLearning('fp-xproj', { projectId: OTHER_PROJECT_ID });

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'accept' });

    expect(res.status).toBe(200);
    const persisted = await prisma.tuningProposal.findUnique({ where: { id: proposal.id } });
    expect(persisted?.status).toBe('accepted');
  });

  // merge/demote/reject are no longer stubs (WI-220) — their behavior is covered
  // in tuning-proposals-verb-dismissal-api.test.ts.

  it('returns 400 for an unknown verb', async () => {
    const proposal = await seedCorroboratedProposal('fp-unknown');

    const res = await callPatch(proposal.id, PROJECT_ID, { verb: 'frobnicate' });

    expect(res.status).toBe(400);
    const { success } = await res.json();
    expect(success).toBe(false);
  });

  it('returns 404 when the proposal id does not exist', async () => {
    const res = await callPatch(999999, PROJECT_ID, { verb: 'defer' });

    expect(res.status).toBe(404);
    const { success } = await res.json();
    expect(success).toBe(false);
  });

  it.each([
    ['missing', null],
    ['an empty string', ''],
    ['invalid (contains a space)', 'bad id'],
  ])('returns 400 VALIDATION_ERROR when the X-Project-ID header is %s', async (_label, projectId) => {
    const proposal = await seedCorroboratedProposal('fp-noproj');

    const res = await callPatch(proposal.id, projectId as string | null, { verb: 'accept' });

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('imports the corroboration threshold from the shared lib rather than re-deriving it', async () => {
    const routeSource = readFileSync(
      join(process.cwd(), 'src/app/api/tuning/proposals/[id]/route.ts'),
      'utf-8'
    );
    expect(routeSource).toMatch(/from ['"]@\/lib\/corroboration['"]/);
    expect(routeSource).toMatch(/getCorroboration/);
  });
});
