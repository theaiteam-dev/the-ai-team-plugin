#!/usr/bin/env node
/**
 * observe-pre-tool-use.js - PreToolUse hook for observing tool calls
 *
 * Logs tool invocations to the API for observability.
 * This is a fire-and-forget observer - it must never block agents.
 *
 * Claude Code sends hook context via stdin JSON, not env vars.
 * Agent name is passed as CLI arg (process.argv[2]) from frontmatter hooks.
 */

import { readHookInput, buildObserverPayload, sendObserverEvent } from './lib/observer.js';

const hookInput = readHookInput();
const agentName = process.argv[2] || undefined;

// Emit handoff-start (fire-and-forget) BEFORE the main await so both
// HTTP requests are in-flight when the main fetch resolves or times out.
const command = hookInput.tool_input?.command || '';
if (command.includes('agents-start') && command.includes('--itemId')) {
  const match = command.match(/--itemId\s+["']?([^\s"']+)["']?/);
  if (match) {
    const itemId = match[1];
    const resolvedAgent = agentName || hookInput.agent_type || 'hannibal';
    sendObserverEvent({
      eventType: 'handoff-start',
      agentName: resolvedAgent,
      itemId,
      timestampMs: Date.now(),
    }).catch(() => {});
  }
}

const payload = buildObserverPayload(hookInput, agentName);
if (payload) {
  await sendObserverEvent(payload).catch(() => {});
}

process.exit(0);
