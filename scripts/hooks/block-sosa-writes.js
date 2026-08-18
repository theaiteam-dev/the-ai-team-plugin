#!/usr/bin/env node
/**
 * block-sosa-writes.js - PreToolUse hook for Sosa
 *
 * Blocks Sosa from writing or editing any files. Sosa reviews and critiques
 * Face's decomposition, but she does NOT write work items, tests, or code.
 * Her output is a review report provided as text to Hannibal.
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

  // Only enforce for Sosa
  if (agent !== 'sosa') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';

  if (toolName === 'Write' || toolName === 'Edit') {
    process.stderr.write('BLOCKED: Sosa cannot write or edit files.\n');
    process.stderr.write('Sosa reviews Face\'s decomposition and provides recommendations.\n');
    process.stderr.write('Put your findings in your review report (as text output).\n');
    process.stderr.write('Face will use your recommendations to refine the work items.\n');
    await denyAndExit({ agentName: agent, toolName, reason: 'BLOCKED: Sosa cannot write or edit files.' });
  }

  // Allow other tools
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
