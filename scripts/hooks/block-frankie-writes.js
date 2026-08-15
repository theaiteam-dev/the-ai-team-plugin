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
 *
 * Fail-closed: if session_id is missing, malformed, or the snapshot can't
 * be written or read, the check falls back to the strict at-call-time
 * existsSync behavior — an error path never weakens the guard.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input,
 * session_id).
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { resolveAgent } from './lib/resolve-agent.js';
import { sendDeniedEvent } from './lib/send-denied-event.js';

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
  return abs === base || abs.startsWith(base + path.sep);
}

/**
 * Where session snapshots of specs/ live. One JSON file per session_id,
 * self-contained in this hook (mirrors lib/observer.js's tmpdir()-keyed
 * ateam-agent-map convention).
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
 * Returns the Set of absolute paths that existed under <cwd>/specs/ at the
 * start of this session (taking the snapshot now if this is the first
 * invocation for the session), or null when no snapshot can be used —
 * missing/unsafe session_id, unreadable or corrupt snapshot file, or a
 * failed write. Callers treat null as "fall back to strict existsSync",
 * so every error path here fails CLOSED, never open.
 */
function loadOrTakeSpecSnapshot(sessionId) {
  const snapshotPath = snapshotPathFor(sessionId);
  if (!snapshotPath) {
    return null;
  }
  try {
    if (existsSync(snapshotPath)) {
      const parsed = JSON.parse(readFileSync(snapshotPath, 'utf8'));
      if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
        return null;
      }
      return new Set(parsed);
    }
    const specsRoot = path.join(process.cwd(), 'specs');
    const files = existsSync(specsRoot) ? listFilesUnder(specsRoot) : [];
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(files));
    return new Set(files);
  } catch {
    return null;
  }
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

  // Take (or load) the session's specs/ snapshot on EVERY Frankie
  // invocation, not just specs/-targeting ones — the first hook fire of the
  // session (whatever it targets) freezes the "graduated" set before any
  // Frankie write can land. null = strict fallback (see loadOrTakeSpecSnapshot).
  const specSnapshot = loadOrTakeSpecSnapshot(hookInput.session_id);

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const filePath = toolInput.file_path || toolInput.notebook_path || '';

  // Only gate write-capable tools. Reads, browser driving, and execs are
  // unrelated to this hook's intent.
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  if (!WRITE_TOOLS.has(toolName)) {
    process.exit(0);
  }

  if (!filePath) {
    process.exit(0);
  }

  // Allow the evidence bundle, anywhere under .qa-evidence/
  if (isUnderDir(filePath, '.qa-evidence')) {
    process.exit(0);
  }

  // specs/ has two cases: a flow file Frankie authored this session is
  // fine (including follow-up Edits to it); a spec that pre-dates the
  // session is a GRADUATED spec and immutable.
  if (isUnderDir(filePath, 'specs')) {
    // Resolve against the same root isUnderDir anchored to, so the
    // immutability check can never look at a different file than the one
    // just allowlisted. With a snapshot, "immutable" = present at session
    // start; without one (strict fallback), "immutable" = exists right now.
    const abs = path.resolve(process.cwd(), filePath);
    const isImmutable = specSnapshot !== null ? specSnapshot.has(abs) : existsSync(abs);
    if (!isImmutable) {
      process.exit(0);
    }

    const reason = `BLOCKED: Frankie cannot edit an existing spec file: ${filePath}. Graduated specs are immutable.`;
    sendDeniedEvent({ agentName: agent, toolName, reason });
    process.stderr.write(`BLOCKED: Frankie cannot edit an existing spec file: ${filePath}\n`);
    process.stderr.write('Graduated specs under specs/ are immutable by design (FlowSpec protection).\n');
    process.stderr.write('You may ADD new flow files only — never edit one that already exists.\n');
    process.exit(2);
  }

  // Everything else is implementation/test territory — Frankie reports,
  // he never fixes.
  const reason = `BLOCKED: Frankie cannot write or edit implementation/test files: ${filePath}. Bounce to B.A. with repro steps instead.`;
  sendDeniedEvent({ agentName: agent, toolName, reason });
  process.stderr.write(`BLOCKED: Frankie cannot write or edit implementation/test files: ${filePath}\n`);
  process.stderr.write('Frankie never fixes the code (see Hard rules in agents/frankie.md).\n');
  process.stderr.write('Record exact repro steps and the failing screenshot in report.md, then bounce the failure to B.A. instead.\n');
  process.exit(2);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
