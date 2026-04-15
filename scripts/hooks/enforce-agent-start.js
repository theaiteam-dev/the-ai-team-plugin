#!/usr/bin/env node
/**
 * enforce-agent-start.js - PreToolUse hook that blocks ateam agents-stop
 * if agents-start has not been called in this session.
 *
 * Root cause: in native teams mode, pipeline workers (Lynch especially)
 * sometimes skip agentStart and go straight to reviewing. When they later
 * call agentStop, the API returns NOT_CLAIMED (400) because no AgentClaim
 * record exists. This breaks peer-to-peer handoff chains and forces
 * Hannibal to manually intervene (~1-2 min overhead per item).
 *
 * How it works:
 * - observe-pre-tool-use.js writes /tmp/ateam-agent-started/{session_id}
 *   when it sees an agents-start command (separate from agent-map)
 * - This hook checks for that marker when agents-stop is attempted
 * - If missing, blocks with a clear message to call agentStart first
 *
 * Also blocks ateam activity log calls before agentStart, since logging
 * before claiming is a sign the agent skipped the lifecycle setup.
 *
 * Hannibal never calls agents-start or agents-stop, so this hook
 * never fires for orchestrator sessions.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const STARTED_DIR = join(tmpdir(), 'ateam-agent-started');

let hookInput = {};
try {
  const raw = readFileSync(0, 'utf8');
  hookInput = JSON.parse(raw);
} catch {
  process.exit(0);
}

try {
  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const command = toolInput.command || '';
  const sessionId = hookInput.session_id || '';

  // Only check Bash calls that invoke ateam CLI
  if (toolName !== 'Bash' || !command.includes('ateam')) {
    process.exit(0);
  }

  // Allow agents-start itself through (that's what creates the marker)
  if (command.includes('agents-start')) {
    process.exit(0);
  }

  // Only enforce on commands that require a prior agentStart:
  // - agents-stop (will fail with NOT_CLAIMED without it)
  // - activity log (sign of skipped lifecycle setup)
  const needsStart = command.includes('agents-stop') || command.includes('activity');
  if (!needsStart) {
    process.exit(0);
  }

  // Check if agentStart has been called in this session
  if (!sessionId || existsSync(join(STARTED_DIR, sessionId))) {
    process.exit(0);
  }

  // agentStart has NOT been called — block
  if (command.includes('agents-stop')) {
    process.stderr.write('BLOCKED: agentStop called without prior agentStart in this session.\n');
    process.stderr.write('You must call agentStart FIRST to register your claim on the work item.\n');
    process.stderr.write('Run: ateam agents-start agentStart --itemId "<ITEM_ID>" --agent "<YOUR_NAME>"\n');
    process.stderr.write('Without this, agentStop will fail with NOT_CLAIMED (400).\n');
  } else {
    process.stderr.write('BLOCKED: ateam activity called without prior agentStart in this session.\n');
    process.stderr.write('Call agentStart first to register your claim, then log activity.\n');
    process.stderr.write('Run: ateam agents-start agentStart --itemId "<ITEM_ID>" --agent "<YOUR_NAME>"\n');
  }
  process.exit(2);
} catch {
  // Fail open on unexpected errors
  process.exit(0);
}
