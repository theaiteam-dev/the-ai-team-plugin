#!/usr/bin/env node
/**
 * enforce-completion-log.js - Stop/SubagentStop hook for working agents
 *
 * Ensures agents call the agent_stop MCP tool before finishing.
 * If the agent hasn't logged completion, this hook blocks the stop
 * and injects a message telling the agent to call agent_stop.
 *
 * Used by: Murdock, B.A., Lynch, Amy, Tawnia
 *
 * Claude Code sends hook context via stdin JSON:
 *   Stop: { session_id, hook_event_name, last_assistant_message, ... }
 *   SubagentStop: { session_id, hook_event_name, agent_type, last_assistant_message, ... }
 *
 * Environment variables (from settings.local.json):
 *   ATEAM_API_URL - Base URL for the A(i)-Team API
 *   ATEAM_PROJECT_ID - Project identifier
 *
 * For testing:
 *   __TEST_MOCK_RESPONSE__ - JSON string to use instead of real API fetch
 *
 * Returns JSON:
 *   { "decision": "block", "additionalContext": "..." } - Force agent to continue
 *   {} - Allow stop
 */

import { readFileSync } from 'fs';
import { resolveAgent, isKnownAgent } from './lib/resolve-agent.js';

// Read hook input from stdin
let hookInput = {};
try {
  const raw = readFileSync(0, 'utf8');
  hookInput = JSON.parse(raw);
} catch {
  // Can't read stdin, allow stop
  console.log(JSON.stringify({}));
  process.exit(0);
}

const apiUrl = process.env.ATEAM_API_URL || '';
const projectId = process.env.ATEAM_PROJECT_ID || '';
const mockResponse = process.env.__TEST_MOCK_RESPONSE__;

// Only enforce for working agents: murdock, ba, lynch, lynch-final, amy, tawnia
const TARGET_AGENTS = ['murdock', 'ba', 'lynch', 'lynch-final', 'amy', 'tawnia'];
const resolvedAgent = resolveAgent(hookInput);
if (!resolvedAgent || !TARGET_AGENTS.includes(resolvedAgent)) {
  console.log(JSON.stringify({}));
  process.exit(0);
}

// Extract agent info from stdin JSON
const agentName = resolvedAgent;
const agentOutput = hookInput.last_assistant_message || '';

// Try to detect item ID from agent output
let detectedItemId = '';

// Look for WI-XXX patterns in agent output
const wiMatch = agentOutput.match(/WI-(\d+)/);
if (wiMatch) {
  detectedItemId = `WI-${wiMatch[1]}`;
}

// Look for "Feature XXX" or "item XXX" patterns
if (!detectedItemId) {
  const featureMatch = agentOutput.match(/(?:Feature|item|Item)\s+(\d{3})/i);
  if (featureMatch) {
    detectedItemId = featureMatch[1];
  }
}

if (!detectedItemId) {
  console.log(JSON.stringify({}));
  process.exit(0);
}

async function checkCompletion() {
  let itemData;

  if (mockResponse !== undefined) {
    // Use test mock
    itemData = JSON.parse(mockResponse);
  } else {
    // Query the API for the work item
    if (!apiUrl || !projectId) {
      // No API config, allow stop
      console.log(JSON.stringify({}));
      process.exit(0);
    }

    const url = `${apiUrl}/api/projects/${projectId}/items/${detectedItemId}`;
    const response = await fetch(url, {
      headers: { 'X-Project-ID': projectId },
    });

    if (!response.ok) {
      // API error, allow stop
      console.log(JSON.stringify({}));
      process.exit(0);
    }

    itemData = await response.json();
  }

  // Check if work_log has an entry for this agent
  const workLog = itemData.work_log || [];
  const agentLower = (agentName || '').toLowerCase();
  const hasEntry = workLog.some(
    (entry) => (entry.agent || '').toLowerCase() === agentLower
  );

  if (hasEntry) {
    // Agent already called agent_stop, allow stop
    console.log(JSON.stringify({}));
    process.exit(0);
  }

  // No completion logged - block and inject message
  const message = `STOP: You haven't logged your work completion yet.

Before finishing, you MUST call ateam agents-stop to record your work:

  ateam agents-stop agentStop --itemId "${detectedItemId}" --agent "${agentName || 'YOUR_AGENT_NAME'}" --status "success" --summary "Your summary here"

Parameters:
- itemId: "${detectedItemId}"
- agent: your agent name (murdock, ba, lynch, amy, or tawnia)
- status: "success" or "failed"
- summary: A brief human-readable overview of your work
- files_created: list of files you created (optional)
- files_modified: list of files you modified (optional)

**About the summary:** This is for HUMANS reading the work item to understand what was done. Write a light overview that complements the code.

This will be recorded in the work item's work_log for the team to see.`;

  console.log(
    JSON.stringify({
      decision: 'block',
      additionalContext: message,
    })
  );
  process.exit(0);
}

checkCompletion().catch(() => {
  // On any error, allow stop
  console.log(JSON.stringify({}));
  process.exit(0);
});
