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
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
      { env: { ...process.env, ...env }, cwd, encoding: 'utf8', timeout: 10000 },
      (error, stdout) => resolve({ exitCode: error?.code ?? 0, stdout: stdout ?? '' })
    );
    if (stdin !== null) child.stdin.write(JSON.stringify(stdin));
    child.stdin.end();
  });
}

describe('observer-preflight.js hook mode (SessionStart)', () => {
  it('stays silent and exits 0 for a non-mission session (no ATEAM_PROJECT_ID), but still records status', async () => {
    const cwd = freshCwd();
    const { exitCode, stdout } = await runPreflight({
      stdin: { hook_event_name: 'SessionStart', cwd },
      env: { ATEAM_PROJECT_ID: '', ATEAM_MISSION_ID: '' },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe(''); // unrelated sessions must not get context noise

    // --check from the same cwd finds the file and reports the broken env.
    const check = await runPreflight({ args: ['--check'], cwd });
    expect(check.exitCode).toBe(1);
    expect(check.stdout).toContain('OBSERVER PREFLIGHT: FAIL');
    expect(check.stdout).toContain('ATEAM_PROJECT_ID');
  });

  it('records a passing status (probe OK) for a healthy env, and --check passes', async () => {
    const cwd = freshCwd();
    const { exitCode, stdout } = await runPreflight({
      stdin: { hook_event_name: 'SessionStart', cwd },
      env: {
        ATEAM_PROJECT_ID: 'preflight-test',
        ATEAM_API_URL: `http://127.0.0.1:${mockPort}`,
        ACCESS_CLIENT_ID: '',
        ACCESS_CLIENT_SECRET: '',
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe(''); // healthy → no warning

    const check = await runPreflight({ args: ['--check'], cwd });
    expect(check.exitCode).toBe(0);
    expect(check.stdout).toContain('OBSERVER PREFLIGHT: PASS');
    expect(check.stdout).toContain('project=preflight-test');
  });

  it('warns loudly (context output) when the env is mission-shaped but creds are missing for a remote API', async () => {
    const cwd = freshCwd();
    const { exitCode, stdout } = await runPreflight({
      stdin: { hook_event_name: 'SessionStart', cwd },
      env: {
        ATEAM_PROJECT_ID: 'preflight-test',
        // Remote-looking but unroutable (TEST-NET-1): no external DNS, the
        // probe's own 2s AbortSignal bounds it. Hermetic and deterministic.
        ATEAM_API_URL: 'https://192.0.2.1:9',
        ACCESS_CLIENT_ID: '',
        ACCESS_CLIENT_SECRET: '',
      },
    });
    expect(exitCode).toBe(0); // never blocks the session
    expect(stdout).toContain('OBSERVER TELEMETRY DEGRADED');
    expect(stdout).toContain('ACCESS_CLIENT_ID');

    const check = await runPreflight({ args: ['--check'], cwd });
    expect(check.exitCode).toBe(1);
    expect(check.stdout).toContain('OBSERVER PREFLIGHT: FAIL');
  }, 15000);
});

describe('observer-preflight.js --check mode', () => {
  it('fails with an explanation when no status file exists (hooks not firing at all)', async () => {
    const cwd = freshCwd(); // nothing ever wrote a status file for this cwd
    const { exitCode, stdout } = await runPreflight({ args: ['--check'], cwd });
    expect(exitCode).toBe(1);
    expect(stdout).toContain('OBSERVER PREFLIGHT: FAIL');
    expect(stdout).toContain('did not run');
  });
});
