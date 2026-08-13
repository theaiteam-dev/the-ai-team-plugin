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
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
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
// readExecutionContract() resolves ateam.config.json relative to
// process.cwd(), and execFileSync inherits the parent's cwd unless
// overridden — so every test here uses a scratch temp directory (its own
// throwaway ateam.config.json and, where needed, a real .qa-evidence/
// fixture) via runHook's new cwd parameter, rather than depending on this
// repo's own real config or mutating it.
// =============================================================================
describe('enforce-final-review — Frankie evidence-bundle gate', () => {
  const HOOK = hookPath('enforce-final-review.js');
  const MISSION_ID = 'M-TEST-001';
  const scratchDirs: string[] = [];

  it('calls the real canFrankieDrive() from lib/qa-contract.js — does not reimplement the drivability check', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/canFrankieDrive/);
    expect(source).toMatch(/qa-contract/);
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
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: missionWithId() },
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
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: missionWithId() },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('blocks on Frankie even when the final review verdict is already set (Frankie is checked first, unconditionally — adversarial ordering)', () => {
    const dir = makeScratchRepo({ surfaces: ['web'], evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      {
        __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE,
        __TEST_MOCK_MISSION__: missionWithId({ final_review_verdict: 'FINAL APPROVED', postcheck: { passed: true } }),
      },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('blocks when surfaces mix a drivable value with non-drivable ones (integration check — full matrix lives in qa-contract.test.js)', () => {
    const dir = makeScratchRepo({ surfaces: ['api', 'web'], evidence: 'none' });
    const result = runHook(
      HOOK,
      {},
      { __TEST_MOCK_BOARD__: MOCK_BOARD_ONE_DONE, __TEST_MOCK_MISSION__: missionWithId() },
      dir
    );
    expect(result.exitCode).toBe(0);
    const output = parseStopOutput(result.stdout);
    expect(output.decision).toBe('block');
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
