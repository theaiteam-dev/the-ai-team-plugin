/**
 * Integration coverage for the scratch-space allowlist shared by the
 * allow-then-block PreToolUse write guards.
 *
 * These hooks exit 0 EARLY for a "scratch" path and only then run their deny
 * rules, so a bad allowlist test disables the guard outright. They used to
 * compare the path as TYPED (`filePath.startsWith('/tmp/')`), which meant
 * `/tmp/../<repo>/src/app.ts` was allowlisted while the `src/app.ts` it
 * resolves to was blocked — and a symlink planted under /tmp laundered a write
 * into implementation code the same way. All four now route through
 * lib/scratch-path.js, which canonicalizes first.
 *
 * block-lynch-writes.js has its own suite (block-lynch-writes.test.ts); the
 * remaining three hooks are covered here plus a Lynch/Stockwell case so every
 * consumer of the helper has an end-to-end assertion.
 *
 * Note on Amy: her two hooks are deny-LIST guards — their last rule is "allow
 * other writes (files outside project directories)". Two consequences worth
 * stating so the assertions below are not misread:
 *
 *   - A resolved path like /etc/hosts stays ALLOWED for Amy before and after
 *     this fix; plain `/etc/hosts`, with no traversal at all, was always
 *     permitted. What the traversal escape actually bought her was reaching
 *     PROJECT paths (src/, tests, config), and those are asserted blocked here.
 *   - Her deny rules match the path STRING, so a symlink whose own spelling
 *     trips no rule still slips past them once the allowlist declines it. That
 *     is a pre-existing property of allow-by-default, not of the scratch
 *     allowlist — `/anywhere/link/app.ts` behaves identically with no scratch
 *     root involved — so it is out of scope here. The symlink layer of the
 *     shared helper is asserted directly in lib/__tests__/scratch-path.test.js
 *     and end-to-end against the deny-by-default hooks (Murdock, Lynch).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { mkdtempSync, symlinkSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';

const HOOKS_DIR = join(__dirname, '..');
const REPO_ROOT = realpathSync(join(__dirname, '..', '..', '..'));

const AMY_WRITES = join(HOOKS_DIR, 'block-amy-writes.js');
const AMY_TEST_WRITES = join(HOOKS_DIR, 'block-amy-test-writes.js');
const MURDOCK_IMPL_WRITES = join(HOOKS_DIR, 'block-murdock-impl-writes.js');
const LYNCH_WRITES = join(HOOKS_DIR, 'block-lynch-writes.js');

/** Run a hook as a child process with stdin JSON. */
function runHook(scriptPath: string, stdin: object) {
  const fullEnv = {
    ...process.env,
    ATEAM_API_URL: 'http://localhost:3000',
    ATEAM_PROJECT_ID: 'test-project',
  };
  try {
    const stdout = execFileSync('node', [scriptPath], {
      env: fullEnv,
      encoding: 'utf8',
      timeout: 5000,
      input: JSON.stringify(stdin),
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
      exitCode: err.status ?? 1,
    };
  }
}

function write(agent: string, filePath: string) {
  return { agent_type: agent, tool_name: 'Write', tool_input: { file_path: filePath } };
}

/** `/tmp/../<abs repo path>/<rel>` — the reported traversal escape. */
function tmpEscape(relPath: string) {
  return `/tmp/..${REPO_ROOT}/${relPath}`;
}

let sandbox: string;
let laundryLink: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'scratch-hook-test-'));
  // A symlink under a scratch root pointing back into the repo: every write
  // "under /tmp" through it actually lands in src/.
  laundryLink = join(sandbox, 'launder');
  symlinkSync(join(REPO_ROOT, 'src'), laundryLink);
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// =============================================================================
// block-murdock-impl-writes.js
// =============================================================================
describe('block-murdock-impl-writes — scratch allowlist cannot be traversed', () => {
  it('blocks /tmp/../<repo>/src/app.ts', () => {
    const result = runHook(MURDOCK_IMPL_WRITES, write('murdock', tmpEscape('src/app.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks /tmp/x/../../etc/hosts', () => {
    const result = runHook(MURDOCK_IMPL_WRITES, write('murdock', '/tmp/x/../../etc/hosts'));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks a /tmp symlink that resolves into src/', () => {
    const result = runHook(MURDOCK_IMPL_WRITES, write('murdock', join(laundryLink, 'app.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('still allows a genuine /tmp/ scratch file', () => {
    const result = runHook(MURDOCK_IMPL_WRITES, write('murdock', '/tmp/scratch/x.md'));
    expect(result.exitCode).toBe(0);
  });

  it('still blocks a plain relative implementation path', () => {
    const result = runHook(MURDOCK_IMPL_WRITES, write('murdock', 'src/app.ts'));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Murdock cannot write implementation files/i);
  });

  it('still allows a plain relative test path', () => {
    const result = runHook(MURDOCK_IMPL_WRITES, write('murdock', 'src/__tests__/app.test.ts'));
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-amy-writes.js
// =============================================================================
describe('block-amy-writes — scratch allowlist cannot be traversed', () => {
  it('blocks /tmp/../<repo>/src/app.ts', () => {
    const result = runHook(AMY_WRITES, write('amy', tmpEscape('src/app.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Amy cannot modify project source code/i);
  });

  it('blocks a traversal onto a test file', () => {
    const result = runHook(AMY_WRITES, write('amy', tmpEscape('src/app.test.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('still allows a genuine /tmp/ scratch file', () => {
    const result = runHook(AMY_WRITES, write('amy', '/tmp/scratch/x.md'));
    expect(result.exitCode).toBe(0);
  });

  it('still allows a genuine /var/ scratch file', () => {
    const result = runHook(AMY_WRITES, write('amy', '/var/tmp/scratch.txt'));
    expect(result.exitCode).toBe(0);
  });

  it('still blocks a plain relative source path', () => {
    const result = runHook(AMY_WRITES, write('amy', 'src/services/order.ts'));
    expect(result.exitCode).toBe(2);
  });
});

// =============================================================================
// block-amy-test-writes.js
// =============================================================================
describe('block-amy-test-writes — scratch allowlist cannot be traversed', () => {
  it('blocks /tmp/../<repo>/src/app.test.ts', () => {
    const result = runHook(AMY_TEST_WRITES, write('amy', tmpEscape('src/app.test.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Test files are Murdock/i);
  });

  it('blocks /tmp/../<repo>/src/app.ts', () => {
    const result = runHook(AMY_TEST_WRITES, write('amy', tmpEscape('src/app.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('still allows a genuine /tmp/ scratch file', () => {
    const result = runHook(AMY_TEST_WRITES, write('amy', '/tmp/scratch/x.md'));
    expect(result.exitCode).toBe(0);
  });

  it('still blocks a plain relative test path', () => {
    const result = runHook(AMY_TEST_WRITES, write('amy', 'src/__tests__/app.test.ts'));
    expect(result.exitCode).toBe(2);
  });
});

// =============================================================================
// block-lynch-writes.js — Stockwell shares this hook since the PR broadened it
// =============================================================================
describe('block-lynch-writes — Stockwell cannot traverse out of scratch', () => {
  it('blocks /tmp/../<repo>/src/app.ts for stockwell', () => {
    const result = runHook(LYNCH_WRITES, write('stockwell', tmpEscape('src/app.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks a /tmp symlink that resolves into src/ for stockwell', () => {
    const result = runHook(LYNCH_WRITES, write('stockwell', join(laundryLink, 'app.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('still allows stockwell a genuine /tmp/ scratch file', () => {
    const result = runHook(LYNCH_WRITES, write('stockwell', '/tmp/final-review-notes.md'));
    expect(result.exitCode).toBe(0);
  });
});
