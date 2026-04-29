#!/usr/bin/env node
/**
 * block-hannibal-writes.js - PreToolUse hook for Hannibal
 *
 * Blocks Write/Edit operations to src/** and test files.
 * This hook is scoped to Hannibal's context only (via frontmatter).
 * Subagents like B.A. and Murdock are not affected.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input).
 */

import { readFileSync } from 'fs';
import { resolveAgent } from './lib/resolve-agent.js';
import { sendDeniedEvent } from './lib/send-denied-event.js';

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

  // Only enforce for Hannibal — null (unidentifiable) fails open
  if (agent !== 'hannibal') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const filePath = toolInput.file_path || '';

  // Only gate write-capable tools. Reads, searches, and execs are unrelated
  // to this hook's intent ("hannibal writes") — Hannibal must read source
  // files to orchestrate and report status.
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  if (!WRITE_TOOLS.has(toolName)) {
    process.exit(0);
  }

  // Block writes to src/ directory (handle both absolute and relative paths)
  if (filePath.includes('/src/') || filePath.startsWith('src/')) {
    sendDeniedEvent({ agentName: agent, toolName, reason: `BLOCKED: Hannibal cannot write to ${filePath}. Implementation code must be delegated to B.A.` });
    process.stderr.write(`BLOCKED: Hannibal cannot write to ${filePath}\n`);
    process.stderr.write('Implementation code must be delegated to B.A.\n');
    process.exit(2);
  }

  // Block writes to test files
  if (filePath.match(/\.(test|spec)\.(ts|js|tsx|jsx)$/)) {
    sendDeniedEvent({ agentName: agent, toolName, reason: `BLOCKED: Hannibal cannot write to ${filePath}. Test files must be delegated to Murdock.` });
    process.stderr.write(`BLOCKED: Hannibal cannot write to ${filePath}\n`);
    process.stderr.write('Test files must be delegated to Murdock.\n');
    process.exit(2);
  }

  // Allow other writes (mission/, ateam.config.json, etc.)
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
