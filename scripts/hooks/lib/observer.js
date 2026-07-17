#!/usr/bin/env node
/**
 * observer.js - Shared logic for observer hook scripts
 *
 * This module provides functions to build and send hook event payloads
 * to the A(i)-Team API for observability.
 *
 * Claude Code sends hook context via STDIN as JSON, not as env vars. The hook
 * process inherits the launching shell's environment, so anything exported
 * there is on process.env: ATEAM_API_URL, ATEAM_PROJECT_ID, CLAUDE_PLUGIN_ROOT,
 * CLAUDE_PROJECT_DIR, and — when the API is behind Cloudflare Access — the
 * ACCESS_CLIENT_ID / ACCESS_CLIENT_SECRET service-token creds (see
 * apiEventHeaders below).
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync } from 'fs';
import { randomUUID, createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveAgent } from './resolve-agent.js';

const AGENT_MAP_DIR = join(tmpdir(), 'ateam-agent-map');

/**
 * Build the headers for a POST to /api/hooks/events.
 *
 * When the API is fronted by Cloudflare Access (the hosted kanban viewer), the
 * CF-Access service-token headers are REQUIRED — without them CF rejects the
 * request before it reaches the app and the telemetry event is silently
 * dropped. That is exactly what emptied HookEvent / activity / token-usage /
 * tool-histogram / skill-usage for CF-gated missions and left the retro running
 * degraded. The creds are read from the same env vars the ateam CLI uses
 * (packages/ateam-cli/internal/client/client.go), so the observer hooks reach
 * the same gated deployments the CLI already does.
 *
 * Shared by observer.js (sendObserverEvent) and send-denied-event.js so the two
 * sibling POST paths can never drift out of sync.
 *
 * @param {string} projectId
 * @returns {Record<string, string>}
 */
export function apiEventHeaders(projectId) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Project-ID': projectId,
  };
  const accessId = process.env.ACCESS_CLIENT_ID;
  const accessSecret = process.env.ACCESS_CLIENT_SECRET;
  if (accessId && accessSecret) {
    headers['CF-Access-Client-Id'] = accessId;
    headers['CF-Access-Client-Secret'] = accessSecret;
  }
  return headers;
}

/**
 * Path for the best-effort observer failure log (FIX 3). One JSON object per
 * line. Lives under CLAUDE_PROJECT_DIR when available so failures are visible
 * alongside the project, falling back to the OS tmp dir otherwise.
 */
function observerFailureLogPath() {
  const base = process.env.CLAUDE_PROJECT_DIR || tmpdir();
  return join(base, '.ateam-observer-failures.log');
}

/**
 * Appends a one-line structured record describing an observer send failure.
 *
 * This makes silent network failures observable without breaking the
 * fire-and-forget contract: it is fully synchronous, wrapped in try/catch,
 * and never throws back into the caller. It deliberately does NOT await any
 * network/IO that could stall the agent — a local append is the only side
 * effect.
 *
 * @param {Object} record - { url, status, error, agentName, eventType }
 */
function logObserverFailure(record) {
  try {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      url: record.url ?? null,
      status: record.status ?? null,
      error: record.error ?? null,
      agentName: record.agentName ?? null,
      eventType: record.eventType ?? null,
    });
    appendFileSync(observerFailureLogPath(), line + '\n');
  } catch {
    // Never let failure logging break the hook.
  }
}

/**
 * Reads the `id` of the LAST assistant message in a Claude Code JSONL
 * transcript. Used to build a per-turn-stable correlationId for Stop events.
 *
 * Why the last assistant message id:
 *   - It is STABLE across network retries of the same Stop hook firing (the
 *     transcript is identical on retry), so a retry dedups to one row.
 *   - It is DISTINCT across different turns (each turn ends with a new
 *     assistant message id), so legitimate per-turn cumulative Stop events are
 *     NOT collapsed into one row.
 *
 * Returns null if the file is unreadable or no assistant message id is found,
 * in which case the caller falls back to a non-deduping random id.
 *
 * @param {string} transcriptPath - Absolute path to the .jsonl transcript
 * @returns {string|null}
 */
function readLastAssistantMessageId(transcriptPath) {
  if (!transcriptPath) return null;
  let content;
  try {
    content = readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  // Walk from the end to find the most recent assistant message id.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const id = entry?.message?.id;
      if ((entry?.type === 'assistant' || entry?.message?.role === 'assistant') && typeof id === 'string' && id) {
        return id;
      }
    } catch {
      // Skip malformed lines.
    }
  }
  return null;
}

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
  ScheduleWakeup: 'prompt',
};

const SCHEDULE_WAKEUP_PROMPT_MAX = 1000;

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
 * @param {Object} [options] - Optional overrides
 * @param {string} [options.correlationId] - Explicit correlationId (used for
 *   Stop events, where a per-turn-stable id enables retry dedup). When omitted,
 *   a random UUID is generated (matching the previous behavior).
 * @returns {Object|null} Payload object or null if invalid
 */
function buildObserverPayload(hookInput, agentNameArg, options = {}) {
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

    // Correlation ID.
    // For Stop events the caller passes a per-turn-stable id (session_id +
    // last assistant message id) so that network retries of the SAME stop
    // firing dedup to one row, while legitimate per-turn cumulative stops stay
    // distinct. For all other events we keep a fresh UUID (no dedup intended
    // beyond the pre/post tool-use pairing the caller may supply).
    const correlationId = options.correlationId || randomUUID();

    // Include session_id in payload for grouping events by agent session
    const payloadData = {};
    if (sessionId) {
      payloadData.session_id = sessionId;
    }
    if (toolName === 'Skill') {
      payloadData.skill_name = toolInput.skill;
      payloadData.args_hash = hashArgs(toolInput.args ?? '');
    }
    if (toolName === 'ScheduleWakeup') {
      if (typeof toolInput.delaySeconds === 'number') {
        payloadData.delay_seconds = toolInput.delaySeconds;
      }
      if (typeof toolInput.prompt === 'string') {
        payloadData.prompt = toolInput.prompt.length > SCHEDULE_WAKEUP_PROMPT_MAX
          ? toolInput.prompt.slice(0, SCHEDULE_WAKEUP_PROMPT_MAX)
          : toolInput.prompt;
      }
      if (typeof toolInput.reason === 'string') {
        payloadData.reason = toolInput.reason;
      }
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
  const projectId = process.env.ATEAM_PROJECT_ID;

  // No ATEAM_PROJECT_ID → this is not an attributable A(i)-Team session; skip
  // the POST entirely. The old `|| 'default'` fallback meant every Claude
  // session on a machine with the plugin (essay writing, unrelated repos)
  // spammed prod with events tagged project='default'/agent='hannibal' —
  // noise that also camouflaged real attribution failures. Telemetry that
  // can't be attributed is not worth storing. Loudness for mission sessions
  // is provided by observer-preflight.js, not by posting garbage.
  if (!projectId) {
    return false;
  }

  // Strip trailing slash from API URL to avoid double slashes
  const cleanUrl = apiUrl.replace(/\/+$/, '');
  const url = `${cleanUrl}/api/hooks/events`;

  // Bounded like sendTokenUsage: a dead or blackholed endpoint that accepts
  // the connection but never responds would otherwise stall the hook until
  // the harness hook timeout. Telemetry must fail fast, never stall agents.
  const timeoutMs = Number(process.env.ATEAM_OBSERVER_TIMEOUT_MS) || 5000;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: apiEventHeaders(projectId),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      process.stderr.write(`[observer] POST ${url} → ${response.status}: ${text}\n`);
      // FIX 3: record the failure to a local log so dropped token events are
      // observable (stderr alone is invisible once the hook process exits).
      logObserverFailure({
        url,
        status: response.status,
        error: text || null,
        agentName: payload?.agentName,
        eventType: payload?.eventType,
      });
    }

    return response.ok;
  } catch (err) {
    process.stderr.write(`[observer] POST ${url} failed: ${err.message}\n`);
    // FIX 3: a thrown fetch (network error, DNS, CF Access redirect, etc.)
    // drops the event silently — capture it in the local failure log.
    logObserverFailure({
      url,
      status: null,
      error: err.message,
      agentName: payload?.agentName,
      eventType: payload?.eventType,
    });
    return false;
  }
}

/**
 * POSTs per-message token-usage records to /api/hooks/token-usage.
 *
 * Centralized here (like apiEventHeaders) so the two callers — observe-stop.js
 * and observe-subagent.js — can never drift on headers again: the v1.9.0
 * CF-Access fix patched sendObserverEvent but MISSED the two inline token-usage
 * fetches, which kept posting with bare Content-Type/X-Project-ID headers.
 * Behind Cloudflare Access every one of those POSTs got a 302 and was silently
 * swallowed, leaving MessageTokenUsage (and therefore MissionTokenUsage) empty
 * in prod. All observer POSTs go through apiEventHeaders — no exceptions.
 *
 * Fire-and-forget and bounded: never throws, never blocks the hook beyond the
 * timeout. Skips entirely (like sendObserverEvent) when ATEAM_PROJECT_ID is
 * unset — unattributable token rows are noise.
 *
 * @param {Array<Object>} records - Enriched per-message usage records
 * @returns {Promise<boolean>} True when the POST succeeded, false otherwise
 */
async function sendTokenUsage(records) {
  const projectId = process.env.ATEAM_PROJECT_ID;
  if (!projectId || !Array.isArray(records) || records.length === 0) {
    return false;
  }
  const apiUrl = (process.env.ATEAM_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const url = `${apiUrl}/api/hooks/token-usage`;
  // Bounded: if the endpoint accepts the connection but never responds, an
  // unbounded fetch would hang the Stop/SubagentStop hook indefinitely.
  const timeoutMs = Number(process.env.ATEAM_TOKEN_USAGE_TIMEOUT_MS) || 5000;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: apiEventHeaders(projectId),
      body: JSON.stringify(records),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      process.stderr.write(`[observer] POST ${url} → ${response.status}: ${text}\n`);
      logObserverFailure({ url, status: response.status, error: text || null });
      return false;
    }
    return true;
  } catch (error) {
    process.stderr.write(`[observer] POST ${url} failed: ${error?.message ?? error}\n`);
    logObserverFailure({ url, status: null, error: String(error?.message ?? error) });
    return false;
  }
}

export {
  readHookInput,
  buildObserverPayload,
  sendObserverEvent,
  sendTokenUsage,
  registerAgent,
  unregisterAgent,
  lookupAgent,
  readLastAssistantMessageId,
  logObserverFailure,
  observerFailureLogPath,
};
