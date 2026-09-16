#!/usr/bin/env node
/**
 * block-frankie-writes.js - PreToolUse hook for Frankie
 *
 * Enforces Frankie's two structural hard rules (agents/frankie.md):
 *   - Never fix the code. Failures bounce back to B.A. with repro steps.
 *   - Never edit an existing file under specs/. Graduated specs are
 *     add-only — only NEW flow files may be added.
 *
 * Allowed:
 *   - Anything under .qa-evidence/ (his evidence bundle)
 *   - A NEW flow file under specs/ — one Frankie authors THIS session.
 *     "New" is judged against a session-scoped snapshot of specs/ taken on
 *     this hook's first invocation for the session, so Frankie can still
 *     Edit a flow file he just Wrote (fixing a typo in his own draft is
 *     not a graduated-spec mutation — PRD 010 §2.5 protects PRE-EXISTING
 *     graduated specs, and Frankie writes new flow files in-mission).
 *
 * Blocked:
 *   - An Edit/Write targeting a spec that pre-dates the session snapshot
 *     (graduated specs are add-only: they cannot be altered, only added to)
 *   - Everything else (implementation, tests, and any other path) —
 *     Frankie's job is to report, not to fix; the failure bounces to B.A.
 *   - An Edit/Write/delete targeting the specs/ directory itself or any
 *     directory under it — a directory move or delete destroys every
 *     graduated spec inside it
 *   - Bash: the decision is INVERTED relative to a blocklist. A write-shaped
 *     statement is blocked UNLESS every write it performs is provably to an
 *     allowlisted location. Two detectors feed that:
 *       (a) extractBashWriteTargets() pulls the target paths out of the
 *           PARSEABLE writers (redirection including `>|`, tee, every mv
 *           operand, cp destination, rm/rmdir, ln, every `sed -i` file
 *           operand — including bundled clusters like `-Ei` —, touch,
 *           truncate, dd of=) and classifies each with the exact same
 *           allow/block rule as Write/Edit above. An operand carrying a
 *           brace/glob metacharacter is protected when its literal prefix
 *           lands in the spec tree.
 *       (b) detectUnverifiableWrite() blocks the write-shaped-but-
 *           UNVERIFIABLE statements — an interpreter running an inline
 *           script (`bash -c`, `python3 -c`, `perl -pi -e`, `node -e`), a
 *           `find` carrying a mutating action (`-delete`, `-exec`, …), or a
 *           known destructive writer whose target set could not be
 *           extracted at all (`… | xargs rm -f`). Previously each of these
 *           yielded zero targets and therefore sailed through; they now
 *           fail CLOSED.
 *     Both detectors run on the tokens left after leading `VAR=val`
 *     assignments and command launchers/wrappers are peeled off (`env`,
 *     `command`, `nohup`, `exec`, `xargs`, `sudo`, `time`, `nice`,
 *     `timeout`, `stdbuf`, `setsid`, `ionice`, `chrt`), so a launcher can no
 *     longer hide the real command behind argv[0] — `timeout 5 sed -i …`
 *     resolves to the `sed -i` it is. The launcher list is deliberately NOT
 *     the load-bearing part: an unrecognized launcher leaves the inner
 *     command unresolved, and (b)'s structural checks are what keep that
 *     honest.
 *
 * This is a best-effort scanner, NOT a filesystem sandbox. Arbitrary shell
 * (a launcher this list doesn't know, a variable-expanded command name, a
 * script file Frankie wrote earlier and then executes) can still defeat a
 * pattern scan, so this hook must never be described as making graduated
 * specs immutable. True filesystem-level immutability — read-only mounts or
 * file permissions applied to specs/ for the duration of the walk — is a
 * separate follow-up; until it ships, this hook plus the agent-facing rule
 * in agents/frankie.md are the enforcement.
 *
 * The Frankie-agnostic half of the scanner — tokenizing, heredoc/quote
 * handling, statement splitting, and the write-target/unverifiable-write
 * detectors named above — lives in lib/bash-write-scan.js, so a second
 * consumer (block-pike-writes.js) does not need its own copy. Only the
 * spec-tree-aware classification (classifyFrankiePath, classifyBashOperand,
 * the specs/ snapshot machinery) stays here.
 *
 * Fail-closed: if session_id is missing, malformed, or the snapshot can't
 * be written or read, the check falls back to the strict at-call-time
 * existsSync behavior — an error path never weakens the guard. The Bash
 * scanner fails CLOSED on every write-shaped statement it recognizes but
 * cannot verify, and on any recognized target that lands on a protected
 * path. It still fails OPEN on a statement it does not read as write-shaped
 * at all (this is pattern-matching, not parsing a shell grammar) — that
 * residual gap is the follow-up named above.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input,
 * session_id).
 */

import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  lstatSync,
  realpathSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { foldSpecKey } from './lib/frankie-spec-key.js';
import { resolveAgent } from './lib/resolve-agent.js';
import { denyAndExit } from './lib/send-denied-event.js';
import {
  splitBashStatements,
  extractBashWriteTargets,
  detectUnverifiableWrite,
} from './lib/bash-write-scan.js';

/**
 * True if any path segment of filePath is EXACTLY ".." — a traversal
 * component. This is a segment check (split on "/"), not a substring
 * check: a filename that merely contains literal ".." characters (e.g.
 * "release-notes..v2.flow.yaml") is NOT flagged — only a standalone ".."
 * between slashes is.
 */
function hasTraversalSegment(filePath) {
  return filePath.split('/').some((segment) => segment === '..');
}

/**
 * True if filePath is the project-root `dirName` directory itself or a path
 * underneath it, whether filePath is relative ("specs/x.yaml") or absolute
 * (".../repo/specs/x.yaml").
 *
 * The match is ANCHORED: the path is resolved against the process cwd (the
 * target project root) and prefix-matched against `<cwd>/<dirName>`. A
 * component-name or substring match would allowlist any path that merely
 * happens to contain a segment called "specs" or ".qa-evidence" — nested
 * production code (packages/shared/src/specs/hack.ts) and, worse, anything
 * anywhere on the filesystem (/tmp/x/specs/pwn.sh). Frankie runs with
 * permissionMode: acceptEdits, so this hook is the only barrier between him
 * and those writes; there is no human confirmation behind it.
 *
 * Any path containing a ".." traversal segment is NEVER "under" anything,
 * even if the segment would resolve back into dirName — Frankie has no
 * legitimate reason to construct a path containing "..", so it is denied
 * categorically rather than normalized away (path.resolve below would
 * happily collapse "specs/sub/../x.yaml" back into an allowed write).
 */
function isUnderDir(filePath, dirName) {
  if (hasTraversalSegment(filePath)) {
    return false;
  }
  const root = process.cwd();
  const abs = path.resolve(root, filePath);
  const base = path.join(root, dirName);

  // Compare CANONICAL paths — no lexical prefix pre-gate. path.resolve() never
  // follows symlinks, and there are two distinct reasons the textual forms can
  // disagree even when the target genuinely lives under the allowed dir:
  //   1. Symlink ESCAPE: `.qa-evidence/M-1/x -> ../../src/services/order.ts`
  //      (or `.qa-evidence -> /` planted before the dir exists) looks textually
  //      inside while every write lands in implementation code — must block.
  //   2. Symlink-ALIASED root: an ABSOLUTE target may be spelled in an alias of
  //      the canonical cwd — macOS `/var/folders/...` vs canonical
  //      `/private/var/folders/...` (process.cwd() reports the canonical form),
  //      any bind mount, any parent symlink. A lexical gate that compared the
  //      aliased `abs` against a canonical-root `base` wrongly rejected these,
  //      routing `rm -rf <tmproot>/specs` to the generic impl-territory branch
  //      instead of spec-immutable. The canonical comparison below resolves
  //      both cases correctly; a cheap lexical pre-gate cannot, because it
  //      assumes `abs` and `base` share a namespace.
  // Fail CLOSED if canonicalization is impossible (dangling link, permission).
  const canonicalRoot = canonicalizePath(root);
  const canonicalBase = canonicalizePath(base);
  const canonicalTarget = canonicalizePath(abs);
  if (canonicalRoot === null || canonicalBase === null || canonicalTarget === null) {
    return false;
  }
  // The allowed directory itself must still live inside the project root. A
  // symlinked `.qa-evidence -> /` would otherwise "contain" the entire
  // filesystem, turning the allowlist into a universal permit.
  if (canonicalBase === canonicalRoot || !isWithin(canonicalBase, canonicalRoot)) {
    return false;
  }
  return isWithin(canonicalTarget, canonicalBase);
}

/**
 * True if `child` is `parent` itself or lives underneath it. Compares whole
 * path SEGMENTS (parent + separator), so a sibling whose name merely starts
 * with the parent's name — `specs-backup/` vs `specs/` — is never "within".
 */
function isWithin(child, parent) {
  if (child === parent) {
    return true;
  }
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(prefix);
}

/**
 * True if `filePath` resolves to a location OUTSIDE the project root — a
 * scratch path (`/tmp/playwright/step3.png`, `$TMPDIR/run/video.webm`,
 * `/var/tmp/trace.zip`) rather than anything this repo owns.
 *
 * Deliberately defined as "not under the project root" rather than as a
 * whitelist of temp directories: Frankie's driver writes screenshots, videos
 * and traces wherever the platform's temp dir happens to be, and enumerating
 * those spellings would miss one. Implemented locally rather than importing
 * lib/scratch-path.js on purpose — that module's root definition is being
 * revised concurrently, and this guard must not inherit a change to it
 * unnoticed.
 *
 * Fails CLOSED (returns false → "treat as inside, classify it normally") on
 * every uncertainty: a ".." traversal segment, or a path that cannot be
 * canonicalized. Symlinks are resolved first, so `/tmp/link -> <repo>/src/app.ts`
 * is correctly judged INSIDE the project.
 */
function isOutsideProjectRoot(filePath) {
  if (!filePath || hasTraversalSegment(filePath)) {
    return false;
  }
  const root = process.cwd();
  const canonicalRoot = canonicalizePath(root);
  const canonicalTarget = canonicalizePath(path.resolve(root, filePath));
  if (canonicalRoot === null || canonicalTarget === null) {
    return false;
  }
  return !isWithin(canonicalTarget, canonicalRoot);
}

/**
 * True if `p` names an existing directory entry, INCLUDING a dangling
 * symlink. lstatSync (not existsSync) on purpose: existsSync follows links
 * and therefore reports `false` for a symlink whose target doesn't exist yet
 * — but writing through such a link still creates the link's target, so it
 * must be canonicalized (and, being dangling, denied) rather than treated as
 * a plain not-yet-existing file.
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
 * Canonical absolute form of `abs` with every symlink resolved, for paths
 * that may not exist yet: walks up to the deepest EXISTING ancestor,
 * realpath()s that, and re-appends the not-yet-existing tail.
 *
 * Returns null when the path cannot be canonicalized — a dangling symlink, a
 * permission error, or an ancestor walk that runs off the top of the
 * filesystem. Callers treat null as "deny": an unresolvable path must never
 * be judged to be inside an allowlisted directory.
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
 * True if `abs` names an existing DIRECTORY.
 *
 * Used to give every directory at or under specs/ the same immutability a
 * graduated spec file has: the session snapshot records only FILES, so a
 * directory always missed the "is it graduated?" lookup and classified as a
 * brand-new spec — which made `rm -rf specs` an allowed way to delete every
 * graduated spec at once, while `rm specs/login.flow.yaml` blocked correctly.
 *
 * ENOENT (nothing there) is the only "not a directory" answer; any other
 * stat failure — a permission error, ENOTDIR, a symlink loop — is unknowable
 * and treated as a directory, i.e. blocked. Fail closed.
 */
function isExistingDirectory(abs) {
  try {
    return statSync(abs).isDirectory();
  } catch (err) {
    return !(err && err.code === 'ENOENT');
  }
}

/**
 * Where session snapshots of specs/ live. One JSON file per session_id,
 * self-contained in this hook (mirrors lib/observer.js's tmpdir()-keyed
 * ateam-agent-map convention). The directory is created 0o700 (owner-only)
 * because it sits under the world-writable system tmpdir — any other local
 * process could otherwise pre-create it (or a snapshot file inside it) and
 * feed Frankie's hook a forged "nothing existed yet" snapshot.
 */
const SNAPSHOT_DIR = path.join(tmpdir(), 'ateam-frankie-spec-snapshot');

/**
 * Snapshot file path for a session, or null when the session_id is absent
 * or not filesystem-safe (anything but [A-Za-z0-9._-]) — null means
 * "no snapshot available, use the strict fallback". A session_id is never
 * trusted as a raw filename: a hostile or malformed id must not become a
 * path escape out of SNAPSHOT_DIR.
 */
function snapshotPathFor(sessionId) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    return null;
  }
  return path.join(SNAPSHOT_DIR, `${sessionId}.json`);
}

/**
 * Recursively lists every file under dir as absolute paths.
 */
function listFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesUnder(entryPath));
    } else {
      out.push(entryPath);
    }
  }
  return out;
}

/**
 * Ensures SNAPSHOT_DIR exists and is trustworthy: owner-only permissions
 * (no group/other access) and, when the platform exposes uids, owned by
 * this process. If the directory doesn't exist yet, it is created with
 * mode 0o700. If it already exists with looser permissions or a different
 * owner — e.g. another local process raced to pre-create it under the
 * shared, world-writable tmpdir — it is treated as UNUSABLE: every snapshot
 * read/write for this invocation is skipped and callers fall back to the
 * strict at-call-time check. Never widen an existing directory's
 * permissions; only refuse to trust it.
 */
function ensureTrustedSnapshotDir() {
  try {
    if (!existsSync(SNAPSHOT_DIR)) {
      mkdirSync(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
      return true;
    }
    const stat = statSync(SNAPSHOT_DIR);
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      return false;
    }
    // Reject if group or other has any permission bit set.
    if ((stat.mode & 0o077) !== 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the Set of absolute paths that existed under <cwd>/specs/ at the
 * start of this session (taking the snapshot now if this is the first
 * invocation for the session), or null when no snapshot can be used —
 * missing/unsafe session_id, an untrustworthy SNAPSHOT_DIR, an unreadable
 * or corrupt snapshot file, a snapshot recorded under a different cwd, or a
 * failed write. Callers treat null as "fall back to strict existsSync", so
 * every error path here fails CLOSED, never open.
 *
 * The on-disk payload is `{ cwd, specs }`, not a bare array: keying the
 * snapshot to the cwd it was taken under means a snapshot recorded while
 * running from a different working directory can never be silently reused
 * to (mis)judge "new" for a different project root. A legacy bare-array
 * payload (or anything else that doesn't match this shape) is rejected
 * outright — never partially trusted — so a pre-seeded `[]` cannot be used
 * to make every pre-existing graduated spec look new.
 */
function loadOrTakeSpecSnapshot(sessionId) {
  const snapshotPath = snapshotPathFor(sessionId);
  if (!snapshotPath) {
    return null;
  }
  if (!ensureTrustedSnapshotDir()) {
    return null;
  }
  try {
    if (existsSync(snapshotPath)) {
      const parsed = JSON.parse(readFileSync(snapshotPath, 'utf8'));
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        typeof parsed.cwd !== 'string' ||
        !Array.isArray(parsed.specs) ||
        !parsed.specs.every((p) => typeof p === 'string')
      ) {
        return null;
      }
      if (parsed.cwd !== process.cwd()) {
        return null;
      }
      // Fold on READ as well as on write: folding is idempotent, so this
      // also normalizes a snapshot written before folding existed.
      return new Set(parsed.specs.map((p) => foldSpecKey(p)));
    }
    const specsRoot = path.join(process.cwd(), 'specs');
    const files = existsSync(specsRoot) ? listFilesUnder(specsRoot) : [];
    // Keys are stored ALREADY FOLDED, so the folding rule stays derivable
    // from the platform alone — a snapshot written by one hook process is
    // read the same way by the next one.
    const keys = files.map((file) => foldSpecKey(file));
    writeFileSync(snapshotPath, JSON.stringify({ cwd: process.cwd(), specs: keys }), { mode: 0o600 });
    return new Set(keys);
  } catch {
    return null;
  }
}

/**
 * Classifies a single candidate path against Frankie's write rules — the
 * one choke point both the Write/Edit branch and the Bash pattern-scan
 * branch feed through, so the two enforcement paths can never drift apart.
 *
 * Returns:
 *   - { blocked: false } — under .qa-evidence/, or a NEW file under specs/
 *     (not present in the session snapshot / not on disk under strict
 *     fallback)
 *   - { blocked: true, reason: 'spec-immutable' } — an existing (graduated)
 *     file under specs/
 *   - { blocked: true, reason: 'other' } — everything else: implementation,
 *     tests, or any other path. Frankie has no legitimate write target
 *     outside .qa-evidence/ and new specs/ files.
 */
function classifyFrankiePath(filePath, specSnapshot) {
  if (isUnderDir(filePath, '.qa-evidence')) {
    return { blocked: false };
  }
  if (isUnderDir(filePath, 'specs')) {
    // Resolve the path the write ACTUALLY lands on — follow symlinks — before
    // deciding existing-vs-new. isUnderDir compares CANONICAL paths, so a
    // symlink under .qa-evidence/ pointing into specs/ (a leftover bundle, a
    // restored artifact, another process's link) reaches this branch. Keying
    // the existing-vs-new decision off the LEXICAL path (`.qa-evidence/...`,
    // which path.resolve does not follow) then misses the snapshot — the write
    // onto the graduated spec classifies as a brand-new file and is allowed.
    // Canonicalize so the directory check and the snapshot lookup both use the
    // real target; this matches the strict (existsSync) fallback, which already
    // follows the link. Fail CLOSED if canonicalization is impossible.
    const canonicalAbs = canonicalizePath(path.resolve(process.cwd(), filePath));
    const canonicalSpecsRoot = canonicalizePath(path.join(process.cwd(), 'specs'));
    if (canonicalAbs === null || canonicalSpecsRoot === null) {
      return { blocked: true, reason: 'spec-immutable' };
    }
    // The spec ROOT itself, and every directory beneath it, are immutable:
    // deleting or moving a directory destroys every graduated spec inside it,
    // so `rm -rf specs`, `rm -r specs/sub` and `mv specs elsewhere` are as
    // destructive as writing over a graduated file. Judged at CALL time
    // rather than from the snapshot (which lists only files), so a directory
    // created mid-session — which may already hold graduated specs — is
    // covered too. The root is blocked whether or not it currently exists,
    // so the rule doesn't hinge on a race with its creation.
    //
    // Only the spec tree gets directory immutability. .qa-evidence/ returns
    // above: that bundle is Frankie's own working area and he may clean it.
    if (canonicalAbs === canonicalSpecsRoot || isExistingDirectory(canonicalAbs)) {
      return { blocked: true, reason: 'spec-immutable' };
    }
    const isImmutable =
      specSnapshot !== null
        ? specSnapshot.has(foldSpecKey(canonicalAbs))
        : existsSync(canonicalAbs);
    return isImmutable ? { blocked: true, reason: 'spec-immutable' } : { blocked: false };
  }
  return { blocked: true, reason: 'other' };
}

/**
 * Shell metacharacters that make an operand a PATTERN the shell expands
 * before the command ever sees it, rather than a literal path: brace
 * expansion (`{`), globs (`*`, `?`) and character classes (`[`).
 */
const GLOB_META_RE = /[{*?[]/;

/**
 * The operand's LITERAL prefix — everything before its first expansion
 * metacharacter — or null when the operand contains none (an ordinary path,
 * classified as-is).
 *
 * `specs/login.flow.yaml{,.disabled}` → `specs/login.flow.yaml`
 * `specs/*.flow.yaml`                 → `specs/`
 * `.qa-evidence/M-1/*.png`            → `.qa-evidence/M-1/`
 */
function literalPrefixBeforeMeta(operand) {
  const match = GLOB_META_RE.exec(operand);
  return match ? operand.slice(0, match.index) : null;
}

/**
 * True if `prefix` names a location at or under the spec root. Lexical on
 * purpose (no realpath): a prefix is a fragment of a path that may not exist
 * as spelled, and over-matching here only ever blocks MORE, which is the
 * fail-closed direction.
 */
function isSpecTreePrefix(prefix) {
  if (hasTraversalSegment(prefix)) {
    // A traversal operand is denied categorically by classifyFrankiePath()
    // anyway; never let one be judged "inside the spec tree" here.
    return false;
  }
  const root = process.cwd();
  return isWithin(path.resolve(root, prefix), path.join(root, 'specs'));
}

/**
 * Classifies a Bash OPERAND — a path as written on a command line, which
 * unlike a Write/Edit `file_path` may still contain shell expansions.
 *
 * `mv specs/login.flow.yaml{,.disabled}` exited 0 because the un-expanded
 * token matched no snapshot entry and so classified as a brand-new spec name
 * — while the shell expands it to
 * `mv specs/login.flow.yaml specs/login.flow.yaml.disabled`, deleting the
 * graduated spec from its path. Same hole for `specs/*.flow.yaml`.
 *
 * No brace/glob expansion is attempted (that way lies writing a shell).
 * Instead: an operand carrying an expansion metacharacter whose LITERAL
 * prefix lands at or under the spec root is protected outright — whatever it
 * expands to is inside the immutable spec tree. Everything else keeps the
 * exact classification Write/Edit would give it, so a glob wholly inside
 * .qa-evidence/ stays allowed (Frankie owns that tree) and a brace token that
 * never touches specs/ is judged exactly as before.
 */
function classifyBashOperand(operand, specSnapshot) {
  const literalPrefix = literalPrefixBeforeMeta(operand);
  if (literalPrefix !== null && isSpecTreePrefix(literalPrefix)) {
    return { blocked: true, reason: 'spec-immutable' };
  }
  return classifyFrankiePath(operand, specSnapshot);
}

let hookInput = {};
try {
  const raw = readFileSync(0, 'utf8');
  hookInput = JSON.parse(raw);
} catch {
  // Can't read stdin, allow through
  process.exit(0);
}

try {
  const agent = resolveAgent(hookInput);

  // Only enforce for Frankie
  if (agent !== 'frankie') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};

  // Only Bash (best-effort shell scan) and the write-capable tools can put
  // bytes on disk. Everything else — reads, browser driving, other execs — is
  // unrelated to this hook's intent, so it returns BEFORE any filesystem work
  // (the specs/ snapshot below walks specs/ and touches tmpdir). Gating first
  // keeps the common read-only tool call at near-zero cost.
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  if (toolName !== 'Bash' && !WRITE_TOOLS.has(toolName)) {
    process.exit(0);
  }

  // Take (or load) the session's specs/ snapshot on every write-capable
  // Frankie invocation — the first one of the session freezes the
  // "graduated" set before any Frankie write can land. Taking it here rather
  // than on literally every tool call only ever makes the snapshot LARGER
  // (more files counted as pre-existing → more files immutable), so the
  // reorder is strictly on the fail-closed side. null = strict fallback
  // (see loadOrTakeSpecSnapshot).
  const specSnapshot = loadOrTakeSpecSnapshot(hookInput.session_id);

  // Bash: full shell interdiction is impossible (arbitrary syntax can
  // always defeat a pattern scan), so this is best-effort defense-in-depth
  // on top of the Write/Edit guard, not a sandbox. The decision is inverted
  // from a blocklist: each statement's recognized write targets are
  // classified with the exact same rule Write/Edit uses below, AND a
  // statement that is write-shaped but whose writes cannot be verified
  // (inline interpreter, mutating find, destructive writer with no
  // extractable target) is blocked on its structure alone.
  if (toolName === 'Bash') {
    const command = toolInput.command || '';
    for (const statement of splitBashStatements(command)) {
      for (const target of extractBashWriteTargets(statement, { isOutsideProjectRoot })) {
        const verdict = classifyBashOperand(target, specSnapshot);
        if (!verdict.blocked) {
          continue;
        }

        if (verdict.reason === 'spec-immutable') {
          const reason = `BLOCKED: Frankie's Bash command writes to an existing spec file: ${target}. Graduated specs are immutable.`;
          await denyAndExit(
            { agentName: agent, toolName, reason },
            `BLOCKED: Frankie's Bash command targets an existing spec file: ${target}\n` +
              'Graduated specs under specs/ are add-only (FlowSpec protection): one that already exists is immutable to you.\n' +
              'You may ADD new flow files only — never edit one that already exists, including via shell redirection or in-place tools.\n' +
              `Command: ${command}\n`
          );
        }

        const reason = `BLOCKED: Frankie's Bash command writes to implementation/test territory: ${target}. Bounce to B.A. with repro steps instead.`;
        await denyAndExit(
          { agentName: agent, toolName, reason },
          `BLOCKED: Frankie's Bash command targets implementation/test territory: ${target}\n` +
            'Frankie never fixes the code (see Hard rules in agents/frankie.md).\n' +
            'Record exact repro steps and the failing screenshot in report.md, then bounce the failure to B.A. instead.\n' +
            `Command: ${command}\n`
        );
      }

      // Nothing classifiable came out of this statement's writers — but a
      // write-shaped statement with nothing to classify is exactly the shape
      // every documented bypass took (`bash -c '…'`, `find … -delete`,
      // `… | xargs rm -f`). Unverifiable means DENIED, not allowed.
      const unverifiable = detectUnverifiableWrite(statement, { isOutsideProjectRoot });
      if (unverifiable) {
        const reason = `BLOCKED: Frankie's Bash command performs an unverifiable write (${unverifiable}).`;
        await denyAndExit(
          { agentName: agent, toolName, reason },
          `BLOCKED: Frankie's Bash command performs an unverifiable write: ${unverifiable}\n` +
            'Frankie may write ONLY under .qa-evidence/ (his evidence bundle) or to a NEW file under specs/.\n' +
            'This statement writes somewhere this guard cannot prove is one of those, so it is denied rather than assumed safe.\n' +
            'Spell the write out as a plain command naming its target path (e.g. `echo ... >> .qa-evidence/<mission>/report.md`), ' +
            'and never fix code or edit an existing spec — bounce the failure to B.A. with repro steps instead.\n' +
            `Statement: ${statement}\n`
        );
      }
    }
    // Every write this statement performs was recognized AND allowlisted —
    // allow.
    process.exit(0);
  }

  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  if (!filePath) {
    process.exit(0);
  }

  const verdict = classifyFrankiePath(filePath, specSnapshot);
  if (!verdict.blocked) {
    process.exit(0);
  }

  if (verdict.reason === 'spec-immutable') {
    const reason = `BLOCKED: Frankie cannot edit an existing spec file: ${filePath}. Graduated specs are immutable.`;
    await denyAndExit(
      { agentName: agent, toolName, reason },
      `BLOCKED: Frankie cannot edit an existing spec file: ${filePath}\n` +
        'Graduated specs under specs/ are add-only (FlowSpec protection): one that already exists is immutable to you.\n' +
        'You may ADD new flow files only — never edit one that already exists.\n'
    );
  }

  // Everything else is implementation/test territory — Frankie reports,
  // he never fixes.
  const reason = `BLOCKED: Frankie cannot write or edit implementation/test files: ${filePath}. Bounce to B.A. with repro steps instead.`;
  await denyAndExit(
    { agentName: agent, toolName, reason },
    `BLOCKED: Frankie cannot write or edit implementation/test files: ${filePath}\n` +
      'Frankie never fixes the code (see Hard rules in agents/frankie.md).\n' +
      'Record exact repro steps and the failing screenshot in report.md, then bounce the failure to B.A. instead.\n'
  );
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
