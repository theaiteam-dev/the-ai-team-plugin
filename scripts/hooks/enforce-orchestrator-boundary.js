#!/usr/bin/env node
/**
 * enforce-orchestrator-boundary.js - Plugin-level PreToolUse enforcement
 *
 * Enforces Hannibal's orchestrator boundaries when running in the main session.
 *
 * Problem: Agent frontmatter hooks only fire for subagent sessions. Since
 * Hannibal runs in the MAIN Claude context ("Main Claude becomes Hannibal"),
 * his frontmatter hooks in agents/hannibal.md never fire.
 *
 * Solution: This hook runs at the PLUGIN level (hooks/hooks.json), firing
 * for ALL sessions. It uses resolveAgent() to detect the current agent and
 * only enforces restrictions for the main session (Hannibal / null agent).
 *
 * Mission-active guard: Only enforces when a mission is running (marker file
 * exists). Without a mission, the main session is a normal user session,
 * not Hannibal. This prevents blocking writes during normal Claude usage.
 *
 * Detection:
 *   1. resolveAgent() returns a known non-hannibal agent → exit 0 (allow)
 *   2. Agent map shows worker name → worker active in main session → exit 0
 *   3. Agent is hannibal or null → main session → check mission-active → enforce allowlist
 *
 * Allowlist (main session only — Hannibal may ONLY write to):
 *   - ateam.config.json
 *   - .claude/** (settings, commands, etc.)
 *   - /tmp/**
 *   - /var/**
 *
 * Also blocks Playwright browser tools for main session (Amy's responsibility).
 */

import { readHookInput, lookupAgent } from './lib/observer.js';
import { resolveAgent, isKnownAgent } from './lib/resolve-agent.js';
import { denyAndExit } from './lib/send-denied-event.js';
import { isMissionActive } from './lib/mission-active.js';

let hookInput = {};
try {
  hookInput = readHookInput();
} catch {
  process.exit(0);
}

const toolName = hookInput.tool_name || '';

// Fast exit for tools we never care about
if (
  toolName === 'Read' ||
  toolName === 'Glob' ||
  toolName === 'Grep' ||
  toolName === 'Task' ||
  toolName === 'TaskOutput' ||
  toolName === 'TaskCreate' ||
  toolName === 'TaskUpdate' ||
  toolName === 'TaskList' ||
  toolName === 'TaskGet' ||
  toolName === 'SendMessage' ||
  toolName === 'TeamCreate' ||
  toolName === 'TeamDelete' ||
  toolName === 'AskUserQuestion' ||
  toolName === 'EnterPlanMode' ||
  toolName === 'ExitPlanMode' ||
  toolName === 'WebSearch' ||
  toolName === 'WebFetch'
) {
  process.exit(0);
}

// --- Agent Detection ---

const resolvedAgent = resolveAgent(hookInput);

// Known non-hannibal agents (workers): allow through — they have their own hooks
if (resolvedAgent !== null && resolvedAgent !== 'hannibal') {
  process.exit(0);
}

// Unknown system agents (Explore, Plan, etc.): allow through
if (resolvedAgent !== null && !isKnownAgent(resolvedAgent)) {
  process.exit(0);
}

// Check agent map: if a worker is active (between SubagentStart/Stop), allow.
const sessionId = hookInput.session_id || '';
const mappedAgent = lookupAgent(sessionId);

if (mappedAgent && mappedAgent !== 'hannibal') {
  // Worker agent is active in the main session — allow through
  process.exit(0);
}

// We're in the main session and Hannibal is in control.
// (resolvedAgent is 'hannibal' or null; mappedAgent is 'hannibal' or null)

// --- Mission-Active Guard ---
// No active mission → this is a normal Claude session, not Hannibal.
// Allow all operations without enforcement.
if (!isMissionActive()) {
  process.exit(0);
}

// --- Enforcement ---

const toolInput = hookInput.tool_input || {};
const agentLabel = resolvedAgent || 'hannibal';

// Block Playwright browser tools (Amy's job)
if (toolName.startsWith('mcp__plugin_playwright_playwright__')) {
  process.stderr.write(`BLOCKED: Hannibal cannot use browser tools (${toolName})\n`);
  process.stderr.write("Browser testing is Amy's responsibility.\n");
  process.stderr.write('Dispatch Amy to probe the feature instead.\n');
  await denyAndExit({ agentName: agentLabel, toolName, reason: `BLOCKED: Hannibal cannot use browser tools (${toolName}). Browser testing is Amy's responsibility.` });
}

// Apply allowlist for Write/Edit
if (toolName === 'Write' || toolName === 'Edit') {
  const filePath = toolInput.file_path || '';
  if (!filePath) {
    process.exit(0);
  }

  // Allowlist: ateam.config.json, .claude/*, /tmp/*, /var/*
  // Match both relative (.claude/) and absolute (/.claude/) paths
  if (
    filePath === 'ateam.config.json' ||
    filePath.startsWith('.claude/') ||
    filePath.includes('/.claude/') ||
    filePath.startsWith('/tmp/') ||
    filePath.startsWith('/var/')
  ) {
    process.exit(0);
  }

  // Everything else is blocked
  process.stderr.write(`BLOCKED: Hannibal cannot write to ${filePath}\n`);
  process.stderr.write('Hannibal orchestrates only. Delegate implementation to B.A. or Murdock.\n');
  await denyAndExit({ agentName: agentLabel, toolName, reason: `BLOCKED: Hannibal cannot write to ${filePath}. Delegate implementation to B.A. or Murdock.` });
}

// Allow everything else
process.exit(0);
