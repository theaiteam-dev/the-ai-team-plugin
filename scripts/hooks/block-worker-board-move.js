#!/usr/bin/env node
/**
 * block-worker-board-move.js - PreToolUse hook for working agents
 *
 * Blocks working agents (Murdock, B.A., Lynch, Amy, Frankie, Stockwell, Tawnia)
 * from calling `ateam board-move` via Bash. Stage transitions are Hannibal's
 * responsibility.
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

  // Only enforce for working agents
  const TARGET_AGENTS = ['murdock', 'ba', 'lynch', 'lynch-final', 'stockwell', 'amy', 'frankie', 'tawnia'];
  if (!agent || !TARGET_AGENTS.includes(agent)) {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const command = toolInput.command || '';

  // Check for ateam board-move CLI calls via Bash
  if (toolName === 'Bash' && command.includes('ateam') && command.includes('board-move')) {
    process.stderr.write('BLOCKED: Working agents cannot call ateam board-move.\n');
    process.stderr.write('Use ateam agents-stop agentStop to complete work.\n');
    process.stderr.write('If the next stage is at WIP capacity, use --advance=false to release the claim without moving stages.\n');
    await denyAndExit({ agentName: agent, toolName, reason: 'BLOCKED: Working agents cannot call ateam board-move. Use ateam agents-stop agentStop to complete work; the --advance=false flag skips the stage transition if needed.' });
  }

  // Allow other tools
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
