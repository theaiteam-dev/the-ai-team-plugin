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

import { readHookInput, buildObserverPayload, sendObserverEvent, sendTokenUsage, readLastAssistantMessageId } from './lib/observer.js';
import { parseTranscriptUsage, parseAdvanceFlagUsage, parseAgentStopItemId, dominantModel } from './lib/parse-transcript.js';

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
      const timestamp = new Date().toISOString();
      // Attribute per-message rows with the SAME resolved identity as the
      // legacy events/histogram path (payload.agentName), not the raw CLI arg.
      // For the main orchestrator session `agentName` (process.argv[2]) is empty
      // — it fires the generic hooks.json Stop hook, not its frontmatter hook —
      // so a bare `agentName || 'unknown'` mislabels Hannibal's tokens as
      // 'unknown'. buildObserverPayload already ran the full resolve chain
      // (CLI arg → resolveAgent(stdin) → session map → 'hannibal').
      const enrichedRecords = perMessageRecords.map((r) => ({
        ...r,
        agentName: payload.agentName,
        timestamp,
      }));
      // Centralized in lib/observer.js so this POST can never again drift from
      // the events path on headers (the v1.9.0 CF-Access fix missed this call
      // site and prod token telemetry silently 302'd for a month). Bounded and
      // fire-and-forget inside sendTokenUsage.
      tokenUsagePromise = sendTokenUsage(enrichedRecords).catch(() => {});

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
      // Approximate model for the collapsed legacy scalar: the one driving the
      // most tokens, not just the last message's (per-message rows stay exact).
      const representativeModel = dominantModel(perMessageRecords);
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
      const nowMs = Date.now();
      // Route-conformant shape — see observe-pre-tool-use.js handoff-start.
      // Uses the RESOLVED payload.agentName, not the raw CLI arg: in the main
      // orchestrator session argv[2] is empty (generic hooks.json Stop hook),
      // and the API rejects agentName-less events with a 400 — every
      // handoff-stop in M-20260819-001 was silently dropped this way.
      handoffStopPromise = sendObserverEvent({
        eventType: 'handoff-stop',
        agentName: payload.agentName,
        status: 'completed',
        summary: `handoff-stop: ${itemId}`,
        payload: JSON.stringify({ itemId, timestampMs: nowMs }),
        timestamp: new Date(nowMs).toISOString(),
        itemId,
        timestampMs: nowMs,
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
