/**
 * Tests for lib/scratch-path.js — the shared scratch-space allowlist used by
 * the allow-then-block PreToolUse write guards (Lynch/Stockwell, Amy x2,
 * Murdock).
 *
 * Two bugs this module exists to kill:
 *
 *  1. TYPED-vs-RESOLVED. The hooks exited 0 on a raw
 *     `filePath.startsWith('/tmp/')` test, so a path that merely BEGAN with a
 *     scratch root — `/tmp/../<repo>/src/app.ts`, or a symlink planted under
 *     /tmp — skipped the block entirely.
 *
 *  2. REPO-UNDER-TEMP. Canonicalizing alone still judged EVERY file of a
 *     checkout that lives under a temp root to be scratch: macOS $TMPDIR is
 *     /var/folders/<hash>/T, `git worktree add /tmp/...` and CI sandboxes put
 *     the working tree under /tmp. On such a checkout all four guards exited 0
 *     for `<repo>/src/app.ts`. The rule is therefore TWO clauses: under a real
 *     temp root AND outside the project root, with the project root winning.
 *
 * Every case below injects BOTH the roots and the project root explicitly, so
 * the suite asserts the same verdicts no matter where this checkout happens to
 * live (/home/..., /tmp/..., /var/folders/...). Nothing here reads the ambient
 * cwd.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { isScratchPath, SCRATCH_ROOTS, TMP_ONLY_SCRATCH_ROOTS } from '../scratch-path.js';

/**
 * A project root that is NOT under any temp root, used by the "repo under
 * /home" layout cases. It does not need to exist — canonicalizeProjectRoot()
 * falls back to the lexical path, and containment is a prefix test.
 */
const HOME_REPO = '/home/nonexistent-fixture/repo';

let fixtures; // realpath'd mkdtemp dir — the "temp root" of the layout-2 cases
let sandbox; // plain scratch dir under `fixtures`
let tempRepo; // a checkout that LIVES under the temp root (the author's case)

beforeAll(() => {
  fixtures = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-path-test-')));
  sandbox = join(fixtures, 'scratch');
  tempRepo = join(fixtures, 'repo');
  mkdirSync(sandbox);
  mkdirSync(join(tempRepo, 'src'), { recursive: true });
});

afterAll(() => {
  rmSync(fixtures, { recursive: true, force: true });
});

// =============================================================================
// Layout 1 — repo lives OUTSIDE any temp root (/home/...)
// =============================================================================
describe('isScratchPath — repo outside the temp roots', () => {
  const scratch = (p, roots = SCRATCH_ROOTS) => isScratchPath(p, roots, HOME_REPO);

  it('allows a plain /tmp/ file', () => {
    expect(scratch('/tmp/scratch/x.md')).toBe(true);
  });

  it('allows a /var/tmp/ file', () => {
    expect(scratch('/var/tmp/scratch.txt')).toBe(true);
  });

  it('allows a file under os.tmpdir() (macOS $TMPDIR = /var/folders/<...>/T)', () => {
    expect(scratch(join(tmpdir(), 'notes.md'))).toBe(true);
  });

  it('allows a not-yet-existing path under an existing scratch dir', () => {
    expect(scratch(join(sandbox, 'nested', 'deeper', 'notes.md'))).toBe(true);
  });

  it('allows an existing file under a scratch dir', () => {
    const file = join(sandbox, 'exists.md');
    writeFileSync(file, 'hi');
    expect(scratch(file)).toBe(true);
  });

  it('allows a ".." that stays inside the scratch root', () => {
    expect(scratch('/tmp/a/../b/notes.md')).toBe(true);
  });

  it('denies /tmp/../<repo>/src/app.ts (the reported escape)', () => {
    expect(scratch(`/tmp/..${HOME_REPO}/src/app.ts`)).toBe(false);
  });

  it('denies /tmp/x/../../etc/hosts (/etc is under no temp root)', () => {
    expect(scratch('/tmp/x/../../etc/hosts')).toBe(false);
  });

  it('denies /var/../etc/passwd', () => {
    expect(scratch('/var/../etc/passwd')).toBe(false);
  });

  it('denies /var itself and non-temp /var subtrees (only /var/tmp is scratch)', () => {
    expect(scratch('/var/log/foo.ts')).toBe(false);
    expect(scratch('/var/www/html/index.php')).toBe(false);
    expect(scratch('/var/lib/whatever.db')).toBe(false);
  });
});

// =============================================================================
// Layout 2 — repo lives INSIDE a temp root (macOS $TMPDIR, /tmp worktree, CI
// sandbox). This is the case that silently disarmed all four write guards.
// =============================================================================
describe('isScratchPath — repo INSIDE a temp root', () => {
  it('denies <repo>/src/app.ts for a checkout under the temp root', () => {
    expect(isScratchPath(join(tempRepo, 'src', 'app.ts'), SCRATCH_ROOTS, tempRepo)).toBe(false);
  });

  it('denies a not-yet-existing file anywhere under such a repo', () => {
    expect(isScratchPath(join(tempRepo, 'src', 'new', 'feature.ts'), SCRATCH_ROOTS, tempRepo)).toBe(
      false,
    );
  });

  it('denies the repo root itself', () => {
    expect(isScratchPath(tempRepo, SCRATCH_ROOTS, tempRepo)).toBe(false);
  });

  it('still allows a sibling of the repo that is under the temp root', () => {
    expect(isScratchPath(join(fixtures, 'outside-scratch.md'), SCRATCH_ROOTS, tempRepo)).toBe(true);
  });

  it('still allows the ordinary scratch dir next door', () => {
    expect(isScratchPath(join(sandbox, 'debug.log'), SCRATCH_ROOTS, tempRepo)).toBe(true);
  });

  it('denies <repo>/../<repo>/src/app.ts — traversal cannot re-enter the repo', () => {
    const spelled = join(tempRepo, '..', 'repo', 'src', 'app.ts');
    expect(isScratchPath(spelled, SCRATCH_ROOTS, tempRepo)).toBe(false);
  });

  it('excludes the project root even when cwd is spelled with a trailing slash or ".."', () => {
    const target = join(tempRepo, 'src', 'app.ts');
    expect(isScratchPath(target, SCRATCH_ROOTS, `${tempRepo}/`)).toBe(false);
    expect(isScratchPath(target, SCRATCH_ROOTS, join(tempRepo, 'src', '..'))).toBe(false);
  });

  it('denies a repo file when the project root is a SUBDIR-spelled cwd of the same repo', () => {
    // Hooks pass the session cwd; if that cwd is <repo>/src, files under it
    // are still excluded (the containment test is prefix-based).
    expect(isScratchPath(join(tempRepo, 'src', 'app.ts'), SCRATCH_ROOTS, join(tempRepo, 'src'))).toBe(
      false,
    );
  });
});

// =============================================================================
// Layout 3 — a SIMULATED /var/folders-style temp root, so the macOS rule is
// testable on Linux. The root is injected; no real $TMPDIR involved.
// =============================================================================
describe('isScratchPath — injected /var/folders-style temp root', () => {
  let fakeTmp;
  let fakeRepo;

  beforeAll(() => {
    fakeTmp = join(fixtures, 'var', 'folders', 'q7', 'T');
    fakeRepo = join(fakeTmp, 'checkout');
    mkdirSync(join(fakeRepo, 'src'), { recursive: true });
  });

  it('treats a file under the injected root as scratch', () => {
    expect(isScratchPath(join(fakeTmp, 'agent-notes.md'), [fakeTmp], HOME_REPO)).toBe(true);
  });

  it('denies the injected root directory itself', () => {
    expect(isScratchPath(fakeTmp, [fakeTmp], HOME_REPO)).toBe(false);
  });

  it('denies a repo file when the repo sits inside the injected root', () => {
    expect(isScratchPath(join(fakeRepo, 'src', 'app.ts'), [fakeTmp], fakeRepo)).toBe(false);
  });

  it('allows a scratch file beside that repo, still inside the injected root', () => {
    expect(isScratchPath(join(fakeTmp, 'beside.md'), [fakeTmp], fakeRepo)).toBe(true);
  });

  it('denies a path outside the injected root even with the repo elsewhere', () => {
    expect(isScratchPath(join(fixtures, 'var', 'other.md'), [fakeTmp], HOME_REPO)).toBe(false);
  });

  it('denies a sibling root whose name merely prefixes the injected one', () => {
    expect(isScratchPath(`${fakeTmp}-evil/x.md`, [fakeTmp], HOME_REPO)).toBe(false);
  });
});

// =============================================================================
// Symlink laundering
// =============================================================================
describe('isScratchPath — symlink laundering is denied', () => {
  it('denies a scratch-rooted symlink pointing into the project', () => {
    const link = join(sandbox, 'launder');
    symlinkSync(join(tempRepo, 'src'), link);
    expect(isScratchPath(join(link, 'app.ts'), SCRATCH_ROOTS, tempRepo)).toBe(false);
  });

  it('denies a dangling symlink under a scratch root (fail closed)', () => {
    const link = join(sandbox, 'dangling');
    symlinkSync('/definitely/not/here/target', link);
    expect(isScratchPath(link, SCRATCH_ROOTS, HOME_REPO)).toBe(false);
  });

  it('denies a symlink that resolves outside every temp root', () => {
    const link = join(sandbox, 'to-etc');
    symlinkSync('/etc', link);
    expect(isScratchPath(join(link, 'hosts'), SCRATCH_ROOTS, HOME_REPO)).toBe(false);
  });

  it('still allows a symlink that stays inside the scratch root', () => {
    const realDir = join(sandbox, 'real-dir');
    mkdirSync(realDir);
    const link = join(sandbox, 'inner-link');
    symlinkSync(realDir, link);
    expect(isScratchPath(join(link, 'notes.md'), SCRATCH_ROOTS, HOME_REPO)).toBe(true);
  });
});

// =============================================================================
// Boundary and shape rules
// =============================================================================
describe('isScratchPath — boundary and shape rules', () => {
  const scratch = (p) => isScratchPath(p, SCRATCH_ROOTS, HOME_REPO);

  it('denies a sibling directory whose name merely starts with the root', () => {
    expect(scratch('/tmpfoo/x.md')).toBe(false);
    expect(scratch('/var/tmpfoo/x.md')).toBe(false);
  });

  it('denies the scratch root itself (matches the old startsWith("/tmp/"))', () => {
    expect(scratch('/tmp')).toBe(false);
    expect(scratch('/var/tmp')).toBe(false);
  });

  it('denies relative paths — they were never allowlisted', () => {
    expect(scratch('src/app.ts')).toBe(false);
    expect(scratch('tmp/x.md')).toBe(false);
    expect(scratch('../tmp/x.md')).toBe(false);
  });

  it('denies empty and non-string inputs', () => {
    expect(scratch('')).toBe(false);
    expect(scratch(undefined)).toBe(false);
    expect(scratch(null)).toBe(false);
    expect(scratch(42)).toBe(false);
  });
});

// =============================================================================
// Root sets and the projectRoot parameter
// =============================================================================
describe('isScratchPath — root sets', () => {
  it('SCRATCH_ROOTS is the real temp roots only — never bare /var', () => {
    expect(SCRATCH_ROOTS).toEqual([tmpdir(), '/tmp', '/var/tmp']);
    expect(SCRATCH_ROOTS).not.toContain('/var');
  });

  it('TMP_ONLY_SCRATCH_ROOTS excludes /var/tmp (Murdock never allowed /var)', () => {
    expect(TMP_ONLY_SCRATCH_ROOTS).toEqual([tmpdir(), '/tmp']);
    expect(isScratchPath('/var/tmp/scratch.txt', TMP_ONLY_SCRATCH_ROOTS, HOME_REPO)).toBe(false);
    expect(isScratchPath('/tmp/scratch.txt', TMP_ONLY_SCRATCH_ROOTS, HOME_REPO)).toBe(true);
  });

  it('an unresolvable root is skipped, not treated as a wildcard', () => {
    expect(isScratchPath('/tmp/x.md', ['/definitely/not/here'], HOME_REPO)).toBe(false);
  });

  it('duplicate/aliased roots collapse instead of changing the verdict', () => {
    const dupes = ['/tmp', '/tmp/', '/tmp/./', tmpdir()];
    expect(isScratchPath('/tmp/x.md', dupes, HOME_REPO)).toBe(true);
    expect(isScratchPath('/etc/hosts', dupes, HOME_REPO)).toBe(false);
  });

  it('a non-array roots argument falls back to the defaults rather than allowing everything', () => {
    expect(isScratchPath('/etc/hosts', 'not-an-array', HOME_REPO)).toBe(false);
    expect(isScratchPath('/tmp/x.md', 'not-an-array', HOME_REPO)).toBe(true);
  });
});

describe('isScratchPath — projectRoot parameter', () => {
  it('defaults to process.cwd() when omitted, so the running checkout is excluded', () => {
    // Built from cwd rather than a hardcoded location, so the assertion holds
    // wherever this checkout lives — including under /tmp.
    expect(isScratchPath(join(process.cwd(), 'src', 'app.ts'))).toBe(false);
  });

  it('still allows a fresh temp fixture under the default project root', () => {
    // A freshly mkdtemp'd directory is never inside the checkout, so it stays
    // scratch no matter where the checkout lives.
    expect(isScratchPath(join(fixtures, 'default-cwd.md'))).toBe(true);
  });

  it('treats a missing/blank project root as "unknown" and applies temp roots only', () => {
    expect(isScratchPath('/tmp/x.md', SCRATCH_ROOTS, '')).toBe(true);
    expect(isScratchPath('/etc/hosts', SCRATCH_ROOTS, '')).toBe(false);
    expect(isScratchPath('/tmp/x.md', SCRATCH_ROOTS, null)).toBe(true);
  });
});
