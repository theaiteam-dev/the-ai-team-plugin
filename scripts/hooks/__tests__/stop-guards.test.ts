/**
 * Tests for agent guards in Stop enforcement hooks.
 *
 * Each Stop hook should use resolveAgent() to identify the agent and only
 * enforce for its target agent(s). Non-target agents must be allowed through
 * (fail-open). Unknown agents (Explore, Plan, null) must also pass through.
 *
 * Hooks under test:
 *   - enforce-completion-log.js   → murdock, ba, lynch, amy, tawnia
 *   - enforce-browser-verification.js → amy
 *   - enforce-sosa-coverage.js    → sosa
 *   - enforce-final-review.js     → hannibal
 *   - enforce-orchestrator-stop.js → hannibal
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, mkdirSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';

// Mission-active marker — enforce-orchestrator-stop needs this to enforce
const MISSION_MARKER = join(tmpdir(), '.ateam-mission-active-test-project');
function setMissionMarker() {
  writeFileSync(MISSION_MARKER, new Date().toISOString());
}
function clearMissionMarker() {
  try { unlinkSync(MISSION_MARKER); } catch { /* ignore */ }
}

const HOOKS_DIR = join(__dirname, '..');

function hookPath(name: string) {
  return join(HOOKS_DIR, name);
}

/**
 * Run a hook script with given stdin JSON and env vars.
 * Returns { stdout, stderr, exitCode }.
 */
function runHook(
  scriptPath: string,
  stdin: object = {},
  env: Record<string, string> = {},
  cwd?: string
) {
  const fullEnv = {
    ...process.env,
    ATEAM_API_URL: 'http://localhost:3000',
    ATEAM_PROJECT_ID: 'test-project',
    ...env,
  };
  // Spreading process.env means an ambient gate-skip var on a dev machine
  // (e.g. ATEAM_SKIP_FRANKIE_GATE=1 left over in a shell) would silently
  // disable the very gates under test. Scrub it unless a test sets it
  // explicitly.
  if (!('ATEAM_SKIP_FRANKIE_GATE' in env)) {
    delete fullEnv.ATEAM_SKIP_FRANKIE_GATE;
  }
  if (!('ATEAM_SKIP_PROMOTION_GATE' in env)) {
    delete fullEnv.ATEAM_SKIP_PROMOTION_GATE;
  }
  const options: Record<string, unknown> = {
    env: fullEnv,
    encoding: 'utf8',
    timeout: 5000,
    input: JSON.stringify(stdin),
  };
  if (cwd) options.cwd = cwd;
  try {
    const stdout = execFileSync('node', [scriptPath], options as any);
    return { stdout: (stdout as string).trim(), stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
      exitCode: err.status ?? 1,
    };
  }
}

/**
 * Parse JSON stdout from a Stop hook response, or return {} if empty/invalid.
 */
function parseStopOutput(stdout: string): Record<string, unknown> {
  if (!stdout) return {};
  try {
    return JSON.parse(stdout);
  } catch {
    return {};
  }
}

// =============================================================================
// enforce-completion-log.js
// =============================================================================
describe('enforce-completion-log — agent guards', () => {
  const HOOK = hookPath('enforce-completion-log.js');

  it('uses resolveAgent() in source (not raw agent_type string comparison)', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/resolveAgent/);
  });

  it('exits 0 for non-target agent (hannibal) even when work_log is empty', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      last_assistant_message: 'Mission complete WI-001',
    }, {
      __TEST_MOCK_RESPONSE__: JSON.stringify({
        id: 'WI-001',
        work_log: [],
        assigned_agent: 'hannibal',
      }),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('exits 0 for non-target agent (face) even when work_log is empty', () => {
    const result = runHook(HOOK, {
      agent_type: 'face',
      last_assistant_message: 'Decomposed WI-001',
    }, {
      __TEST_MOCK_RESPONSE__: JSON.stringify({
        id: 'WI-001',
        work_log: [],
        assigned_agent: 'face',
      }),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('exits 0 for unknown/system agent (Explore)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      last_assistant_message: 'Explored codebase WI-001',
    }, {
      __TEST_MOCK_RESPONSE__: JSON.stringify({
        id: 'WI-001',
        work_log: [],
      }),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('blocks target agent (murdock) when work_log is empty', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      last_assistant_message: 'Tests written for WI-001',
    }, {
      __TEST_MOCK_RESPONSE__: JSON.stringify({
        id: 'WI-001',
        work_log: [],
        assigned_agent: 'Murdock',
      }),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('blocks target agent (amy) when work_log is empty', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      last_assistant_message: 'Probing complete for WI-001',
    }, {
      __TEST_MOCK_RESPONSE__: JSON.stringify({
        id: 'WI-001',
        work_log: [],
        assigned_agent: 'Amy',
      }),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('exits 0 (fail-open) on API error for any agent', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      last_assistant_message: 'Tests written for WI-001',
    }, {
      ATEAM_API_URL: 'http://localhost:99999',
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// enforce-browser-verification.js
// =============================================================================
describe('enforce-browser-verification — agent guards', () => {
  const HOOK = hookPath('enforce-browser-verification.js');

  it('uses resolveAgent() in source', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/resolveAgent/);
  });

  it('exits 0 for non-amy agent (murdock) without browser marker', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      last_assistant_message: 'Tests done WI-001',
    }, {
      __TEST_MOCK_RESPONSE__: JSON.stringify({
        id: 'WI-001',
        work_log: [],
      }),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('exits 0 for non-amy agent (lynch) without browser marker', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch',
      last_assistant_message: 'Review done WI-001',
    }, {
      __TEST_MOCK_RESPONSE__: JSON.stringify({
        id: 'WI-001',
        work_log: [],
      }),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('exits 0 for unknown/system agent (Explore) without browser marker', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      last_assistant_message: 'Explored codebase',
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('blocks amy when no browser marker and no NO_UI justification', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      last_assistant_message: 'Probing complete for WI-001',
    }, {
      __TEST_MOCK_RESPONSE__: JSON.stringify({
        id: 'WI-001',
        work_log: [{ agent: 'amy', summary: 'VERIFIED - All tests pass' }],
      }),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('exits 0 (fail-open) on API error for amy', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      last_assistant_message: 'Probing complete for WI-001',
    }, {
      ATEAM_API_URL: 'http://localhost:99999',
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// enforce-sosa-coverage.js
// =============================================================================
describe('enforce-sosa-coverage — agent guards', () => {
  const HOOK = hookPath('enforce-sosa-coverage.js');

  it('uses resolveAgent() in source', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/resolveAgent/);
  });

  it('exits 0 for non-sosa agent (face) when items exist in briefings', () => {
    const result = runHook(HOOK, {
      agent_type: 'face',
      last_assistant_message: 'Decomposed items',
    }, {
      __TEST_MOCK_ITEMS__: JSON.stringify([
        { id: 'WI-001', title: 'Feature A' },
        { id: 'WI-002', title: 'Feature B' },
      ]),
      __TEST_MOCK_ACTIVITY__: JSON.stringify([]),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('exits 0 for non-sosa agent (murdock) when items exist', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      last_assistant_message: 'Done',
    }, {
      __TEST_MOCK_ITEMS__: JSON.stringify([{ id: 'WI-001' }]),
      __TEST_MOCK_ACTIVITY__: JSON.stringify([]),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('exits 0 for unknown/system agent (Plan)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Plan',
      last_assistant_message: 'Planning done',
    }, {
      __TEST_MOCK_ITEMS__: JSON.stringify([{ id: 'WI-001' }]),
      __TEST_MOCK_ACTIVITY__: JSON.stringify([]),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('blocks sosa when items exist and no render calls found', () => {
    const result = runHook(HOOK, {
      agent_type: 'sosa',
      last_assistant_message: 'Done reviewing',
    }, {
      __TEST_MOCK_ITEMS__: JSON.stringify([
        { id: 'WI-001', title: 'Feature A' },
      ]),
      __TEST_MOCK_ACTIVITY__: JSON.stringify([]),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('exits 0 (fail-open) on API error for sosa', () => {
    const result = runHook(HOOK, {
      agent_type: 'sosa',
      last_assistant_message: 'Done',
    }, {
      ATEAM_API_URL: 'http://localhost:99999',
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// enforce-final-review.js
// =============================================================================
describe('enforce-final-review — agent guards', () => {
  const HOOK = hookPath('enforce-final-review.js');

  it('uses resolveAgent() in source', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/resolveAgent/);
  });

  it('exits 0 for non-hannibal agent (tawnia) even with incomplete mission', () => {
    const result = runHook(HOOK, {
      agent_type: 'tawnia',
      last_assistant_message: 'Documentation done',
    }, {
      __TEST_MOCK_BOARD__: JSON.stringify({
        columns: { testing: [{ id: 'WI-001' }] },
      }),
      __TEST_MOCK_MISSION__: JSON.stringify({
        status: 'active',
        final_review_verdict: null,
        postcheck: null,
      }),
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 for non-hannibal agent (lynch) even with incomplete mission', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch',
      last_assistant_message: 'Review done',
    }, {
      __TEST_MOCK_BOARD__: JSON.stringify({
        columns: { testing: [{ id: 'WI-001' }] },
      }),
      __TEST_MOCK_MISSION__: JSON.stringify({
        status: 'active',
        final_review_verdict: null,
        postcheck: null,
      }),
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 for unknown/system agent (Explore)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
    }, {
      __TEST_MOCK_BOARD__: JSON.stringify({
        columns: { testing: [{ id: 'WI-001' }] },
      }),
      __TEST_MOCK_MISSION__: JSON.stringify({ status: 'active' }),
    });
    expect(result.exitCode).toBe(0);
  });

  it('enforces (exits 2) for hannibal with items still active', () => {
    const result = runHook(HOOK, {
      // no agent_type = main session (hannibal)
    }, {
      __TEST_MOCK_BOARD__: JSON.stringify({
        columns: { testing: [{ id: 'WI-001' }] },
      }),
      __TEST_MOCK_MISSION__: JSON.stringify({
        status: 'active',
        final_review_verdict: null,
        postcheck: null,
      }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('exits 0 (fail-open) on API error for hannibal', () => {
    const result = runHook(HOOK, {}, {
      ATEAM_API_URL: 'http://localhost:99999',
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// enforce-final-review.js — Frankie evidence-bundle gate (WI-783)
//
// Extends the existing hook: on a drivable-surface repo, mission completion
// is blocked until Frankie's evidence report exists on disk. The gate calls
// canFrankieDrive() from scripts/hooks/lib/qa-contract.js directly — never
// reimplements the drivability check (that helper has its own exhaustive
// six-surface matrix in qa-contract.test.js; this suite does not re-derive
// it, only proves the hook is correctly wired to it).
//
// The gate resolves both ateam.config.json and the evidence path against
// the hook process's cwd, and execFileSync inherits the parent's cwd unless
// overridden — so every test here uses a scratch temp directory (its own
// throwaway ateam.config.json and, where needed, a real .qa-evidence/
// fixture) via runHook's cwd parameter, rather than depending on this
// repo's own real config or mutating it.
// =============================================================================
describe('enforce-final-review — Frankie evidence-bundle gate', () => {
  const HOOK = hookPath('enforce-final-review.js');
  const MISSION_ID = 'M-TEST-001';
  const scratchDirs: string[] = [];

  it('calls the real canFrankieDrive() from lib/qa-contract.js — does not reimplement the drivability check', () => {
    // The gate moved into lib/stop-gates.js so enforce-orchestrator-stop.js
    // enforces the identical condition; the assertion follows that one hop.
    // The original intent is unchanged and now covers both hooks: neither
    // reimplements drivability, they reach the same canFrankieDrive().
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/checkFrankieEvidence/);
    expect(source).toMatch(/stop-gates/);

    const gateSource = readFileSync(join(HOOKS_DIR, 'lib', 'stop-gates.js'), 'utf8');
    expect(gateSource).toMatch(/canFrankieDrive/);
    expect(gateSource).toMatch(/qa-contract/);
  });

  /**
   * Creates a throwaway repo directory with its own ateam.config.json
   * (surfaces controlled by the caller — pass `undefined` to omit the key
   * entirely, or `null` to skip writing a config file at all, simulating an
   * unreadable/missing config). Optionally seeds a real
   * .qa-evidence/<missionId>/report.md fixture.
   */
  function makeScratchRepo(opts: {
    surfaces?: string[] | undefined;
    config?: 'missing' | 'malformed' | 'valid';
    evidence?: 'none' | 'dir-only' | 'report';
    missionId?: string;
  }) {
    const { surfaces, config = 'valid', evidence = 'none', missionId = MISSION_ID } = opts;
    const dir = mkdtempSync(join(tmpdir(), 'ateam-frankie-gate-'));
    scratchDirs.push(dir);

    if (config === 'valid') {
      const configBody = surfaces === undefined ? {} : { surfaces };
      writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify(configBody));
    } else if (config === 'malformed') {
      writeFileSync(join(dir, 'ateam.config.json'), '{ this is not valid json');
    }
    // 'missing': write nothing — readExecutionContract() must fail open (ENOENT).

    if (evidence === 'dir-only') {
      mkdirSync(join(dir, '.qa-evidence', missionId), { recursive: true });
    } else if (evidence === 'report') {
      mkdirSync(join(dir, '.qa-evidence', missionId), { recursive: true });
      writeFileSync(join(dir, '.qa-evidence', missionId, 'report.md'), '# Evidence\n\n- [x] Login works\n');
    }

    return dir;
  }

  afterAll(() => {
    for (const dir of scratchDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  // WI-791: checkFrankieEvidence triggers on stagedCount, not doneCount —
  // items sit in staged awaiting the walk. MOCK_BOARD_ONE_DONE is kept for
  // the two scenarios that legitimately represent the fully-promoted end
  // state (items already in done, nothing staged); every other fixture
  // below uses MOCK_BOARD_ONE_STAGED so the Frankie gate actually fires.
  const MOCK_BOARD_ONE_STAGED = JSON.stringify({
    columns: { staged: [{ id: 'WI-001' }] },
  });
  const MOCK_BOARD_ONE_DONE = JSON.stringify({
    columns: { done: [{ id: 'WI-001' }] },
  });
  const MOCK_BOARD_EMPTY = JSON.stringify({ columns: {} });

  function missionWithId(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      id: MISSION_ID,
      status: 'active',
      final_review_verdict: null,
      postcheck: null,
      ...overrides,
    });
  }

  const MOCK_MISSION_FULLY_COMPLETE = JSON.stringify({
    id: MISSION_ID,
    status: 'active',
    final_review_verdict: 'FINAL APPROVED',
    postcheck: { passed: true },
  });

  // ---------------------------------------------------------------------------
  // AC1 — drivable surface, done items exist, no evidence bundle: block.
  // ---------------------------------------------------------------------------
  it('blocks with JSON decision, naming Frankie and the expected evidence path, when drivable and no evidence exists at all', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: missionWithId() },
      dir
    );
    expect(result.exitCode, 'Frankie gate blocks via JSON, exit 0 — never a nonzero exit code (AC8)').toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.additionalContext).toMatch(/frankie/i);
    expect(output.additionalContext).toMatch(/\.qa-evidence\/M-TEST-001\/report\.md/);
  });

  it('blocks when the evidence directory exists but report.md itself is missing (adversarial: directory presence is not report presence)', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: 'dir-only' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: missionWithId() },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.additionalContext).toMatch(/frankie/i);
  });

  it('blocks on Frankie even when the final review verdict is already set (Frankie is checked first, unconditionally — adversarial ordering)', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED,
        __TEST_MOCK_MISSION__: missionWithId({ final_review_verdict: 'FINAL APPROVED', postcheck: { passed: true } }),
      },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.additionalContext).toMatch(/frankie/i);
  });

  it('blocks when surfaces mix a drivable value with non-drivable ones (integration check — full matrix lives in qa-contract.test.js)', () => {
    const dir = makeScratchRepo({ surfaces: ['api', 'web'], evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: missionWithId() },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.additionalContext).toMatch(/frankie/i);
  });

  // ---------------------------------------------------------------------------
  // AC2 — evidence exists: not blocked on Frankie's account; pre-existing
  // gates continue to apply UNCHANGED (still exit(2), not JSON).
  // ---------------------------------------------------------------------------
  it('does not block on Frankie once the evidence report exists, but the pre-existing final-review gate still applies unchanged (exit 2)', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: 'report' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: missionWithId() },
      dir
    );
    expect(result.exitCode, 'pre-existing gate blocks via exit(2), not the JSON mechanism').toBe(2);
    expect(result.stderr).toMatch(/Final Mission Review required/i);
    expect(result.stderr, 'the Final Mission Review belongs to Stockwell').toMatch(/Stockwell/);
    expect(result.stderr).not.toMatch(/Lynch/);
  });

  it('allows the stop entirely once evidence exists and the pre-existing gates (final review + post-checks) are also satisfied', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: 'report' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: MOCK_MISSION_FULLY_COMPLETE },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  // ---------------------------------------------------------------------------
  // WI-791 note: the tests below (AC3/AC7) intentionally keep MOCK_BOARD_ONE_DONE
  // rather than switching to MOCK_BOARD_ONE_STAGED. With stagedCount 0 they
  // remain correct post-re-key (checkFrankieEvidence short-circuits on
  // `!(stagedCount > 0)` before ever reaching drivability/config-read logic,
  // same as pre-re-key with doneCount), but they no longer exercise the
  // drivability/config-fail-open branches specifically THROUGH the staged
  // path — that exact coverage lives directly in stop-gates.test.ts's
  // checkFrankieEvidence unit tests (called with stagedCount > 0). Left
  // unchanged here rather than guessed, since it's not yet confirmed whether
  // enforce-final-review.js will express the new "staged, not promoted"
  // block via this hook's exit(2)/stderr convention or the Frankie-style
  // JSON mechanism — flagged for Lynch/B.A. to close if meaningful.
  // ---------------------------------------------------------------------------
  // AC3 — no drivable surface (hardware-only, or surfaces absent entirely):
  // never blocks on Frankie's account, evidence bundle notwithstanding.
  // ---------------------------------------------------------------------------
  it('does not block on Frankie for a hardware-only repo, even with no evidence bundle', () => {
    const dir = makeScratchRepo({ surfaces: ['hardware'], evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: MOCK_MISSION_FULLY_COMPLETE },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('does not block on Frankie when surfaces is absent from the contract entirely, even with no evidence bundle', () => {
    const dir = makeScratchRepo({ surfaces: undefined, evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: MOCK_MISSION_FULLY_COMPLETE },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  // ---------------------------------------------------------------------------
  // AC4 — a surface FlowSpec cannot drive today (api, fixture-flow,
  // golden-pair, cli): consistent with canFrankieDrive(), never blocks.
  // Representative sample, not exhaustive — the full 6-surface matrix is
  // qa-contract.test.js's job, not this hook's.
  // ---------------------------------------------------------------------------
  it('does not block on Frankie for surfaces: ["api"]', () => {
    const dir = makeScratchRepo({ surfaces: ['api'], evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: MOCK_MISSION_FULLY_COMPLETE },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('does not block on Frankie for surfaces: ["cli"]', () => {
    const dir = makeScratchRepo({ surfaces: ['cli'], evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: MOCK_MISSION_FULLY_COMPLETE },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  // ---------------------------------------------------------------------------
  // AC5 — no active mission, or no items reached done: never blocks on
  // Frankie's account.
  // ---------------------------------------------------------------------------
  it('does not block on Frankie when no items have reached done, even on a drivable surface with no evidence', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: 'none' });
    const result = runHook(HOOK, {}, { __TEST_MOCK_BOARD__: MOCK_BOARD_EMPTY, __TEST_MOCK_MISSION__: missionWithId() }, dir);
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('does not block on Frankie when no mission is active', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: 'none' });
    const result = runHook(HOOK, {}, { __TEST_MOCK_NO_MISSION__: 'true' }, dir);
    expect(result.exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // AC6 — only Hannibal's session evaluates the Frankie condition.
  // ---------------------------------------------------------------------------
  it('does not evaluate the Frankie condition for a non-hannibal agent, even in an otherwise-blocking scenario', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: 'none' });
    const result = runHook(
      HOOK,
      { agent_type: 'tawnia', last_assistant_message: 'Documentation done' },
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: missionWithId() },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  // ---------------------------------------------------------------------------
  // AC7 — fails open when the config cannot be read (missing file, or
  // malformed JSON): readExecutionContract()'s own fail-open collapses to
  // surfaces: [], so canFrankieDrive() is false and Frankie's gate never
  // fires — proven end-to-end through the hook, not just inside
  // qa-contract.test.js.
  // ---------------------------------------------------------------------------
  it('fails open (does not block on Frankie) when ateam.config.json is missing entirely', () => {
    const dir = makeScratchRepo({ config: 'missing', evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: MOCK_MISSION_FULLY_COMPLETE },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('fails open (does not block on Frankie) when ateam.config.json contains malformed JSON', () => {
    const dir = makeScratchRepo({ config: 'malformed', evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: MOCK_MISSION_FULLY_COMPLETE },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });
});

// =============================================================================
// enforce-orchestrator-stop.js
// =============================================================================
describe('enforce-orchestrator-stop — agent guards', () => {
  const HOOK = hookPath('enforce-orchestrator-stop.js');

  // Mission marker must exist for enforcement to kick in on the main session
  beforeAll(() => setMissionMarker());
  afterAll(() => clearMissionMarker());

  it('uses resolveAgent() in source', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/resolveAgent/);
  });

  it('exits 0 for subagent (murdock) even with active items', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      last_assistant_message: 'Tests done WI-001',
    });
    // Subagents with agent_type set are passed through immediately
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('exits 0 for subagent (ba) even with active items', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      last_assistant_message: 'Implementation done WI-001',
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('exits 0 for unknown/system agent (Explore)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('blocks main session (hannibal/no agent_type) when items still active', () => {
    const result = runHook(HOOK, {
      // no agent_type = main session
      session_id: 'main-session-123',
    }, {
      __TEST_MOCK_BOARD__: JSON.stringify({
        columns: {
          testing: [{ id: 'WI-001' }],
          done: [],
        },
      }),
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('exits 0 (fail-open) on API error for main session', () => {
    const result = runHook(HOOK, {}, {
      ATEAM_API_URL: 'http://localhost:99999',
    });
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });
});

// =============================================================================
// enforce-orchestrator-stop.js — Frankie evidence-bundle gate
//
// The Frankie gate originally shipped only in enforce-final-review.js, which
// binds via agents/hannibal.md frontmatter — i.e. only when hannibal runs as a
// SUBAGENT session. In the primary execution mode Hannibal runs in the MAIN
// session, gated by this hook (registered plugin-wide in hooks/hooks.json), so
// the mandatory gate never fired. Both hooks now call the same
// checkFrankieEvidence() from lib/stop-gates.js; this suite mirrors the
// enforce-final-review coverage above so the two cannot drift apart again.
// =============================================================================
describe('enforce-orchestrator-stop — Frankie evidence-bundle gate', () => {
  const HOOK = hookPath('enforce-orchestrator-stop.js');
  const MISSION_ID = 'M-TEST-002';
  const scratchDirs: string[] = [];

  beforeAll(() => setMissionMarker());
  afterAll(() => {
    clearMissionMarker();
    for (const dir of scratchDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  it('shares the gate with enforce-final-review via lib/stop-gates.js — neither hook reimplements it', () => {
    const orchestratorSource = readFileSync(HOOK, 'utf8');
    const finalReviewSource = readFileSync(hookPath('enforce-final-review.js'), 'utf8');
    expect(orchestratorSource).toMatch(/checkFrankieEvidence/);
    expect(orchestratorSource).toMatch(/stop-gates/);
    expect(finalReviewSource).toMatch(/checkFrankieEvidence/);
    expect(finalReviewSource).toMatch(/stop-gates/);
  });

  function makeScratchRepo(opts: { surfaces?: string[]; evidence?: boolean }) {
    const dir = mkdtempSync(join(tmpdir(), 'ateam-orchestrator-gate-'));
    scratchDirs.push(dir);
    const body = opts.surfaces === undefined ? {} : { surfaces: opts.surfaces };
    writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify(body));
    if (opts.evidence) {
      mkdirSync(join(dir, '.qa-evidence', MISSION_ID), { recursive: true });
      writeFileSync(join(dir, '.qa-evidence', MISSION_ID, 'report.md'), '# Evidence\n');
    }
    return dir;
  }

  // WI-791: checkFrankieEvidence is re-keyed to trigger on stagedCount, not
  // doneCount — items sit in staged awaiting the walk, not done (done now
  // only happens via WI-790's atomic promotion, gated behind Stockwell's
  // approved review). A board fixture with only `done` items no longer
  // exercises the Frankie gate at all post-re-key, so every fixture below
  // uses `staged` instead.
  const MOCK_BOARD_ONE_STAGED = JSON.stringify({ columns: { staged: [{ id: 'WI-001' }] } });

  function missionMock(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      id: MISSION_ID,
      status: 'active',
      final_review_verdict: null,
      postcheck: null,
      ...overrides,
    });
  }

  const MISSION_FULLY_COMPLETE = missionMock({
    final_review_verdict: 'FINAL APPROVED',
    postcheck: { passed: true },
  });

  it('blocks the main session when items are staged, the surface is drivable, and no evidence bundle exists', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: false });
    const result = runHook(
      HOOK,
      { session_id: 'main-session-123' },
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: missionMock() },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/frankie/i);
    expect(String(output.additionalContext)).toMatch(
      new RegExp(`\\.qa-evidence/${MISSION_ID}/report\\.md`)
    );
  });

  it('blocks on Frankie before any other staged-related gate, even when the verdict is already recorded', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: false });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: MISSION_FULLY_COMPLETE },
      dir
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/frankie/i);
  });

  it('does not block on Frankie once the evidence report exists, but STILL blocks — items remain staged, not promoted (AC2)', () => {
    // AC2: the orchestrator must not treat an all-staged board as an empty
    // board and allow the stop. Promotion to done only happens via WI-790's
    // atomic transaction when Stockwell's review is written — the Stop hook
    // itself never promotes anything, so once Frankie's evidence clears, the
    // mission is STILL blocked until that promotion has actually run.
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: true });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: missionMock() },
      dir
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/staged/i);
    expect(
      String(output.additionalContext),
      'must tell the operator promotion has not happened yet'
    ).toMatch(/promot/i);
    expect(String(output.additionalContext)).not.toMatch(/frankie/i);
  });

  it('still blocks (staged, not promoted) for a repo with no drivable surface — that only silences the Frankie-specific sub-check', () => {
    // AC2's "not promoted" block is unconditional on stagedCount > 0: it has
    // nothing to do with whether Frankie can walk this repo. A non-drivable
    // surface means checkFrankieEvidence itself returns null (nothing to
    // evidence-check), but the more fundamental fact — items are sitting in
    // staged and nothing has promoted them — still holds and must still block.
    const dir = makeScratchRepo({ surfaces: ['hardware'], evidence: false });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: MISSION_FULLY_COMPLETE },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).not.toMatch(/frankie/i);
    expect(String(output.additionalContext)).toMatch(/staged/i);
  });

  it('does not evaluate the Frankie condition for a subagent session', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: false });
    const result = runHook(
      HOOK,
      { agent_type: 'tawnia' },
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: missionMock() },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  // -------------------------------------------------------------------------
  // WI-791 AC2/AC3 core distinction (Sosa's highest silent-failure-risk flag):
  // Frankie's evidence gate — and the "staged, not promoted" block — must
  // fire ONLY once the pipeline stages are genuinely empty. A board where
  // some items are staged but OTHERS are still mid-pipeline must block with
  // the existing "items still active" message, not a staged/Frankie message
  // — that would misdiagnose an in-flight mission as merely "awaiting
  // promotion". This is exactly the failure mode a plain ACTIVE_STAGES
  // append would risk: staged must never be folded into totalActive.
  // -------------------------------------------------------------------------
  it('blocks with the generic "items still active" message — NOT a Frankie/staged message — when pipeline stages are non-empty even though some items are already staged', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: false });
    const result = runHook(
      HOOK,
      { session_id: 'main-session-456' },
      {
        __TEST_MOCK_BOARD__: JSON.stringify({
          columns: {
            testing: [{ id: 'WI-002' }], // pipeline work still in flight
            staged: [{ id: 'WI-001' }], // AND some item already staged
          },
        }),
      },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(
      String(output.additionalContext),
      'must not prematurely surface the Frankie/promotion message while other items are still mid-pipeline'
    ).not.toMatch(/frankie/i);
    expect(String(output.additionalContext)).toMatch(/still active/i);
  });
});

// =============================================================================
// ATEAM_SKIP_FRANKIE_GATE — operator escape hatch.
//
// Every other check in these two hooks fails open on adversity (missing
// config, failed fetch, thrown error). The Frankie gate blocks on a local
// filesystem condition, so a missing Playwright headless shell, a missing
// flowspec, or an unavailable dev server could otherwise trap the operator
// with no way out. The override is documented in the block message itself.
// =============================================================================
describe('Frankie evidence gate — ATEAM_SKIP_FRANKIE_GATE escape hatch', () => {
  const MISSION_ID = 'M-TEST-003';
  const scratchDirs: string[] = [];

  beforeAll(() => setMissionMarker());
  afterAll(() => {
    clearMissionMarker();
    for (const dir of scratchDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  function drivableRepoWithoutEvidence() {
    const dir = mkdtempSync(join(tmpdir(), 'ateam-frankie-escape-'));
    scratchDirs.push(dir);
    writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify({ surfaces: ['web'] }));
    return dir;
  }

  // WI-791: staged (not done) is what makes the Frankie gate fire post-re-key.
  const MOCK_BOARD_ONE_STAGED = JSON.stringify({ columns: { staged: [{ id: 'WI-001' }] } });
  const MISSION_FULLY_COMPLETE = JSON.stringify({
    id: MISSION_ID,
    status: 'active',
    final_review_verdict: 'FINAL APPROVED',
    postcheck: { passed: true },
  });

  it('enforce-final-review: names the override in the block message', () => {
    const result = runHook(
      hookPath('enforce-final-review.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED,
        __TEST_MOCK_MISSION__: MISSION_FULLY_COMPLETE,
      },
      drivableRepoWithoutEvidence()
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/ATEAM_SKIP_FRANKIE_GATE=1/);
  });

  // WI-791 design note: ATEAM_SKIP_FRANKIE_GATE is documented (stop-gates.js
  // header) as an escape hatch for LOCAL FILESYSTEM/environment adversity
  // that has nothing to do with mission progress (no Playwright, no
  // flowspec, dev server down) — it suppresses checkFrankieEvidence's own
  // block. It was never meant to let a mission stop with items still
  // unpromoted, which is an independent, board-state fact the override does
  // not (and must not) touch. So with the override set, the Frankie-specific
  // message goes away, but the mission still cannot stop while items sit in
  // staged — AC2's "not promoted" block still fires. This is a deliberate
  // interpretation of an item the PRD itself flagged as having an open
  // question for Sosa; confirm this reading holds before relying on it.
  it('enforce-final-review: ATEAM_SKIP_FRANKIE_GATE=1 suppresses the Frankie-specific message, but the mission still cannot stop while items remain staged', () => {
    const result = runHook(
      hookPath('enforce-final-review.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED,
        __TEST_MOCK_MISSION__: MISSION_FULLY_COMPLETE,
        ATEAM_SKIP_FRANKIE_GATE: '1',
      },
      drivableRepoWithoutEvidence()
    );
    // enforce-final-review.js exits 2 on block (unlike
    // enforce-orchestrator-stop.js's JSON-decision contract) — assert via
    // stderr, matching this file's other enforce-final-review assertions.
    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toMatch(/frankie/i);
    expect(result.stderr).toMatch(/staged/i);
  });

  it('enforce-orchestrator-stop: names the override in the block message', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED,
        __TEST_MOCK_MISSION__: MISSION_FULLY_COMPLETE,
      },
      drivableRepoWithoutEvidence()
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/ATEAM_SKIP_FRANKIE_GATE=1/);
  });

  it('enforce-orchestrator-stop: ATEAM_SKIP_FRANKIE_GATE=1 suppresses the Frankie-specific message, but the mission still cannot stop while items remain staged', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_STAGED,
        __TEST_MOCK_MISSION__: MISSION_FULLY_COMPLETE,
        ATEAM_SKIP_FRANKIE_GATE: '1',
      },
      drivableRepoWithoutEvidence()
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).not.toMatch(/frankie/i);
    expect(String(output.additionalContext)).toMatch(/staged/i);
  });
});

// =============================================================================
// Final Mission Review verdict gate — a FINAL REJECTED review is a COMPLETE
// review, so mere truthiness of the stored markdown must not fall through to
// the "run postcheck" gate. Both hooks parse the standardized verdict marker
// (VERDICT: FINAL APPROVED / FINAL REJECTED, playbooks/orchestration-*.md)
// via checkFinalReviewRejection() in lib/stop-gates.js: an explicit rejection
// blocks with the ADR 0004 restart-at-Frankie path; text with no recognizable
// marker preserves today's treat-as-complete behavior (fail open).
// =============================================================================
describe('Final Mission Review verdict gate', () => {
  const MISSION_ID = 'M-TEST-004';
  const scratchDirs: string[] = [];

  beforeAll(() => setMissionMarker());
  afterAll(() => {
    clearMissionMarker();
    for (const dir of scratchDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  /** Drivable repo with a fresh, all-green evidence bundle (Frankie gate passes). */
  function repoWithEvidence() {
    const dir = mkdtempSync(join(tmpdir(), 'ateam-verdict-gate-'));
    scratchDirs.push(dir);
    writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify({ surfaces: ['web'] }));
    mkdirSync(join(dir, '.qa-evidence', MISSION_ID), { recursive: true });
    writeFileSync(
      join(dir, '.qa-evidence', MISSION_ID, 'report.md'),
      '# Evidence\n\n- ✅ Login works\n'
    );
    return dir;
  }

  const MOCK_BOARD_ONE_DONE = JSON.stringify({ columns: { done: [{ id: 'WI-001' }] } });

  function missionMock(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      id: MISSION_ID,
      status: 'active',
      final_review_verdict: null,
      postcheck: null,
      ...overrides,
    });
  }

  const REJECTED_REVIEW = '# Final Mission Review\n\nVERDICT: FINAL REJECTED\n\n- WI-003: broken';
  const APPROVED_REVIEW = '# Final Mission Review\n\nVERDICT: FINAL APPROVED\n';
  const MARKERLESS_REVIEW = '# Final Mission Review\n\nEverything looks reasonable.';

  it('enforce-orchestrator-stop: FINAL REJECTED blocks with the restart-at-Frankie path, not the postcheck misdirection', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE,
        __TEST_MOCK_MISSION__: missionMock({ final_review_verdict: REJECTED_REVIEW }),
      },
      repoWithEvidence()
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    const context = String(output.additionalContext);
    expect(context).toMatch(/FINAL REJECTED/);
    expect(context, 'ADR 0004: the tail restarts at Frankie after rework').toMatch(
      /RESTARTS at Frankie/i
    );
    expect(context, 'full DoD re-walk before Stockwell re-reviews').toMatch(
      /FULL Definition of Done/i
    );
    expect(context, 'must not misdirect toward running postcheck').not.toMatch(
      /Run ateam missions postcheck/i
    );
  });

  it('enforce-orchestrator-stop: FINAL APPROVED proceeds to the postcheck gate', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE,
        __TEST_MOCK_MISSION__: missionMock({ final_review_verdict: APPROVED_REVIEW }),
      },
      repoWithEvidence()
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/postcheck/i);
    expect(String(output.additionalContext)).not.toMatch(/RESTARTS at Frankie/i);
  });

  it('enforce-orchestrator-stop: review text with no recognizable marker preserves current behavior (postcheck gate, fail open)', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE,
        __TEST_MOCK_MISSION__: missionMock({ final_review_verdict: MARKERLESS_REVIEW }),
      },
      repoWithEvidence()
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/postcheck/i);
    expect(String(output.additionalContext)).not.toMatch(/RESTARTS at Frankie/i);
  });

  it('enforce-orchestrator-stop: FINAL APPROVED with passing postchecks allows the stop (rejection gate is inert)', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE,
        __TEST_MOCK_MISSION__: missionMock({
          final_review_verdict: APPROVED_REVIEW,
          postcheck: { passed: true },
        }),
      },
      repoWithEvidence()
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('enforce-final-review: FINAL REJECTED blocks (exit 2) with the restart-at-Frankie path on stderr', () => {
    const result = runHook(
      hookPath('enforce-final-review.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE,
        __TEST_MOCK_MISSION__: missionMock({ final_review_verdict: REJECTED_REVIEW }),
      },
      repoWithEvidence()
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/FINAL REJECTED/);
    expect(result.stderr).toMatch(/RESTARTS at Frankie/i);
    expect(result.stderr).toMatch(/FULL Definition of Done/i);
    expect(result.stderr).not.toMatch(/Run ateam missions postcheck/i);
  });

  it('enforce-final-review: FINAL APPROVED proceeds to the postcheck gate (exit 2, postcheck message)', () => {
    const result = runHook(
      hookPath('enforce-final-review.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE,
        __TEST_MOCK_MISSION__: missionMock({ final_review_verdict: APPROVED_REVIEW }),
      },
      repoWithEvidence()
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Post-mission checks required/i);
    expect(result.stderr).not.toMatch(/RESTARTS at Frankie/i);
  });

  it('enforce-final-review: review text with no recognizable marker preserves current behavior (postcheck gate)', () => {
    const result = runHook(
      hookPath('enforce-final-review.js'),
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE,
        __TEST_MOCK_MISSION__: missionMock({ final_review_verdict: MARKERLESS_REVIEW }),
      },
      repoWithEvidence()
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Post-mission checks required/i);
    expect(result.stderr).not.toMatch(/RESTARTS at Frankie/i);
  });
});

// =============================================================================
// Frankie evidence QUALITY gates — existence alone is not enough:
//   - a report older than the newest done transition is STALE (post-rework
//     evidence must reflect the final code, ADR 0004);
//   - a report containing ❌ statements records a FAILED walk (do not
//     dispatch Stockwell).
// Exercised through enforce-orchestrator-stop.js — the hook that binds in the
// primary execution mode; the logic itself is shared via lib/stop-gates.js
// and unit-tested exhaustively in stop-gates.test.ts.
// =============================================================================
describe('enforce-orchestrator-stop — Frankie evidence quality gates', () => {
  const MISSION_ID = 'M-TEST-005';
  const scratchDirs: string[] = [];

  beforeAll(() => setMissionMarker());
  afterAll(() => {
    clearMissionMarker();
    for (const dir of scratchDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  function repoWithReport(body: string, reportMtime?: Date) {
    const dir = mkdtempSync(join(tmpdir(), 'ateam-evidence-quality-'));
    scratchDirs.push(dir);
    writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify({ surfaces: ['web'] }));
    mkdirSync(join(dir, '.qa-evidence', MISSION_ID), { recursive: true });
    const reportPath = join(dir, '.qa-evidence', MISSION_ID, 'report.md');
    writeFileSync(reportPath, body);
    if (reportMtime) utimesSync(reportPath, reportMtime, reportMtime);
    return dir;
  }

  function missionMock() {
    return JSON.stringify({
      id: MISSION_ID,
      status: 'active',
      final_review_verdict: null,
      postcheck: null,
    });
  }

  const HOUR = 60 * 60 * 1000;

  // WI-791: staleness now compares against the newest STAGED transition, not
  // the newest done one — items sit in staged awaiting the walk. Board
  // fixtures below use `staged`, not `done`.

  it('blocks with a STALE re-walk message when a staged transition postdates the report (post-rework evidence)', () => {
    const dir = repoWithReport('# Evidence\n\n- ✅ Login works\n', new Date(Date.now() - 2 * HOUR));
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: JSON.stringify({
          columns: {
            staged: [{ id: 'WI-001', updatedAt: new Date(Date.now() - 1 * HOUR).toISOString() }],
          },
        }),
        __TEST_MOCK_MISSION__: missionMock(),
      },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/STALE/i);
    expect(String(output.additionalContext)).toMatch(/FULL Definition of Done/i);
  });

  it('blocks with the distinct failed-walk message when the report contains ❌ statements', () => {
    const dir = repoWithReport('# Evidence\n\n- ✅ Login works\n- ❌ Checkout broken (WI-003)\n');
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: JSON.stringify({ columns: { staged: [{ id: 'WI-001' }] } }),
        __TEST_MOCK_MISSION__: missionMock(),
      },
      dir
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/FAILED/);
    expect(String(output.additionalContext)).toMatch(/Do NOT dispatch Stockwell/i);
    expect(String(output.additionalContext)).not.toMatch(/STALE/);
  });

  it('passes a fresh all-green report through to the next gate — items are still staged, not promoted (AC2)', () => {
    const dir = repoWithReport('# Evidence\n\n- ✅ Login works\n');
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: JSON.stringify({
          columns: {
            staged: [{ id: 'WI-001', updatedAt: new Date(Date.now() - 1 * HOUR).toISOString() }],
          },
        }),
        __TEST_MOCK_MISSION__: missionMock(),
      },
      dir
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    // Frankie's quality checks passed (fresh, all-green) — the mission
    // still blocks, but now on the "staged, not promoted" gate (AC2), not
    // on Frankie himself.
    expect(String(output.additionalContext)).not.toMatch(/frankie/i);
    expect(String(output.additionalContext)).toMatch(/staged/i);
  });
});

// =============================================================================
// stop_hook_active re-entry guard + ATEAM_SKIP_PROMOTION_GATE.
//
// Every mission-tail gate blocks with a "keep orchestrating" instruction. When
// the condition CANNOT be satisfied — an API server predating WI-790's
// staged→done promotion, or a review whose verdict parses as 'unknown' — that
// is an infinite Hannibal loop: block, resume, block, resume. Claude Code sets
// stop_hook_active on a stop that is itself the consequence of a previous
// block, which is the harness-level way out; ATEAM_SKIP_PROMOTION_GATE=1 is
// the operator-level one, deliberately separate from ATEAM_SKIP_FRANKIE_GATE
// (skipping a walk nobody can drive is a different decision from declaring a
// mission finished with items the API never promoted).
//
// The guard is NARROW by construction: it releases only the staged/promotion
// gate, the one gate that can be genuinely unsatisfiable. Applied at the top
// of the hooks instead, it degraded EVERY gate from permanent to one-shot —
// including the always-satisfiable "items still active → continue
// orchestrating" gate, so the second stop would end a mission mid-pipeline.
// The tests below pin both halves: the loop breaker still breaks the loop, and
// the satisfiable gates keep enforcing regardless of stop_hook_active.
// =============================================================================
describe('Stop hooks — stop_hook_active re-entry guard and the promotion-gate override', () => {
  const MISSION_ID = 'M-TEST-REENTRY';
  const scratchDirs: string[] = [];

  beforeAll(() => setMissionMarker());
  afterAll(() => {
    clearMissionMarker();
    for (const dir of scratchDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  /** Non-drivable repo: only the staged/promotion gate can fire here. */
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'ateam-reentry-'));
    scratchDirs.push(dir);
    writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify({ surfaces: ['hardware'] }));
    return dir;
  }

  const BOARD_ONE_STAGED = JSON.stringify({ columns: { staged: [{ id: 'WI-001' }] } });
  const MISSION_APPROVED = JSON.stringify({
    id: MISSION_ID,
    status: 'active',
    final_review_verdict: 'VERDICT: FINAL APPROVED',
    postcheck: { passed: true },
  });

  /** Drivable repo with NO evidence bundle: the Frankie gate fires here. */
  function drivableRepoWithoutEvidence() {
    const dir = mkdtempSync(join(tmpdir(), 'ateam-reentry-drivable-'));
    scratchDirs.push(dir);
    writeFileSync(join(dir, 'ateam.config.json'), JSON.stringify({ surfaces: ['web'] }));
    return dir;
  }

  const BOARD_THREE_ACTIVE = JSON.stringify({
    columns: {
      testing: [{ id: 'WI-001' }],
      implementing: [{ id: 'WI-002' }],
      review: [{ id: 'WI-003' }],
    },
  });
  const BOARD_ONE_DONE = JSON.stringify({ columns: { done: [{ id: 'WI-001' }] } });
  const MISSION_NO_REVIEW = JSON.stringify({
    id: MISSION_ID,
    status: 'active',
    final_review_verdict: null,
    postcheck: null,
  });

  it('enforce-orchestrator-stop: still blocks with items mid-pipeline even when stop_hook_active is true (the guard is not a mission-ending bypass)', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      { session_id: 'main-session-reentry', stop_hook_active: true },
      { __TEST_MOCK_BOARD__: BOARD_THREE_ACTIVE, __TEST_MOCK_MISSION__: MISSION_APPROVED },
      repo()
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/3 items still active/i);
  });

  it('enforce-final-review: still blocks with items mid-pipeline even when stop_hook_active is true', () => {
    const result = runHook(
      hookPath('enforce-final-review.js'),
      { stop_hook_active: true },
      { __TEST_MOCK_BOARD__: BOARD_THREE_ACTIVE, __TEST_MOCK_MISSION__: MISSION_APPROVED },
      repo()
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Mission incomplete/i);
  });

  it('enforce-orchestrator-stop: the Frankie evidence gate keeps enforcing under stop_hook_active (it is satisfiable — dispatch Frankie)', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      { session_id: 'main-session-reentry', stop_hook_active: true },
      { __TEST_MOCK_BOARD__: BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: MISSION_NO_REVIEW },
      drivableRepoWithoutEvidence()
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/evidence bundle is missing/i);
  });

  it('enforce-orchestrator-stop: the missing-final-review gate keeps enforcing under stop_hook_active', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      { session_id: 'main-session-reentry', stop_hook_active: true },
      { __TEST_MOCK_BOARD__: BOARD_ONE_DONE, __TEST_MOCK_MISSION__: MISSION_NO_REVIEW },
      repo()
    );
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(String(output.additionalContext)).toMatch(/Final Mission Review/i);
  });

  it('enforce-orchestrator-stop: allows the stop when stop_hook_active is true and the only remaining block is the unsatisfiable promotion gate', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      { session_id: 'main-session-reentry', stop_hook_active: true },
      { __TEST_MOCK_BOARD__: BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: MISSION_APPROVED },
      repo()
    );
    expect(result.exitCode).toBe(0);
    expect(parseStopOutput(result.stdout).decision).not.toBe('block');
  });

  it('enforce-orchestrator-stop: still blocks on the same input when stop_hook_active is false (the guard is not a blanket bypass)', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      { session_id: 'main-session-reentry', stop_hook_active: false },
      { __TEST_MOCK_BOARD__: BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: MISSION_APPROVED },
      repo()
    );
    expect(parseStopOutput(result.stdout).decision).toBe('block');
  });

  it('enforce-final-review: allows the stop when stop_hook_active is true and only the unsatisfiable promotion gate remains', () => {
    const result = runHook(
      hookPath('enforce-final-review.js'),
      { stop_hook_active: true },
      { __TEST_MOCK_BOARD__: BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: MISSION_APPROVED },
      repo()
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('enforce-final-review: still blocks on the same input without the flag', () => {
    const result = runHook(
      hookPath('enforce-final-review.js'),
      {},
      { __TEST_MOCK_BOARD__: BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: MISSION_APPROVED },
      repo()
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/staged/i);
  });

  it('names the APPROVED-but-unpromoted situation — the exact state an API predating WI-790 leaves behind', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      { __TEST_MOCK_BOARD__: BOARD_ONE_STAGED, __TEST_MOCK_MISSION__: MISSION_APPROVED },
      repo()
    );
    const context = String(parseStopOutput(result.stdout).additionalContext);
    expect(context).toMatch(/APPROVED/);
    expect(context).toMatch(/still staged/i);
    expect(context).toMatch(/WI-790/);
    expect(context).toMatch(/ATEAM_SKIP_PROMOTION_GATE=1/);
  });

  it('enforce-orchestrator-stop: ATEAM_SKIP_PROMOTION_GATE=1 releases the staged gate', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: BOARD_ONE_STAGED,
        __TEST_MOCK_MISSION__: MISSION_APPROVED,
        ATEAM_SKIP_PROMOTION_GATE: '1',
      },
      repo()
    );
    expect(result.exitCode).toBe(0);
    expect(parseStopOutput(result.stdout).decision).not.toBe('block');
  });

  it('enforce-final-review: ATEAM_SKIP_PROMOTION_GATE=1 releases the staged gate', () => {
    const result = runHook(
      hookPath('enforce-final-review.js'),
      {},
      {
        __TEST_MOCK_BOARD__: BOARD_ONE_STAGED,
        __TEST_MOCK_MISSION__: MISSION_APPROVED,
        ATEAM_SKIP_PROMOTION_GATE: '1',
      },
      repo()
    );
    expect(result.exitCode).toBe(0);
  });

  it('ATEAM_SKIP_FRANKIE_GATE does NOT release the promotion gate — the two overrides stay separate', () => {
    const result = runHook(
      hookPath('enforce-orchestrator-stop.js'),
      {},
      {
        __TEST_MOCK_BOARD__: BOARD_ONE_STAGED,
        __TEST_MOCK_MISSION__: MISSION_APPROVED,
        ATEAM_SKIP_FRANKIE_GATE: '1',
      },
      repo()
    );
    expect(parseStopOutput(result.stdout).decision).toBe('block');
  });
});
