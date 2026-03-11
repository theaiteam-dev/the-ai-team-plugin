#!/usr/bin/env node
/**
 * block-worker-board-claim.js - PreToolUse hook for working agents
 *
 * Blocks working agents from calling `ateam board-claim` directly via Bash.
 * Workers should use `ateam agents-start` to claim items, which handles both
 * the board claim and the assigned_agent metadata in one call.
 *
 * Targets: murdock, ba, lynch, lynch-final, amy, tawnia
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

  // Only enforce for working agents
  const TARGET_AGENTS = ['murdock', 'ba', 'lynch', 'lynch-final', 'amy', 'tawnia'];
  if (!agent || !TARGET_AGENTS.includes(agent)) {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const command = toolInput.command || '';

  // Check for ateam board-claim CLI calls via Bash
  if (toolName === 'Bash' && command.includes('ateam') && command.includes('board-claim')) {
    try {
      sendDeniedEvent({ agentName: agent, toolName, reason: 'BLOCKED: Working agents cannot call ateam board-claim directly. Use ateam agents-start instead.' });
    } finally {
      process.stderr.write('BLOCKED: Working agents cannot call ateam board-claim directly.\n');
      process.stderr.write('Use ateam agents-start to claim items — it handles both the board claim and metadata.\n');
      process.exit(2);
    }
  }

  // Allow other tools
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
