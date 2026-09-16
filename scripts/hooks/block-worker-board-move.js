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

  // Only enforce for agents that must never drive the board themselves.
  // Pike is here for a different reason than the rest: he is not a working
  // agent at all (he claims nothing, runs before a mission exists), and the
  // items he files must stay in `briefings` for /ai-team:run to pick up.
  const TARGET_AGENTS = ['murdock', 'ba', 'lynch', 'lynch-final', 'stockwell', 'amy', 'frankie', 'tawnia', 'pike'];
  if (!agent || !TARGET_AGENTS.includes(agent)) {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const command = toolInput.command || '';

  // Check for ateam board-move CLI calls via Bash
  if (toolName === 'Bash' && command.includes('ateam') && command.includes('board-move')) {
    if (agent === 'pike') {
      process.stderr.write('BLOCKED: Pike cannot call ateam board-move.\n');
      process.stderr.write('The bug items you file stay in briefings; /ai-team:run advances them.\n');
      await denyAndExit({ agentName: agent, toolName, reason: 'BLOCKED: Pike cannot call ateam board-move. Items he files stay in briefings for /ai-team:run to execute.' });
    }
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
