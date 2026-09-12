#!/usr/bin/env node
/**
 * block-worker-board-claim.js - PreToolUse hook for working agents
 *
 * Blocks working agents from calling `ateam board-claim` directly via Bash.
 * Workers should use `ateam agents-start` to claim items, which handles both
 * the board claim and the assigned_agent metadata in one call.
 *
 * Targets: murdock, ba, lynch, lynch-final, stockwell, amy, frankie, tawnia
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

  // Only enforce for agents that must never claim board items directly.
  // Pike claims nothing at all: he files items and leaves them unassigned in
  // `briefings`, so for him this is a total prohibition, not a routing rule.
  const TARGET_AGENTS = ['murdock', 'ba', 'lynch', 'lynch-final', 'stockwell', 'amy', 'frankie', 'tawnia', 'pike'];
  if (!agent || !TARGET_AGENTS.includes(agent)) {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const command = toolInput.command || '';

  // Check for ateam board-claim CLI calls via Bash
  if (toolName === 'Bash' && command.includes('ateam') && command.includes('board-claim')) {
    if (agent === 'pike') {
      process.stderr.write('BLOCKED: Pike cannot call ateam board-claim.\n');
      process.stderr.write('Pike claims nothing: the items he files stay unassigned in briefings.\n');
      await denyAndExit({ agentName: agent, toolName, reason: 'BLOCKED: Pike cannot call ateam board-claim. He claims nothing; the items he files stay unassigned in briefings.' });
    }
    process.stderr.write('BLOCKED: Working agents cannot call ateam board-claim directly.\n');
    process.stderr.write('Use ateam agents-start to claim items — it handles both the board claim and metadata.\n');
    await denyAndExit({ agentName: agent, toolName, reason: 'BLOCKED: Working agents cannot call ateam board-claim directly. Use ateam agents-start instead.' });
  }

  // Allow other tools
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
