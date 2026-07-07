import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { POST } from '@/app/api/tuning/proposals/route';

/**
 * Integration tests for POST /api/tuning/proposals, rewritten for Phase A's
 * global, post-agreement TuningProposal model.
 *
 * A proposal is no longer eagerly drafted for browsing — /api/tuning/candidates
 * is the VIEW a maintainer walks. This POST *is* the agreement: it links one
 * or more (already corroborated) fingerprints to a new proposal, carrying the
 * agreed targetSurface/altitude/proposalText, and is created directly with
 * status='accepted'. It shares the exact FR-9 corroboration gate that the
 * accept/edit verbs on /api/tuning/proposals/{id} use (see
 * @/lib/corroboration's areAllCorroborated) — every linked fingerprint must
 * be corroborated (>=3 distinct missions), or nothing is created and the
 * route returns 422.
 *
 * Runs against the real SQLite dev DB (like the sibling tuning-* API tests)
 * rather than a prisma mock: the ACs here — the corroboration gate actually
 * querying distinct missionId counts, the m-n fingerprint connect, and the
 * unknown-fingerprint 400 — all execute inside real DB reads/writes that a
 * mock would have to reimplement and could silently drift from.
 */

const PROJECT_ID = 'test-proposals-create-project';

// Every fingerprint slug used anywhere in this file — cleaned up in
// beforeEach so a proposal created in one test never leaks into the next
// (TuningProposal is global now, with no projectId to scope a deleteMany by).
const TEST_FINGERPRINTS = [
  'fp-create-a',
  'fp-create-b',
  'fp-strong',
  'fp-weak',
  'fp-known',
  'fp-notarget',
  'fp-badaltitude',
  'fp-notext',
  'fp-anything',
];

async function seedFingerprint(slug: string) {
  return prisma.fingerprint.upsert({
    where: { slug },
    update: {},
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

async function seedLearning(fingerprint: string, missionId: string) {
  return prisma.retroLearning.create({
    data: {
      projectId: PROJECT_ID,
      missionId,
      source: 'stockwell',
      severity: 'high',
      attributedAgent: 'ba',
      targetSurface: `surface:${fingerprint}`,
      pattern: `pat:${fingerprint}`,
      fingerprint,
      title: `title:${fingerprint}`,
      detail: null,
      status: 'open',
    },
  });
}

/** Corroborates a fingerprint by giving it 3 distinct-mission learnings. */
async function corroborate(fingerprint: string, missionPrefix: string) {
  await seedFingerprint(fingerprint);
  for (const suffix of ['a', 'b', 'c']) {
    const missionId = `M-${missionPrefix}-${suffix}`;
    await seedMission(missionId);
    await seedLearning(fingerprint, missionId);
  }
}

function buildRequest(projectId: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  return new Request('http://localhost:3000/api/tuning/proposals', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Proposals Create Test Project' },
  });
  await prisma.retroLearning.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.tuningProposal.deleteMany({
    where: { fingerprints: { some: { slug: { in: TEST_FINGERPRINTS } } } },
  });
  await prisma.mission.deleteMany({ where: { projectId: PROJECT_ID } });
});

describe('POST /api/tuning/proposals', () => {
  it('creates an accepted proposal linking every corroborated fingerprint, returning 201', async () => {
    await corroborate('fp-create-a', 'create-a');
    await corroborate('fp-create-b', 'create-b');

    const res = await POST(
      buildRequest(PROJECT_ID, {
        fingerprints: ['fp-create-a', 'fp-create-b'],
        targetSurface: 'agents/ba.md',
        altitude: 'agent-prompt',
        proposalText: 'Tighten error handling guidance.',
      })
    );

    expect(res.status).toBe(201);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(typeof data.id).toBe('number');
    expect(data.status).toBe('accepted');
    expect([...data.fingerprints].sort()).toEqual(['fp-create-a', 'fp-create-b']);

    const persisted = await prisma.tuningProposal.findUnique({
      where: { id: data.id },
      include: { fingerprints: { select: { slug: true } } },
    });
    expect(persisted?.status).toBe('accepted');
    expect(persisted?.targetSurface).toBe('agents/ba.md');
    expect(persisted?.fingerprints.map((f) => f.slug).sort()).toEqual(['fp-create-a', 'fp-create-b']);
  });

  it('returns 422 and creates nothing when any linked fingerprint is not corroborated', async () => {
    await corroborate('fp-strong', 'strong');
    // fp-weak: only 1 distinct mission — below the threshold.
    await seedFingerprint('fp-weak');
    await seedMission('M-weak-a');
    await seedLearning('fp-weak', 'M-weak-a');

    const res = await POST(
      buildRequest(PROJECT_ID, {
        fingerprints: ['fp-strong', 'fp-weak'],
        targetSurface: 'agents/ba.md',
        altitude: 'agent-prompt',
        proposalText: 'Should not be created.',
      })
    );

    expect(res.status).toBe(422);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(JSON.stringify(error)).toMatch(/corroborat/i);

    const count = await prisma.tuningProposal.count({
      where: { fingerprints: { some: { slug: { in: ['fp-strong', 'fp-weak'] } } } },
    });
    expect(count).toBe(0);
  });

  it('returns 400 when an unknown fingerprint slug is referenced', async () => {
    await corroborate('fp-known', 'known');

    const res = await POST(
      buildRequest(PROJECT_ID, {
        fingerprints: ['fp-known', 'fp-does-not-exist'],
        targetSurface: 'agents/ba.md',
        altitude: 'agent-prompt',
        proposalText: 'text',
      })
    );

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.message).toContain('fp-does-not-exist');
  });

  it('returns 400 when fingerprints is missing, empty, or not an array', async () => {
    for (const fingerprints of [undefined, [], 'fp-a', 123]) {
      const body: Record<string, unknown> = {
        targetSurface: 'agents/ba.md',
        altitude: 'agent-prompt',
        proposalText: 'text',
      };
      if (fingerprints !== undefined) body.fingerprints = fingerprints;

      const res = await POST(buildRequest(PROJECT_ID, body));

      expect(res.status).toBe(400);
      const { success, error } = await res.json();
      expect(success).toBe(false);
      expect(error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns 400 when targetSurface is missing', async () => {
    await corroborate('fp-notarget', 'notarget');

    const res = await POST(
      buildRequest(PROJECT_ID, {
        fingerprints: ['fp-notarget'],
        altitude: 'agent-prompt',
        proposalText: 'text',
      })
    );

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['file-text', 'skilltext', '', 'SKILL-TEXT', 'agent'])(
    'returns 400 when altitude "%s" is outside skill-text|agent-prompt|hook',
    async (altitude) => {
      await corroborate('fp-badaltitude', 'badaltitude');

      const res = await POST(
        buildRequest(PROJECT_ID, {
          fingerprints: ['fp-badaltitude'],
          targetSurface: 'agents/ba.md',
          altitude,
          proposalText: 'text',
        })
      );

      expect(res.status).toBe(400);
      const { success, error } = await res.json();
      expect(success).toBe(false);
      expect(error.code).toBe('VALIDATION_ERROR');
    }
  );

  it('returns 400 when proposalText is missing or empty', async () => {
    await corroborate('fp-notext', 'notext');

    for (const proposalText of [undefined, '']) {
      const body: Record<string, unknown> = {
        fingerprints: ['fp-notext'],
        targetSurface: 'agents/ba.md',
        altitude: 'agent-prompt',
      };
      if (proposalText !== undefined) body.proposalText = proposalText;

      const res = await POST(buildRequest(PROJECT_ID, body));

      expect(res.status).toBe(400);
      const { success, error } = await res.json();
      expect(success).toBe(false);
      expect(error.code).toBe('VALIDATION_ERROR');
    }
  });

  it.each([
    ['missing', null],
    ['an empty string', ''],
    ['invalid (contains a space)', 'bad id'],
  ])('returns 400 VALIDATION_ERROR when the X-Project-ID header is %s', async (_label, projectId) => {
    const res = await POST(
      buildRequest(projectId as string | null, {
        fingerprints: ['fp-anything'],
        targetSurface: 'agents/ba.md',
        altitude: 'agent-prompt',
        proposalText: 'text',
      })
    );

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 (not 500) when the request body is malformed JSON', async () => {
    const request = new Request('http://localhost:3000/api/tuning/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Project-ID': PROJECT_ID },
      body: '{not json',
    });

    const res = await POST(request);

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
  });
});
