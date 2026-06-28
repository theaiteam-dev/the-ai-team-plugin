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
  // On Stop events, parse transcript for token usage and advance flag, then merge into payload
  const transcriptPath = hookInput.transcript_path;
  let tokenFields = {};
  let advanceFields = {};
  let handoffStopPromise;
  if (transcriptPath) {
    const tokenUsage = parseTranscriptUsage(transcriptPath);
    tokenFields = {
      ...(tokenUsage.inputTokens !== null && { inputTokens: tokenUsage.inputTokens }),
      ...(tokenUsage.outputTokens !== null && { outputTokens: tokenUsage.outputTokens }),
      ...(tokenUsage.cacheCreationTokens !== null && { cacheCreationTokens: tokenUsage.cacheCreationTokens }),
      ...(tokenUsage.cacheReadTokens !== null && { cacheReadTokens: tokenUsage.cacheReadTokens }),
      ...(tokenUsage.model !== null && { model: tokenUsage.model }),
    };

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
  ]);
}

process.exit(0);
