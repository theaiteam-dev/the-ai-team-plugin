/**
 * send-denied-event.js - Utility for recording denied events
 *
 * POSTs a "denied" hook event to the A(i)-Team API for Raw Agent View telemetry.
 * Mirrors the sendObserverEvent() pattern in observer.js.
 *
 * Usage (preferred — denial telemetry actually reaches the API):
 *   import { denyAndExit } from './lib/send-denied-event.js';
 *   await denyAndExit(
 *     { agentName: agent, toolName, reason: 'descriptive reason' },
 *     'BLOCKED: ...\nguidance line\n'
 *   );
 *
 * `sendDeniedEvent()` on its own is fire-and-forget: calling it and then
 * immediately calling process.exit() tears the process down before the POST's
 * socket work ever runs, so the event is silently lost. Hooks must therefore
 * use denyAndExit(), which awaits the POST (bounded by a short timeout) before
 * exiting.
 */

import { randomUUID } from 'crypto';
import { apiEventHeaders } from './observer.js';

/**
 * POSTs a denied event to the API. Fire-and-forget: does not throw on failure.
 *
 * @param {{ agentName: string, toolName: string, reason: string }} params
 * @param {{ quiet?: boolean }} [options] quiet suppresses the transport
 *   diagnostics on stderr. denyAndExit() sets it because that stderr is the
 *   BLOCKED message the agent reads — a telemetry transport failure must not
 *   append noise to the guidance it acts on.
 * @returns {Promise<void>}
 */
export async function sendDeniedEvent({ agentName, toolName, reason }, options = {}) {
  const { quiet = false } = options;
  const apiUrl = process.env.ATEAM_API_URL || 'http://localhost:3000';
  const projectId = process.env.ATEAM_PROJECT_ID;

  // Unattributable session (no ATEAM_PROJECT_ID) → skip, matching
  // sendObserverEvent. Posting as project 'default' is noise.
  if (!projectId) {
    return;
  }

  // Strip trailing slash from API URL to avoid double slashes
  const cleanUrl = apiUrl.replace(/\/+$/, '');
  const url = `${cleanUrl}/api/hooks/events`;

  const payload = {
    eventType: 'pre_tool_use',
    agentName,
    toolName,
    status: 'denied',
    summary: reason,
    correlationId: randomUUID(),
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: apiEventHeaders(projectId),
      body: JSON.stringify(payload),
    });

    if (!response.ok && !quiet) {
      const text = await response.text().catch(() => '');
      process.stderr.write(`[denied-event] POST ${url} → ${response.status}: ${text}\n`);
    }
  } catch (err) {
    if (!quiet) {
      process.stderr.write(`[denied-event] POST ${url} failed: ${err.message}\n`);
    }
  }
}

/**
 * How long denyAndExit() waits for the denial POST before giving up and
 * exiting anyway. A hook must never stall a tool call on unreachable
 * telemetry, so the flush is bounded — telemetry is best-effort, the DENIAL
 * itself is not.
 */
const DEFAULT_FLUSH_TIMEOUT_MS = 500;

/**
 * Awaits sendDeniedEvent(), but never for longer than timeoutMs. Resolves
 * (never rejects) either way, so a caller can always proceed to exit.
 *
 * @param {{ agentName: string, toolName: string, reason: string }} event
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export async function flushDeniedEvent(event, timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS) {
  let timer;
  try {
    await Promise.race([
      sendDeniedEvent(event, { quiet: true }),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // sendDeniedEvent() swallows its own failures; this is belt-and-braces so
    // a telemetry problem can never turn into an unhandled rejection that
    // changes the hook's exit code.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Records the denial, emits the agent-facing message, then exits.
 *
 * The message is written BEFORE the flush await so the stdio write has the
 * whole flush window to drain (process.stdout/stderr writes to a pipe are
 * asynchronous, and process.exit() does not wait for them).
 *
 * @param {{ agentName: string, toolName: string, reason: string }} event
 * @param {string} [message] text written verbatim to the chosen stream
 * @param {{ exitCode?: number, stream?: 'stderr'|'stdout', timeoutMs?: number }} [options]
 * @returns {Promise<never>}
 */
export async function denyAndExit(event, message = '', options = {}) {
  const { exitCode = 2, stream = 'stderr', timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS } = options;
  if (message) {
    if (stream === 'stdout') {
      process.stdout.write(message);
    } else {
      process.stderr.write(message);
    }
  }
  await flushDeniedEvent(event, timeoutMs);
  process.exit(exitCode);
}
