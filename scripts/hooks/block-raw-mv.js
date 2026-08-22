#!/usr/bin/env node
/**
 * block-raw-mv.js - PreToolUse hook for Hannibal
 *
 * Blocks raw `mv` commands on mission files.
 * Hannibal must use the board_move MCP tool instead, which:
 * - Updates board state in the API
 * - Validates stage transitions
 * - Enforces WIP limits
 * - Logs activity
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

  // Only enforce for Hannibal — null (unidentifiable) fails open
  if (agent !== 'hannibal') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const command = toolInput.command || '';

  // Check if this is an mv command targeting mission files
  const isMvCommand = command.trim().startsWith('mv ') || command.includes('&& mv ') || command.includes('; mv ');
  const targetsMission = command.includes('mission/') || command.includes('/mission/');

  if (isMvCommand && targetsMission) {
    process.stderr.write('BLOCKED: Do not use raw `mv` to move mission files.\n');
    process.stderr.write('\n');
    process.stderr.write('Use the board_move MCP tool instead:\n');
    process.stderr.write('\n');
    process.stderr.write('  board_move(itemId="WI-001", to="done")\n');
    process.stderr.write('\n');
    process.stderr.write('The MCP tool ensures:\n');
    process.stderr.write('  - Board state is updated in the API\n');
    process.stderr.write('  - Stage transitions are validated\n');
    process.stderr.write('  - WIP limits are enforced\n');
    process.stderr.write('  - Activity is logged\n');
    process.stderr.write('\n');
    process.stderr.write('Available stages: briefings, ready, testing, implementing, review, probing, staged, done, blocked\n');
    await denyAndExit({ agentName: agent, toolName, reason: 'BLOCKED: Do not use raw `mv` to move mission files. Use the board_move MCP tool instead.' });
  }

  // Allow other bash commands
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
