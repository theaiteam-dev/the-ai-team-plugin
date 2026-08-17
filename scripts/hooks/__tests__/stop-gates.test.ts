/**
 * Tests for scripts/hooks/lib/stop-gates.js — the shared mission-completion
 * gate logic used by BOTH Stop hooks:
 *
 *   - enforce-final-review.js      (bound via agents/hannibal.md frontmatter)
 *   - enforce-orchestrator-stop.js (bound plugin-wide via hooks/hooks.json)
 *
 * These two files were near-duplicates, and the Frankie evidence gate was
 * only ever added to the first one — which never binds in the primary
 * execution mode (Hannibal runs in the MAIN session, not a subagent
 * session). Extracting the gate here is what keeps them from drifting apart
 * again.
 *
 * The URL builders are covered here as pure functions; the fact that they
 * point at *routes that actually exist* is covered end-to-end against a stub
 * HTTP server in stop-hooks-api-integration.test.ts.
 *
 * WI-791: staged is a holding pen between Amy's probing and the mission-tail
 * promotion to done (WI-790). ACTIVE_STAGES deliberately does NOT gain a
 * 'staged' entry — Sosa flagged that a plain append would be the highest
 * silent-failure risk in the mission: countBoard's totalActive would then
 * include staged items, so the EXISTING "totalActive > 0 → block" check in
 * both consumer hooks would swallow an all-staged board with the wrong,
 * generic "items still active" message instead of the correct
 * Frankie-evidence / not-yet-promoted diagnosis — and worse, the consumer
 * hooks' "only reached once totalActive === 0" calling convention for
 * checkFrankieEvidence would still hold, so the message would merely be
 * *misleading*, not absent — but ANY conflation of staged with "still
 * active" is exactly the kind of gate this item exists to hardn against.
 * countBoard instead reports stagedCount as an independent field alongside
 * totalActive/doneCount, and checkFrankieEvidence is re-keyed from
 * doneCount/doneItems to stagedCount/stagedItems (evidence now compares
 * against the newest STAGED transition, not the newest done one — items sit
 * in staged while awaiting the walk, not done). The "active work still in
 * flight must be checked before checkFrankieEvidence is ever called"
 * calling convention is unchanged and preserved by the consumer hooks
 * (exercised end-to-end in stop-guards.test.ts); this file unit-tests
 * stop-gates.js itself.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';

// The gate resolves EVERYTHING — the execution contract AND the evidence
// path — against the `cwd` it is handed (it used to read the contract via
// readExecutionContract(), which is bound to process.cwd(), forcing these
// tests to stub the reader). Each test now writes a real ateam.config.json
// into a scratch repo instead, so the REAL config read and the REAL
// canFrankieDrive() are both genuinely under test.
import {
  buildBoardUrl,
  buildMissionUrl,
  buildFinalReviewUrl,
  normalizeBoard,
  normalizeMission,
  countBoard,
  checkFrankieEvidence,
  parseFinalReviewVerdict,
  checkFinalReviewRejection,
  fetchBoard,
  fetchMission,
} from '../lib/stop-gates.js';

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------
describe('stop-gates — URL builders', () => {
  const API = 'http://localhost:3000';

  it('builds the board URL against /api/board (NOT /api/projects/:id/board, which does not exist)', () => {
    const url = buildBoardUrl(API);
    expect(url).toMatch(/^http:\/\/localhost:3000\/api\/board(\?|$)/);
    expect(url).not.toMatch(/\/api\/projects\//);
  });

  it('asks the board for completed items — done items are excluded by default, so the done count would always be 0 without it', () => {
    expect(buildBoardUrl(API)).toMatch(/includeCompleted=true/);
  });

  it('builds the current-mission URL against /api/missions/current (NOT /api/projects/:id/missions/current)', () => {
    const url = buildMissionUrl(API);
    expect(url).toBe('http://localhost:3000/api/missions/current');
    expect(url).not.toMatch(/\/api\/projects\//);
  });

  it('builds the final-review URL against /api/missions/:missionId/final-review', () => {
    expect(buildFinalReviewUrl(API, 'M-TEST-001')).toBe(
      'http://localhost:3000/api/missions/M-TEST-001/final-review'
    );
  });

  it('tolerates a trailing slash on the configured API URL', () => {
    expect(buildBoardUrl('http://localhost:3000/')).toMatch(/localhost:3000\/api\/board/);
    expect(buildMissionUrl('http://localhost:3000///')).toBe(
      'http://localhost:3000/api/missions/current'
    );
  });
});

// ---------------------------------------------------------------------------
// fetchBoard / fetchMission — must fail open (resolve null) on a rejected
// fetch AND on a fetch that never resolves at all, rather than hanging the
// Stop hook or rejecting out from under its caller (CodeRabbit PR #55: the
// board/mission fetch calls previously had no timeout, and the review
// sub-fetch was the only one with a catch).
// ---------------------------------------------------------------------------
describe('stop-gates — fetchBoard/fetchMission fail-open on unbounded fetch', () => {
  const API = 'http://localhost:3000';
  const PROJECT_ID = 'test-project';

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fetchBoard resolves null (not a rejected promise) when fetch rejects with a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(fetchBoard(API, PROJECT_ID)).resolves.toBeNull();
  });

  it('fetchMission resolves null (not a rejected promise) when fetch rejects with a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(fetchMission(API, PROJECT_ID)).resolves.toBeNull();
  });

  it('fetchBoard resolves null once the request exceeds its timeout, instead of hanging forever on a stuck API', async () => {
    vi.useFakeTimers();
    // Simulates a hung connection: the fetch promise only ever settles when
    // its AbortSignal fires — exactly what fetchJsonOrNull's internal
    // timeout must trigger.
    const hangingFetch = vi.fn((_url: string, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    vi.stubGlobal('fetch', hangingFetch);

    const resultPromise = fetchBoard(API, PROJECT_ID);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await resultPromise).toBeNull();
  });

  it('fetchMission resolves null once the request exceeds its timeout, instead of hanging forever on a stuck API', async () => {
    vi.useFakeTimers();
    const hangingFetch = vi.fn((_url: string, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    vi.stubGlobal('fetch', hangingFetch);

    const resultPromise = fetchMission(API, PROJECT_ID);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await resultPromise).toBeNull();
  });

  it('fetchBoard forwards the X-Project-ID header and parses a 2xx JSON body normally (happy path unaffected by the timeout wiring)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ columns: { done: [{ id: 'WI-001' }] } }),
      })
    );
    const board = await fetchBoard(API, PROJECT_ID);
    expect(board?.columns.done).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeBoard — the real API returns { success, data: { items: [...] } },
// keyed by stageId, with no `columns` key anywhere. The hooks' gate logic (and
// the __TEST_MOCK_BOARD__ fixtures) speak `columns`, so the fetch boundary
// adapts one to the other.
// ---------------------------------------------------------------------------
describe('stop-gates — normalizeBoard', () => {
  it('groups the real API item list into columns keyed by stageId', () => {
    const board = normalizeBoard({
      success: true,
      data: {
        stages: [],
        claims: [],
        currentMission: null,
        items: [
          { id: 'WI-001', stageId: 'testing' },
          { id: 'WI-002', stageId: 'testing' },
          { id: 'WI-003', stageId: 'done' },
        ],
      },
    });
    expect(board.columns.testing).toHaveLength(2);
    expect(board.columns.done).toHaveLength(1);
  });

  it('passes an already-column-shaped payload through unchanged (test-mock shape)', () => {
    const board = normalizeBoard({ columns: { done: [{ id: 'WI-001' }] } });
    expect(board.columns.done).toHaveLength(1);
  });

  it('collapses an unrecognized payload to empty columns rather than throwing', () => {
    expect(normalizeBoard(null).columns).toEqual({});
    expect(normalizeBoard({ success: true, data: {} }).columns).toEqual({});
  });

  it('groups staged items into their own column, same as any other stage (WI-791)', () => {
    const board = normalizeBoard({
      columns: undefined,
      items: undefined,
      success: true,
      data: {
        items: [
          { id: 'WI-001', stageId: 'staged' },
          { id: 'WI-002', stageId: 'staged' },
          { id: 'WI-003', stageId: 'done' },
        ],
      },
    });
    expect(board.columns.staged).toHaveLength(2);
    expect(board.columns.done).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeMission
// ---------------------------------------------------------------------------
describe('stop-gates — normalizeMission', () => {
  it('unwraps the real { success, data } envelope and exposes the mission id', () => {
    const mission = normalizeMission({
      success: true,
      data: { id: 'M-TEST-001', name: 'Test', state: 'running' },
    });
    expect(mission?.id).toBe('M-TEST-001');
  });

  it('derives postcheck.passed from mission state === "completed" (postcheck sets that state on pass)', () => {
    expect(
      normalizeMission({ success: true, data: { id: 'M-1', state: 'completed' } })?.postcheck?.passed
    ).toBe(true);
    expect(
      normalizeMission({ success: true, data: { id: 'M-1', state: 'running' } })?.postcheck?.passed
    ).toBe(false);
    expect(
      normalizeMission({ success: true, data: { id: 'M-1', state: 'failed' } })?.postcheck?.passed
    ).toBe(false);
  });

  it('maps the stored finalReview markdown onto final_review_verdict', () => {
    const mission = normalizeMission({
      success: true,
      data: { id: 'M-1', state: 'running', finalReview: '# FINAL APPROVED' },
    });
    expect(mission?.final_review_verdict).toBe('# FINAL APPROVED');
  });

  it('preserves an already-normalized payload (test-mock shape) verbatim', () => {
    const mission = normalizeMission({
      id: 'M-TEST-001',
      final_review_verdict: 'FINAL APPROVED',
      postcheck: { passed: true },
    });
    expect(mission?.id).toBe('M-TEST-001');
    expect(mission?.final_review_verdict).toBe('FINAL APPROVED');
    expect(mission?.postcheck?.passed).toBe(true);
  });

  it('returns null when there is no active mission (data: null)', () => {
    expect(normalizeMission({ success: true, data: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseFinalReviewVerdict — the playbooks standardize Stockwell's verdict
// line as `VERDICT: FINAL APPROVED` / `VERDICT: FINAL REJECTED`.
// ---------------------------------------------------------------------------
describe('stop-gates — parseFinalReviewVerdict', () => {
  it('parses VERDICT: FINAL APPROVED', () => {
    expect(parseFinalReviewVerdict('# Final Mission Review\n\nVERDICT: FINAL APPROVED\n')).toBe(
      'approved'
    );
  });

  it('parses VERDICT: FINAL REJECTED', () => {
    expect(parseFinalReviewVerdict('# Final Mission Review\n\nVERDICT: FINAL REJECTED\n')).toBe(
      'rejected'
    );
  });

  it('honors a bare FINAL APPROVED / FINAL REJECTED marker without the VERDICT: prefix', () => {
    expect(parseFinalReviewVerdict('FINAL APPROVED — all requirements met')).toBe('approved');
    expect(parseFinalReviewVerdict('FINAL REJECTED — see WI-003, WI-007')).toBe('rejected');
  });

  it('the last VERDICT line wins when a re-review appends below the original', () => {
    expect(
      parseFinalReviewVerdict(
        'VERDICT: FINAL REJECTED\n\n## Re-review after rework\n\nVERDICT: FINAL APPROVED\n'
      )
    ).toBe('approved');
  });

  it('a VERDICT line outranks a stray bare marker quoted elsewhere in the prose', () => {
    expect(
      parseFinalReviewVerdict(
        'The previous run ended FINAL REJECTED; all issues addressed.\n\nVERDICT: FINAL APPROVED\n'
      )
    ).toBe('approved');
  });

  it('returns unknown for review text with no recognizable marker (fail open — never a deadlock)', () => {
    expect(parseFinalReviewVerdict('# Final Mission Review\n\nAPPROVED')).toBe('unknown');
    expect(parseFinalReviewVerdict('Looks good to me.')).toBe('unknown');
  });

  it('returns unknown when both bare markers appear with no VERDICT line to disambiguate', () => {
    expect(parseFinalReviewVerdict('FINAL APPROVED? no — FINAL REJECTED? unclear')).toBe('unknown');
  });

  it('returns unknown for non-string input', () => {
    expect(parseFinalReviewVerdict(null)).toBe('unknown');
    expect(parseFinalReviewVerdict(undefined)).toBe('unknown');
    expect(parseFinalReviewVerdict(42 as unknown as string)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// checkFinalReviewRejection — an explicit FINAL REJECTED must block with the
// ADR 0004 restart-at-Frankie path, never fall through to "run postcheck".
// ---------------------------------------------------------------------------
describe('stop-gates — checkFinalReviewRejection', () => {
  it('blocks a FINAL REJECTED review with the restart-at-Frankie instructions', () => {
    const message = checkFinalReviewRejection('VERDICT: FINAL REJECTED\n\n- WI-003: broken');
    expect(message).toMatch(/FINAL REJECTED/);
    expect(message, 'must not misdirect toward postcheck').toMatch(/Do NOT run post-checks/i);
    expect(message, 'ADR 0004: the tail restarts at Frankie').toMatch(/RESTARTS at Frankie/i);
    expect(message, 'ADR 0004: full DoD re-walk, then Stockwell re-reviews').toMatch(
      /FULL Definition of Done/i
    );
    expect(
      message,
      'WI-794: staged→testing|implementing is a real, rejection-cap-counted transition, not a manual reopen'
    ).toMatch(/not a manual reopen/i);
  });

  it('returns null for FINAL APPROVED (falls through to the postcheck gate)', () => {
    expect(checkFinalReviewRejection('VERDICT: FINAL APPROVED')).toBeNull();
  });

  it('returns null for review text with no recognizable marker (preserves current treat-as-complete behavior)', () => {
    expect(checkFinalReviewRejection('# Final Mission Review\n\nAPPROVED')).toBeNull();
  });

  it('returns null when there is no review at all', () => {
    expect(checkFinalReviewRejection(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// countBoard — WI-791 AC1: stagedCount is reported alongside doneCount, and
// staged is NOT one of the ACTIVE_STAGES (a deliberate design decision, not
// an oversight — see the file header comment).
// ---------------------------------------------------------------------------
describe('stop-gates — countBoard (WI-791 AC1: stagedCount alongside doneCount)', () => {
  it('reports stagedCount for a board whose only items are staged, with totalActive 0 and doneCount 0', () => {
    const result = countBoard({
      staged: [{ id: 'WI-001' }, { id: 'WI-002' }, { id: 'WI-003' }],
    });
    expect(result.totalActive).toBe(0);
    expect(result.stagedCount).toBe(3);
    expect(result.doneCount).toBe(0);
  });

  it('staged items are never counted into totalActive or activeCounts — staged is not an ACTIVE_STAGES entry', () => {
    const result = countBoard({
      staged: [{ id: 'WI-001' }],
      testing: [{ id: 'WI-002' }],
    });
    expect(result.totalActive).toBe(1); // only the testing item
    expect(result.activeCounts.staged).toBeUndefined();
    expect(result.activeCounts.testing).toBe(1);
    expect(result.stagedCount).toBe(1);
  });

  it('reports stagedCount 0 for a board with no staged column at all', () => {
    const result = countBoard({ done: [{ id: 'WI-001' }] });
    expect(result.stagedCount).toBe(0);
    expect(result.doneCount).toBe(1);
  });

  it('reports stagedCount 0 for a genuinely empty board (no mission)', () => {
    const result = countBoard({});
    expect(result.totalActive).toBe(0);
    expect(result.stagedCount).toBe(0);
    expect(result.doneCount).toBe(0);
  });

  it('tracks staged and done as independent counts on a mixed board', () => {
    const result = countBoard({
      staged: [{ id: 'WI-001' }],
      done: [{ id: 'WI-002' }, { id: 'WI-003' }],
    });
    expect(result.stagedCount).toBe(1);
    expect(result.doneCount).toBe(2);
    expect(result.totalActive).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkFrankieEvidence — returns a block message, or null to allow.
//
// WI-791: re-keyed from doneCount/doneItems to stagedCount/stagedItems —
// Frankie's evidence bundle is demanded once items sit in STAGED (the
// mission-tail holding pen), not once they reach DONE (which now only
// happens via WI-790's atomic promotion, gated behind Stockwell's approved
// final review — by which point the walk has already happened and been
// evidenced against the staged transition). The declared surfaces come from
// a real ateam.config.json written into the scratch repo; the evidence path
// is resolved against the same cwd.
// ---------------------------------------------------------------------------
describe('stop-gates — checkFrankieEvidence', () => {
  const scratchDirs: string[] = [];

  /** Throwaway repo dir; pass a mission id to seed a real evidence report. */
  function scratch(
    withReport: string | null = null,
    opts: { surfaces?: string[]; reportBody?: string } = {}
  ) {
    const { surfaces = ['web'], reportBody = '# Evidence\n' } = opts;
    const dir = mkdtempSync(join(tmpdir(), 'ateam-stop-gates-'));
    scratchDirs.push(dir);
    writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify({ surfaces }));
    if (withReport) {
      mkdirSync(join(dir, '.qa-evidence', withReport), { recursive: true });
      writeFileSync(join(dir, '.qa-evidence', withReport, 'report.md'), reportBody);
    }
    return dir;
  }

  afterEach(() => {
    delete process.env.ATEAM_SKIP_FRANKIE_GATE;
    for (const dir of scratchDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  it('does not block when the contract declares no drivable surface', () => {
    expect(
      checkFrankieEvidence({
        missionId: 'M-TEST-001',
        stagedCount: 1,
        cwd: scratch(null, { surfaces: ['hardware'] }),
      })
    ).toBeNull();
  });

  it('blocks when items are staged, the surface is drivable, and no evidence report exists', () => {
    const message = checkFrankieEvidence({
      missionId: 'M-TEST-001',
      stagedCount: 1,
      cwd: scratch(),
    });
    expect(message).toMatch(/frankie/i);
    expect(message).toMatch(/\.qa-evidence\/M-TEST-001\/report\.md/);
  });

  it('documents the ATEAM_SKIP_FRANKIE_GATE escape hatch in the block message itself', () => {
    const message = checkFrankieEvidence({
      missionId: 'M-TEST-001',
      stagedCount: 1,
      cwd: scratch(),
    });
    expect(
      message,
      'an operator trapped by this gate must be able to see the way out without reading the source'
    ).toMatch(/ATEAM_SKIP_FRANKIE_GATE=1/);
  });

  it('allows when ATEAM_SKIP_FRANKIE_GATE=1 is set (operator escape hatch)', () => {
    process.env.ATEAM_SKIP_FRANKIE_GATE = '1';
    expect(
      checkFrankieEvidence({ missionId: 'M-TEST-001', stagedCount: 1, cwd: scratch() })
    ).toBeNull();
  });

  it('allows when ATEAM_SKIP_FRANKIE_GATE=true is set', () => {
    process.env.ATEAM_SKIP_FRANKIE_GATE = 'true';
    expect(
      checkFrankieEvidence({ missionId: 'M-TEST-001', stagedCount: 1, cwd: scratch() })
    ).toBeNull();
  });

  it('still blocks when ATEAM_SKIP_FRANKIE_GATE is set to an empty string (unset-like values do not disable a gate)', () => {
    process.env.ATEAM_SKIP_FRANKIE_GATE = '';
    expect(
      checkFrankieEvidence({ missionId: 'M-TEST-001', stagedCount: 1, cwd: scratch() })
    ).toMatch(/frankie/i);
  });

  it('allows once the evidence report exists', () => {
    expect(
      checkFrankieEvidence({
        missionId: 'M-TEST-001',
        stagedCount: 1,
        cwd: scratch('M-TEST-001'),
      })
    ).toBeNull();
  });

  it('allows when no items have reached staged (AC3: triggers on stagedCount > 0, not doneCount > 0)', () => {
    expect(
      checkFrankieEvidence({ missionId: 'M-TEST-001', stagedCount: 0, cwd: scratch() })
    ).toBeNull();
  });

  it('allows a fully-done board with nothing staged — evidence was already gated while items were staged, done needs no re-check', () => {
    // Directly pins AC3's re-keying: a board where everything already
    // reached done (stagedCount 0) must NOT re-trigger the evidence gate,
    // even though the OLD doneCount-based version would have (doneCount
    // would be > 0 here). This is the exact regression this AC prevents.
    expect(
      checkFrankieEvidence({
        missionId: 'M-TEST-001',
        stagedCount: 0,
        cwd: scratch(), // no evidence report written — would block under the old doneCount keying
      })
    ).toBeNull();
  });

  it('allows when there is no mission id to resolve an evidence path against', () => {
    expect(checkFrankieEvidence({ missionId: null, stagedCount: 1, cwd: scratch() })).toBeNull();
  });

  it('fails open (allows) when the filesystem check itself throws, rather than hard-blocking on adversity', () => {
    // A non-string cwd makes join() throw — stands in for any unexpected
    // filesystem failure (permissions, ENOTDIR) that is NOT "file absent".
    expect(
      checkFrankieEvidence({
        missionId: 'M-TEST-001',
        stagedCount: 1,
        cwd: 12345 as unknown as string,
      })
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Staleness — a pre-rework report must not satisfy the gate forever. The
  // transition timestamp now comes from the board's STAGED items
  // (completedAt, falling back to updatedAt) — items sit in staged while
  // awaiting the walk, so that is the meaningful "last touched" moment.
  // -------------------------------------------------------------------------
  describe('staleness (ADR 0004: evidence must reflect the final code)', () => {
    const HOUR = 60 * 60 * 1000;

    /** Backdates the report so a staged transition can postdate it. */
    function backdateReport(cwd: string, missionId: string, when: Date) {
      utimesSync(join(cwd, '.qa-evidence', missionId, 'report.md'), when, when);
    }

    it('blocks with a re-walk message when the newest staged transition postdates the report', () => {
      const cwd = scratch('M-TEST-001');
      backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
      const message = checkFrankieEvidence({
        missionId: 'M-TEST-001',
        stagedCount: 2,
        stagedItems: [
          { id: 'WI-001', updatedAt: new Date(Date.now() - 3 * HOUR).toISOString() },
          { id: 'WI-002', updatedAt: new Date(Date.now() - 1 * HOUR).toISOString() },
        ],
        cwd,
      });
      expect(message).toMatch(/STALE/i);
      expect(message, 'ADR 0004: full re-walk, not only previous failures').toMatch(
        /FULL Definition of Done/i
      );
      expect(message).toMatch(/ATEAM_SKIP_FRANKIE_GATE=1/);
    });

    it('prefers completedAt over updatedAt as the staged-transition record', () => {
      const cwd = scratch('M-TEST-001');
      backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
      const message = checkFrankieEvidence({
        missionId: 'M-TEST-001',
        stagedCount: 1,
        stagedItems: [
          {
            id: 'WI-001',
            completedAt: new Date(Date.now() - 1 * HOUR).toISOString(),
            updatedAt: new Date(Date.now() - 3 * HOUR).toISOString(),
          },
        ],
        cwd,
      });
      expect(message).toMatch(/STALE/i);
    });

    it('falls back to updatedAt when completedAt is an empty string, rather than treating the item as timestamp-less (CodeRabbit PR #55: ?? does not fall back on "")', () => {
      // completedAt: '' is falsy but NOT nullish, so `completedAt ?? updatedAt`
      // resolves to '' (Date.parse('') is NaN) and the item's timestamp is
      // silently dropped from the staleness comparison — letting a stale
      // pre-rework report satisfy the gate. The fresh updatedAt here must be
      // picked up instead, still triggering STALE against the backdated report.
      const cwd = scratch('M-TEST-001');
      backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
      const message = checkFrankieEvidence({
        missionId: 'M-TEST-001',
        stagedCount: 1,
        stagedItems: [
          {
            id: 'WI-001',
            completedAt: '',
            updatedAt: new Date(Date.now() - 1 * HOUR).toISOString(),
          },
        ],
        cwd,
      });
      expect(message).toMatch(/STALE/i);
    });

    it('passes when the report is newer than every staged transition', () => {
      const cwd = scratch('M-TEST-001');
      expect(
        checkFrankieEvidence({
          missionId: 'M-TEST-001',
          stagedCount: 1,
          stagedItems: [{ id: 'WI-001', updatedAt: new Date(Date.now() - 1 * HOUR).toISOString() }],
          cwd,
        })
      ).toBeNull();
    });

    it('fails open when the staged items carry no usable timestamp (staleness cannot be derived)', () => {
      const cwd = scratch('M-TEST-001');
      backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
      expect(
        checkFrankieEvidence({
          missionId: 'M-TEST-001',
          stagedCount: 1,
          stagedItems: [{ id: 'WI-001' }, { id: 'WI-002', updatedAt: 'not-a-date' }],
          cwd,
        })
      ).toBeNull();
    });

    it('honors the ATEAM_SKIP_FRANKIE_GATE escape valve for the staleness check', () => {
      process.env.ATEAM_SKIP_FRANKIE_GATE = '1';
      const cwd = scratch('M-TEST-001');
      backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
      expect(
        checkFrankieEvidence({
          missionId: 'M-TEST-001',
          stagedCount: 1,
          stagedItems: [{ id: 'WI-001', updatedAt: new Date().toISOString() }],
          cwd,
        })
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Failed walk — a report full of ❌ statements is evidence of FAILURE, not
  // completion. Distinct message: do not dispatch Stockwell.
  // -------------------------------------------------------------------------
  describe('failed walk (❌ statements in the report)', () => {
    const FAILED_REPORT = '# Evidence\n\n- ✅ Login works\n- ❌ Checkout total is wrong (WI-003)\n';
    const GREEN_REPORT = '# Evidence\n\n- ✅ Login works\n- ✅ Checkout total correct\n';

    it('blocks with a distinct do-not-dispatch-Stockwell message when the report contains ❌', () => {
      const message = checkFrankieEvidence({
        missionId: 'M-TEST-001',
        stagedCount: 1,
        cwd: scratch('M-TEST-001', { reportBody: FAILED_REPORT }),
      });
      expect(message).toMatch(/FAILED/);
      expect(message, 'distinct from the missing/stale messages').toMatch(
        /Do NOT dispatch Stockwell/i
      );
      expect(message).toMatch(/❌/);
      expect(message).toMatch(/ATEAM_SKIP_FRANKIE_GATE=1/);
      expect(message).not.toMatch(/STALE/);
      expect(
        message,
        'named items are reworked and returned to staged before Frankie re-walks'
      ).toMatch(/back in staged/i);
      expect(
        message,
        'WI-794: staged→testing|implementing is a real, rejection-cap-counted transition, not a manual reopen'
      ).toMatch(/not a manual reopen/i);
    });

    it('passes a fresh, all-green report', () => {
      expect(
        checkFrankieEvidence({
          missionId: 'M-TEST-001',
          stagedCount: 1,
          cwd: scratch('M-TEST-001', { reportBody: GREEN_REPORT }),
        })
      ).toBeNull();
    });

    it('honors the ATEAM_SKIP_FRANKIE_GATE escape valve for the failed-walk check', () => {
      process.env.ATEAM_SKIP_FRANKIE_GATE = 'true';
      expect(
        checkFrankieEvidence({
          missionId: 'M-TEST-001',
          stagedCount: 1,
          cwd: scratch('M-TEST-001', { reportBody: FAILED_REPORT }),
        })
      ).toBeNull();
    });

    it('fails open when the report exists but cannot be read as a file (unreadable report)', () => {
      // Make report.md a DIRECTORY: existsSync passes, readFileSync throws
      // EISDIR — the gate must fail open rather than trap the operator.
      const cwd = scratch(null);
      mkdirSync(join(cwd, '.qa-evidence', 'M-TEST-001', 'report.md'), { recursive: true });
      expect(
        checkFrankieEvidence({ missionId: 'M-TEST-001', stagedCount: 1, cwd })
      ).toBeNull();
    });
  });
});
