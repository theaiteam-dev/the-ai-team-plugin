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
 *
 * The gate logic and API access live in lib/stop-gates.js, shared with
 * enforce-final-review.js so the two hooks cannot drift apart. This is the
 * hook that binds in the primary execution mode (Hannibal runs in the main
 * session); enforce-final-review.js only binds for subagent sessions.
 *
 * Environment variables:
 *   ATEAM_API_URL - Base URL for the A(i)-Team API
 *   ATEAM_PROJECT_ID - Project identifier
 *   ATEAM_SKIP_FRANKIE_GATE - Set to 1 to override the Frankie evidence gate
 *
 * For testing:
 *   __TEST_MOCK_BOARD__ - JSON string for fake board response
 *   __TEST_MOCK_MISSION__ - JSON string for fake mission response
 */

import { readHookInput, lookupAgent } from './lib/observer.js';
import { resolveAgent, isKnownAgent } from './lib/resolve-agent.js';
import { isMissionActive } from './lib/mission-active.js';
import {
  fetchBoard,
  fetchMission,
  normalizeBoard,
  normalizeMission,
  countBoard,
  checkFrankieEvidence,
} from './lib/stop-gates.js';

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
const mockMission = process.env.__TEST_MOCK_MISSION__;

// No API config and no mock = no active mission to enforce
if (!mockBoard && (!apiUrl || !projectId)) {
  console.log(JSON.stringify({}));
  process.exit(0);
}

async function checkCompletion() {
  let boardData;

  if (mockBoard !== undefined) {
    boardData = normalizeBoard(JSON.parse(mockBoard));
  } else {
    boardData = await fetchBoard(apiUrl, projectId);

    if (!boardData) {
      // API error — allow stop (don't trap the user)
      console.log(JSON.stringify({}));
      process.exit(0);
    }
  }

  const { activeCounts, totalActive, doneCount } = countBoard(boardData.columns);

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

  // All items done — check Frankie's walk, then final review and post-checks
  let missionData;

  if (mockMission !== undefined) {
    missionData = normalizeMission(JSON.parse(mockMission));
  } else {
    missionData = await fetchMission(apiUrl, projectId);
  }

  if (!missionData) {
    // No active mission — allow stop
    console.log(JSON.stringify({}));
    process.exit(0);
  }

  // Frankie's mission-tail walk precedes Stockwell's Final Mission Review —
  // same gate enforce-final-review.js applies, shared via lib/stop-gates.js.
  const frankieBlock = checkFrankieEvidence({
    missionId: missionData.id,
    doneCount,
  });
  if (frankieBlock) {
    console.log(JSON.stringify({ decision: 'block', additionalContext: frankieBlock }));
    process.exit(0);
  }

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
