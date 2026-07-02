#!/usr/bin/env node
/**
 * observe-subagent.js - Observer hook for SubagentStart and SubagentStop events.
 *
 * These events fire in the MAIN session when a subagent is spawned or completes.
 * SubagentStart contains agent_type (e.g., "murdock") which lets us identify
 * which A(i)-Team agent is starting.
 *
 * On SubagentStart: registers agent name in a temp file keyed by session_id,
 * so PreToolUse/PostToolUse hooks can look up which agent is active.
 *
 * On SubagentStop: registers "hannibal" (control returns to main session).
 */

import { readHookInput, sendObserverEvent, registerAgent, lookupAgent } from './lib/observer.js';
import { parseTranscriptUsage, dominantModel } from './lib/parse-transcript.js';

try {
  const hookInput = readHookInput();
  const hookEventName = hookInput.hook_event_name || '';
  const agentId = hookInput.agent_id || '';
  const agentType = hookInput.agent_type || '';
  const sessionId = hookInput.session_id || '';

  // Extract agent name from agent_type (e.g., "ai-team:murdock" → "murdock")
  let agentName = 'unknown';
  if (agentType.startsWith('ai-team:')) {
    agentName = agentType.split(':')[1];
  } else if (agentType) {
    agentName = agentType;
  }

  let eventType = '';
  let status = '';
  let summary = '';

  if (hookEventName === 'SubagentStart') {
    eventType = 'subagent_start';
    status = 'started';
    summary = `${agentName} started (${agentType})`;
    // Register this agent so tool call hooks can look it up
    if (sessionId && agentName !== 'unknown') {
      registerAgent(sessionId, agentName);
    }
  } else if (hookEventName === 'SubagentStop') {
    eventType = 'subagent_stop';
    status = 'completed';
    // SubagentStop may not have agent_type — look up from registry
    if (agentName === 'unknown' && sessionId) {
      agentName = lookupAgent(sessionId) || 'unknown';
    }
    summary = `${agentName} completed (${agentType || agentName})`;
    // After subagent stops, control returns to Hannibal (main session).
    // Register "hannibal" instead of deleting — this ensures Hannibal's
    // orchestration tool calls (board_move, etc.) get attributed correctly.
    if (sessionId) {
      registerAgent(sessionId, 'hannibal');
    }
  } else {
    process.exit(0);
  }

  const payload = JSON.stringify({
    session_id: sessionId || undefined,
    agent_id: agentId || undefined,
    agent_type: agentType || undefined,
  });

  // On SubagentStop, parse token usage from transcript if available.
  let tokenFields = {};
  let tokenUsagePromise;
  if (hookEventName === 'SubagentStop') {
    const transcriptPath = hookInput.agent_transcript_path;
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
          agentName,
          timestamp,
        }));
        // Bounded: this is a best-effort fetch awaited in Promise.all below. If the
        // endpoint accepts the connection but never responds, an unbounded fetch
        // would hang the SubagentStop hook indefinitely. Abort after a short
        // timeout so token attribution can never block the agent.
        const tokenUsageTimeoutMs = Number(process.env.ATEAM_TOKEN_USAGE_TIMEOUT_MS) || 5000;
        tokenUsagePromise = fetch(`${apiUrl}/api/hooks/token-usage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Project-ID': projectId },
          body: JSON.stringify(enrichedRecords),
          signal: AbortSignal.timeout(tokenUsageTimeoutMs),
        }).catch(() => {});

        // Sum array back to scalars for the legacy /api/hooks/events subagent_stop payload.
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
    }
  }

  await Promise.all([
    sendObserverEvent({
      eventType,
      agentName,
      status,
      summary,
      payload,
      correlationId: agentId || undefined,
      timestamp: new Date().toISOString(),
      ...tokenFields,
    }).catch(() => {}),
    tokenUsagePromise,
  ]);
} catch {
  // Fire-and-forget: never block the agent
}

process.exit(0);
