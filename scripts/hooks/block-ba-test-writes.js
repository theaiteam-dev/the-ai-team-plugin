#!/usr/bin/env node
/**
 * block-ba-test-writes.js - PreToolUse hook for B.A.
 *
 * Blocks B.A. from writing or editing test files. Tests are Murdock's
 * responsibility. B.A. implements code to pass existing tests — he does
 * NOT modify the tests to pass his code.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input).
 */

import { readFileSync } from 'fs';
import { resolveAgent } from './lib/resolve-agent.js';
import { denyAndExit } from './lib/send-denied-event.js';

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

  // Only enforce for B.A.
  if (agent !== 'ba') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const filePath = toolInput.file_path || toolInput.notebook_path || '';

  // Only gate write-capable tools. This hook is matcher-less (fires on every
  // tool), and Read/Grep/Glob also carry a file_path — without this gate the
  // test-file path check below falsely blocks B.A. from READING test files,
  // not just from writing them.
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  if (!WRITE_TOOLS.has(toolName)) {
    process.exit(0);
  }

  if (!filePath) {
    process.exit(0);
  }

  // Block writes to test/spec files
  if (filePath.match(/\.(test|spec)\.(ts|js|tsx|jsx)$/)) {
    const reason = `BLOCKED: B.A. cannot modify test files: ${filePath}. Tests are Murdock's responsibility.`;
    process.stderr.write(`BLOCKED: B.A. cannot modify test files: ${filePath}\n`);
    process.stderr.write('Tests are Murdock\'s responsibility. Implement code that passes the existing tests.\n');
    process.stderr.write('If a test is genuinely broken, message Hannibal to have Murdock fix it.\n');
    await denyAndExit({ agentName: agent, toolName, reason });
  }

  // Allow vitest.setup.ts, jest.setup.ts etc. — these are infrastructure, not tests
  // Allow all other writes
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
