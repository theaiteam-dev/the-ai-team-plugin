#!/usr/bin/env node
/**
 * block-raw-echo-log.js - PreToolUse hook for working agents
 *
 * Blocks attempts to use raw `echo >> mission/activity.log` commands.
 * Redirects agents to use `ateam activity createActivityEntry` via Bash instead.
 *
 * Targets: murdock, ba, lynch, amy, tawnia
 * Returns: { decision: "block" } JSON at exit 0 (NOT exit 2)
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input).
 */

import { readFileSync } from 'fs';
import { resolveAgent } from './lib/resolve-agent.js';
import { sendDeniedEvent } from './lib/send-denied-event.js';

// Read hook input from stdin (Claude Code sends JSON)
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
  const TARGET_AGENTS = ['murdock', 'ba', 'lynch', 'amy', 'tawnia'];
  if (!agent || !TARGET_AGENTS.includes(agent)) {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const command = toolInput.command || '';

  // Check for echo commands targeting mission/activity.log
  const isEchoToActivityLog =
    command.includes('>> mission/activity.log') ||
    command.includes('>>mission/activity.log') ||
    command.includes('> mission/activity.log') ||
    command.includes('>mission/activity.log') ||
    (command.includes('echo') && command.includes('activity.log'));

  if (isEchoToActivityLog) {
    const reason = 'BLOCKED: Do not use raw echo commands to write to activity.log. Use ateam activity createActivityEntry instead.';
    sendDeniedEvent({ agentName: agent, toolName, reason });

    // Block and provide guidance (JSON decision, exit 0 — not exit 2)
    const response = {
      decision: 'block',
      reason: `
BLOCKED: Do not use raw echo commands to write to activity.log.

Instead, use the ateam CLI:
  ateam activity createActivityEntry --agent "YourAgent" --message "Your message here"

Examples:
  ateam activity createActivityEntry --agent "Murdock" --message "Created 5 test cases"
  ateam activity createActivityEntry --agent "B.A." --message "All tests passing"
  ateam activity createActivityEntry --agent "Lynch" --message "APPROVED - all checks pass"

This ensures proper formatting and API integration.
`.trim(),
    };

    console.log(JSON.stringify(response));
    process.exit(0);
  }

  // Allow other commands
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
