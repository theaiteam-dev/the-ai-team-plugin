#!/usr/bin/env node
/**
 * enforce-browser-verification.js - Stop hook for Amy
 *
 * Ensures Amy performs browser verification before finishing.
 * Checks for a marker file created by track-browser-usage.js.
 * If no marker exists, checks if the agent_stop summary contains
 * a NO_UI justification. Otherwise blocks.
 *
 * Used by: Amy
 *
 * Claude Code sends hook context via stdin JSON:
 *   SubagentStop: { agent_type, last_assistant_message, ... }
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
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveAgent } from './lib/resolve-agent.js';

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

const agentName = resolveAgent(hookInput) || '';
const agentOutput = hookInput.last_assistant_message || '';
const apiUrl = process.env.ATEAM_API_URL || '';
const projectId = process.env.ATEAM_PROJECT_ID || '';
const mockResponse = process.env.__TEST_MOCK_RESPONSE__;

// Only enforce for Amy
if (agentName !== 'amy') {
  console.log(JSON.stringify({}));
  process.exit(0);
}

// Detect item ID from output
let detectedItemId = '';
const wiMatch = agentOutput.match(/WI-(\d+)/);
if (wiMatch) {
  detectedItemId = `WI-${wiMatch[1]}`;
}
if (!detectedItemId) {
  const featureMatch = agentOutput.match(/(?:Feature|item|Item)\s+(\d{3})/i);
  if (featureMatch) {
    detectedItemId = featureMatch[1];
  }
}

// Check for browser usage marker file
const markerPath = join(tmpdir(), `.ateam-browser-verified-${projectId || 'default'}`);

if (existsSync(markerPath)) {
  // Browser testing confirmed - clean up marker and allow stop
  try { unlinkSync(markerPath); } catch { /* ignore */ }
  console.log(JSON.stringify({}));
  process.exit(0);
}

// No marker file - check if agent_stop summary contains NO_UI justification
const noUiPatterns = [
  /NO_UI_COMPONENT/i,
  /NO_UI/i,
  /no user-facing UI/i,
  /API-only/i,
  /backend-only/i,
  /no UI component/i,
];

async function checkSummary() {
  let summary = '';

  // Try to get the work_log summary from the API
  if (mockResponse !== undefined) {
    try {
      const itemData = JSON.parse(mockResponse);
      const workLog = itemData.work_log || [];
      const amyEntry = workLog.find(
        (entry) => (entry.agent || '').toLowerCase() === 'amy'
      );
      if (amyEntry) {
        summary = amyEntry.summary || '';
      }
    } catch { /* ignore parse errors */ }
  } else if (apiUrl && projectId && detectedItemId) {
    try {
      const url = `${apiUrl}/api/projects/${projectId}/items/${detectedItemId}`;
      const response = await fetch(url, {
        headers: { 'X-Project-ID': projectId },
      });
      if (response.ok) {
        const itemData = await response.json();
        const workLog = itemData.work_log || [];
        const amyEntry = workLog.find(
          (entry) => (entry.agent || '').toLowerCase() === 'amy'
        );
        if (amyEntry) {
          summary = amyEntry.summary || '';
        }
      }
    } catch {
      // API unreachable - fail open
      console.log(JSON.stringify({}));
      process.exit(0);
    }
  }

  // Also check agent output for NO_UI patterns
  const textToCheck = `${summary} ${agentOutput}`;

  for (const pattern of noUiPatterns) {
    if (pattern.test(textToCheck)) {
      // Valid NO_UI justification found - allow stop
      console.log(JSON.stringify({}));
      process.exit(0);
    }
  }

  // No browser verification and no NO_UI justification - block
  const message = `STOP: Browser verification required.

You MUST verify this feature from the user's perspective before finishing:

1. Read ateam.config.json for devServer.url
2. Use the agent-browser skill to navigate and interact with the app
3. Verify the feature works as a user would experience it
4. Take a screenshot as evidence

PREFERRED: Use the agent-browser skill:
  Skill(agent-browser) - navigates, clicks, takes screenshots

ALTERNATIVE: Use Playwright MCP tools directly:
  - mcp__plugin_playwright_playwright__browser_navigate
  - mcp__plugin_playwright_playwright__browser_snapshot
  - mcp__plugin_playwright_playwright__browser_click
  - mcp__plugin_playwright_playwright__browser_take_screenshot

If this feature has NO user-facing UI, call ateam agents-stop agentStop again with
"NO_UI_COMPONENT" in the summary to skip browser verification.`;

  console.log(
    JSON.stringify({
      decision: 'block',
      additionalContext: message,
    })
  );
  process.exit(0);
}

checkSummary().catch(() => {
  // On any error, fail open - allow stop
  console.log(JSON.stringify({}));
  process.exit(0);
});
