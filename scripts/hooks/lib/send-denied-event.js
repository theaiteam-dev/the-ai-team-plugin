/**
 * send-denied-event.js - Fire-and-forget utility for recording denied events
 *
 * POSTs a "denied" hook event to the A(i)-Team API for Raw Agent View telemetry.
 * Mirrors the sendObserverEvent() pattern in observer.js.
 *
 * Usage:
 *   import { sendDeniedEvent } from './lib/send-denied-event.js';
 *   sendDeniedEvent({ agentName: agent, toolName, reason: 'descriptive reason' });
 *   process.exit(2);
 */

import { randomUUID } from 'crypto';
import { apiEventHeaders } from './observer.js';

/**
 * POSTs a denied event to the API. Fire-and-forget: does not throw on failure.
 *
 * @param {{ agentName: string, toolName: string, reason: string }} params
 * @returns {Promise<void>}
 */
export async function sendDeniedEvent({ agentName, toolName, reason }) {
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

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      process.stderr.write(`[denied-event] POST ${url} → ${response.status}: ${text}\n`);
    }
  } catch (err) {
    process.stderr.write(`[denied-event] POST ${url} failed: ${err.message}\n`);
  }
}
