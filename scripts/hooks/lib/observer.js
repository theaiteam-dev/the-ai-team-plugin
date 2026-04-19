#!/usr/bin/env node
/**
 * observer.js - Shared logic for observer hook scripts
 *
 * This module provides functions to build and send hook event payloads
 * to the A(i)-Team API for observability.
 *
 * Claude Code sends hook context via STDIN as JSON, not as env vars.
 * The only env vars available are: ATEAM_API_URL, ATEAM_PROJECT_ID,
 * CLAUDE_PLUGIN_ROOT, CLAUDE_PROJECT_DIR.
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { randomUUID, createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveAgent } from './resolve-agent.js';

const AGENT_MAP_DIR = join(tmpdir(), 'ateam-agent-map');

function hashArgs(args) {
  const input = typeof args === 'string' ? args : JSON.stringify(args ?? '');
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

const SUMMARY_FIELDS = {
  Bash: 'command',
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebSearch: 'query',
  WebFetch: 'url',
  Skill: 'skill',
};

function summarizeToolInput(toolName, toolInput) {
  const field = SUMMARY_FIELDS[toolName];
  return field ? (toolInput[field] || '') : '';
}

/**
 * Registers an active agent for a session. Called by observe-subagent.js
 * on SubagentStart. Tracks which agent is currently running so
 * PreToolUse/PostToolUse hooks can attribute tool calls.
 *
 * Uses session_id as key (all hooks in a session share the same ID).
 * For parallel agents, the last-started agent wins (imperfect but
 * better than "unknown" for most sequential pipeline flows).
 */
function registerAgent(sessionId, agentName) {
  try {
    mkdirSync(AGENT_MAP_DIR, { recursive: true });
    writeFileSync(join(AGENT_MAP_DIR, sessionId), agentName);
  } catch {}
}

/**
 * Unregisters an agent for a session. Called on SubagentStop.
 */
function unregisterAgent(sessionId) {
  try {
    unlinkSync(join(AGENT_MAP_DIR, sessionId));
  } catch {}
}

/**
 * Looks up the active agent name for a session.
 * Returns the agent name or null if no active agent.
 */
function lookupAgent(sessionId) {
  if (!sessionId) return null;
  try {
    return readFileSync(join(AGENT_MAP_DIR, sessionId), 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Reads and parses the hook input JSON from stdin.
 * Claude Code pipes JSON to hook commands on stdin.
 *
 * @returns {Object} Parsed JSON or empty object on failure
 */
function readHookInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Builds a hook event payload from hook input and CLI args.
 *
 * @param {Object} hookInput - Parsed stdin JSON from Claude Code
 * @param {string} agentNameArg - Agent name passed as CLI arg (process.argv[2])
 * @returns {Object|null} Payload object or null if invalid
 */
function buildObserverPayload(hookInput, agentNameArg) {
  try {
    const toolName = hookInput.tool_name || '';
    const sessionId = hookInput.session_id || '';
    // Try: CLI arg → resolve from stdin (agent_type/teammate_name) → session agent map → fallback to hannibal
    const agentName = agentNameArg || resolveAgent(hookInput) || lookupAgent(sessionId) || 'hannibal';
    const hookEventName = hookInput.hook_event_name || '';

    // Map Claude Code hook event names to our event types
    let eventType = '';
    if (hookEventName === 'PreToolUse') {
      eventType = 'pre_tool_use';
    } else if (hookEventName === 'PostToolUse') {
      eventType = 'post_tool_use';
    } else if (hookEventName === 'Stop') {
      eventType = 'stop';
    } else if (hookEventName === 'SubagentStop') {
      eventType = 'subagent_stop';
    } else if (hookEventName === 'SubagentStart') {
      eventType = 'subagent_start';
    } else if (hookEventName) {
      eventType = hookEventName.toLowerCase();
    }

    // If no event type, nothing to log
    if (!eventType) {
      return null;
    }

    // Tool input comes as an object from stdin, not a JSON string
    const toolInput = hookInput.tool_input || {};

    // Generate summary based on event type
    let summary = '';
    let status = 'pending';

    if (eventType === 'pre_tool_use') {
      status = 'pending';
      summary = `${toolName}: ${summarizeToolInput(toolName, toolInput)}`.substring(0, 200).trim();
    } else if (eventType === 'post_tool_use') {
      status = 'success';
      summary = `${toolName}: ${summarizeToolInput(toolName, toolInput)} (completed)`.substring(0, 200).trim();
    } else if (eventType === 'post_tool_use_failure') {
      status = 'failed';
      summary = `${toolName}: ${summarizeToolInput(toolName, toolInput)} (failed)`.substring(0, 200).trim();
    } else if (eventType === 'subagent_start') {
      status = 'started';
      summary = `${agentName} started`;
    } else if (eventType === 'subagent_stop') {
      status = 'completed';
      summary = `${agentName} completed`;
    } else if (eventType === 'stop') {
      status = 'stopped';
      summary = `${agentName} stopped`;
    } else {
      summary = `${eventType}: ${agentName}`;
    }

    // Generate a correlation ID (UUID v4)
    const correlationId = randomUUID();

    // Include session_id in payload for grouping events by agent session
    const payloadData = {};
    if (sessionId) {
      payloadData.session_id = sessionId;
    }
    if (toolName === 'Skill') {
      payloadData.skill_name = toolInput.skill;
      payloadData.args_hash = hashArgs(toolInput.args || '');
    }
    const payload = Object.keys(payloadData).length > 0 ? JSON.stringify(payloadData) : '{}';

    return {
      eventType,
      agentName,
      toolName: toolName || undefined,
      status,
      summary,
      payload,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[observer] buildObserverPayload failed: ${err.message}`);
    return null;
  }
}

/**
 * Sends a hook event payload to the API.
 * Fire-and-forget: catches all errors and returns false on failure.
 *
 * @param {Object} payload - The event payload to send
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function sendObserverEvent(payload) {
  const apiUrl = process.env.ATEAM_API_URL || 'http://localhost:3000';
  const projectId = process.env.ATEAM_PROJECT_ID || 'default';

  // Strip trailing slash from API URL to avoid double slashes
  const cleanUrl = apiUrl.replace(/\/+$/, '');
  const url = `${cleanUrl}/api/hooks/events`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': projectId,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      process.stderr.write(`[observer] POST ${url} → ${response.status}: ${text}\n`);
    }

    return response.ok;
  } catch (err) {
    process.stderr.write(`[observer] POST ${url} failed: ${err.message}\n`);
    return false;
  }
}

export { readHookInput, buildObserverPayload, sendObserverEvent, registerAgent, unregisterAgent, lookupAgent };
