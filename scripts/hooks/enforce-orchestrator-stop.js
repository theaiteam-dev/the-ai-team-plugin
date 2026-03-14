#!/usr/bin/env node
/**
 * enforce-orchestrator-stop.js - Plugin-level Stop enforcement
 *
 * Prevents the main session (Hannibal) from ending without completing
 * the mission: all items done, final review passed, post-checks passed.
 *
 * Same agent detection as enforce-orchestrator-boundary.js: only enforces
 * for the main session, not for worker subagent sessions (which have their
 * own Stop hooks via frontmatter).
 *
 * Mission-active guard: Only enforces when a mission is running (marker file
 * exists). Without a mission, the main session is a normal user session,
 * not Hannibal. This prevents blocking normal session stops.
 *
 * Stop hooks use JSON stdout format:
 *   { "decision": "block", "additionalContext": "..." } - block stop
 *   {} - allow stop
 */

import { readHookInput, lookupAgent } from './lib/observer.js';
import { resolveAgent, isKnownAgent } from './lib/resolve-agent.js';
import { isMissionActive } from './lib/mission-active.js';

const hookInput = readHookInput();

// --- Agent Detection ---

// Use resolveAgent() for robust agent identification (handles ai-team: prefix, casing)
const resolvedAgent = resolveAgent(hookInput);

// Any known non-hannibal agent: their frontmatter Stop hooks handle enforcement
if (resolvedAgent !== null && resolvedAgent !== 'hannibal') {
  console.log(JSON.stringify({}));
  process.exit(0);
}

// Unknown system agents (Explore, Plan, etc.): pass through
if (resolvedAgent !== null && !isKnownAgent(resolvedAgent)) {
  console.log(JSON.stringify({}));
  process.exit(0);
}

// Check agent map: if a worker is active, this isn't Hannibal's stop
const sessionId = hookInput.session_id || '';
const mappedAgent = lookupAgent(sessionId);

if (mappedAgent && mappedAgent !== 'hannibal') {
  console.log(JSON.stringify({}));
  process.exit(0);
}

// --- Mission-Active Guard ---
// No active mission → this is a normal Claude session, not Hannibal.
// Allow stop without enforcement.
if (!isMissionActive()) {
  console.log(JSON.stringify({}));
  process.exit(0);
}

// --- Main session (Hannibal) enforcement ---

const apiUrl = process.env.ATEAM_API_URL || '';
const projectId = process.env.ATEAM_PROJECT_ID || '';
const mockBoard = process.env.__TEST_MOCK_BOARD__;

// No API config and no mock = no active mission to enforce
if (!mockBoard && (!apiUrl || !projectId)) {
  console.log(JSON.stringify({}));
  process.exit(0);
}

async function checkCompletion() {
  let boardData;

  if (mockBoard !== undefined) {
    boardData = JSON.parse(mockBoard);
  } else {
    // Fetch board state
    const boardResp = await fetch(
      `${apiUrl.replace(/\/+$/, '')}/api/projects/${projectId}/board`,
      { headers: { 'X-Project-ID': projectId } }
    );

    if (!boardResp.ok) {
      // API error — allow stop (don't trap the user)
      console.log(JSON.stringify({}));
      process.exit(0);
    }

    boardData = await boardResp.json();
  }

  const columns = boardData.columns || {};

  // Check for items still in active stages
  const activeStages = [
    'briefings',
    'ready',
    'testing',
    'implementing',
    'review',
    'probing',
    'blocked',
  ];
  const activeCounts = {};
  let totalActive = 0;

  for (const stage of activeStages) {
    const items = columns[stage] || [];
    if (items.length > 0) {
      activeCounts[stage] = items.length;
      totalActive += items.length;
    }
  }

  const doneCount = (columns.done || []).length;

  // No items at all — no mission, allow stop
  if (totalActive === 0 && doneCount === 0) {
    console.log(JSON.stringify({}));
    process.exit(0);
  }

  // Items still active — block stop
  if (totalActive > 0) {
    const summary = Object.entries(activeCounts)
      .map(([s, c]) => `${s}: ${c}`)
      .join(', ');

    console.log(
      JSON.stringify({
        decision: 'block',
        additionalContext: `Mission incomplete. ${totalActive} items still active (${summary}). Done: ${doneCount}. Continue orchestrating.`,
      })
    );
    process.exit(0);
  }

  // All items done — check final review and post-checks
  const missionResp = await fetch(
    `${apiUrl.replace(/\/+$/, '')}/api/projects/${projectId}/missions/current`,
    { headers: { 'X-Project-ID': projectId } }
  );

  if (!missionResp.ok) {
    // No active mission — allow stop
    console.log(JSON.stringify({}));
    process.exit(0);
  }

  const missionData = await missionResp.json();

  if (doneCount > 0 && !missionData.final_review_verdict) {
    console.log(
      JSON.stringify({
        decision: 'block',
        additionalContext: `All ${doneCount} items are done but Lynch has not completed the Final Mission Review. Dispatch Lynch for final review.`,
      })
    );
    process.exit(0);
  }

  if (
    missionData.final_review_verdict &&
    (!missionData.postcheck || !missionData.postcheck.passed)
  ) {
    console.log(
      JSON.stringify({
        decision: 'block',
        additionalContext:
          'Final review is complete but post-checks have not passed. Run ateam missions postcheck.',
      })
    );
    process.exit(0);
  }

  // Mission complete — allow stop
  console.log(JSON.stringify({}));
  process.exit(0);
}

checkCompletion().catch(() => {
  // On any error (API unreachable, etc.), allow stop
  console.log(JSON.stringify({}));
  process.exit(0);
});
