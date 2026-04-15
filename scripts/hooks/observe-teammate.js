#!/usr/bin/env node
/**
 * observe-teammate.js - Observer hook for TeammateIdle and TaskCompleted events.
 *
 * These events fire in the LEAD session when a native-teams teammate goes idle
 * or completes a task. They contain teammate_name and team_name.
 *
 * stdin JSON for TeammateIdle:
 *   { session_id, hook_event_name: "TeammateIdle", teammate_name, team_name, ... }
 *
 * stdin JSON for TaskCompleted:
 *   { session_id, hook_event_name: "TaskCompleted", task_id, task_subject, teammate_name, team_name, ... }
 */

import { readHookInput, sendObserverEvent, registerAgent } from './lib/observer.js';

try {
  const hookInput = readHookInput();
  const hookEventName = hookInput.hook_event_name || '';
  const teammateName = hookInput.teammate_name || 'unknown';
  const teamName = hookInput.team_name || '';
  const sessionId = hookInput.session_id || '';

  let eventType = '';
  let status = '';
  let summary = '';

  if (hookEventName === 'TeammateIdle') {
    // Register teammate session so PreToolUse/PostToolUse hooks can attribute
    // tool calls to the correct agent via lookupAgent(sessionId)
    if (sessionId && teammateName !== 'unknown') {
      registerAgent(sessionId, teammateName);
    }
    eventType = 'teammate_idle';
    status = 'idle';
    summary = `${teammateName} went idle`;
  } else if (hookEventName === 'TaskCompleted') {
    eventType = 'task_completed';
    status = 'completed';
    const taskSubject = hookInput.task_subject || '';
    summary = `${teammateName} completed: ${taskSubject}`.substring(0, 200).trim();
  } else {
    process.exit(0);
  }

  const payload = JSON.stringify({
    session_id: sessionId || undefined,
    teammate_name: teammateName,
    team_name: teamName || undefined,
    task_id: hookInput.task_id || undefined,
    task_subject: hookInput.task_subject || undefined,
  });

  await sendObserverEvent({
    eventType,
    agentName: teammateName,
    status,
    summary,
    payload,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
} catch {
  // Fire-and-forget: never block the agent
}

process.exit(0);
