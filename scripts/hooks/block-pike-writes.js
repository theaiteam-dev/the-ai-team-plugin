#!/usr/bin/env node
/**
 * block-pike-writes.js - PreToolUse hook for Pike
 *
 * Pike triages a reported defect into `bug`-type work items before any
 * mission exists (agents/pike.md). He reproduces, names a SUSPECTED cause,
 * and files items via `ateam items createItem`. He does not fix anything,
 * and he does not write the failing test that would be the most natural
 * repro artifact. That test is Murdock's first move once `/ai-team:run`
 * starts, and a Pike-authored one would pre-empt the pipeline's own TDD
 * stage.
 *
 * Allowed (exit 0):
 *   - The mission brief under `<project>/.mission-briefs/` (`*.md` only):
 *     the one repo file Pike authors, per the mission-brief skill. Judged by
 *     where the path RESOLVES (".." collapsed, symlinks followed), so
 *     `.mission-briefs/../src/app.ts` and a symlink laundered through the
 *     brief dir are not brief writes.
 *   - The system temp dirs, via lib/scratch-path.js's canonicalized,
 *     project-root-excluded test (throwaway probe scripts, screenshots).
 *
 * Blocked (exit 2, denied event recorded):
 *   - Every other Write/Edit/MultiEdit/NotebookEdit target: implementation,
 *     tests, config, docs. Test files get a message naming Murdock, because
 *     the pull toward "just write the failing test" is the specific failure
 *     mode this hook exists for.
 *
 * Scope: write-capable tools only, like block-lynch-writes.js and
 * block-amy-writes.js. Bash is NOT scanned here: Pike drives dev servers and
 * the ateam CLI through Bash, and block-frankie-writes.js's shell scanner is
 * not factored into a shared lib. The rule in agents/pike.md binds regardless
 * of what this hook catches; it is a guard, not a sandbox.
 *
 * Fail-open everywhere: unreadable stdin, an unidentifiable agent, a missing
 * file path, or an unexpected error all exit 0.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input, cwd).
 */

import { readFileSync, lstatSync, realpathSync } from 'fs';
import path from 'path';
import { resolveAgent } from './lib/resolve-agent.js';
import { isScratchPath } from './lib/scratch-path.js';
import { denyAndExit } from './lib/send-denied-event.js';

const BRIEF_DIR = '.mission-briefs';

/**
 * Project root: the hook payload's `cwd`, falling back to process.cwd(),
 * the same source the other write guards use.
 */
function projectRootFrom(input) {
  const fromPayload = input && typeof input.cwd === 'string' ? input.cwd : '';
  return fromPayload !== '' ? fromPayload : process.cwd();
}

function pathEntryExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonical absolute form of `abs` with symlinks resolved, for paths that
 * may not exist yet: realpath() the deepest existing ancestor and re-append
 * the not-yet-existing tail. Returns null when the path cannot be
 * canonicalized (dangling symlink, permission error); callers treat null as
 * "not allowlisted".
 */
function canonicalizePath(abs) {
  const tail = [];
  let current = abs;
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

function isWithin(child, parent) {
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(prefix);
}

/**
 * True iff `filePath` resolves to a `.md` file strictly inside
 * `<projectRoot>/.mission-briefs/`. Relative paths resolve against the
 * project root (the hook payload's cwd), which is where the mission-brief
 * skill's `.mission-briefs/<slug>.md` convention is anchored.
 */
function isMissionBriefPath(filePath, projectRoot) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  const target = canonicalizePath(path.resolve(abs));
  if (target === null) {
    return false;
  }
  const rootResolved = path.resolve(projectRoot);
  const rootCanonical = canonicalizePath(rootResolved) ?? rootResolved;
  const briefDir = path.join(rootCanonical, BRIEF_DIR);
  return isWithin(target, briefDir) && target.endsWith('.md');
}

const TEST_FILE_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)__tests__\//,
  /_test\.go$/,
  /(^|\/)tests?\//,
];

function looksLikeTestFile(filePath) {
  return TEST_FILE_PATTERNS.some((re) => re.test(filePath));
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

  // Only enforce for Pike
  if (agent !== 'pike') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const filePath = toolInput.file_path || toolInput.notebook_path || '';

  // Only gate write-capable tools. Pike must Read source to trace a cause
  // and run Bash to reproduce; those fall through.
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  if (!WRITE_TOOLS.has(toolName)) {
    process.exit(0);
  }

  if (!filePath) {
    process.exit(0);
  }

  const projectRoot = projectRootFrom(hookInput);

  // Scratch space outside the project: probe scripts, screenshots, notes.
  if (isScratchPath(filePath, undefined, projectRoot)) {
    process.exit(0);
  }

  // The mission brief is the one repo file Pike authors.
  if (isMissionBriefPath(filePath, projectRoot)) {
    process.exit(0);
  }

  if (looksLikeTestFile(filePath)) {
    const reason = `BLOCKED: Pike cannot write test file ${filePath}. A failing test is Murdock's job, not a repro artifact.`;
    process.stderr.write(`BLOCKED: Pike cannot write test file ${filePath}\n`);
    process.stderr.write("A failing test is Murdock's job once /ai-team:run starts, not a repro artifact.\n");
    process.stderr.write('Put the repro steps in the work item\'s acceptance criteria instead (ateam items createItem).\n');
    await denyAndExit({ agentName: agent, toolName, reason });
  }

  const reason = `BLOCKED: Pike cannot write ${filePath}. Pike triages and files work items; the only repo file he writes is the mission brief under ${BRIEF_DIR}/.`;
  process.stderr.write(`BLOCKED: Pike cannot write ${filePath}\n`);
  process.stderr.write('Pike triages and files work items. He does not fix, patch, or scaffold.\n');
  process.stderr.write(`Allowed targets: the mission brief under ${BRIEF_DIR}/ and scratch files outside the project.\n`);
  process.stderr.write('Record the suspected cause in the work item\'s context field (ateam items createItem).\n');
  await denyAndExit({ agentName: agent, toolName, reason });
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
