#!/usr/bin/env node
/**
 * block-lynch-writes.js - PreToolUse hook for Lynch
 *
 * Blocks Lynch from writing or editing any files. Lynch is a code reviewer —
 * he reviews statically and must NOT modify source files, tests, or docs.
 * /tmp/ and /var/ are allowed as scratch space.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input).
 */

import { readFileSync } from 'fs';
import { resolveAgent } from './lib/resolve-agent.js';
import { denyAndExit } from './lib/send-denied-event.js';

try {
  let hookInput = {};
  try {
    const raw = readFileSync(0, 'utf8');
    hookInput = JSON.parse(raw);
  } catch {
    // Can't read stdin — fail open
    process.exit(0);
  }

  const agent = resolveAgent(hookInput);

  // Only enforce for reviewers: Lynch (per-feature) and Stockwell (final
  // review, resolved name since the lynch-final rename). 'lynch-final' is
  // kept for legacy dispatch types.
  if (agent !== 'lynch' && agent !== 'lynch-final' && agent !== 'stockwell') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';

  if (toolName !== 'Write' && toolName !== 'Edit') {
    process.exit(0);
  }

  const filePath = (hookInput.tool_input && hookInput.tool_input.file_path) || '';

  // Allow /tmp/ and /var/ as scratch space
  if (!filePath || filePath.startsWith('/tmp/') || filePath.startsWith('/var/')) {
    process.exit(0);
  }

  process.stderr.write('BLOCKED: reviewers (Lynch/Stockwell) cannot write or edit project files.\n');
  process.stderr.write('Reviewers review code statically. Browser investigation belongs to Amy.\n');
  process.stderr.write('Put your findings in the review report (as text output).\n');
  await denyAndExit({ agentName: agent, toolName, reason: `BLOCKED: reviewers (Lynch/Stockwell) cannot write or edit project files: ${filePath}` });
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
