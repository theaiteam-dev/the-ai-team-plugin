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

import { readHookInput, buildObserverPayload, sendObserverEvent } from './lib/observer.js';
import { parseTranscriptUsage, parseAdvanceFlagUsage, parseAgentStopItemId } from './lib/parse-transcript.js';

const hookInput = readHookInput();
const agentName = process.argv[2] || undefined;

const payload = buildObserverPayload(hookInput, agentName);
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
