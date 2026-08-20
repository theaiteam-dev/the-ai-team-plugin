#!/usr/bin/env node
/**
 * block-lynch-writes.js - PreToolUse hook for Lynch
 *
 * Blocks Lynch from writing or editing any files. Lynch is a code reviewer —
 * he reviews statically and must NOT modify source files, tests, or docs.
 * The system temp dirs are allowed as scratch space — see lib/scratch-path.js:
 * the path is canonicalized (".." collapsed, symlinks resolved) and the project
 * root is excluded before the allowlist test, so `/tmp/../<repo>/src/app.ts` is
 * NOT scratch, and neither is `<repo>/src/app.ts` on a repo that lives under
 * /tmp.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input).
 */

import { readFileSync } from 'fs';
import { resolveAgent } from './lib/resolve-agent.js';
import { isScratchPath } from './lib/scratch-path.js';
import { denyAndExit } from './lib/send-denied-event.js';

/**
 * Project root for the scratch-space exclusion. Claude Code sends the session
 * cwd in the hook payload; the hook process is started there too, so
 * process.cwd() is the fallback. Passed EXPLICITLY into isScratchPath so a
 * repo that lives under a temp root (macOS $TMPDIR, a /tmp worktree, a CI
 * sandbox) never gets a scratch allowance for its own files.
 */
function projectRootFrom(input) {
  const fromPayload = input && typeof input.cwd === 'string' ? input.cwd : '';
  return fromPayload !== '' ? fromPayload : process.cwd();
}

try {
  let hookInput = {};
  try {
    const raw = readFileSync(0, 'utf8');
    hookInput = JSON.parse(raw);
  } catch {
    // Can't read stdin — fail open
    process.exit(0);
  }

  const agent = resolveAgent(hookInput);

  // Only enforce for reviewers: Lynch (per-feature) and Stockwell (final
  // review, resolved name since the lynch-final rename). 'lynch-final' is
  // kept for legacy dispatch types.
  if (agent !== 'lynch' && agent !== 'lynch-final' && agent !== 'stockwell') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';

  if (toolName !== 'Write' && toolName !== 'Edit') {
    process.exit(0);
  }

  const filePath = (hookInput.tool_input && hookInput.tool_input.file_path) || '';

  // Allow the temp dirs as scratch space — but only where the path REALLY
  // resolves under them and outside this project (isScratchPath collapses
  // "..", follows symlinks, and excludes the project root).
  if (!filePath || isScratchPath(filePath, undefined, projectRootFrom(hookInput))) {
    process.exit(0);
  }

  process.stderr.write('BLOCKED: reviewers (Lynch/Stockwell) cannot write or edit project files.\n');
  process.stderr.write('Reviewers review code statically. Browser investigation belongs to Amy.\n');
  process.stderr.write('Put your findings in the review report (as text output).\n');
  await denyAndExit({ agentName: agent, toolName, reason: `BLOCKED: reviewers (Lynch/Stockwell) cannot write or edit project files: ${filePath}` });
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
