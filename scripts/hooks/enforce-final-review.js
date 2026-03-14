#!/usr/bin/env node
/**
 * enforce-final-review.js - Stop hook for Hannibal
 *
 * Prevents mission from ending without:
 * 1. All items reaching done stage
 * 2. Final Mission Review being completed
 * 3. Post-mission checks passing (via mission_postcheck MCP tool)
 *
 * Queries the A(i)-Team API instead of reading filesystem.
 *
 * Environment variables:
 *   ATEAM_API_URL - Base URL for the A(i)-Team API
 *   ATEAM_PROJECT_ID - Project identifier
 *
 * For testing:
 *   __TEST_MOCK_BOARD__ - JSON string for fake board response
 *   __TEST_MOCK_MISSION__ - JSON string for fake mission response
 *   __TEST_MOCK_NO_MISSION__ - Set to 'true' to simulate no active mission
 */

import { readFileSync } from 'fs';
import { resolveAgent, isKnownAgent } from './lib/resolve-agent.js';

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
    boardData = mockBoard ? JSON.parse(mockBoard) : { columns: {} };
    missionData = mockMission ? JSON.parse(mockMission) : {};
  } else {
    // Query the API
    if (!apiUrl || !projectId) {
      // No API config, allow stop
      process.exit(0);
    }

    // Fetch board state
    const boardUrl = `${apiUrl}/api/projects/${projectId}/board`;
    const boardResp = await fetch(boardUrl, {
      headers: { 'X-Project-ID': projectId },
    });

    if (!boardResp.ok) {
      // No board / API error, allow stop
      process.exit(0);
    }

    boardData = await boardResp.json();

    // Fetch mission state
    const missionUrl = `${apiUrl}/api/projects/${projectId}/missions/current`;
    const missionResp = await fetch(missionUrl, {
      headers: { 'X-Project-ID': projectId },
    });

    if (!missionResp.ok) {
      // No active mission, allow stop
      process.exit(0);
    }

    missionData = await missionResp.json();
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
    const count = items.length;
    if (count > 0) {
      activeCounts[stage] = count;
      totalActive += count;
    }
  }

  const doneItems = columns.done || [];
  const doneCount = doneItems.length;

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

  // If all items done but no final review verdict, block stop
  if (doneCount > 0 && !missionData.final_review_verdict) {
    process.stderr.write('Final Mission Review required.\n');
    process.stderr.write(
      `All ${doneCount} items are done, but Lynch has not completed the final review.\n`
    );
    process.stderr.write(
      'Dispatch Lynch for Final Mission Review before ending.\n'
    );
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
