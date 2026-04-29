#!/usr/bin/env node
/**
 * block-amy-writes.js - PreToolUse hook for Amy
 *
 * Blocks Write/Edit operations to project source code, tests, and config.
 * Amy investigates and reports - she does NOT modify production code or tests.
 * Her findings go in the agent_stop summary, not file artifacts.
 *
 * Allowed: writes to /tmp/, throwaway debug scripts outside the project.
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

  // Only enforce for Amy
  if (agent !== 'amy') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const filePath = toolInput.file_path || '';

  // Only gate write-capable tools. Reads, searches, and execs are unrelated
  // to this hook's intent ("amy writes") — Amy must read source files to
  // investigate bugs and probe behavior.
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  if (!WRITE_TOOLS.has(toolName)) {
    process.exit(0);
  }

  if (!filePath) {
    process.exit(0);
  }

  // Allow writes to /tmp/ (throwaway debug scripts, investigation artifacts)
  if (filePath.startsWith('/tmp/') || filePath.startsWith('/var/')) {
    process.exit(0);
  }

  // Block writes to test/spec files
  if (filePath.match(/\.(test|spec)\.(ts|js|tsx|jsx)$/)) {
    const reason = `BLOCKED: Amy cannot write to ${filePath}. Test files are Murdock's responsibility.`;
    sendDeniedEvent({ agentName: agent, toolName, reason });
    process.stderr.write(`BLOCKED: Amy cannot write to ${filePath}\n`);
    process.stderr.write('Test files are Murdock\'s responsibility.\n');
    process.stderr.write('Document your findings in the agent_stop summary instead.\n');
    process.exit(2);
  }

  // Block writes to raptor files
  if (filePath.match(/raptor/i)) {
    const reason = `BLOCKED: Amy cannot write raptor files: ${filePath}`;
    sendDeniedEvent({ agentName: agent, toolName, reason });
    process.stderr.write(`BLOCKED: Amy cannot write raptor files: ${filePath}\n`);
    process.stderr.write('Document your investigation in the agent_stop summary instead.\n');
    process.exit(2);
  }

  // Block writes to project source code (src/, app/, lib/, components/, etc.)
  if (filePath.match(/\/(src|app|lib|components|pages|utils|services|hooks|styles|public)\//)) {
    const reason = `BLOCKED: Amy cannot modify project source code: ${filePath}`;
    sendDeniedEvent({ agentName: agent, toolName, reason });
    process.stderr.write(`BLOCKED: Amy cannot modify project source code: ${filePath}\n`);
    process.stderr.write('Amy investigates and reports. She does NOT fix bugs or modify code.\n');
    process.stderr.write('Document your findings in the agent_stop summary instead.\n');
    process.exit(2);
  }

  // Block writes to config files that affect the project
  if (filePath.match(/\/(package\.json|tsconfig.*|biome\.json|vitest\.config|next\.config|prisma\/schema)/)) {
    const reason = `BLOCKED: Amy cannot modify project config: ${filePath}`;
    sendDeniedEvent({ agentName: agent, toolName, reason });
    process.stderr.write(`BLOCKED: Amy cannot modify project config: ${filePath}\n`);
    process.stderr.write('Report config issues in the agent_stop summary instead.\n');
    process.exit(2);
  }

  // Allow other writes (files outside project directories)
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
