import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/lib/db';
import { GET } from '@/app/api/tuning/candidates/route';

/**
 * Integration tests for WI-214: GET /api/tuning/candidates — the tuning walk's
 * ordered list (FR-8).
 *
 * The route returns recurrence-ranked LIVE fingerprints (same semantics as
 * /api/learnings/rank: >=1 open/recurred learning, hits = full historical row
 * count incl resolved/dismissed, ordered by hits DESC) PLUS previously-dismissed
 * fingerprints that new evidence RESURFACES. A fingerprint whose latest
 * TuningProposal is status='dismissed' is excluded by default (the operator
 * already said "no") UNLESS it resurfaces — and resurfacing happens when it
 * accrued >=3 new RetroLearning rows since dismissal OR gained a cross-project
 * hit (WI-212 getCorroboration). Resurfaced entries carry resurfaced:true and
 * the original dismissalNote so the operator re-decides with memory.
 *
 * These run against the real SQLite dev DB (like learnings-rank-api.test.ts) ON
 * PURPOSE: the ACs — recurrence grouping, the dismissal-exclusion join, the
 * "new hits since dismissal" time comparison, and the cross-project resurfacing
 * signal — all execute inside DB queries + the getCorroboration lib. A mocked
 * Prisma client would return whatever rows the test handed it, so deleting the
 * dismissal filter or the resurfacing threshold would not fail a mocked test.
 *
 * DISMISSAL CLOCK — why PAST/FUTURE instead of pinning proposal.updatedAt:
 * "new hits since dismissal" = RetroLearning rows with createdAt later than the
 * dismissed proposal's updatedAt. Rather than fight Prisma's @updatedAt (whether
 * an explicitly-supplied updatedAt is honored on create is version-dependent),
 * each dismissed proposal is created live so its updatedAt is ~now (2026). We
 * then bracket it widely: pre-dismissal learnings are dated in the PAST (2020,
 * before the dismissal clock) and post-dismissal "new" learnings in the FUTURE
 * (2030, after it). The count of rows-after-dismissal is therefore deterministic
 * regardless of the exact dismissal instant, as long as it falls in (2020, 2030)
 * — which "now" always does for this suite.
 *
 * The fingerprint -> dismissed-proposal link is the schema's only such edge:
 * RetroLearning.proposalId -> TuningProposal.id. Pre-dismissal rows carry that
 * proposalId; post-dismissal recurrences are unlinked (they arrived after the
 * proposal was already dismissed) and are associated back only by fingerprint.
 */

const PROJECT_ID = 'test-candidates-project';
const OTHER_PROJECT_ID = 'test-candidates-project-other';

// Bracket the (~now) dismissal clock: PAST precedes it, FUTURE follows it.
const PAST = new Date('2020-01-01T00:00:00.000Z');
const FUTURE = new Date('2030-01-01T00:00:00.000Z');

const DISMISSAL_NOTE = 'taste: we allow this';

function buildRequest(projectId: string | null): Request {
  const headers: Record<string, string> = {};
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  return new Request('http://localhost:3000/api/tuning/candidates', {
    method: 'GET',
    headers,
  });
}

async function seedLearning(
  projectId: string,
  fingerprint: string,
  opts: {
    status?: string;
    proposalId?: number;
    createdAt?: Date;
    severity?: string;
    pattern?: string;
    targetSurface?: string;
  } = {}
) {
  return prisma.retroLearning.create({
    data: {
      projectId,
      missionId: null,
      source: 'stockwell',
      severity: opts.severity ?? 'high',
      attributedAgent: 'ba',
      targetSurface: opts.targetSurface ?? `surface:${fingerprint}`,
      pattern: opts.pattern ?? `pat:${fingerprint}`,
      fingerprint,
      title: `title:${fingerprint}`,
      detail: null,
      status: opts.status ?? 'open',
      ...(opts.proposalId !== undefined ? { proposalId: opts.proposalId } : {}),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

async function seedDismissedProposal(
  projectId: string,
  opts: { dismissalNote?: string; targetSurface?: string } = {}
) {
  // updatedAt is intentionally left to default (~now) — see the DISMISSAL CLOCK
  // note above; PAST rows precede it and FUTURE rows follow it.
  return prisma.tuningProposal.create({
    data: {
      projectId,
      targetSurface: opts.targetSurface ?? 'agents/ba.md',
      altitude: 'agent',
      proposalText: 'proposal text',
      status: 'dismissed',
      dismissalNote: opts.dismissalNote ?? DISMISSAL_NOTE,
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
  // Learnings first (they FK to proposals), then proposals.
  await prisma.retroLearning.deleteMany({
    where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
  });
  await prisma.tuningProposal.deleteMany({
    where: { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } },
  });
});

describe('GET /api/tuning/candidates', () => {
  it('ranks live fingerprints by full-history hits DESC and does not mark them resurfaced', async () => {
    // fp-hot recurred across history: 2 resolved + 1 recurred = 3 hits (full
    // history weight, incl resolved), qualifies via its recurred row.
    await seedLearning(PROJECT_ID, 'fp-hot', { status: 'resolved' });
    await seedLearning(PROJECT_ID, 'fp-hot', { status: 'resolved' });
    await seedLearning(PROJECT_ID, 'fp-hot', { status: 'recurred' });
    // fp-cold: a single open hit.
    await seedLearning(PROJECT_ID, 'fp-cold', { status: 'open' });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data.map((r: { fingerprint: string }) => r.fingerprint)).toEqual(['fp-hot', 'fp-cold']);
    expect(data[0]).toMatchObject({ fingerprint: 'fp-hot', hits: 3 });
    expect(data[1]).toMatchObject({ fingerprint: 'fp-cold', hits: 1 });
    // Ordinary (never-dismissed) entries are not resurfaced and carry no note.
    expect(data[0].resurfaced).toBeFalsy();
    expect(data[0].dismissalNote ?? null).toBeNull();
  });

  it('excludes a dismissed fingerprint by default when it has too few new hits and no cross-project hit', async () => {
    await seedLearning(PROJECT_ID, 'fp-live', { status: 'open' });

    // fp-dismissed still has open learnings (would pass the rank HAVING) but its
    // latest proposal is dismissed and only 2 new hits accrued since — below the
    // >=3 resurfacing threshold, with no cross-project corroboration -> excluded.
    const proposal = await seedDismissedProposal(PROJECT_ID);
    await seedLearning(PROJECT_ID, 'fp-dismissed', { status: 'open', proposalId: proposal.id, createdAt: PAST });
    await seedLearning(PROJECT_ID, 'fp-dismissed', { status: 'open', proposalId: proposal.id, createdAt: PAST });
    await seedLearning(PROJECT_ID, 'fp-dismissed', { status: 'open', createdAt: FUTURE });
    await seedLearning(PROJECT_ID, 'fp-dismissed', { status: 'open', createdAt: FUTURE });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    const fingerprints = data.map((r: { fingerprint: string }) => r.fingerprint);
    expect(fingerprints).toContain('fp-live');
    expect(fingerprints).not.toContain('fp-dismissed');
  });

  it('resurfaces a dismissed fingerprint that accrued >=3 new hits, with resurfaced flag, original note, and full-history hits', async () => {
    const proposal = await seedDismissedProposal(PROJECT_ID, { dismissalNote: DISMISSAL_NOTE });
    // 2 pre-dismissal rows (linked) + 3 new post-dismissal rows = 5 total hits.
    await seedLearning(PROJECT_ID, 'fp-resurf', { status: 'resolved', proposalId: proposal.id, createdAt: PAST });
    await seedLearning(PROJECT_ID, 'fp-resurf', { status: 'resolved', proposalId: proposal.id, createdAt: PAST });
    await seedLearning(PROJECT_ID, 'fp-resurf', { status: 'open', createdAt: FUTURE });
    await seedLearning(PROJECT_ID, 'fp-resurf', { status: 'open', createdAt: FUTURE });
    await seedLearning(PROJECT_ID, 'fp-resurf', { status: 'open', createdAt: FUTURE });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    const entry = data.find((r: { fingerprint: string }) => r.fingerprint === 'fp-resurf');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      fingerprint: 'fp-resurf',
      resurfaced: true,
      dismissalNote: DISMISSAL_NOTE,
      hits: 5,
    });
  });

  it('resurfaces a dismissed fingerprint on a cross-project hit even with fewer than 3 new hits (uses the WI-212 corroboration signal)', async () => {
    const proposal = await seedDismissedProposal(PROJECT_ID, { dismissalNote: DISMISSAL_NOTE });
    // Only 2 new in-project hits (below the >=3 threshold): resurfacing here can
    // ONLY come from the cross-project signal, so this proves getCorroboration
    // is actually wired in rather than the threshold being re-derived locally.
    await seedLearning(PROJECT_ID, 'fp-xproj', { status: 'open', proposalId: proposal.id, createdAt: PAST });
    await seedLearning(PROJECT_ID, 'fp-xproj', { status: 'open', createdAt: FUTURE });
    await seedLearning(PROJECT_ID, 'fp-xproj', { status: 'open', createdAt: FUTURE });
    // The same fingerprint under a DIFFERENT project -> crossProject === true.
    await seedLearning(OTHER_PROJECT_ID, 'fp-xproj', { status: 'open' });

    const res = await GET(buildRequest(PROJECT_ID));

    expect(res.status).toBe(200);
    const { data } = await res.json();
    const entry = data.find((r: { fingerprint: string }) => r.fingerprint === 'fp-xproj');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ resurfaced: true, dismissalNote: DISMISSAL_NOTE });
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

  it('imports the corroboration threshold from the shared lib rather than re-deriving it', async () => {
    // WI-214 MUST import getCorroboration from WI-212's lib for cross-project
    // detection and never re-derive the >=3-OR-cross-project threshold locally
    // (single-source-of-truth constraint from the item context).
    const routeSource = readFileSync(
      join(process.cwd(), 'src/app/api/tuning/candidates/route.ts'),
      'utf-8'
    );
    expect(routeSource).toMatch(/from ['"]@\/lib\/corroboration['"]/);
    expect(routeSource).toMatch(/getCorroboration/);
  });
});
