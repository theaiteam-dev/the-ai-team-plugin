#!/usr/bin/env node
/**
 * enforce-final-review.js - Stop hook for Hannibal
 *
 * Prevents mission from ending without:
 * 1. All items reaching done stage
 * 2. Frankie's evidence bundle existing, fresh, and free of failing (❌) statements
 * 3. Final Mission Review being completed — and not FINAL REJECTED (a
 *    rejection blocks with the ADR 0004 restart-at-Frankie path)
 * 4. Post-mission checks passing (via mission_postcheck MCP tool)
 *
 * Queries the A(i)-Team API instead of reading filesystem.
 *
 * The gate logic and API access live in lib/stop-gates.js, shared with
 * enforce-orchestrator-stop.js — the two hooks must enforce the same rules,
 * and only that hook binds when Hannibal runs in the main session.
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
 *   __TEST_MOCK_NO_MISSION__ - Set to 'true' to simulate no active mission
 */

import { readFileSync } from 'fs';
import { resolveAgent, isKnownAgent } from './lib/resolve-agent.js';
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

// Read hook input from stdin (optional — old callers may not pipe stdin)
let hookInput = {};
try {
  const raw = readFileSync(0, 'utf8');
  if (raw && raw.trim()) {
    hookInput = JSON.parse(raw);
  }
} catch {
  // Can't read stdin — assume main session (Hannibal), continue enforcing
}

// Narrow re-entry guard: Claude Code sets stop_hook_active when the session is
// stopping BECAUSE a Stop hook already blocked once. That matters for exactly
// ONE gate — the staged-not-promoted check, which cannot be satisfied by
// orchestrating harder when the API predates WI-790's promotion transaction or
// the review's verdict parses as 'unknown' (block, resume, block, resume
// forever). Bailing out here at the top instead degraded EVERY gate from
// permanent to one-shot, including the always-satisfiable "items still active"
// gate, letting the second stop end a mission mid-pipeline. The flag is
// therefore carried down to that single gate (kept identical to
// enforce-orchestrator-stop.js, its main-session twin).
const reentryAfterBlock = !!hookInput && hookInput.stop_hook_active === true;

// Only enforce for Hannibal (main session). Known non-hannibal agents pass through.
const resolvedAgent = resolveAgent(hookInput);
if (resolvedAgent !== null && resolvedAgent !== 'hannibal') {
  process.exit(0);
}

const apiUrl = process.env.ATEAM_API_URL || '';
const projectId = process.env.ATEAM_PROJECT_ID || '';
const mockBoard = process.env.__TEST_MOCK_BOARD__;
const mockMission = process.env.__TEST_MOCK_MISSION__;
const mockNoMission = process.env.__TEST_MOCK_NO_MISSION__;

async function checkFinalReview() {
  // Simulate no active mission
  if (mockNoMission === 'true') {
    process.exit(0);
  }

  let boardData;
  let missionData;

  if (mockBoard !== undefined || mockMission !== undefined) {
    // Use test mocks
    boardData = normalizeBoard(mockBoard ? JSON.parse(mockBoard) : { columns: {} });
    missionData = normalizeMission(mockMission ? JSON.parse(mockMission) : {}) || {};
  } else {
    // Query the API
    if (!apiUrl || !projectId) {
      // No API config, allow stop
      process.exit(0);
    }

    boardData = await fetchBoard(apiUrl, projectId);
    if (!boardData) {
      // No board / API error, allow stop
      process.exit(0);
    }

    missionData = await fetchMission(apiUrl, projectId);
    if (!missionData) {
      // No active mission, allow stop
      process.exit(0);
    }
  }

  const { activeCounts, totalActive, doneCount, stagedCount } = countBoard(boardData.columns);

  // If items are still active, block stop
  if (totalActive > 0) {
    const summary = Object.entries(activeCounts)
      .map(([stage, count]) => `${stage}: ${count}`)
      .join(', ');

    process.stderr.write(
      `Mission incomplete. ${totalActive} items still in progress (not done).\n`
    );
    process.stderr.write(`Status: ${summary}\n`);
    process.stderr.write(`Done: ${doneCount}\n`);
    process.exit(2);
  }

  // Frankie's mission-tail walk precedes Stockwell's Final Mission Review —
  // on a repo with a drivable surface, block until his evidence bundle
  // exists on disk (only reached once totalActive === 0, i.e. every item is
  // genuinely done — the check above already exited otherwise). Repos with
  // no drivable surface are exempt. This gate uses the JSON decision-block
  // format (never a nonzero exit code) — distinct from the pre-existing
  // exit(2) gates below, which are untouched.
  //
  // The gate itself lives in lib/stop-gates.js so enforce-orchestrator-stop.js
  // enforces exactly the same condition — that hook is the one that binds in
  // the primary execution mode, where Hannibal runs in the main session.
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
  // empty (no-mission) board and allowed to stop. Uses the same exit(2)+
  // stderr mechanism as the other pre-existing gates below (this is NOT the
  // Frankie-specific JSON-decision sub-check, so ATEAM_SKIP_FRANKIE_GATE
  // must not suppress it).
  //
  // This is the one gate the stop_hook_active re-entry guard releases — the
  // only one that can be genuinely unsatisfiable. Reaching it already implies
  // totalActive === 0, so releasing it can never end a mission with items
  // still mid-pipeline.
  const stagedBlock = checkStagedNotPromoted(stagedCount, {
    finalReview: missionData.final_review_verdict,
  });
  if (stagedBlock && !reentryAfterBlock) {
    process.stderr.write(`${stagedBlock}\n`);
    process.exit(2);
  }

  // If all items done but no final review verdict, block stop
  if (doneCount > 0 && !missionData.final_review_verdict) {
    process.stderr.write('Final Mission Review required.\n');
    process.stderr.write(
      `All ${doneCount} items are done, but Stockwell has not completed the final review.\n`
    );
    process.stderr.write(
      'Dispatch Stockwell for Final Mission Review before ending.\n'
    );
    process.exit(2);
  }

  // An explicit FINAL REJECTED verdict is a completed review, but it must not
  // fall through to the post-check gate ("run postcheck" would misdirect).
  // Block with the ADR 0004 restart-at-Frankie path instead. Reviews with no
  // recognizable verdict marker fall through unchanged (fail open).
  const rejectionBlock = checkFinalReviewRejection(missionData.final_review_verdict);
  if (rejectionBlock) {
    process.stderr.write(`${rejectionBlock}\n`);
    process.exit(2);
  }

  // If final review done but post-checks not run/passed, block stop
  if (missionData.final_review_verdict) {
    const postcheck = missionData.postcheck;
    if (!postcheck || !postcheck.passed) {
      process.stderr.write('Post-mission checks required.\n');
      process.stderr.write(
        'Final review is complete, but post-checks have not passed.\n'
      );
      process.stderr.write('\n');
      process.stderr.write(
        'Run ateam missions postcheck to verify lint, tests, and e2e all pass.\n'
      );
      process.exit(2);
    }
  }

  // Mission complete with final review and passing post-checks - allow stop
  process.exit(0);
}

checkFinalReview().catch(() => {
  // On any error (API unreachable, etc.), allow stop
  process.exit(0);
});
