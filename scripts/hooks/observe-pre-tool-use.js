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

import { readHookInput, buildObserverPayload, sendObserverEvent, registerAgent } from './lib/observer.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const STARTED_DIR = join(tmpdir(), 'ateam-agent-started');

const hookInput = readHookInput();
const sessionId = hookInput.session_id || '';
let agentName = process.argv[2] || undefined;

// Self-registration: when a native teammate runs `ateam agents-start --agent <name>`,
// extract the agent name and map this session_id to it. This is the workaround for
// native teams mode where frontmatter hooks don't propagate and PreToolUse/PostToolUse
// stdin lacks teammate_name. Every pipeline agent's first action is agentStart, so all
// subsequent tool calls from this session will resolve correctly via lookupAgent.
// Also writes a marker for enforce-agent-start.js to verify lifecycle compliance.
const command = hookInput.tool_input?.command || '';
if (command.includes('agents-start') && command.includes('--agent')) {
  const agentMatch = command.match(/--agent\s+["']?([^\s"']+)["']?/);
  if (agentMatch && sessionId) {
    const cliAgent = agentMatch[1].toLowerCase();
    registerAgent(sessionId, cliAgent);
    // Write marker so enforce-agent-start.js knows this session called agentStart
    try {
      mkdirSync(STARTED_DIR, { recursive: true });
      writeFileSync(join(STARTED_DIR, sessionId), cliAgent);
    } catch {}
    if (!agentName) agentName = cliAgent;
  }
}

// Emit handoff-start (fire-and-forget) BEFORE the main await so both
// HTTP requests are in-flight when the main fetch resolves or times out.
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
