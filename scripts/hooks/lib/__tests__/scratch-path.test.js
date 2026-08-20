/**
 * Tests for lib/scratch-path.js — the shared scratch-space allowlist used by
 * the allow-then-block PreToolUse write guards (Lynch/Stockwell, Amy x2,
 * Murdock).
 *
 * The bug this module exists to kill: those hooks exited 0 on a raw
 * `filePath.startsWith('/tmp/')` test, so a path that merely BEGAN with a
 * scratch root — `/tmp/../<repo>/src/app.ts`, or a symlink planted under
 * /tmp — skipped the block entirely. The allowlist must judge where a path
 * RESOLVES, not how it is spelled.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { isScratchPath, SCRATCH_ROOTS, TMP_ONLY_SCRATCH_ROOTS } from '../scratch-path.js';

const REPO_ROOT = realpathSync(join(__dirname, '..', '..', '..', '..'));

let sandbox;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'scratch-path-test-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('isScratchPath — genuine scratch paths are allowed', () => {
  it('allows a plain /tmp/ file', () => {
    expect(isScratchPath('/tmp/scratch/x.md')).toBe(true);
  });

  it('allows a plain /var/ file', () => {
    expect(isScratchPath('/var/tmp/scratch.txt')).toBe(true);
  });

  it('allows a not-yet-existing path under an existing scratch dir', () => {
    expect(isScratchPath(join(sandbox, 'nested', 'deeper', 'notes.md'))).toBe(true);
  });

  it('allows an existing file under a scratch dir', () => {
    const file = join(sandbox, 'exists.md');
    writeFileSync(file, 'hi');
    expect(isScratchPath(file)).toBe(true);
  });

  it('allows a ".." that stays inside the scratch root', () => {
    expect(isScratchPath('/tmp/a/../b/notes.md')).toBe(true);
  });
});

describe('isScratchPath — traversal escapes are denied', () => {
  it('denies /tmp/../<repo>/src/app.ts (the reported escape)', () => {
    expect(isScratchPath(`/tmp/../${REPO_ROOT}/src/app.ts`)).toBe(false);
  });

  it('denies /tmp/x/../../etc/hosts', () => {
    expect(isScratchPath('/tmp/x/../../etc/hosts')).toBe(false);
  });

  it('denies /var/../etc/passwd', () => {
    expect(isScratchPath('/var/../etc/passwd')).toBe(false);
  });
});

describe('isScratchPath — symlink laundering is denied', () => {
  it('denies a scratch-rooted symlink pointing at the repo', () => {
    const link = join(sandbox, 'launder');
    symlinkSync(join(REPO_ROOT, 'src'), link);
    expect(isScratchPath(join(link, 'app.ts'))).toBe(false);
  });

  it('denies a dangling symlink under a scratch root (fail closed)', () => {
    const link = join(sandbox, 'dangling');
    symlinkSync('/definitely/not/here/target', link);
    expect(isScratchPath(link)).toBe(false);
  });

  it('still allows a symlink that stays inside the scratch root', () => {
    const realDir = join(sandbox, 'real-dir');
    mkdirSync(realDir);
    const link = join(sandbox, 'inner-link');
    symlinkSync(realDir, link);
    expect(isScratchPath(join(link, 'notes.md'))).toBe(true);
  });
});

describe('isScratchPath — boundary and shape rules', () => {
  it('denies a sibling directory whose name merely starts with the root', () => {
    expect(isScratchPath('/tmpfoo/x.md')).toBe(false);
    expect(isScratchPath('/variable/x.md')).toBe(false);
  });

  it('denies the scratch root itself (matches the old startsWith("/tmp/"))', () => {
    expect(isScratchPath('/tmp')).toBe(false);
  });

  it('denies relative paths — they were never allowlisted', () => {
    expect(isScratchPath('src/app.ts')).toBe(false);
    expect(isScratchPath('tmp/x.md')).toBe(false);
    expect(isScratchPath('../tmp/x.md')).toBe(false);
  });

  it('denies empty and non-string inputs', () => {
    expect(isScratchPath('')).toBe(false);
    expect(isScratchPath(undefined)).toBe(false);
    expect(isScratchPath(null)).toBe(false);
    expect(isScratchPath(42)).toBe(false);
  });
});

describe('isScratchPath — root sets', () => {
  it('SCRATCH_ROOTS covers both /tmp and /var', () => {
    expect(SCRATCH_ROOTS).toEqual(['/tmp', '/var']);
  });

  it('TMP_ONLY_SCRATCH_ROOTS excludes /var (Murdock never allowed it)', () => {
    expect(TMP_ONLY_SCRATCH_ROOTS).toEqual(['/tmp']);
    expect(isScratchPath('/var/tmp/scratch.txt', TMP_ONLY_SCRATCH_ROOTS)).toBe(false);
    expect(isScratchPath('/tmp/scratch.txt', TMP_ONLY_SCRATCH_ROOTS)).toBe(true);
  });

  it('an unresolvable root is skipped, not treated as a wildcard', () => {
    expect(isScratchPath('/tmp/x.md', ['/definitely/not/here'])).toBe(false);
  });
});
