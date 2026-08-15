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
 */

import { describe, it, expect, afterEach } from 'vitest';
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
  checkFrankieEvidence,
  parseFinalReviewVerdict,
  checkFinalReviewRejection,
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
    expect(message, 'ADR 0005: reopening done items is a manual operator action').toMatch(
      /manual operator action/i
    );
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
// checkFrankieEvidence — returns a block message, or null to allow.
//
// The declared surfaces come from a real ateam.config.json written into the
// scratch repo; the evidence path is resolved against the same cwd.
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
        doneCount: 1,
        cwd: scratch(null, { surfaces: ['hardware'] }),
      })
    ).toBeNull();
  });

  it('blocks when the mission is done, the surface is drivable, and no evidence report exists', () => {
    const message = checkFrankieEvidence({
      missionId: 'M-TEST-001',
      doneCount: 1,
      cwd: scratch(),
    });
    expect(message).toMatch(/frankie/i);
    expect(message).toMatch(/\.qa-evidence\/M-TEST-001\/report\.md/);
  });

  it('documents the ATEAM_SKIP_FRANKIE_GATE escape hatch in the block message itself', () => {
    const message = checkFrankieEvidence({
      missionId: 'M-TEST-001',
      doneCount: 1,
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
      checkFrankieEvidence({ missionId: 'M-TEST-001', doneCount: 1, cwd: scratch() })
    ).toBeNull();
  });

  it('allows when ATEAM_SKIP_FRANKIE_GATE=true is set', () => {
    process.env.ATEAM_SKIP_FRANKIE_GATE = 'true';
    expect(
      checkFrankieEvidence({ missionId: 'M-TEST-001', doneCount: 1, cwd: scratch() })
    ).toBeNull();
  });

  it('still blocks when ATEAM_SKIP_FRANKIE_GATE is set to an empty string (unset-like values do not disable a gate)', () => {
    process.env.ATEAM_SKIP_FRANKIE_GATE = '';
    expect(
      checkFrankieEvidence({ missionId: 'M-TEST-001', doneCount: 1, cwd: scratch() })
    ).toMatch(/frankie/i);
  });

  it('allows once the evidence report exists', () => {
    expect(
      checkFrankieEvidence({
        missionId: 'M-TEST-001',
        doneCount: 1,
        cwd: scratch('M-TEST-001'),
      })
    ).toBeNull();
  });

  it('allows when no items have reached done', () => {
    expect(
      checkFrankieEvidence({ missionId: 'M-TEST-001', doneCount: 0, cwd: scratch() })
    ).toBeNull();
  });

  it('allows when there is no mission id to resolve an evidence path against', () => {
    expect(checkFrankieEvidence({ missionId: null, doneCount: 1, cwd: scratch() })).toBeNull();
  });

  it('fails open (allows) when the filesystem check itself throws, rather than hard-blocking on adversity', () => {
    // A non-string cwd makes join() throw — stands in for any unexpected
    // filesystem failure (permissions, ENOTDIR) that is NOT "file absent".
    expect(
      checkFrankieEvidence({
        missionId: 'M-TEST-001',
        doneCount: 1,
        cwd: 12345 as unknown as string,
      })
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Staleness — a pre-rework report must not satisfy the gate forever. The
  // done-transition timestamp comes from the board's done items
  // (completedAt, falling back to updatedAt).
  // -------------------------------------------------------------------------
  describe('staleness (ADR 0004: evidence must reflect the final code)', () => {
    const HOUR = 60 * 60 * 1000;

    /** Backdates the report so a done transition can postdate it. */
    function backdateReport(cwd: string, missionId: string, when: Date) {
      utimesSync(join(cwd, '.qa-evidence', missionId, 'report.md'), when, when);
    }

    it('blocks with a re-walk message when the newest done transition postdates the report', () => {
      const cwd = scratch('M-TEST-001');
      backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
      const message = checkFrankieEvidence({
        missionId: 'M-TEST-001',
        doneCount: 2,
        doneItems: [
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

    it('prefers completedAt over updatedAt as the done-transition record', () => {
      const cwd = scratch('M-TEST-001');
      backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
      const message = checkFrankieEvidence({
        missionId: 'M-TEST-001',
        doneCount: 1,
        doneItems: [
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

    it('passes when the report is newer than every done transition', () => {
      const cwd = scratch('M-TEST-001');
      expect(
        checkFrankieEvidence({
          missionId: 'M-TEST-001',
          doneCount: 1,
          doneItems: [{ id: 'WI-001', updatedAt: new Date(Date.now() - 1 * HOUR).toISOString() }],
          cwd,
        })
      ).toBeNull();
    });

    it('fails open when the done items carry no usable timestamp (staleness cannot be derived)', () => {
      const cwd = scratch('M-TEST-001');
      backdateReport(cwd, 'M-TEST-001', new Date(Date.now() - 2 * HOUR));
      expect(
        checkFrankieEvidence({
          missionId: 'M-TEST-001',
          doneCount: 1,
          doneItems: [{ id: 'WI-001' }, { id: 'WI-002', updatedAt: 'not-a-date' }],
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
          doneCount: 1,
          doneItems: [{ id: 'WI-001', updatedAt: new Date().toISOString() }],
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
        doneCount: 1,
        cwd: scratch('M-TEST-001', { reportBody: FAILED_REPORT }),
      });
      expect(message).toMatch(/FAILED/);
      expect(message, 'distinct from the missing/stale messages').toMatch(
        /Do NOT dispatch Stockwell/i
      );
      expect(message).toMatch(/❌/);
      expect(message).toMatch(/ATEAM_SKIP_FRANKIE_GATE=1/);
      expect(message).not.toMatch(/STALE/);
    });

    it('passes a fresh, all-green report', () => {
      expect(
        checkFrankieEvidence({
          missionId: 'M-TEST-001',
          doneCount: 1,
          cwd: scratch('M-TEST-001', { reportBody: GREEN_REPORT }),
        })
      ).toBeNull();
    });

    it('honors the ATEAM_SKIP_FRANKIE_GATE escape valve for the failed-walk check', () => {
      process.env.ATEAM_SKIP_FRANKIE_GATE = 'true';
      expect(
        checkFrankieEvidence({
          missionId: 'M-TEST-001',
          doneCount: 1,
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
        checkFrankieEvidence({ missionId: 'M-TEST-001', doneCount: 1, cwd })
      ).toBeNull();
    });
  });
});
