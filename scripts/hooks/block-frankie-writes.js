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
 *   - A NEW file under specs/ that does not already exist on disk
 *
 * Blocked:
 *   - An Edit/Write targeting a file that already exists under specs/
 *     ("immutable" — graduated specs cannot be altered, only added to)
 *   - Everything else (implementation, tests, and any other path) —
 *     Frankie's job is to report, not to fix; the failure bounces to B.A.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input).
 */

import { readFileSync, existsSync } from 'fs';
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
 * True if filePath names `dirName` itself or a path underneath it,
 * whether filePath is relative ("specs/x.yaml") or absolute
 * (".../repo/specs/x.yaml").
 *
 * Any path containing a ".." traversal segment is NEVER "under" anything,
 * even if the segment would resolve back into dirName — Frankie has no
 * legitimate reason to construct a path containing "..", and both the
 * specs/ and .qa-evidence/ allowlists depend on this function, so this
 * one check closes the traversal hole for both (e.g. "specs/../src/x.ts"
 * or ".qa-evidence/../packages/shared/src/agents.ts" both fall through to
 * the default block branch instead of being treated as allowed writes).
 */
function isUnderDir(filePath, dirName) {
  if (hasTraversalSegment(filePath)) {
    return false;
  }
  return (
    filePath === dirName ||
    filePath.startsWith(`${dirName}/`) ||
    filePath.includes(`/${dirName}/`)
  );
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

  // specs/ has two cases: a brand-new flow file is fine; an existing one
  // is immutable.
  if (isUnderDir(filePath, 'specs')) {
    if (!existsSync(filePath)) {
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
