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
 *   ATEAM_SKIP_PROMOTION_GATE - Set to 1 to override the staged-not-promoted gate
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
  checkStagedNotPromoted,
  checkFinalReviewRejection,
} from './lib/stop-gates.js';

const hookInput = readHookInput();

// --- Re-entry Guard (narrow) ---
// Claude Code sets stop_hook_active when the session is stopping BECAUSE a
// Stop hook already blocked once. That matters for exactly ONE gate: the
// staged-not-promoted check, which CANNOT be satisfied by orchestrating
// harder when the API predates WI-790's promotion transaction or the review's
// verdict parses as 'unknown' — block, resume, block, resume forever.
//
// It is NOT a blanket bypass. Bailing out here at the top degraded every gate
// from permanent to one-shot — most damagingly the always-satisfiable
// "totalActive > 0 → continue orchestrating" gate, which would then let the
// SECOND stop end a mission with items still mid-pipeline. So the flag is
// carried down to the one gate it belongs to (see checkStagedNotPromoted
// below); everything else — active items, Frankie's evidence, the missing
// final review, an explicit rejection, post-checks — keeps enforcing.
const reentryAfterBlock = !!hookInput && hookInput.stop_hook_active === true;

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

  const { activeCounts, totalActive, doneCount, stagedCount } = countBoard(boardData.columns);

  // No items at all — no mission, allow stop. WI-791: a board with only
  // staged items must NOT take this path (it must proceed to the
  // Frankie-evidence / not-yet-promoted gates below), so stagedCount is
  // part of the "genuinely empty" test.
  if (totalActive === 0 && doneCount === 0 && stagedCount === 0) {
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
  // WI-791: keyed on stagedCount/stagedItems — items sit in staged awaiting
  // the walk, not done (done now only happens via WI-790's atomic promotion).
  const frankieBlock = checkFrankieEvidence({
    missionId: missionData.id,
    stagedCount,
    stagedItems: boardData.columns.staged,
  });
  if (frankieBlock) {
    console.log(JSON.stringify({ decision: 'block', additionalContext: frankieBlock }));
    process.exit(0);
  }

  // WI-791 AC2: Frankie's evidence clearing does not mean promotion has run
  // — that only happens via WI-790's atomic transaction when Stockwell's
  // review is written. An all-staged board must never be treated as an
  // empty (no-mission) board and allowed to stop.
  //
  // This is the one gate the stop_hook_active re-entry guard releases: it is
  // the only one that can be genuinely unsatisfiable (see the guard's comment
  // at the top of this file). Reaching it already implies totalActive === 0,
  // so releasing it can never end a mission with items mid-pipeline.
  const stagedBlock = checkStagedNotPromoted(stagedCount, {
    finalReview: missionData.final_review_verdict,
  });
  if (stagedBlock && !reentryAfterBlock) {
    console.log(JSON.stringify({ decision: 'block', additionalContext: stagedBlock }));
    process.exit(0);
  }

  if (doneCount > 0 && !missionData.final_review_verdict) {
    console.log(
      JSON.stringify({
        decision: 'block',
        additionalContext: `All ${doneCount} items are done but Stockwell has not completed the Final Mission Review. Dispatch Stockwell for final review.`,
      })
    );
    process.exit(0);
  }

  // An explicit FINAL REJECTED verdict is a completed review, but it must not
  // fall through to the post-check gate ("run postcheck" would misdirect).
  // Block with the ADR 0004 restart-at-Frankie path instead. Reviews with no
  // recognizable verdict marker fall through unchanged (fail open).
  const rejectionBlock = checkFinalReviewRejection(missionData.final_review_verdict);
  if (rejectionBlock) {
    console.log(JSON.stringify({ decision: 'block', additionalContext: rejectionBlock }));
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
