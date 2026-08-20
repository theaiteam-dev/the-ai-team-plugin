/**
 * Integration coverage for the scratch-space allowlist shared by the
 * allow-then-block PreToolUse write guards.
 *
 * These hooks exit 0 EARLY for a "scratch" path and only then run their deny
 * rules, so a bad allowlist test disables the guard outright. Two ways that
 * has happened, both asserted end-to-end here:
 *
 *   1. TYPED vs RESOLVED. The hooks compared the path as typed
 *      (`filePath.startsWith('/tmp/')`), so `/tmp/../<repo>/src/app.ts` was
 *      allowlisted while the `src/app.ts` it resolves to was blocked — and a
 *      symlink planted under /tmp laundered a write into implementation code
 *      the same way.
 *
 *   2. REPO UNDER A TEMP ROOT. Canonicalizing alone still allowlisted every
 *      file of a checkout that LIVES under a temp root — macOS $TMPDIR is
 *      /var/folders/<hash>/T, `git worktree add /tmp/...` and CI sandboxes put
 *      the working tree under /tmp. There, `<repo>/src/app.ts` is genuinely
 *      "under /tmp" and all four guards exited 0 for it. The allowlist now
 *      subtracts the project root, which the hooks pass in from the hook
 *      payload's `cwd`.
 *
 * Both layouts are simulated EXPLICITLY, with fixtures built in real temp dirs
 * and the project root injected per-run, so these assertions hold no matter
 * where this checkout happens to live.
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
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';

const HOOKS_DIR = join(__dirname, '..');
const REPO_ROOT = realpathSync(join(__dirname, '..', '..', '..'));

const AMY_WRITES = join(HOOKS_DIR, 'block-amy-writes.js');
const AMY_TEST_WRITES = join(HOOKS_DIR, 'block-amy-test-writes.js');
const MURDOCK_IMPL_WRITES = join(HOOKS_DIR, 'block-murdock-impl-writes.js');
const LYNCH_WRITES = join(HOOKS_DIR, 'block-lynch-writes.js');

/**
 * Run a hook as a child process with stdin JSON, from a given project root.
 *
 * `cwd` is set BOTH as the child's working directory and on the payload, the
 * way Claude Code actually invokes hooks — that pair is what tells the guard
 * which tree is "the project" and therefore never scratch.
 */
function runHook(scriptPath: string, stdin: object, cwd: string = REPO_ROOT) {
  const fullEnv = {
    ...process.env,
    ATEAM_API_URL: 'http://localhost:3000',
    ATEAM_PROJECT_ID: 'test-project',
  };
  try {
    const stdout = execFileSync('node', [scriptPath], {
      cwd,
      env: fullEnv,
      encoding: 'utf8',
      timeout: 5000,
      input: JSON.stringify({ cwd, ...stdin }),
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

/** `/tmp/../<abs project path>/<rel>` — the reported traversal escape. */
function tmpEscape(projectRoot: string, relPath: string) {
  return `/tmp/..${projectRoot}/${relPath}`;
}

// Fixtures. `fixtures` is a real directory under the system temp root, so
// everything inside it is genuinely "under /tmp" ($TMPDIR on macOS):
//
//   <fixtures>/repo/src/        <- a checkout that LIVES under the temp root
//   <fixtures>/scratch/         <- ordinary scratch space beside it
//   <fixtures>/scratch/launder  -> <fixtures>/repo/src  (symlink laundering)
//   <fixtures>/outside.md       <- scratch sibling of the repo
let fixtures: string;
let tempRepo: string;
let scratchDir: string;
let laundryLink: string;
let repoLaundryLink: string;

beforeAll(() => {
  fixtures = realpathSync(mkdtempSync(join(tmpdir(), 'ateam-hookfx-')));
  tempRepo = join(fixtures, 'repo');
  scratchDir = join(fixtures, 'scratch');
  mkdirSync(join(tempRepo, 'src'), { recursive: true });
  mkdirSync(scratchDir);
  // A symlink under a scratch root pointing into the temp-rooted repo: every
  // write "under /tmp" through it actually lands in that repo's src/.
  laundryLink = join(scratchDir, 'launder');
  symlinkSync(join(tempRepo, 'src'), laundryLink);
  // Same trick aimed at THIS checkout, for the runs whose project root is the
  // real repo. The target need not exist — a dangling link fails closed too.
  repoLaundryLink = join(scratchDir, 'launder-checkout');
  symlinkSync(join(REPO_ROOT, 'scripts'), repoLaundryLink);
});

afterAll(() => {
  rmSync(fixtures, { recursive: true, force: true });
});

// =============================================================================
// block-murdock-impl-writes.js
// =============================================================================
describe('block-murdock-impl-writes — scratch allowlist cannot be traversed', () => {
  it('blocks /tmp/../<repo>/src/app.ts', () => {
    const result = runHook(
      MURDOCK_IMPL_WRITES,
      write('murdock', tmpEscape(REPO_ROOT, 'src/app.ts')),
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks /tmp/x/../../etc/hosts', () => {
    const result = runHook(MURDOCK_IMPL_WRITES, write('murdock', '/tmp/x/../../etc/hosts'));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks a /tmp symlink that resolves into the checkout', () => {
    const result = runHook(
      MURDOCK_IMPL_WRITES,
      write('murdock', join(repoLaundryLink, 'app.ts')),
    );
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

describe('block-murdock-impl-writes — repo living under a temp root', () => {
  it('blocks <repo>/src/app.ts when the repo itself is under /tmp', () => {
    const result = runHook(
      MURDOCK_IMPL_WRITES,
      write('murdock', join(tempRepo, 'src', 'app.ts')),
      tempRepo,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Murdock cannot write implementation files/i);
  });

  it('blocks /tmp/../<temp repo>/src/app.ts', () => {
    const result = runHook(
      MURDOCK_IMPL_WRITES,
      write('murdock', tmpEscape(tempRepo, 'src/app.ts')),
      tempRepo,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks a scratch symlink resolving into the temp-rooted repo', () => {
    const result = runHook(MURDOCK_IMPL_WRITES, write('murdock', join(laundryLink, 'app.ts')), tempRepo);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('still allows scratch beside that repo (same temp root, outside the project)', () => {
    const beside = runHook(
      MURDOCK_IMPL_WRITES,
      write('murdock', join(fixtures, 'outside.md')),
      tempRepo,
    );
    expect(beside.exitCode).toBe(0);
    const inScratchDir = runHook(
      MURDOCK_IMPL_WRITES,
      write('murdock', join(scratchDir, 'notes.md')),
      tempRepo,
    );
    expect(inScratchDir.exitCode).toBe(0);
  });
});

// =============================================================================
// block-amy-writes.js
// =============================================================================
describe('block-amy-writes — scratch allowlist cannot be traversed', () => {
  it('blocks /tmp/../<repo>/src/app.ts', () => {
    const result = runHook(AMY_WRITES, write('amy', tmpEscape(REPO_ROOT, 'src/app.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Amy cannot modify project source code/i);
  });

  it('blocks a traversal onto a test file', () => {
    const result = runHook(AMY_WRITES, write('amy', tmpEscape(REPO_ROOT, 'src/app.test.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('still allows a genuine /tmp/ scratch file', () => {
    const result = runHook(AMY_WRITES, write('amy', '/tmp/scratch/x.md'));
    expect(result.exitCode).toBe(0);
  });

  it('still allows a genuine /var/tmp/ scratch file', () => {
    const result = runHook(AMY_WRITES, write('amy', '/var/tmp/scratch.txt'));
    expect(result.exitCode).toBe(0);
  });

  it('still blocks a plain relative source path', () => {
    const result = runHook(AMY_WRITES, write('amy', 'src/services/order.ts'));
    expect(result.exitCode).toBe(2);
  });
});

describe('block-amy-writes — repo living under a temp root', () => {
  it('blocks <repo>/src/services/order.ts when the repo is under /tmp', () => {
    const result = runHook(
      AMY_WRITES,
      write('amy', join(tempRepo, 'src', 'services', 'order.ts')),
      tempRepo,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Amy cannot modify project source code/i);
  });

  it('blocks <repo>/src/app.test.ts when the repo is under /tmp', () => {
    const result = runHook(AMY_WRITES, write('amy', join(tempRepo, 'src', 'app.test.ts')), tempRepo);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Test files are Murdock/i);
  });

  it('still allows scratch beside that repo', () => {
    const result = runHook(AMY_WRITES, write('amy', join(scratchDir, 'findings.md')), tempRepo);
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-amy-test-writes.js
// =============================================================================
describe('block-amy-test-writes — scratch allowlist cannot be traversed', () => {
  it('blocks /tmp/../<repo>/src/app.test.ts', () => {
    const result = runHook(AMY_TEST_WRITES, write('amy', tmpEscape(REPO_ROOT, 'src/app.test.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Test files are Murdock/i);
  });

  it('blocks /tmp/../<repo>/src/app.ts', () => {
    const result = runHook(AMY_TEST_WRITES, write('amy', tmpEscape(REPO_ROOT, 'src/app.ts')));
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

describe('block-amy-test-writes — repo living under a temp root', () => {
  it('blocks <repo>/src/app.test.ts when the repo is under /tmp', () => {
    const result = runHook(
      AMY_TEST_WRITES,
      write('amy', join(tempRepo, 'src', 'app.test.ts')),
      tempRepo,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Test files are Murdock/i);
  });

  it('blocks <repo>/src/app.ts when the repo is under /tmp', () => {
    const result = runHook(AMY_TEST_WRITES, write('amy', join(tempRepo, 'src', 'app.ts')), tempRepo);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('still allows scratch beside that repo', () => {
    const result = runHook(AMY_TEST_WRITES, write('amy', join(scratchDir, 'probe.md')), tempRepo);
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-lynch-writes.js — Stockwell shares this hook since the PR broadened it
// =============================================================================
describe('block-lynch-writes — Stockwell cannot traverse out of scratch', () => {
  it('blocks /tmp/../<repo>/src/app.ts for stockwell', () => {
    const result = runHook(LYNCH_WRITES, write('stockwell', tmpEscape(REPO_ROOT, 'src/app.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks a /tmp symlink that resolves into the checkout for stockwell', () => {
    const result = runHook(LYNCH_WRITES, write('stockwell', join(repoLaundryLink, 'app.ts')));
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('still allows stockwell a genuine /tmp/ scratch file', () => {
    const result = runHook(LYNCH_WRITES, write('stockwell', '/tmp/final-review-notes.md'));
    expect(result.exitCode).toBe(0);
  });
});

describe('block-lynch-writes — repo living under a temp root', () => {
  it('blocks <repo>/src/app.ts for lynch when the repo is under /tmp', () => {
    const result = runHook(LYNCH_WRITES, write('lynch', join(tempRepo, 'src', 'app.ts')), tempRepo);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks <repo>/README.md for stockwell when the repo is under /tmp', () => {
    const result = runHook(
      LYNCH_WRITES,
      write('stockwell', join(tempRepo, 'README.md')),
      tempRepo,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks a scratch symlink resolving into the temp-rooted repo', () => {
    const result = runHook(LYNCH_WRITES, write('lynch', join(laundryLink, 'app.ts')), tempRepo);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('still allows scratch beside that repo', () => {
    const result = runHook(LYNCH_WRITES, write('lynch', join(scratchDir, 'review.md')), tempRepo);
    expect(result.exitCode).toBe(0);
  });
});
