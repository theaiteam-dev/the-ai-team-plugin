#!/usr/bin/env node
/**
 * observe-stop.js - Stop hook for observing agent session ends
 *
 * Logs agent session completions to the API for observability.
 * This is a fire-and-forget observer - it must never block agents.
 *
 * Claude Code sends hook context via stdin JSON, not env vars.
 * Agent name is passed as CLI arg (process.argv[2]) from frontmatter hooks.
 */

import { readHookInput, buildObserverPayload, sendObserverEvent, readLastAssistantMessageId } from './lib/observer.js';
import { parseTranscriptUsage, parseAdvanceFlagUsage, parseAgentStopItemId } from './lib/parse-transcript.js';

const hookInput = readHookInput();
const agentName = process.argv[2] || undefined;

// Build a per-turn-stable correlationId for Stop events so retries of the SAME
// stop firing dedup to a single row, while distinct per-turn cumulative stops
// remain separate rows. Composition: `${session_id}:${lastAssistantMessageId}`.
//   - session_id scopes the id to this session (avoids cross-session collisions
//     on the globally-but-not-guaranteed-unique message id).
//   - lastAssistantMessageId is identical on retry (same transcript) but
//     changes every turn (each turn ends with a new assistant message id).
// Fallback when no assistant message id is available: omit the correlationId
// (the route then always stores the event — no dedup, but no data loss either).
const sessionId = hookInput.session_id || '';
const lastAssistantMessageId = readLastAssistantMessageId(hookInput.transcript_path);
const stopCorrelationId = lastAssistantMessageId
  ? (sessionId ? `${sessionId}:${lastAssistantMessageId}` : lastAssistantMessageId)
  : undefined;

const payload = buildObserverPayload(hookInput, agentName, { correlationId: stopCorrelationId });
if (payload) {
  const transcriptPath = hookInput.transcript_path;
  let tokenFields = {};
  let advanceFields = {};
  let handoffStopPromise;
  let tokenUsagePromise;

  if (transcriptPath) {
    // parseTranscriptUsage now returns an array of per-message records (WI-170).
    const perMessageRecords = parseTranscriptUsage(transcriptPath);

    if (perMessageRecords.length > 0) {
      // POST per-message records to /api/hooks/token-usage (fire-and-forget).
      const apiUrl = (process.env.ATEAM_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const projectId = process.env.ATEAM_PROJECT_ID || 'default';
      const timestamp = new Date().toISOString();
      const enrichedRecords = perMessageRecords.map((r) => ({
        ...r,
        agentName: agentName || 'unknown',
        timestamp,
      }));
      tokenUsagePromise = fetch(`${apiUrl}/api/hooks/token-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-ID': projectId },
        body: JSON.stringify(enrichedRecords),
      }).catch(() => {});

      // Sum array back to scalars for the legacy /api/hooks/events stop payload.
      const tokenSum = perMessageRecords.reduce(
        (acc, r) => ({
          inputTokens: acc.inputTokens + r.inputTokens,
          outputTokens: acc.outputTokens + r.outputTokens,
          cacheCreationTokens: acc.cacheCreationTokens + r.cacheCreationTokens,
          cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
        }),
        { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
      );
      const representativeModel = perMessageRecords[perMessageRecords.length - 1].model;
      tokenFields = {
        inputTokens: tokenSum.inputTokens,
        outputTokens: tokenSum.outputTokens,
        cacheCreationTokens: tokenSum.cacheCreationTokens,
        cacheReadTokens: tokenSum.cacheReadTokens,
        ...(representativeModel && { model: representativeModel }),
      };
    }

    const { advanceFlagUsed } = parseAdvanceFlagUsage(transcriptPath);
    advanceFields = advanceFlagUsed !== null ? { advanceFlagUsed } : {};

    const { itemId } = parseAgentStopItemId(transcriptPath);
    if (itemId) {
      handoffStopPromise = sendObserverEvent({
        eventType: 'handoff-stop',
        agentName,
        itemId,
        timestampMs: Date.now(),
      }).catch(() => {});
    }
  }

  await Promise.all([
    sendObserverEvent({ ...payload, ...tokenFields, ...advanceFields }).catch(() => {}),
    handoffStopPromise,
    tokenUsagePromise,
  ]);
}

process.exit(0);
