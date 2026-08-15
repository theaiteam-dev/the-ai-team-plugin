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

import { describe, it, expect, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// readExecutionContract() resolves ateam.config.json against process.cwd(),
// and vitest workers cannot process.chdir(). Stubbing only that reader lets
// these tests control the declared surfaces without depending on this repo's
// own config — while the REAL canFrankieDrive() still decides drivability, so
// the gate's wiring to it stays genuinely under test.
const contract = vi.hoisted(() => ({ surfaces: ['web'] as string[] }));

vi.mock('../lib/qa-contract.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/qa-contract.js')>();
  return {
    ...actual,
    readExecutionContract: () => ({ surfaces: contract.surfaces }),
  };
});

import {
  buildBoardUrl,
  buildMissionUrl,
  buildFinalReviewUrl,
  normalizeBoard,
  normalizeMission,
  checkFrankieEvidence,
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
// checkFrankieEvidence — returns a block message, or null to allow.
//
// The declared surfaces come from the stubbed contract above (default:
// drivable); the evidence path is resolved against the cwd passed in.
// ---------------------------------------------------------------------------
describe('stop-gates — checkFrankieEvidence', () => {
  const scratchDirs: string[] = [];

  /** Throwaway repo dir; pass a mission id to seed a real evidence report. */
  function scratch(withReport: string | null = null) {
    const dir = mkdtempSync(join(tmpdir(), 'ateam-stop-gates-'));
    scratchDirs.push(dir);
    if (withReport) {
      mkdirSync(join(dir, '.qa-evidence', withReport), { recursive: true });
      writeFileSync(join(dir, '.qa-evidence', withReport, 'report.md'), '# Evidence\n');
    }
    return dir;
  }

  afterEach(() => {
    delete process.env.ATEAM_SKIP_FRANKIE_GATE;
    contract.surfaces = ['web'];
    for (const dir of scratchDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  it('does not block when the contract declares no drivable surface', () => {
    contract.surfaces = ['hardware'];
    expect(
      checkFrankieEvidence({ missionId: 'M-TEST-001', doneCount: 1, cwd: scratch() })
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
});
