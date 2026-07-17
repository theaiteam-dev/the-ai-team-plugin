/**
 * Tests for observer-preflight.js — the two-sided telemetry preflight.
 *
 * Hook mode runs at SessionStart in the REAL hook env and records what it sees
 * to a status file keyed by cwd; --check mode (run via Bash from the mission
 * precheck) reads that file and fails loudly when telemetry would silently
 * black-hole (the M-20260714-001 failure mode: mission green, zero telemetry).
 *
 * Runs the real script as a subprocess, following observe-per-message-emit's
 * pattern.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { createServer } from 'http';

const SCRIPT = join(import.meta.dirname, '..', 'observer-preflight.js');

let mockServer;
let mockPort;

beforeAll(async () => {
  await new Promise((resolve) => {
    mockServer = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: [] }));
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => mockServer.close(resolve));
});

const tempDirs = [];
function freshCwd() {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-cwd-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Run the script; returns { exitCode, stdout }. */
function runPreflight({ args = [], stdin = null, env = {}, cwd = process.cwd() }) {
  return new Promise((resolve) => {
    const child = execFile(
      'node',
      [SCRIPT, ...args],
      // CLAUDE_CODE_SESSION_ID is cleared by default so tests are hermetic
      // regardless of whether the runner itself is a Claude Code session;
      // session-identity tests set it explicitly.
      { env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', ...env }, cwd, encoding: 'utf8', timeout: 10000 },
      (error, stdout) => {
        // A timeout-killed process reports error.killed/error.signal with NO
        // numeric code — `error?.code ?? 0` would masquerade a hung preflight
        // as exit 0 and silently pass assertions. Surface it distinctly.
        if (error && (error.killed || error.signal)) {
          return resolve({ exitCode: `killed:${error.signal ?? 'timeout'}`, stdout: stdout ?? '' });
        }
        // Spawn failures carry a string code (e.g. 'ENOENT') — never 0.
        const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ exitCode, stdout: stdout ?? '' });
      }
    );
    // A fast-exiting child (--check never reads stdin) can close the pipe
    // before we write — the resulting async EPIPE is an UNCAUGHT exception
    // that crashes whatever unrelated test is running in this worker. Swallow
    // stream errors; the exit code is the contract under test, not the pipe.
    child.stdin.on('error', () => {});
    try {
      if (stdin !== null) child.stdin.write(JSON.stringify(stdin));
      child.stdin.end();
    } catch { /* child already gone — benign */ }
  });
}

/** Mirror of the script's status-file keying (sha256 of realpath'd cwd). */
function statusPathFor(cwd) {
  let canonical = cwd;
  try { canonical = realpathSync(cwd); } catch { /* keep raw */ }
  const key = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return join(tmpdir(), 'ateam-observer-preflight', `${key}.json`);
}

/**
 * Run hook mode, then --check. The status write is deliberately best-effort
 * (never blocks a session), so under full-suite parallel load a transient
 * EMFILE-class failure can swallow it — the script's ACCEPTED failure mode,
 * not a bug. Retry the pair once when --check reports a missing file so the
 * happy-path contract stays pinned without load flakiness; a genuine keying
 * or write bug still fails both attempts.
 */
async function hookThenCheck({ cwd, hookStdin, hookEnv, checkEnv = {} }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const hook = await runPreflight({ stdin: hookStdin, env: hookEnv, cwd });
    const check = await runPreflight({ args: ['--check'], cwd, env: checkEnv });
    if (!check.stdout.includes('No preflight status file') || attempt === 1) {
      return { hook, check };
    }
  }
}

describe('observer-preflight.js hook mode (SessionStart)', () => {
  it('stays silent and exits 0 for a non-mission session (no ATEAM_PROJECT_ID), but still records status', async () => {
    const cwd = freshCwd();
    const { hook, check } = await hookThenCheck({
      cwd,
      hookStdin: { hook_event_name: 'SessionStart', cwd },
      hookEnv: { ATEAM_PROJECT_ID: '', ATEAM_MISSION_ID: '' },
    });
    expect(hook.exitCode).toBe(0);
    expect(hook.stdout).toBe(''); // unrelated sessions must not get context noise

    // --check from the same cwd finds the file and reports the broken env.
    expect(check.exitCode).toBe(1);
    expect(check.stdout).toContain('OBSERVER PREFLIGHT: FAIL');
    expect(check.stdout).toContain('ATEAM_PROJECT_ID');
  });

  it('records a passing status (probe OK) for a healthy env, and --check passes', async () => {
    const cwd = freshCwd();
    const { hook, check } = await hookThenCheck({
      cwd,
      hookStdin: { hook_event_name: 'SessionStart', cwd },
      hookEnv: {
        ATEAM_PROJECT_ID: 'preflight-test',
        ATEAM_API_URL: `http://127.0.0.1:${mockPort}`,
        ACCESS_CLIENT_ID: '',
        ACCESS_CLIENT_SECRET: '',
      },
    });
    expect(hook.exitCode).toBe(0);
    expect(hook.stdout).toBe(''); // healthy → no warning

    expect(check.exitCode).toBe(0);
    expect(check.stdout).toContain('OBSERVER PREFLIGHT: PASS');
    expect(check.stdout).toContain('project=preflight-test');
  });

  it('warns loudly (context output) when the env is mission-shaped but creds are missing for a remote API', async () => {
    const cwd = freshCwd();
    const { hook, check } = await hookThenCheck({
      cwd,
      hookStdin: { hook_event_name: 'SessionStart', cwd },
      hookEnv: {
        ATEAM_PROJECT_ID: 'preflight-test',
        // Remote-looking but unroutable (TEST-NET-1): no external DNS, the
        // probe's own 2s AbortSignal bounds it. Hermetic and deterministic.
        ATEAM_API_URL: 'https://192.0.2.1:9',
        ACCESS_CLIENT_ID: '',
        ACCESS_CLIENT_SECRET: '',
      },
    });
    expect(hook.exitCode).toBe(0); // never blocks the session
    expect(hook.stdout).toContain('OBSERVER TELEMETRY DEGRADED');
    expect(hook.stdout).toContain('ACCESS_CLIENT_ID');

    expect(check.exitCode).toBe(1);
    expect(check.stdout).toContain('OBSERVER PREFLIGHT: FAIL');
  }, 20000);
});

describe('observer-preflight.js --check mode', () => {
  it('fails with an explanation when no status file exists (hooks not firing at all)', async () => {
    const cwd = freshCwd(); // nothing ever wrote a status file for this cwd
    const { exitCode, stdout } = await runPreflight({ args: ['--check'], cwd });
    expect(exitCode).toBe(1);
    expect(stdout).toContain('OBSERVER PREFLIGHT: FAIL');
    expect(stdout).toContain('did not run');
  });

  it('fails with a distinct message when the status file exists but is corrupt JSON', async () => {
    const cwd = freshCwd();
    mkdirSync(join(tmpdir(), 'ateam-observer-preflight'), { recursive: true });
    writeFileSync(statusPathFor(cwd), '{ not json !!!');

    const { exitCode, stdout } = await runPreflight({ args: ['--check'], cwd });
    expect(exitCode).toBe(1);
    expect(stdout).toContain('OBSERVER PREFLIGHT: FAIL');
    expect(stdout).toContain('corrupt');
    expect(stdout).not.toContain('did not run');
  });

  it('fails when the status file was written by a DIFFERENT session (stale-PASS prevention)', async () => {
    // The core false-negative from review: session A (hooks on) writes PASS
    // status; session B (hooks off) never refreshes it. --check in session B
    // must FAIL, not read A's stale PASS.
    const cwd = freshCwd();
    const { hook, check } = await hookThenCheck({
      cwd,
      hookStdin: { hook_event_name: 'SessionStart', cwd, session_id: 'sess-A' },
      hookEnv: {
        ATEAM_PROJECT_ID: 'preflight-test',
        ATEAM_API_URL: `http://127.0.0.1:${mockPort}`,
        ACCESS_CLIENT_ID: '',
        ACCESS_CLIENT_SECRET: '',
      },
      checkEnv: { CLAUDE_CODE_SESSION_ID: 'sess-B' },
    });
    expect(hook.exitCode).toBe(0);
    expect(check.exitCode).toBe(1);
    expect(check.stdout).toContain('OBSERVER PREFLIGHT: FAIL');
    expect(check.stdout).toContain('DIFFERENT session');
  });

  it('passes with session=verified when the status was written by THIS session', async () => {
    const cwd = freshCwd();
    const { hook, check } = await hookThenCheck({
      cwd,
      hookStdin: { hook_event_name: 'SessionStart', cwd, session_id: 'sess-same' },
      hookEnv: {
        ATEAM_PROJECT_ID: 'preflight-test',
        ATEAM_API_URL: `http://127.0.0.1:${mockPort}`,
        ACCESS_CLIENT_ID: '',
        ACCESS_CLIENT_SECRET: '',
      },
      checkEnv: { CLAUDE_CODE_SESSION_ID: 'sess-same' },
    });
    expect(hook.exitCode).toBe(0);
    expect(check.exitCode).toBe(0);
    expect(check.stdout).toContain('OBSERVER PREFLIGHT: PASS');
    expect(check.stdout).toContain('session=verified');
  });

  it('fails via the age gate when session identity is unavailable and the status is old', async () => {
    const cwd = freshCwd();
    mkdirSync(join(tmpdir(), 'ateam-observer-preflight'), { recursive: true });
    // A healthy-looking status from 13h ago, with no sessionId to compare.
    writeFileSync(statusPathFor(cwd), JSON.stringify({
      timestamp: new Date(Date.now() - 13 * 3600_000).toISOString(),
      cwd,
      sessionId: null,
      apiUrl: 'http://localhost:3000',
      local: true,
      projectIdPresent: true,
      projectId: 'preflight-test',
      missionIdPresent: false,
      credsPresent: false,
      probe: { attempted: true, ok: true, status: 200, error: null },
    }));

    const { exitCode, stdout } = await runPreflight({ args: ['--check'], cwd });
    expect(exitCode).toBe(1);
    expect(stdout).toContain('OBSERVER PREFLIGHT: FAIL');
    expect(stdout).toContain('earlier session');
  });
});
