#!/usr/bin/env node
/**
 * block-lynch-browser.js - PreToolUse hook for Lynch
 *
 * Blocks Lynch from using Playwright MCP browser tools.
 * Lynch reviews code by reading it, not by interacting with the browser.
 * Browser-based testing is Amy's responsibility.
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

  // Only enforce for reviewers: Lynch (per-feature) and Stockwell (final
  // review, resolved name since the lynch-final rename). 'lynch-final' is
  // kept for legacy dispatch types.
  if (agent !== 'lynch' && agent !== 'lynch-final' && agent !== 'stockwell') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';

  if (/^mcp__plugin_playwright_playwright__/.test(toolName)) {
    sendDeniedEvent({ agentName: agent, toolName, reason: 'BLOCKED: reviewers (Lynch/Stockwell) cannot use Playwright browser tools. Browser-based testing is Amy\'s responsibility.' });
    process.stderr.write('BLOCKED: reviewers (Lynch/Stockwell) cannot use Playwright browser tools.\n');
    process.stderr.write('Code review is done by reading code, not by interacting with the browser.\n');
    process.stderr.write('Browser-based testing is Amy\'s responsibility during the probing stage.\n');
    process.exit(2);
  }

  // Allow other tools
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
