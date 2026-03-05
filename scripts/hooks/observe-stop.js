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
import { parseTranscriptUsage } from './lib/parse-transcript.js';

const hookInput = readHookInput();
const agentName = process.argv[2] || undefined;

const payload = buildObserverPayload(hookInput, agentName);
if (payload) {
  // On Stop events, parse transcript for token usage and merge into payload
  const transcriptPath = hookInput.transcript_path;
  let tokenFields = {};
  if (transcriptPath) {
    const tokenUsage = parseTranscriptUsage(transcriptPath);
    tokenFields = {
      ...(tokenUsage.inputTokens !== null && { inputTokens: tokenUsage.inputTokens }),
      ...(tokenUsage.outputTokens !== null && { outputTokens: tokenUsage.outputTokens }),
      ...(tokenUsage.cacheCreationTokens !== null && { cacheCreationTokens: tokenUsage.cacheCreationTokens }),
      ...(tokenUsage.cacheReadTokens !== null && { cacheReadTokens: tokenUsage.cacheReadTokens }),
      ...(tokenUsage.model !== null && { model: tokenUsage.model }),
    };
  }

  await sendObserverEvent({ ...payload, ...tokenFields }).catch(() => {});
}

process.exit(0);
