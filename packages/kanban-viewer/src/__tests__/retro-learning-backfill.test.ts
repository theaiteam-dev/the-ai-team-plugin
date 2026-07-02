import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { GET as rankGET } from '@/app/api/learnings/rank/route';
import { backfillRetroLearnings } from '../../prisma/scripts/backfill-retro-learnings';

/**
 * Phase 1 validation gate (§12) for WI-201.
 *
 * Replays the S12 corpus (5 historical retros + the 2 stalled drafts
 * prd/drafts/coderabbit-learnings.md and prd/drafts/agent-blind-spot-fixes.md)
 * through the capture surface, then confirms the recurrence-rank query converges
 * the known repeat offenders each onto a SINGLE fingerprint (match-or-create, not
 * near-duplicate slugs), with a hit count equal to the number of distinct
 * missions the pattern appeared in, in recurrence-rank order.
 *
 * This runs in-process against the real (project-scoped, hermetic) dev DB: the
 * backfill invokes the WI-196 capture handler and this test invokes the WI-198
 * rank handler directly — NOT via the compiled ateam binary and NOT via a
 * running Next.js server — matching the sibling learnings-*-api.test.ts tests.
 *
 * Contract with the backfill script (packages/prisma/scripts/backfill-retro-learnings.ts):
 *   export async function backfillRetroLearnings(
 *     opts: { projectId: string }
 *   ): Promise<{ rowsCreated: number }>
 * It must create the historical Mission rows it attributes learnings to (scoped
 * to opts.projectId — the WI-196 capture guard rejects a missionId the project
 * does not own) and capture each occurrence via the capture surface, using the
 * curated fingerprint slugs below for the four repeat offenders.
 *
 * Expected recurrence (distinct missions), per PRD §1 / §12:
 *   lynch-grep-gaps        5×
 *   missing-banned-pattern 5×
 *   telemetry-empty        3×
 *   gitignore-db           2×  (filed Low 2026-05-17, recurred as #1 Must-Fix)
 */

const PROJECT_ID = 'test-backfill-corpus';

const EXPECTED_RECURRENCE: Array<[fingerprint: string, distinctMissions: number]> = [
  ['telemetry-empty', 3],
  ['lynch-grep-gaps', 5],
  ['missing-banned-pattern', 5],
  ['gitignore-db', 2],
];
const OFFENDERS = EXPECTED_RECURRENCE.map(([fingerprint]) => fingerprint);

interface RankRow {
  fingerprint: string;
  pattern: string;
  targetSurface: string;
  severity: string;
  hits: number;
}

function buildRankRequest(projectId: string): Request {
  return new Request('http://localhost:3000/api/learnings/rank', {
    method: 'GET',
    headers: { 'X-Project-ID': projectId },
  });
}

async function distinctMissionCount(fingerprint: string): Promise<number> {
  const rows = await prisma.retroLearning.findMany({
    where: { projectId: PROJECT_ID, fingerprint },
    select: { missionId: true },
  });
  return new Set(rows.map((r) => r.missionId)).size;
}

let rankData: RankRow[];

beforeEach(async () => {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: { id: PROJECT_ID, name: 'Backfill Corpus Test Project' },
  });
  // Clean any prior run so the backfill starts from an empty corpus for this project.
  await prisma.retroLearning.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.mission.deleteMany({ where: { projectId: PROJECT_ID } });

  await backfillRetroLearnings({ projectId: PROJECT_ID });

  const res = await rankGET(buildRankRequest(PROJECT_ID));
  const body = await res.json();
  rankData = body.data;
});

describe('retro-learning corpus backfill (Phase 1 validation gate)', () => {
  it('ingests the corpus via the capture surface, producing ranked rows for the known offenders', async () => {
    const totalRows = await prisma.retroLearning.count({ where: { projectId: PROJECT_ID } });
    expect(totalRows).toBeGreaterThan(0);

    const rankedFingerprints = rankData.map((r) => r.fingerprint);
    for (const offender of OFFENDERS) {
      expect(rankedFingerprints).toContain(offender);
    }
  });

  it.each(EXPECTED_RECURRENCE)(
    'converges "%s" onto a single fingerprint whose hits equal its %d distinct missions',
    async (fingerprint, expectedMissions) => {
      // Match-or-create must collapse every occurrence of this offender across the
      // corpus onto ONE fingerprint — not near-duplicate slugs.
      const entries = rankData.filter((r) => r.fingerprint === fingerprint);
      expect(entries).toHaveLength(1);

      // hits counts every row of the fingerprint; per-mission dedupe (WI-196) means
      // one row per distinct mission, so hits === distinct missions === the corpus
      // recurrence documented in the PRD.
      const distinctMissions = await distinctMissionCount(fingerprint);
      expect(entries[0].hits).toBe(distinctMissions);
      expect(entries[0].hits).toBe(expectedMissions);
    }
  );

  it('ranks the repeat offenders in recurrence order (hits DESC)', async () => {
    const offenderHits = rankData
      .filter((r) => OFFENDERS.includes(r.fingerprint))
      .map((r) => r.hits);

    // All four offenders must be present and appear in non-increasing hit order.
    expect(offenderHits).toHaveLength(OFFENDERS.length);
    expect(offenderHits).toEqual([...offenderHits].sort((a, b) => b - a));
  });
});
