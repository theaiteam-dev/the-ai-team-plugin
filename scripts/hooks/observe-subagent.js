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
import { parseTranscriptUsage } from './lib/parse-transcript.js';

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

  // On SubagentStop, parse token usage from transcript if available
  let tokenFields = {};
  if (hookEventName === 'SubagentStop') {
    const transcriptPath = hookInput.agent_transcript_path;
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
  }

  await sendObserverEvent({
    eventType,
    agentName,
    status,
    summary,
    payload,
    correlationId: agentId || undefined,
    timestamp: new Date().toISOString(),
    ...tokenFields,
  }).catch(() => {});
} catch {
  // Fire-and-forget: never block the agent
}

process.exit(0);
