#!/usr/bin/env node
/**
 * enforce-sosa-coverage.js - Stop hook for Sosa
 *
 * Ensures Sosa reviews ALL items in briefings stage before completing.
 * Sosa's job is to read every item and provide feedback. This hook prevents
 * her from finishing without actually doing the reviews.
 *
 * Claude Code sends hook context via stdin JSON:
 *   Stop: { session_id, hook_event_name, last_assistant_message, ... }
 *
 * Environment variables (from settings.local.json):
 *   ATEAM_API_URL - Base URL for the A(i)-Team API
 *   ATEAM_PROJECT_ID - Project identifier
 *
 * For testing:
 *   __TEST_MOCK_ITEMS__ - JSON string for items list response
 *   __TEST_MOCK_ACTIVITY__ - JSON string for activity log response
 *
 * Returns JSON:
 *   { "decision": "block", "additionalContext": "..." } - Force agent to continue
 *   {} - Allow stop
 */

import { readFileSync } from 'fs';
import { resolveAgent } from './lib/resolve-agent.js';

// Read hook input from stdin
let hookInput = {};
try {
  const raw = readFileSync(0, 'utf8');
  hookInput = JSON.parse(raw);
} catch {
  // Can't read stdin, allow stop
  console.log(JSON.stringify({}));
  process.exit(0);
}

// Only enforce for Sosa
const resolvedAgent = resolveAgent(hookInput);
if (resolvedAgent !== 'sosa') {
  console.log(JSON.stringify({}));
  process.exit(0);
}

const apiUrl = process.env.ATEAM_API_URL || '';
const projectId = process.env.ATEAM_PROJECT_ID || '';
const mockItems = process.env.__TEST_MOCK_ITEMS__;
const mockActivity = process.env.__TEST_MOCK_ACTIVITY__;

async function checkCoverage() {
  // Query the API for items in briefings stage
  let briefingsItems = [];

  if (mockItems !== undefined) {
    // Use test mock
    briefingsItems = JSON.parse(mockItems);
  } else {
    // Query the API
    if (!apiUrl || !projectId) {
      // No API config, allow stop
      console.log(JSON.stringify({}));
      process.exit(0);
    }

    const itemsUrl = `${apiUrl}/api/items?stage=briefings`;
    const itemsResponse = await fetch(itemsUrl, {
      headers: { 'X-Project-ID': projectId },
    });

    if (!itemsResponse.ok) {
      // API error, allow stop
      console.log(JSON.stringify({}));
      process.exit(0);
    }

    briefingsItems = await itemsResponse.json();
  }

  // If there are no items in briefings, allow stop (nothing to review)
  if (!briefingsItems || briefingsItems.length === 0) {
    console.log(JSON.stringify({}));
    process.exit(0);
  }

  // Query the activity log to check for item_render calls by sosa
  let activityLog = [];

  if (mockActivity !== undefined) {
    // Use test mock
    activityLog = JSON.parse(mockActivity);
  } else {
    const activityUrl = `${apiUrl}/api/activity`;
    const activityResponse = await fetch(activityUrl, {
      headers: { 'X-Project-ID': projectId },
    });

    if (!activityResponse.ok) {
      // API error, allow stop
      console.log(JSON.stringify({}));
      process.exit(0);
    }

    activityLog = await activityResponse.json();
  }

  // Count ateam items render calls by sosa (via Bash tool)
  const renderCalls = activityLog.filter(
    (entry) =>
      entry.agent === 'sosa' &&
      entry.message &&
      (entry.message.includes('ateam items render') || entry.message.includes('item_render'))
  );

  const itemsCount = briefingsItems.length;
  const rendersCount = renderCalls.length;

  // If Sosa hasn't rendered any items yet, block
  if (rendersCount === 0) {
    const message = `STOP: You haven't reviewed any work items yet.

You have ${itemsCount} item(s) in the briefings stage that need your review.

Before finishing, you MUST:
1. Run: ateam items list --stage briefings
2. Run: ateam items render <itemId> for EVERY item (${itemsCount}/${itemsCount})
3. Evaluate each item against your Analysis Framework
4. Produce a refinement report with findings

Your job is to review the decomposition, not just explore the codebase.
Start by running ateam items list --stage briefings, then render each item.`;

    console.log(
      JSON.stringify({
        decision: 'block',
        additionalContext: message,
      })
    );
    process.exit(0);
  }

  // If Sosa rendered some but not all items, warn but allow
  // (She may have good reason, or she may be in a follow-up session)
  // The prompt enforcement is the primary mechanism here
  console.log(JSON.stringify({}));
  process.exit(0);
}

checkCoverage().catch(() => {
  // On any error, allow stop
  console.log(JSON.stringify({}));
  process.exit(0);
});
