#!/usr/bin/env node
/**
 * block-frankie-writes.js - PreToolUse hook for Frankie
 *
 * Enforces Frankie's two structural hard rules (agents/frankie.md):
 *   - Never fix the code. Failures bounce back to B.A. with repro steps.
 *   - Never edit an existing file under specs/. Graduated specs are
 *     immutable by design (FlowSpec protection) — only NEW flow files
 *     may be added.
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
 *     ("immutable" — graduated specs cannot be altered, only added to)
 *   - Everything else (implementation, tests, and any other path) —
 *     Frankie's job is to report, not to fix; the failure bounces to B.A.
 *   - An Edit/Write/delete targeting the specs/ directory itself or any
 *     directory under it — a directory move or delete destroys every
 *     graduated spec inside it
 *   - Bash commands whose recognized write-shaped operation (redirection
 *     including `>|`, tee, every mv operand, cp destination, rm/rmdir, ln,
 *     every `sed -i` file operand, touch, truncate, dd of=) targets a
 *     protected path. This is best-effort defense-in-depth, NOT
 *     a shell sandbox — arbitrary shell syntax can defeat the pattern scan
 *     — but every path it DOES recognize is checked against the exact same
 *     allow/block rule as Write/Edit above.
 *
 * Fail-closed: if session_id is missing, malformed, or the snapshot can't
 * be written or read, the check falls back to the strict at-call-time
 * existsSync behavior — an error path never weakens the guard. Similarly,
 * the Bash scanner fails OPEN on a command it cannot parse into a
 * recognized write op (this is pattern-matching, not parsing a shell
 * grammar), but fails CLOSED the instant it does recognize one targeting a
 * protected path.
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
  // Cheap lexical gate first — anything that isn't even textually under the
  // allowed root can be rejected without touching the filesystem.
  if (!isWithin(abs, base)) {
    return false;
  }

  // Lexical containment is not enough: path.resolve() never follows symlinks,
  // so `.qa-evidence/M-1/x -> ../../src/services/order.ts` (or an
  // `.qa-evidence -> /` link planted before the directory exists) would be
  // "under" the allowed root textually while every write through it lands in
  // implementation code. Compare CANONICAL paths instead, and fail CLOSED if
  // canonicalization is impossible (dangling link, permission error).
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
    const abs = path.resolve(process.cwd(), filePath);
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
    if (abs === path.join(process.cwd(), 'specs') || isExistingDirectory(abs)) {
      return { blocked: true, reason: 'spec-immutable' };
    }
    const isImmutable =
      specSnapshot !== null ? specSnapshot.has(foldSpecKey(abs)) : existsSync(abs);
    return isImmutable ? { blocked: true, reason: 'spec-immutable' } : { blocked: false };
  }
  return { blocked: true, reason: 'other' };
}

/**
 * Strips a single layer of matching double- or single-quotes from a token,
 * if present. Best-effort — this is not a shell tokenizer.
 */
function stripQuotes(token) {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

/**
 * Replaces the contents of double- or single-quoted spans with spaces of
 * equal length, preserving the string's length/positions so a delimiter
 * search against the masked string still lines up with the original. Used
 * so a shell metacharacter (`;`, `|`, `>`) that appears INSIDE a quoted
 * argument — e.g. `ateam ... --summary "found bug; needs fix"` — is never
 * mistaken for an actual statement separator or redirect.
 */
function maskQuotedSpans(s) {
  return s.replace(/"[^"]*"|'[^']*'/g, (m) => ' '.repeat(m.length));
}

/**
 * Finds every heredoc opener (`<<WORD`, `<< WORD`, `<<-WORD`, `<<'WORD'`,
 * `<<"WORD"`) on a single line, in the order bash would read their bodies.
 *
 * Scans character by character tracking quote state, so a `<<` that appears
 * inside a quoted argument (`echo "a <<EOF b"`) is not an opener. A `<<<`
 * here-STRING is skipped — it has no body lines. Returns null when a line
 * contains something opener-shaped whose delimiter cannot be determined
 * (unterminated quote, empty delimiter); callers treat null as "no heredoc
 * recognized" and keep scanning every line, which is the fail-closed
 * direction.
 */
function findHeredocOpeners(line) {
  const openers = [];
  let quote = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch !== '<' || line[i + 1] !== '<') {
      continue;
    }
    if (line[i + 2] === '<') {
      // `<<<` is a here-string: the word IS the input, no body lines follow.
      i += 2;
      continue;
    }

    let j = i + 2;
    let dashed = false;
    if (line[j] === '-') {
      dashed = true;
      j++;
    }
    while (line[j] === ' ' || line[j] === '\t') {
      j++;
    }

    let delimiter;
    const q = line[j];
    if (q === "'" || q === '"') {
      const end = line.indexOf(q, j + 1);
      if (end === -1) {
        return null;
      }
      delimiter = line.slice(j + 1, end);
      j = end + 1;
    } else {
      let k = j;
      while (k < line.length && /[A-Za-z0-9_.\-\\]/.test(line[k])) {
        k++;
      }
      delimiter = line.slice(j, k).replace(/\\/g, '');
      j = k;
    }
    if (!delimiter) {
      return null;
    }

    openers.push({ delimiter, dashed });
    i = j - 1;
  }

  return openers;
}

/**
 * Removes heredoc BODY lines from a command before it is split into
 * statements.
 *
 * splitBashStatements() treats a newline as a statement separator, so every
 * line of a heredoc body used to be scanned as if it were a command. That
 * false-positives on Frankie's own evidence writes: the markdown blockquote
 * `> Expected the total to update` inside
 * `cat > .qa-evidence/M-1/report.md <<EOF` reads as a redirect to a file
 * called "Expected", and prose like `see report>summary` reads as a glued
 * redirect once padRedirectOperators() normalizes it.
 *
 * The heredoc OPENER line is always kept — its own redirect is a real write
 * (`cat > src/app.ts <<EOF` must still block). Only the lines between the
 * opener and its terminator are dropped, and only when the terminator is
 * actually found: an unterminated heredoc (or an opener whose delimiter
 * cannot be parsed) returns the command untouched, so the scan stays
 * fail-closed on anything it does not fully understand.
 */
function stripHeredocBodies(command) {
  if (!command.includes('<<')) {
    return command;
  }

  const lines = command.split('\n');
  const kept = [];

  for (let i = 0; i < lines.length; i++) {
    kept.push(lines[i]);

    const openers = findHeredocOpeners(lines[i]);
    if (!openers || openers.length === 0) {
      continue;
    }

    // Bash reads the bodies of multiple heredocs on one line in order, each
    // ending at its own delimiter line.
    let idx = i + 1;
    let pending = 0;
    while (idx < lines.length && pending < openers.length) {
      const bodyLine = lines[idx].replace(/\r$/, '');
      const candidate = openers[pending].dashed ? bodyLine.replace(/^\t+/, '') : bodyLine;
      if (candidate === openers[pending].delimiter) {
        pending++;
      }
      idx++;
    }
    if (pending < openers.length) {
      // No terminator in sight — fail closed and scan the whole command.
      return command;
    }
    i = idx - 1;
  }

  return kept.join('\n');
}

/**
 * Splits a compound Bash command into independent statements on the
 * command separators that matter for this scan: &&, ||, ;, |, and
 * newlines. `||` and `&&` MUST be tested before the single-character `|`
 * alternative so a `||` is consumed whole rather than as two `|` splits.
 * Delimiter POSITIONS are found in a quote-masked copy of the command, but
 * the returned statements are sliced from the ORIGINAL string, so quoting
 * is preserved within each statement and a delimiter inside quotes never
 * splits the command.
 *
 * Heredoc bodies are removed first (see stripHeredocBodies) — they are data,
 * not commands, and scanning them as statements false-positives on ordinary
 * prose containing ">".
 */
function splitBashStatements(rawCommand) {
  const command = stripHeredocBodies(rawCommand);
  const masked = maskQuotedSpans(command);
  // `>\|` MUST be matched ahead of the bare `\|` alternative — it is bash's
  // noclobber-override REDIRECT (`echo x >| file`), not a pipe. Matching it
  // here consumes it so the bare `\|` never sees it; the `continue` below
  // then declines to split there. Without this, `echo x >| specs/x.flow.yaml`
  // split into `echo x >` (a dangling operator whose target is undefined) and
  // a second "statement" whose argv[0] was the path — zero targets extracted,
  // write allowed.
  const delimiterRe = /&&|\|\||>\||[;\n]|\|/g;
  const statements = [];
  let lastIndex = 0;
  let match;
  while ((match = delimiterRe.exec(masked))) {
    if (match[0] === '>|') {
      continue;
    }
    statements.push(command.slice(lastIndex, match.index));
    lastIndex = delimiterRe.lastIndex;
  }
  statements.push(command.slice(lastIndex));
  return statements.map((s) => s.trim()).filter(Boolean);
}

/** fd-duplication targets (`2>&1`, `>&2`, ...) and stream-discard sinks —
 * shell idioms for merging/silencing output streams, never a path a spec,
 * implementation, or test file could live at. Excluded from targets so
 * the extremely common `... > /dev/null 2>&1` pattern doesn't false-block.
 */
function isBenignRedirectSink(target) {
  return target === '/dev/null' || target === '/dev/stdout' || target === '/dev/stderr' || /^&\d+$/.test(target);
}

const REDIRECT_OPERATOR_RE = /^(?:\d*>>?|&>>?)$/;
const REDIRECT_PREFIX_RE = /^(\d*>>?|&>>?)(.+)$/;

/**
 * Surrounds every UNQUOTED output-redirection operator with spaces so the
 * quote-aware tokenizer below always sees the operator and its target as
 * separate tokens.
 *
 * Without this, the tokenizer (`(?:[^\s"']+|"[^"]*"|'[^']*')+`) glues a
 * redirect onto whatever precedes it — `echo hi>specs/x.flow.yaml` becomes
 * the single token `hi>specs/x.flow.yaml`, which matches neither the
 * "operator is its own token" nor the "operator starts the token" case, so
 * ZERO targets were extracted and the write sailed through while the spaced
 * form `echo hi > specs/x.flow.yaml` was blocked. Bash itself treats the two
 * identically, and so must this scan.
 *
 * Hand-rolled rather than a regex because the fd prefix must be peeled off
 * correctly: `2>file` is fd 2 redirected to `file`, but `hi2>file` is the
 * word `hi2` followed by `>file` (a digit run counts as an fd only when it
 * forms its own word). Quoted spans are copied through untouched, so a `>`
 * inside `--description "before > after"` is never treated as an operator.
 * fd-duplication targets stay recognizable: `2>&1` becomes `2> &1`, and
 * `&1` is filtered out downstream by isBenignRedirectSink().
 */
function padRedirectOperators(statement) {
  let out = '';
  let quote = null;

  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i];

    if (quote) {
      out += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch !== '>') {
      out += ch;
      continue;
    }

    // Peel any fd prefix already emitted so the whole operator (`2>`, `&>>`)
    // re-emerges as one whitespace-delimited token.
    let prefix = '';
    if (out.endsWith('&') && (out.length === 1 || /\s/.test(out[out.length - 2]))) {
      prefix = '&';
      out = out.slice(0, -1);
    } else {
      let cut = out.length;
      while (cut > 0 && out[cut - 1] >= '0' && out[cut - 1] <= '9') {
        cut--;
      }
      // Trailing digits are an fd number only when they are a word of their
      // own (start of statement or preceded by whitespace).
      if (cut < out.length && (cut === 0 || /\s/.test(out[cut - 1]))) {
        prefix = out.slice(cut);
        out = out.slice(0, cut);
      }
    }

    let operator = `${prefix}>`;
    if (statement[i + 1] === '>') {
      operator += '>';
      i++;
    }
    // `>|` (and `2>|`, `&>|`) is the noclobber-override spelling of `>`: the
    // `|` belongs to the OPERATOR, not to the target. Absorb it so the target
    // is the next token and the `|` is never mistaken for a path of its own.
    if (statement[i + 1] === '|') {
      i++;
    }
    out += ` ${operator} `;
  }

  return out;
}

/**
 * Best-effort extraction of write-shaped operations' target paths from a
 * single Bash statement (already split on &&/||/;/|/newline by
 * splitBashStatements). This is NOT a shell parser — variable expansion,
 * subshells, and command substitution can all defeat it. It exists as
 * defense-in-depth on top of the Write/Edit guard above (mirrors
 * block-ba-bash-restrictions.js's regex-based approach), not as a sandbox:
 * a statement this function doesn't recognize simply yields no targets,
 * and the caller allows it through (fail open on the unparseable case;
 * fail closed on the recognized one).
 *
 * Tokenizes the statement respecting quotes (a quoted argument, e.g.
 * "a > b", is one opaque token — its contents are never mistaken for a
 * redirect operator or a statement's command/args), then recognizes:
 * output redirection (`>`, `>>`, and fd-qualified variants like `2>`,
 * whether the operator stands alone, is glued to the target (`>file`), is
 * glued to the PRECEDING token (`echo hi>file`), or is the noclobber-override
 * `>|` form — padRedirectOperators() normalizes all four), `tee [-a]`,
 * `mv` (EVERY non-flag operand — a source is a deletion), `cp` (destination
 * only — its source is read-only), `rm`/`rmdir`/`touch`/`truncate`/`ln`
 * (every non-flag arg is a target), `sed -i` (every file operand after the
 * script), and `dd of=`.
 */
function extractBashWriteTargets(statement) {
  const targets = [];
  const rawTokens = padRedirectOperators(statement).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (rawTokens.length === 0) {
    return targets;
  }

  const pushTarget = (raw) => {
    if (!raw) return;
    // Subshell/group wrapping leaves shell punctuation glued to the path:
    // `(echo hi > specs/checkout.flow.yaml)` extracts the token
    // "specs/checkout.flow.yaml)", whose trailing ")" made the graduated-spec
    // lookup miss and the write classify as a NEW spec (allowed) instead of an
    // edit to an existing one (blocked). Peel the wrapper characters off
    // before classification — a real path ending in ")" only ever loses
    // characters, which can widen a match but never narrows one, so this
    // errs fail-closed.
    const target = stripQuotes(stripQuotes(raw).replace(/^\(+/, '').replace(/[);]+$/, ''));
    if (target && !isBenignRedirectSink(target)) {
      targets.push(target);
    }
  };

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    if (REDIRECT_OPERATOR_RE.test(token)) {
      // Operator is its own token (`echo x > file`) — target is next token.
      pushTarget(rawTokens[i + 1]);
      continue;
    }
    const prefixMatch = token.match(REDIRECT_PREFIX_RE);
    if (prefixMatch) {
      // Operator glued to target (`echo x >file`).
      pushTarget(prefixMatch[2]);
    }
  }

  const ofToken = rawTokens.find((t) => /^of=/.test(stripQuotes(t)));
  if (ofToken) {
    pushTarget(stripQuotes(ofToken).slice('of='.length));
  }

  const cmd = stripQuotes(rawTokens[0]).split('/').pop();
  const nonFlagArgs = rawTokens
    .slice(1)
    .map(stripQuotes)
    .filter((w) => w.length > 0 && !w.startsWith('-') && !/[>|;&]/.test(w));

  // `ln` is a write op in BOTH directions: the link name is a new path being
  // created, and the link TARGET is the file every later write through that
  // link actually lands in. `ln -s ../src/services/order.ts .qa-evidence/x`
  // would otherwise be a two-step laundering of an implementation-file write
  // past this guard, so every non-flag arg is classified.
  if (
    cmd === 'rm' ||
    cmd === 'rmdir' ||
    cmd === 'touch' ||
    cmd === 'truncate' ||
    cmd === 'tee' ||
    cmd === 'ln'
  ) {
    nonFlagArgs.forEach(pushTarget);
  } else if (cmd === 'mv') {
    // EVERY operand, not just the destination: an mv SOURCE is a deletion —
    // the file stops existing at that path — so `mv specs/login.flow.yaml
    // specs/login2.flow.yaml` destroys a graduated spec even though its
    // destination is an innocent new spec name. Same "write op in BOTH
    // directions" reasoning as `ln` above.
    nonFlagArgs.forEach(pushTarget);
  } else if (cmd === 'cp') {
    // Destination ONLY — unlike mv, a cp source is read-only: the original
    // file survives untouched, so copying a graduated spec somewhere else is
    // not a mutation of it. Only the path being written is a target.
    if (nonFlagArgs.length > 0) {
      pushTarget(nonFlagArgs[nonFlagArgs.length - 1]);
    }
  } else if (cmd === 'sed') {
    const hasInPlace = rawTokens.some((w) => /^(?:-i|--in-place)/.test(stripQuotes(w)));
    if (hasInPlace) {
      // `sed -i` edits EVERY file operand in place, so classifying only the
      // last one (the right heuristic for an mv/cp DESTINATION) let
      // `sed -i "" s/a/b/ specs/login.flow.yaml .qa-evidence/x.md` rewrite a
      // graduated spec while only the allowed evidence file was checked.
      //
      // Walk sed's argv rather than the flat non-flag list so the SCRIPT slot
      // is identified correctly and every remaining operand is classified:
      //   - `-e`/`-f`/`--expression`/`--file` supply the script; in their
      //     separate-token form the following token is that script (never a
      //     file), and in their attached form (`-e's/a/b/'`,
      //     `--expression=s/a/b/`) the token carries it.
      //   - otherwise the first bare operand is the script and the rest are
      //     files.
      //   - BSD's empty suffix (`sed -i '' …`) tokenizes to an empty string
      //     and is skipped; `-i.bak` / `--in-place=.bak` are ordinary flags.
      // Boundary: a space-separated BSD suffix (`sed -i .bak s/a/b/ f`) is
      // indistinguishable from a script operand, so it takes the script slot
      // and the real script is classified as a target too — erring toward
      // MORE targets, never fewer, which is the fail-closed direction.
      let scriptSeen = false;
      for (let i = 1; i < rawTokens.length; i++) {
        const operand = stripQuotes(rawTokens[i]);
        if (operand.length === 0) {
          continue;
        }
        if (operand.startsWith('-')) {
          if (/^(?:-e|-f)$/.test(operand) || /^--(?:expression|file)$/.test(operand)) {
            scriptSeen = true;
            i++; // the next token is the script/script-file, never an edit target
          } else if (/^(?:-e|-f)./.test(operand) || /^--(?:expression|file)=/.test(operand)) {
            scriptSeen = true;
          }
          continue;
        }
        if (/[>|;&]/.test(operand)) {
          continue; // shell punctuation, not an operand (same rule as nonFlagArgs)
        }
        if (!scriptSeen) {
          scriptSeen = true;
          continue;
        }
        pushTarget(operand);
      }
    }
  }

  return targets;
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
  // on top of the Write/Edit guard, not a sandbox. Scan each statement for
  // a recognized write-shaped op and classify its target with the exact
  // same rule Write/Edit uses below.
  if (toolName === 'Bash') {
    const command = toolInput.command || '';
    for (const statement of splitBashStatements(command)) {
      for (const target of extractBashWriteTargets(statement)) {
        const verdict = classifyFrankiePath(target, specSnapshot);
        if (!verdict.blocked) {
          continue;
        }

        if (verdict.reason === 'spec-immutable') {
          const reason = `BLOCKED: Frankie's Bash command writes to an existing spec file: ${target}. Graduated specs are immutable.`;
          await denyAndExit(
            { agentName: agent, toolName, reason },
            `BLOCKED: Frankie's Bash command targets an existing spec file: ${target}\n` +
              'Graduated specs under specs/ are immutable by design (FlowSpec protection).\n' +
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
    }
    // No recognized write op targeted a protected path — allow.
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
        'Graduated specs under specs/ are immutable by design (FlowSpec protection).\n' +
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
