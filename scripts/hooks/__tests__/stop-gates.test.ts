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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readdirSync, readFileSync } from 'fs';
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
  buildItemsUrl,
  normalizeBoard,
  normalizeMission,
  countBoard,
  scopeBoardToMission,
  checkFrankieEvidence,
  parseFinalReviewVerdict,
  checkFinalReviewRejection,
  checkStagedNotPromoted,
  checkOrphanStagedItems,
  checkMissingFinalReview,
  checkUnparseableVerdict,
  checkPostcheck,
  isMissionActiveState,
  fetchBoard,
  fetchMission,
  fetchMissionItems,
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

  it('builds the mission-scoped items URL against /api/items?missionId=', () => {
    // /api/board is project-wide; promotion only ever sweeps the CURRENT
    // mission's items, so the gates need the mission's own membership list.
    expect(buildItemsUrl(API, 'M-TEST-001')).toBe(
      'http://localhost:3000/api/items?missionId=M-TEST-001'
    );
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

  // The payload from /api/missions/current has never carried a `postcheck`
  // key. It used to be SYNTHESIZED here as `{ passed: state === 'completed' }`,
  // which turned the post-check gate into a bare mission-state check that
  // passed with zero evidence any post-check ran — and, before the route
  // learned to prefer the ACTIVE mission, a stale completed mission could
  // satisfy it for the mission actually in flight. Absent now means null, and
  // null means "not passed" (checkPostcheck below).
  it('does NOT synthesize postcheck from the mission state — an absent key is null (fail closed)', () => {
    expect(
      normalizeMission({ success: true, data: { id: 'M-1', state: 'completed' } })?.postcheck
    ).toBeNull();
    expect(
      normalizeMission({ success: true, data: { id: 'M-1', state: 'running' } })?.postcheck
    ).toBeNull();
  });

  it('keeps the mission state so the gates can read the lifecycle directly', () => {
    expect(normalizeMission({ success: true, data: { id: 'M-1', state: 'completed' } })?.state).toBe(
      'completed'
    );
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
describe('stop-gates — parseFinalReviewVerdict (re-exported from @ai-team/shared)', () => {
  // The rule is ONE copy — packages/shared/src/final-review-verdict.ts, whose
  // own suite pins the full tolerated-decoration matrix. These cases exist so
  // the HOOK side is proven to be reading that rule and not a local mirror.
  it('reads the verdict from the report\'s LAST non-empty line', () => {
    expect(parseFinalReviewVerdict('# Review\n\nVERDICT: FINAL APPROVED\n')).toBe('approved');
    expect(parseFinalReviewVerdict('# Review\n\nVERDICT: FINAL REJECTED\n')).toBe('rejected');
  });

  it("a 'the earlier pass issued VERDICT: FINAL APPROVED' preamble does not flip a rejection", () => {
    expect(
      parseFinalReviewVerdict(
        'Context: the earlier pass issued VERDICT: FINAL APPROVED, which was premature.\n\nVERDICT: FINAL REJECTED'
      ),
      'first-line-wins parsed this as approved and would have promoted a rejected mission'
    ).toBe('rejected');
  });

  it('a 4-backtick block quoting a 3-backtick example cannot flip the verdict — there is no fence logic left to fool', () => {
    const report = [
      '# Final Mission Review',
      '',
      '````markdown',
      '```',
      'VERDICT: FINAL APPROVED',
      '```',
      '````',
      '',
      'VERDICT: FINAL REJECTED',
    ].join('\n');
    expect(parseFinalReviewVerdict(report)).toBe('rejected');
  });

  it('returns unknown when the last line is not the trailer (verdict buried mid-report, bare marker, or no marker)', () => {
    expect(parseFinalReviewVerdict('VERDICT: FINAL APPROVED\n\n- WI-001: notes')).toBe('unknown');
    expect(parseFinalReviewVerdict('# Review\n\nFINAL APPROVED')).toBe('unknown');
    expect(parseFinalReviewVerdict('# Review\n\nEverything looks reasonable.')).toBe('unknown');
  });

  it('returns unknown for non-string input', () => {
    expect(parseFinalReviewVerdict(null)).toBe('unknown');
    expect(parseFinalReviewVerdict(undefined)).toBe('unknown');
    expect(parseFinalReviewVerdict(42)).toBe('unknown');
  });

  it('the hook side does not carry its own copy of the rule — no fence stripper, no prose scan', () => {
    const source = readFileSync(join(__dirname, '..', 'lib', 'stop-gates.js'), 'utf8');
    expect(source, 'stripFencedBlocks was deleted with the prose-scanning rule').not.toMatch(
      /stripFencedBlocks/
    );
    expect(source, 'the rule must be imported from the built shared package').toMatch(
      /packages\/shared\/dist\/final-review-verdict\.js/
    );
  });
});

describe('stop-gates — checkFinalReviewRejection', () => {
  it('blocks a FINAL REJECTED review with the restart-at-Frankie instructions', () => {
    const message = checkFinalReviewRejection('- WI-003: broken\n\nVERDICT: FINAL REJECTED');
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

  it('returns null for review text with no verdict trailer — checkUnparseableVerdict owns that case', () => {
    expect(checkFinalReviewRejection('# Final Mission Review\n\nAPPROVED')).toBeNull();
  });

  it('returns null when the rejection is only quoted mid-report — the trailer is the verdict', () => {
    expect(
      checkFinalReviewRejection('VERDICT: FINAL REJECTED\n\nfixed now\n\nVERDICT: FINAL APPROVED')
    ).toBeNull();
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

  it('keeps a valid surface when a sibling entry is the wrong type — one parse rule, shared with qa-contract.js', () => {
    // This module used to hand-roll a stricter parser: a single non-string
    // entry collapsed the WHOLE surfaces array to [], silently disarming the
    // gate on a config that genuinely declares a drivable web surface.
    // normalizeContract() drops only the bad entry (and warns on stderr).
    const message = checkFrankieEvidence({
      missionId: 'M-TEST-001',
      stagedCount: 1,
      cwd: scratch(null, { surfaces: ['web', 42 as unknown as string] }),
    });
    expect(message, 'the declared web surface must still arm the gate').toMatch(/frankie/i);
  });

  it('drops unknown surfaces values (case-sensitive) exactly as qa-contract.js does', () => {
    expect(
      checkFrankieEvidence({
        missionId: 'M-TEST-001',
        stagedCount: 1,
        cwd: scratch(null, { surfaces: ['Web'] }),
      }),
      '"Web" is not "web" — the gate stays inert rather than firing on a surface nobody can drive'
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

    // ---------------------------------------------------------------------
    // Finding #18: `updatedAt` is @updatedAt — Prisma stamps it on EVERY
    // write, so a title edit or an assignedAgent clear after a clean walk
    // used to read as "items were reworked", forcing a full DoD re-walk for
    // nothing. The transition INTO staged is recorded as a work-log entry
    // (Amy's 'completed' entry advances probing → staged in the same
    // transaction), so that is what the evidence must postdate.
    // ---------------------------------------------------------------------
    describe('transition timestamp comes from the work log, not @updatedAt', () => {
      it('does NOT flag STALE when only updatedAt moved after the walk (an incidental touch, not a rework)', () => {
        const cwd = scratch('M-TEST-001');
        backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
        expect(
          checkFrankieEvidence({
            missionId: 'M-TEST-001',
            stagedCount: 1,
            stagedItems: [
              {
                id: 'WI-001',
                // Entered staged BEFORE the walk...
                workLogs: [
                  {
                    agent: 'Amy',
                    action: 'completed',
                    summary: 'Probing complete',
                    timestamp: new Date(Date.now() - 3 * HOUR).toISOString(),
                  },
                ],
                // ...but something touched the row afterwards (title edit,
                // assignedAgent clear, any write at all).
                updatedAt: new Date(Date.now() - 1 * HOUR).toISOString(),
              },
            ],
            cwd,
          })
        ).toBeNull();
      });

      it('DOES flag STALE when the work log shows the item re-entered staged after the walk (a real rework)', () => {
        const cwd = scratch('M-TEST-001');
        backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
        const message = checkFrankieEvidence({
          missionId: 'M-TEST-001',
          stagedCount: 1,
          stagedItems: [
            {
              id: 'WI-001',
              workLogs: [
                {
                  agent: 'Amy',
                  action: 'completed',
                  summary: 'Probing complete (first pass)',
                  timestamp: new Date(Date.now() - 4 * HOUR).toISOString(),
                },
                {
                  agent: 'Hannibal',
                  action: 'tail_rework',
                  summary: 'Tail rework: moved from staged to implementing',
                  timestamp: new Date(Date.now() - 3 * HOUR).toISOString(),
                },
                {
                  agent: 'Amy',
                  action: 'completed',
                  summary: 'Probing complete (after rework)',
                  timestamp: new Date(Date.now() - 1 * HOUR).toISOString(),
                },
              ],
              updatedAt: new Date(Date.now() - 1 * HOUR).toISOString(),
            },
          ],
          cwd,
        });
        expect(message).toMatch(/STALE/i);
      });

      // -------------------------------------------------------------------
      // The rework path itself: Hannibal moves an item OUT of staged with a
      // real board-move (WI-794), which records a `tail_rework` entry, and the
      // item later comes BACK to staged by another board-move — a path that
      // writes no `completed` entry. Keying only on `completed` then yields the
      // PRE-rework transition, and because that is non-null the
      // completedAt/updatedAt fallback never runs, so the pre-rework (stale)
      // evidence bundle satisfies the gate forever.
      // -------------------------------------------------------------------
      it('DOES flag STALE when the newest work-log entry is a tail_rework with no recorded re-entry (rework after the walk)', () => {
        const cwd = scratch('M-TEST-001');
        backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
        const message = checkFrankieEvidence({
          missionId: 'M-TEST-001',
          stagedCount: 1,
          stagedItems: [
            {
              id: 'WI-001',
              workLogs: [
                {
                  agent: 'Amy',
                  action: 'completed',
                  summary: 'Probing complete (pre-rework)',
                  timestamp: new Date(Date.now() - 4 * HOUR).toISOString(),
                },
                {
                  agent: 'Hannibal',
                  action: 'tail_rework',
                  summary: 'Tail rework: moved from staged to implementing',
                  timestamp: new Date(Date.now() - 1 * HOUR).toISOString(),
                },
              ],
              // No completedAt/updatedAt at all: the STALE verdict must come
              // from the tail_rework entry itself, not from a fallback.
            },
          ],
          cwd,
        });
        expect(message).toMatch(/STALE/i);
        expect(message).toMatch(/FULL Definition of Done/i);
      });

      it('does NOT flag STALE when a completed entry follows the tail_rework and the report postdates it (rework fully re-walked)', () => {
        const cwd = scratch('M-TEST-001');
        backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 1 * HOUR));
        expect(
          checkFrankieEvidence({
            missionId: 'M-TEST-001',
            stagedCount: 1,
            stagedItems: [
              {
                id: 'WI-001',
                workLogs: [
                  {
                    agent: 'Hannibal',
                    action: 'tail_rework',
                    summary: 'Tail rework: moved from staged to implementing',
                    timestamp: new Date(Date.now() - 4 * HOUR).toISOString(),
                  },
                  {
                    agent: 'Amy',
                    action: 'completed',
                    summary: 'Probing complete (after rework)',
                    timestamp: new Date(Date.now() - 3 * HOUR).toISOString(),
                  },
                ],
              },
            ],
            cwd,
          })
        ).toBeNull();
      });

      it('ignores annotation (note) entries when deriving the staged transition', () => {
        const cwd = scratch('M-TEST-001');
        backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
        expect(
          checkFrankieEvidence({
            missionId: 'M-TEST-001',
            stagedCount: 1,
            stagedItems: [
              {
                id: 'WI-001',
                workLogs: [
                  {
                    agent: 'Amy',
                    action: 'completed',
                    summary: 'Probing complete',
                    timestamp: new Date(Date.now() - 3 * HOUR).toISOString(),
                  },
                  {
                    agent: 'system',
                    action: 'note',
                    summary: 'Someone annotated the item after the walk',
                    timestamp: new Date(Date.now() - 1 * HOUR).toISOString(),
                  },
                ],
              },
            ],
            cwd,
          })
        ).toBeNull();
      });

      it('accepts the snake_case work_log key too (CLAUDE.md/CLI spelling of the same relation)', () => {
        const cwd = scratch('M-TEST-001');
        backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
        expect(
          checkFrankieEvidence({
            missionId: 'M-TEST-001',
            stagedCount: 1,
            stagedItems: [
              {
                id: 'WI-001',
                work_log: [
                  {
                    agent: 'Amy',
                    action: 'completed',
                    summary: 'Probing complete',
                    timestamp: new Date(Date.now() - 3 * HOUR).toISOString(),
                  },
                ],
                updatedAt: new Date(Date.now() - 1 * HOUR).toISOString(),
              },
            ],
            cwd,
          })
        ).toBeNull();
      });

      it('falls back to completedAt/updatedAt for an item whose payload carries no work log at all', () => {
        const cwd = scratch('M-TEST-001');
        backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
        expect(
          checkFrankieEvidence({
            missionId: 'M-TEST-001',
            stagedCount: 1,
            stagedItems: [
              { id: 'WI-001', workLogs: [], updatedAt: new Date(Date.now() - 1 * HOUR).toISOString() },
            ],
            cwd,
          })
        ).toMatch(/STALE/i);
      });

      it('accepts Date objects as well as ISO strings on work-log timestamps', () => {
        const cwd = scratch('M-TEST-001');
        backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
        expect(
          checkFrankieEvidence({
            missionId: 'M-TEST-001',
            stagedCount: 1,
            stagedItems: [
              {
                id: 'WI-001',
                workLogs: [
                  { agent: 'Amy', action: 'completed', summary: 'x', timestamp: new Date(Date.now() - 1 * HOUR) },
                ],
              },
            ],
            cwd,
          })
        ).toMatch(/STALE/i);
      });
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

// ---------------------------------------------------------------------------
// checkStagedNotPromoted — items in staged mean promotion (WI-790) has not
// run. Unlike every other gate here it used to have NO override at all, so an
// API server predating WI-790 (or a verdict that parses as 'unknown') left
// Hannibal blocked forever with no way out.
// ---------------------------------------------------------------------------
describe('stop-gates — checkStagedNotPromoted', () => {
  afterEach(() => {
    delete process.env.ATEAM_SKIP_PROMOTION_GATE;
    delete process.env.ATEAM_SKIP_FRANKIE_GATE;
  });

  it('allows the stop when nothing is staged', () => {
    expect(checkStagedNotPromoted(0)).toBeNull();
  });

  it('blocks with the promotion diagnosis when items are staged and no review has been written', () => {
    const message = checkStagedNotPromoted(3);
    expect(message).toMatch(/3 item\(s\)/);
    expect(message).toMatch(/promot/i);
    expect(message).toMatch(/Stockwell/);
  });

  it('names its own ATEAM_SKIP_PROMOTION_GATE override inside the block message', () => {
    expect(
      checkStagedNotPromoted(1),
      'an operator trapped by this gate must see the way out without reading the source'
    ).toMatch(/ATEAM_SKIP_PROMOTION_GATE=1/);
  });

  it('never names ATEAM_SKIP_FRANKIE_GATE — the two overrides are deliberately separate decisions', () => {
    expect(checkStagedNotPromoted(1)).not.toMatch(/ATEAM_SKIP_FRANKIE_GATE/);
  });

  it('allows the stop when ATEAM_SKIP_PROMOTION_GATE=1 / =true is set', () => {
    process.env.ATEAM_SKIP_PROMOTION_GATE = '1';
    expect(checkStagedNotPromoted(2)).toBeNull();
    process.env.ATEAM_SKIP_PROMOTION_GATE = 'true';
    expect(checkStagedNotPromoted(2)).toBeNull();
  });

  it('still blocks when ATEAM_SKIP_PROMOTION_GATE is an empty string (unset-like values do not disable a gate)', () => {
    process.env.ATEAM_SKIP_PROMOTION_GATE = '';
    expect(checkStagedNotPromoted(2)).toMatch(/staged/i);
  });

  it('is NOT suppressed by ATEAM_SKIP_FRANKIE_GATE — that override covers only the Frankie evidence sub-check', () => {
    process.env.ATEAM_SKIP_FRANKIE_GATE = '1';
    expect(checkStagedNotPromoted(2)).toMatch(/staged/i);
  });

  describe('a review already exists but nothing was promoted', () => {
    it('diagnoses the APPROVED-but-unpromoted case (an API predating WI-790) and names both ways out', () => {
      const message = checkStagedNotPromoted(2, {
        finalReview: '# Final Mission Review\n\nVERDICT: FINAL APPROVED\n',
      });
      expect(message).toMatch(/APPROVED/);
      expect(message).toMatch(/2 item\(s\) are still staged/);
      expect(message).toMatch(/WI-790/);
      expect(message, 'the operator can re-POST the review...').toMatch(/writeFinalReview/);
      expect(message, '...or override the gate').toMatch(/ATEAM_SKIP_PROMOTION_GATE=1/);
    });

    it('does not mention Frankie in the approved-but-unpromoted message — nothing here is about the walk', () => {
      expect(
        checkStagedNotPromoted(1, { finalReview: 'VERDICT: FINAL APPROVED' })
      ).not.toMatch(/frankie/i);
    });

    it('diagnoses a FINAL REJECTED review as rework-then-restart, never "re-POST the review"', () => {
      const message = checkStagedNotPromoted(1, { finalReview: 'VERDICT: FINAL REJECTED' });
      expect(message).toMatch(/REJECTED/);
      expect(message).toMatch(/rework/i);
      expect(message).not.toMatch(/writeFinalReview/);
    });

    it('diagnoses an unparseable verdict — promotion only ever runs on FINAL APPROVED', () => {
      const message = checkStagedNotPromoted(1, { finalReview: 'Looks good, shipping it.' });
      expect(message).toMatch(/states no verdict/i);
      expect(message, 'the way out is the trailer requirement').toMatch(
        /LAST line must be exactly "VERDICT: FINAL APPROVED" or "VERDICT: FINAL REJECTED"/
      );
      expect(message).toMatch(/ATEAM_SKIP_PROMOTION_GATE=1/);
    });

    it('treats a blank review string as no review at all (falls back to the dispatch-Stockwell message)', () => {
      expect(checkStagedNotPromoted(1, { finalReview: '   ' })).toMatch(/Stockwell/);
    });
  });
});

// ---------------------------------------------------------------------------
// Cloudflare Access headers — every API request these hooks make must carry
// the CF service-token headers when they are configured. This is the THIRD
// occurrence of the same bug shape (observer.js documents the last one): a
// fetch built its headers inline as `{ 'X-Project-ID': projectId }`, so behind
// Cloudflare Access the request was answered with a 302/403 before it ever
// reached the app, fetchJsonOrNull returned null, and EVERY gate in this
// module failed open — silently, exactly like the telemetry blackout did.
// ---------------------------------------------------------------------------
describe('stop-gates — Cloudflare Access service-token headers', () => {
  const API = 'http://localhost:3000';
  const PROJECT_ID = 'cf-project';

  beforeEach(() => {
    process.env.ACCESS_CLIENT_ID = 'cf-id.access';
    process.env.ACCESS_CLIENT_SECRET = 'cf-secret';
  });

  afterEach(() => {
    delete process.env.ACCESS_CLIENT_ID;
    delete process.env.ACCESS_CLIENT_SECRET;
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function headersOf(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
    return (fetchMock.mock.calls[call][1] as { headers: Record<string, string> }).headers;
  }

  it('fetchBoard sends CF-Access-Client-Id/Secret alongside X-Project-ID', async () => {
    const fetchMock = stubFetch({ success: true, data: { items: [] } });
    await fetchBoard(API, PROJECT_ID);

    expect(headersOf(fetchMock)).toMatchObject({
      'X-Project-ID': PROJECT_ID,
      'CF-Access-Client-Id': 'cf-id.access',
      'CF-Access-Client-Secret': 'cf-secret',
    });
  });

  it('fetchMission sends them on BOTH the mission and the final-review sub-fetch', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('final-review')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { finalReview: 'VERDICT: FINAL APPROVED' } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { id: 'M-1', state: 'running' } }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchMission(API, PROJECT_ID);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of [0, 1]) {
      expect(headersOf(fetchMock, call)).toMatchObject({
        'CF-Access-Client-Id': 'cf-id.access',
        'CF-Access-Client-Secret': 'cf-secret',
      });
    }
  });

  it('fetchMissionItems sends them too', async () => {
    const fetchMock = stubFetch({ success: true, data: [] });
    await fetchMissionItems(API, PROJECT_ID, 'M-1');

    expect(headersOf(fetchMock)).toMatchObject({
      'X-Project-ID': PROJECT_ID,
      'CF-Access-Client-Id': 'cf-id.access',
      'CF-Access-Client-Secret': 'cf-secret',
    });
  });

  // TRIPWIRE. Not a test of behavior — a test that the bug shape cannot come
  // back a fourth time in a file nobody thought to re-check.
  it('no hook builds an X-Project-ID header inline — apiEventHeaders() is the only place that spells it', () => {
    const hooksDir = join(__dirname, '..');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        // observer.js DEFINES apiEventHeaders — the one legitimate spelling.
        if (full === join(hooksDir, 'lib', 'observer.js')) continue;

        const source = readFileSync(full, 'utf8');
        for (const [index, line] of source.split('\n').entries()) {
          // A header OBJECT literal keyed by X-Project-ID (prose mentioning the
          // header in a comment is fine, and must not false-positive).
          if (/['"]X-Project-ID['"]\s*:/.test(line)) {
            offenders.push(`${full}:${index + 1}: ${line.trim()}`);
          }
        }
      }
    };

    walk(hooksDir);

    expect(
      offenders,
      'Build API request headers with apiEventHeaders(projectId) from lib/observer.js. ' +
        'An inline { "X-Project-ID": projectId } object drops the CF-Access service-token ' +
        'headers, so behind Cloudflare Access the request 302/403s and the caller fails open.'
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchMissionItems — mission membership, or null (never a throw).
// ---------------------------------------------------------------------------
describe('stop-gates — fetchMissionItems', () => {
  const API = 'http://localhost:3000';

  afterEach(() => vi.unstubAllGlobals());

  it('unwraps the { success, data } envelope into a plain array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [{ id: 'WI-001' }, { id: 'WI-002' }] }),
      })
    );
    await expect(fetchMissionItems(API, 'p', 'M-1')).resolves.toEqual([
      { id: 'WI-001' },
      { id: 'WI-002' },
    ]);
  });

  it('resolves null (never throws) when the API is unreachable — callers fall back to the project-wide board', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(fetchMissionItems(API, 'p', 'M-1')).resolves.toBeNull();
  });

  it('resolves null on a non-2xx (e.g. an API server too old to know ?missionId=)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(fetchMissionItems(API, 'p', 'M-1')).resolves.toBeNull();
  });

  it('does not even attempt a fetch without a mission id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchMissionItems(API, 'p', null)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// scopeBoardToMission — /api/board is PROJECT-wide, promotion is MISSION-wide.
// One orphaned staged item used to block every future stop of every future
// mission, with advice ("re-POST the final review") that could never clear it.
// ---------------------------------------------------------------------------
describe('stop-gates — scopeBoardToMission', () => {
  const columns = {
    staged: [{ id: 'WI-001' }, { id: 'WI-002' }, { id: 'WI-ORPHAN' }],
    done: [{ id: 'WI-000' }, { id: 'WI-OLD' }],
  };
  const missionItems = [{ id: 'WI-001' }, { id: 'WI-002' }, { id: 'WI-000' }];

  it('counts only the staged items that belong to the mission', () => {
    const scope = scopeBoardToMission(columns, missionItems);
    expect(scope.scoped).toBe(true);
    expect(scope.stagedCount).toBe(2);
    expect(scope.stagedItems.map((i: any) => i.id)).toEqual(['WI-001', 'WI-002']);
  });

  it('counts only the done items that belong to the mission', () => {
    expect(scopeBoardToMission(columns, missionItems).doneCount).toBe(1);
  });

  it('reports staged items that belong to no mission item as orphans, by id', () => {
    expect(scopeBoardToMission(columns, missionItems).orphanStagedIds).toEqual(['WI-ORPHAN']);
  });

  it('an orphan-only board leaves the mission with nothing staged — the gate must not fire', () => {
    const scope = scopeBoardToMission({ staged: [{ id: 'WI-ORPHAN' }] }, [{ id: 'WI-001' }]);
    expect(scope.stagedCount).toBe(0);
    expect(checkStagedNotPromoted(scope.stagedCount)).toBeNull();
  });

  it('falls back to the project-wide view when membership is unknown (null) — scoping may only ever narrow on positive knowledge', () => {
    const scope = scopeBoardToMission(columns, null);
    expect(scope.scoped).toBe(false);
    expect(scope.stagedCount).toBe(3);
    expect(scope.doneCount).toBe(2);
    expect(scope.orphanStagedIds).toEqual([]);
  });

  it('falls back to the project-wide view when the mission has no linked items at all', () => {
    expect(scopeBoardToMission(columns, []).stagedCount).toBe(3);
  });

  it('tolerates junk entries in either list rather than throwing', () => {
    const scope = scopeBoardToMission({ staged: [null, 'WI-001', { id: 'WI-001' }] } as any, [
      { id: 'WI-001' },
      null,
      { nope: true },
    ] as any);
    expect(scope.stagedCount).toBe(1);
    expect(scope.orphanStagedIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// checkStagedNotPromoted — orphan reporting.
// ---------------------------------------------------------------------------
describe('stop-gates — checkStagedNotPromoted names orphaned staged items', () => {
  afterEach(() => delete process.env.ATEAM_SKIP_PROMOTION_GATE);

  it('appends the orphan ids and a remediation that can actually clear them', () => {
    const message = checkStagedNotPromoted(1, { orphanStagedIds: ['WI-OLD', 'WI-STRAY'] });
    expect(message).toMatch(/WI-OLD, WI-STRAY/);
    expect(message, 'the way out is a board-move or an archive, not another review').toMatch(
      /board-move moveItem/
    );
    expect(message).toMatch(/do NOT belong to this mission/i);
  });

  it('says nothing about orphans when there are none', () => {
    expect(checkStagedNotPromoted(1)).not.toMatch(/orphan|do NOT belong/i);
  });

  it('never blocks on orphans alone — with nothing of THIS mission staged the gate is silent', () => {
    expect(checkStagedNotPromoted(0, { orphanStagedIds: ['WI-OLD'] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkMissingFinalReview — the gate that closed the two-stop escape hatch.
// ---------------------------------------------------------------------------
describe('stop-gates — checkMissingFinalReview', () => {
  it('BLOCKS on an all-staged board with no review — doneCount is 0 by construction there', () => {
    // This is the exact board the old doneCount-keyed gate was silent on:
    // nothing reaches done except via promotion, and promotion only runs on an
    // APPROVED review — so keying the "no review yet" gate on done items meant
    // it could never fire on the board that needed it.
    const message = checkMissingFinalReview({ pendingCount: 2, finalReview: null });
    expect(message).toMatch(/Stockwell/);
    expect(message).toMatch(/Final Mission Review/i);
  });

  it('blocks on a done board with no review too (unchanged behavior)', () => {
    expect(checkMissingFinalReview({ pendingCount: 1, finalReview: undefined })).toMatch(
      /Final Mission Review/i
    );
  });

  it('falls through once a review exists', () => {
    expect(
      checkMissingFinalReview({ pendingCount: 3, finalReview: 'VERDICT: FINAL APPROVED' })
    ).toBeNull();
  });

  it('falls through when nothing has finished the pipeline', () => {
    expect(checkMissingFinalReview({ pendingCount: 0, finalReview: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkOrphanStagedItems — FIX B. Mission scoping made the promotion gate's
// counts and messages correct; it must never make an unexplained staged item
// DISAPPEAR. Board staged=[WI-1] with no MissionItem link and mission
// items=[WI-99] used to leave every gate silent, so the hook emitted {} on the
// FIRST stop.
// ---------------------------------------------------------------------------
describe('stop-gates — checkOrphanStagedItems', () => {
  const ENV = process.env.ATEAM_SKIP_PROMOTION_GATE;
  afterEach(() => {
    if (ENV === undefined) delete process.env.ATEAM_SKIP_PROMOTION_GATE;
    else process.env.ATEAM_SKIP_PROMOTION_GATE = ENV;
  });

  it('allows the stop when there are no orphans', () => {
    expect(checkOrphanStagedItems([])).toBeNull();
    expect(checkOrphanStagedItems(undefined)).toBeNull();
    expect(checkOrphanStagedItems(null)).toBeNull();
  });

  it("BLOCKS on the author's exact fixture — one staged item with no mission link", () => {
    const { orphanStagedIds } = scopeBoardToMission(
      { staged: [{ id: 'WI-1' }] },
      [{ id: 'WI-99' }]
    );
    expect(orphanStagedIds).toEqual(['WI-1']);
    const message = checkOrphanStagedItems(orphanStagedIds);
    expect(message, 'an unexplained staged item is never silently dropped').not.toBeNull();
    expect(message).toMatch(/WI-1/);
  });

  it('names every orphan and all three remediations that can actually clear one', () => {
    const message = String(checkOrphanStagedItems(['WI-1', 'WI-2']));
    expect(message).toMatch(/WI-1/);
    expect(message).toMatch(/WI-2/);
    expect(message, 'attach to the mission').toMatch(/attach it to this mission/i);
    expect(message, 'move back into the pipeline').toMatch(/board-move moveItem/);
    expect(message, 'or archive it').toMatch(/archive/i);
  });

  it('names ATEAM_SKIP_PROMOTION_GATE as the operator override, and honors it', () => {
    expect(String(checkOrphanStagedItems(['WI-1']))).toMatch(/ATEAM_SKIP_PROMOTION_GATE=1/);
    process.env.ATEAM_SKIP_PROMOTION_GATE = '1';
    expect(checkOrphanStagedItems(['WI-1'])).toBeNull();
    process.env.ATEAM_SKIP_PROMOTION_GATE = 'true';
    expect(checkOrphanStagedItems(['WI-1'])).toBeNull();
  });

  it('still blocks when the override is set to an unset-like empty string', () => {
    process.env.ATEAM_SKIP_PROMOTION_GATE = '';
    expect(checkOrphanStagedItems(['WI-1'])).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkUnparseableVerdict — a review that states no verdict promoted nothing,
// so it is not "review complete". Fail CLOSED with the trailer requirement,
// which the operator clears by re-POSTing the report.
// ---------------------------------------------------------------------------
describe('stop-gates — checkUnparseableVerdict', () => {
  it('blocks a written review whose last line is not the verdict trailer', () => {
    const message = String(
      checkUnparseableVerdict('# Final Mission Review\n\nVERDICT: FINAL APPROVED\n\n- notes')
    );
    expect(message).toMatch(/states no verdict/i);
    expect(message, 'the remediation is the trailer requirement itself').toMatch(
      /LAST line must be exactly "VERDICT: FINAL APPROVED" or "VERDICT: FINAL REJECTED"/
    );
    expect(message).toMatch(/writeFinalReview/);
  });

  it('falls through for a readable approved or rejected verdict', () => {
    expect(checkUnparseableVerdict('body\n\nVERDICT: FINAL APPROVED')).toBeNull();
    expect(checkUnparseableVerdict('body\n\nVERDICT: FINAL REJECTED')).toBeNull();
  });

  it('falls through when no review has been written at all (the missing-review gate owns that)', () => {
    expect(checkUnparseableVerdict(null)).toBeNull();
    expect(checkUnparseableVerdict(undefined)).toBeNull();
    expect(checkUnparseableVerdict('')).toBeNull();
    expect(checkUnparseableVerdict('   \n\n')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkPostcheck — FAIL CLOSED, and INDEPENDENT OF BOARD CONTENTS.
//
// Two defects converge here. The old synthesis (`{ passed: state ===
// 'completed' }`) made this a bare mission-state check that passed with zero
// evidence a post-check ran. Then the `pendingCount > 0` precondition added to
// fix that made the gate silent in exactly the state it exists for: once an
// APPROVED review promotes every staged item and those items are archived, the
// board is empty, so the post-check never ran, the mission stayed `running`
// forever, and POST /api/missions 409'd until someone found `force: true`.
// Whether a post-check is owed is a fact about the MISSION, so nothing here
// reads the board.
// ---------------------------------------------------------------------------
describe('stop-gates — checkPostcheck', () => {
  const APPROVED = '# Final Mission Review\n\nVERDICT: FINAL APPROVED\n';

  it('BLOCKS a running mission with an approved review and an EMPTY board (the promoted-then-archived case)', () => {
    const message = checkPostcheck({
      finalReview: APPROVED,
      postcheck: null,
      missionState: 'running',
    });
    expect(message, 'an empty board is not evidence a post-check ran').toMatch(
      /post-checks have not passed/i
    );
    expect(message).toMatch(/ateam missions-postcheck/);
  });

  it('takes no board argument at all — the gate cannot be disarmed by emptying the board', () => {
    expect(checkPostcheck.length, 'one destructured options object, no board counts').toBe(1);
    const source = readFileSync(join(__dirname, '..', 'lib', 'stop-gates.js'), 'utf8');
    const fn = source.slice(source.indexOf('export function checkPostcheck'));
    expect(fn.slice(0, fn.indexOf('\n}')), 'no pendingCount precondition').not.toMatch(
      /pendingCount/
    );
  });

  it('BLOCKS a running mission whose payload carries no postcheck key (the real /api/missions/current shape)', () => {
    expect(
      checkPostcheck({ finalReview: APPROVED, postcheck: null, missionState: 'running' })
    ).toMatch(/post-checks have not passed/i);
  });

  it('blocks a running mission that affirmatively reports a FAILED postcheck', () => {
    expect(
      checkPostcheck({ finalReview: APPROVED, postcheck: { passed: false }, missionState: 'running' })
    ).toMatch(/post-checks/i);
  });

  it('releases on an affirmative postcheck.passed === true', () => {
    expect(
      checkPostcheck({ finalReview: APPROVED, postcheck: { passed: true }, missionState: 'running' })
    ).toBeNull();
  });

  it('does not accept a truthy-but-not-true passed value', () => {
    expect(
      checkPostcheck({ finalReview: APPROVED, postcheck: { passed: 'yes' }, missionState: 'running' })
    ).toMatch(/post-checks/i);
  });

  it("releases on mission state 'completed' — POST /api/missions/postcheck is that state's only writer, so it IS the recorded pass", () => {
    expect(
      checkPostcheck({ finalReview: APPROVED, postcheck: null, missionState: 'completed' })
    ).toBeNull();
  });

  it('releases on the other over states too — a failed/archived mission can never be post-checked again, so blocking would be an unclearable trap', () => {
    for (const state of ['failed', 'archived']) {
      expect(
        checkPostcheck({ finalReview: APPROVED, postcheck: null, missionState: state }),
        `${state} must not deadlock the end of the mission`
      ).toBeNull();
    }
  });

  it('blocks on an unknown/absent mission state — an unrecognized lifecycle fails CLOSED', () => {
    expect(
      checkPostcheck({ finalReview: APPROVED, postcheck: null, missionState: null })
    ).toMatch(/post-checks/i);
    expect(isMissionActiveState(undefined)).toBe(true);
    expect(isMissionActiveState('running')).toBe(true);
    expect(isMissionActiveState('completed')).toBe(false);
  });

  it('falls through when no review has been written (the missing-review gate owns that case)', () => {
    expect(
      checkPostcheck({ finalReview: null, postcheck: null, missionState: 'running' })
    ).toBeNull();
  });

  it('falls through on a REJECTED verdict — post-checks must not run, and checkFinalReviewRejection owns the message', () => {
    expect(
      checkPostcheck({
        finalReview: 'issues\n\nVERDICT: FINAL REJECTED',
        postcheck: null,
        missionState: 'running',
      })
    ).toBeNull();
  });

  it('falls through on an UNKNOWN verdict — checkUnparseableVerdict owns that case, and nothing was promoted', () => {
    expect(
      checkPostcheck({
        finalReview: '# Final Mission Review\n\nlooks fine',
        postcheck: null,
        missionState: 'running',
      })
    ).toBeNull();
  });
});
