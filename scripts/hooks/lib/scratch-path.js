/**
 * scratch-path.js — shared scratch-space allowlist for the PreToolUse write guards.
 *
 * Several hooks (block-lynch-writes, block-amy-writes, block-amy-test-writes,
 * block-murdock-impl-writes) are ALLOW-THEN-BLOCK: they exit 0 early for a
 * "scratch space" path and only then run their deny rules. That early exit is
 * the whole guard's soft underbelly — a raw `filePath.startsWith('/tmp/')`
 * test judges the path as TYPED, not as it RESOLVES, so
 * `/tmp/../<repo>/src/app.ts` was allowlisted while the plain `src/app.ts` it
 * resolves to was blocked. Same story for a symlink: `/tmp/pwn ->
 * <repo>/src/app.ts` textually lives under /tmp while every write through it
 * lands in implementation code. These agents run with permissionMode
 * acceptEdits, so the hook is the only barrier — there is no human
 * confirmation behind it.
 *
 * This module is the ONE implementation of "is this really under a scratch
 * root", so the bug class cannot re-appear in four copies. It mirrors the
 * containment logic block-frankie-writes.js already uses for .qa-evidence/ and
 * specs/: resolve, canonicalize through symlinks, then compare whole path
 * SEGMENTS.
 *
 * THE RULE (two clauses, both required):
 *
 *   scratch  ==  (target resolves under a REAL temp root)
 *            AND (target does NOT resolve under the project root)
 *
 * The second clause is not decoration. Canonicalizing alone is not enough,
 * because a repo can legitimately LIVE under a temp root:
 *   - macOS: $TMPDIR is /var/folders/<hash>/T, and checkouts/worktrees made
 *     with mktemp -d land inside it;
 *   - CI sandboxes and `git worktree add /tmp/...` put the whole working tree
 *     under /tmp;
 *   - any `mktemp -d`-created scratch checkout.
 * On such a checkout, a temp-root-only test judges `<repo>/src/app.ts` to be
 * scratch, all four guards exit 0, and the agents are unguarded for exactly
 * the writes the hooks exist to stop. The project-root exclusion WINS: a path
 * under the project root is never scratch, even when the project itself sits
 * inside a temp root. A sibling of the repo but still under the temp root
 * (e.g. `<tmp>/notes.md` next to `<tmp>/repo/`) remains genuine scratch.
 *
 * The temp roots are the REAL ones only — os.tmpdir() (which is where $TMPDIR
 * points, covering macOS /var/folders/<...>/T), /tmp, and /var/tmp. `/var`
 * itself is deliberately NOT a root: it is a system tree (/var/lib, /var/log,
 * /var/www — deployment targets), not throwaway space. Each root is
 * canonicalized before comparison, so /tmp -> /private/tmp on macOS is handled.
 *
 * Semantics preserved from the string-prefix version it replaces:
 *   - Only ABSOLUTE paths can be scratch. A relative path was never
 *     allowlisted before (it cannot start with "/tmp/"), and resolving it
 *     against the cwd would make the verdict depend on where the agent
 *     happens to be running.
 *   - The root DIRECTORY itself ("/tmp") is not scratch, matching the old
 *     `startsWith('/tmp/')`, which required a separator.
 *   - The separator guard means a sibling like "/tmpfoo" is never "under"
 *     "/tmp".
 *
 * The project root is passed IN by each hook (from the hook payload's `cwd`,
 * falling back to process.cwd()) rather than read deep inside this module, so
 * both layouts — repo under /home, repo under a temp root — are testable
 * without depending on where the test checkout happens to live.
 *
 * Every failure path returns false (deny): an unresolvable path — dangling
 * symlink, permission error — must never be judged to be inside the
 * allowlist.
 */

import { lstatSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Scratch roots for hooks that allow the system temp trees (Lynch, Amy).
 *
 * os.tmpdir() first: on macOS it is the per-user /var/folders/<...>/T that
 * $TMPDIR points at, which is where most tooling actually writes. Duplicates
 * (Linux, where os.tmpdir() is usually /tmp) collapse during canonicalization.
 */
export const SCRATCH_ROOTS = [tmpdir(), '/tmp', '/var/tmp'];

/**
 * Scratch roots for hooks that only ever allowed the throwaway temp dirs and
 * never /var (Murdock). os.tmpdir() is included because it IS the system temp
 * directory — on macOS that path happens to live under /var, but /var/tmp and
 * the rest of /var stay excluded.
 */
export const TMP_ONLY_SCRATCH_ROOTS = [tmpdir(), '/tmp'];

/**
 * True if `child` is `parent` itself or lives underneath it. Compares whole
 * path SEGMENTS (parent + separator), so "/tmpfoo" is never within "/tmp".
 */
function isWithin(child, parent) {
  if (child === parent) {
    return true;
  }
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(prefix);
}

/**
 * True if `p` names an existing directory entry, INCLUDING a dangling
 * symlink. lstatSync (not existsSync) on purpose: existsSync follows links and
 * reports false for a symlink whose target doesn't exist yet — but writing
 * through such a link still creates the link's target, so it must be
 * canonicalized (and, being dangling, denied) rather than treated as a plain
 * not-yet-existing file.
 */
function pathEntryExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonical absolute form of `abs` with every symlink resolved, for paths that
 * may not exist yet: walks up to the deepest EXISTING ancestor, realpath()s
 * that, and re-appends the not-yet-existing tail.
 *
 * Returns null when the path cannot be canonicalized (dangling symlink,
 * permission error, or an ancestor walk that runs off the top of the
 * filesystem). Callers treat null as "not scratch" — i.e. deny.
 */
function canonicalizePath(abs) {
  const tail = [];
  let current = abs;
  // Bounded purely as a runaway guard; path.dirname() reaches the root in a
  // handful of steps for any real path.
  for (let depth = 0; depth < 4096; depth++) {
    if (pathEntryExists(current)) {
      try {
        const real = realpathSync(current);
        return tail.length > 0 ? path.join(real, ...tail) : real;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    tail.unshift(path.basename(current));
    current = parent;
  }
  return null;
}

/**
 * Canonical form of the project root used for the exclusion clause.
 *
 * Unlike a write target, an un-canonicalizable project root must NOT silently
 * disappear — dropping the exclusion is what re-opens the hole on a
 * temp-rooted checkout. So fall back to the lexically resolved path (still a
 * usable containment prefix) and only give up on a non-string/empty input.
 */
function canonicalizeProjectRoot(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot === '') {
    return null;
  }
  const resolved = path.resolve(projectRoot);
  return canonicalizePath(resolved) ?? resolved;
}

/**
 * True if `filePath` genuinely resolves to a location UNDER one of `roots` AND
 * outside `projectRoot`.
 *
 * @param {string} filePath      Path exactly as the agent typed it.
 * @param {string[]} [roots]     Temp roots to test against (default: os.tmpdir(), /tmp, /var/tmp).
 * @param {string} [projectRoot] Project root to exclude; defaults to process.cwd().
 *                               Hooks pass the hook payload's `cwd` explicitly.
 */
export function isScratchPath(filePath, roots = SCRATCH_ROOTS, projectRoot = process.cwd()) {
  if (typeof filePath !== 'string' || filePath === '') {
    return false;
  }
  // Relative paths were never scratch, and resolving them against the cwd
  // would make the verdict depend on where the agent runs (see module header).
  if (!path.isAbsolute(filePath)) {
    return false;
  }

  // path.resolve() collapses ".." lexically; canonicalizePath() then resolves
  // symlinks. Both are needed — resolve() never follows links, and realpath()
  // alone cannot handle a path that doesn't exist yet.
  const canonicalTarget = canonicalizePath(path.resolve(filePath));
  if (canonicalTarget === null) {
    return false;
  }

  // Project-root exclusion, checked FIRST and unconditionally: when the repo
  // itself lives under a temp root (macOS $TMPDIR, a /tmp worktree, a CI
  // sandbox), everything in it is also "under /tmp" — and none of it is
  // scratch. This clause is what keeps the guards armed on such a checkout.
  const canonicalProjectRoot = canonicalizeProjectRoot(projectRoot);
  if (canonicalProjectRoot !== null && isWithin(canonicalTarget, canonicalProjectRoot)) {
    return false;
  }

  const rootList = Array.isArray(roots) ? roots : SCRATCH_ROOTS;
  const seen = new Set();
  for (const root of rootList) {
    if (typeof root !== 'string' || root === '') {
      continue;
    }
    const canonicalRoot = canonicalizePath(path.resolve(root));
    if (canonicalRoot === null) {
      // Root doesn't exist / can't be resolved on this host — it cannot
      // contain anything, so skip it rather than widening the allowlist.
      continue;
    }
    // Roots collapse to the same real path on many hosts (Linux os.tmpdir()
    // === /tmp); only test each distinct real root once.
    if (seen.has(canonicalRoot)) {
      continue;
    }
    seen.add(canonicalRoot);
    // The root itself is not a write target (matches the old
    // `startsWith('/tmp/')`, which required a trailing separator).
    if (canonicalTarget === canonicalRoot) {
      continue;
    }
    if (isWithin(canonicalTarget, canonicalRoot)) {
      return true;
    }
  }

  return false;
}
