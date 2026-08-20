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
 * Semantics preserved from the string-prefix version it replaces:
 *   - Only ABSOLUTE paths can be scratch. A relative path was never
 *     allowlisted before (it cannot start with "/tmp/"), and resolving it
 *     against process.cwd() would make the verdict depend on where the agent
 *     happens to be running — including allowlisting the whole project if cwd
 *     itself sat under /tmp.
 *   - The root DIRECTORY itself ("/tmp") is not scratch, matching the old
 *     `startsWith('/tmp/')`, which required a separator.
 *   - The separator guard means a sibling like "/tmpfoo" is never "under"
 *     "/tmp".
 *
 * Every failure path returns false (deny): an unresolvable path — dangling
 * symlink, permission error — must never be judged to be inside the
 * allowlist.
 */

import { lstatSync, realpathSync } from 'fs';
import path from 'path';

/** Scratch roots for hooks that allow both /tmp and /var (Lynch, Amy). */
export const SCRATCH_ROOTS = ['/tmp', '/var'];

/** Scratch roots for hooks that only ever allowed /tmp (Murdock). */
export const TMP_ONLY_SCRATCH_ROOTS = ['/tmp'];

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
 * True if `filePath` genuinely resolves to a location UNDER one of `roots`.
 *
 * @param {string} filePath  Path exactly as the agent typed it.
 * @param {string[]} [roots] Scratch roots to test against (default /tmp, /var).
 */
export function isScratchPath(filePath, roots = SCRATCH_ROOTS) {
  if (typeof filePath !== 'string' || filePath === '') {
    return false;
  }
  // Relative paths were never scratch, and resolving them against cwd would
  // make the verdict depend on where the agent runs (see module header).
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

  for (const root of roots) {
    const canonicalRoot = canonicalizePath(path.resolve(root));
    if (canonicalRoot === null) {
      // Root doesn't exist / can't be resolved on this host — it cannot
      // contain anything, so skip it rather than widening the allowlist.
      continue;
    }
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
