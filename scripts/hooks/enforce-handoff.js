#!/usr/bin/env node
/**
 * enforce-handoff.js - Stop hook for pipeline agents (Murdock, B.A., Lynch, Amy)
 *
 * Blocks the agent from stopping until BOTH conditions are met:
 * 1. agentStop was called (work log recorded)
 * 2. Handoff message was sent (SendMessage to next agent or Hannibal)
 *
 * Scans the transcript to verify both steps. If either is missing,
 * blocks the stop and tells the agent exactly what to do.
 *
 * Used by: Murdock, B.A., Lynch, Amy
 *
 * Input (stdin JSON):
 *   { session_id, hook_event_name, transcript_path, last_assistant_message, ... }
 *
 * Output (stdout JSON):
 *   { "decision": "block", "reason": "..." } - Force agent to continue
 *   {} - Allow stop
 */

import { readFileSync } from 'fs';
import { resolveAgent } from './lib/resolve-agent.js';
import { lookupAgent } from './lib/observer.js';

// Pipeline agents this hook applies to
const PIPELINE_AGENTS = ['murdock', 'ba', 'lynch', 'amy'];

// Expected handoff targets per agent type
const HANDOFF_TARGETS = {
  murdock: { next: 'ba', desc: 'B.A.' },
  ba: { next: 'lynch', desc: 'Lynch' },
  lynch: { next: 'amy', desc: 'Amy' },
  amy: { next: null, desc: null }, // Amy sends FYI to Hannibal only
};

// Valid rejection routing: agent → { returnToStage: expectedRecipientType }
const REJECTION_TARGETS = {
  lynch: { testing: 'murdock', implementing: 'ba' },
  amy: { implementing: 'ba' },
};

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

// Only enforce for pipeline agents
// resolveAgent reads agent_type/teammate_name from stdin. For native teammates,
// these fields may not be present in Stop hooks — fall back to the session-to-agent
// map populated by observe-teammate.js on TeammateIdle events.
const sessionId = hookInput.session_id || '';
const resolvedFromStdin = resolveAgent(hookInput);
const resolvedFromMap = !resolvedFromStdin && sessionId ? lookupAgent(sessionId) : null;
// lookupAgent returns instance name (e.g. "murdock-1"), normalize to base type
const resolvedAgent = resolvedFromStdin || (resolvedFromMap ? resolvedFromMap.replace(/-\d+$/, '') : null);
if (!resolvedAgent || !PIPELINE_AGENTS.includes(resolvedAgent)) {
  console.log(JSON.stringify({}));
  process.exit(0);
}

// Need transcript to verify steps
const transcriptPath = hookInput.transcript_path;
if (!transcriptPath) {
  // No transcript available, allow stop (can't verify)
  console.log(JSON.stringify({}));
  process.exit(0);
}

// Parse transcript
let lines;
try {
  const content = readFileSync(transcriptPath, 'utf8');
  lines = content.split('\n').filter((line) => line.trim().length > 0);
} catch {
  // Can't read transcript, allow stop
  console.log(JSON.stringify({}));
  process.exit(0);
}

// Scan transcript for agentStop call and SendMessage handoff
let foundAgentStop = false;
let foundHandoff = false;
let agentStopItemId = null;
let instanceName = null;
let agentStopOutcome = null;
let agentStopReturnTo = null;
let claimedNext = null; // Extracted from agentStop JSON response in transcript

for (const line of lines) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }

  const contentBlocks = entry?.message?.content;
  if (!Array.isArray(contentBlocks)) continue;

  for (const block of contentBlocks) {
    // Extract claimedNext from agentStop tool result (JSON response in transcript)
    if (block?.type === 'tool_result' || (block?.type === 'text' && typeof block.text === 'string')) {
      const text = block.text || (typeof block.content === 'string' ? block.content : '') || '';
      const claimedMatch = text.match(/"claimedNext"\s*:\s*"([^"]+)"/);
      if (claimedMatch) claimedNext = claimedMatch[1];
    }

    if (block?.type !== 'tool_use') continue;

    // Check for agentStop via Bash
    if (block.name === 'Bash') {
      const command = block.input?.command || '';
      if (command.includes('agents-stop') && command.includes('agentStop')) {
        foundAgentStop = true;
        const itemMatch = command.match(/--itemId\s+["']?([^\s"']+)["']?/);
        if (itemMatch) agentStopItemId = itemMatch[1];
        const agentMatch = command.match(/--agent\s+["']?([^\s"']+)["']?/);
        if (agentMatch) instanceName = agentMatch[1];
        const outcomeMatch = command.match(/--outcome\s+["']?([^\s"']+)["']?/);
        if (outcomeMatch) agentStopOutcome = outcomeMatch[1];
        const returnToMatch = command.match(/--return-to\s+["']?([^\s"']+)["']?/);
        if (returnToMatch) agentStopReturnTo = returnToMatch[1];
      }
    }

    // Check for SendMessage (handoff)
    if (block.name === 'SendMessage') {
      const recipient = block.input?.to || '';
      const content = block.input?.content || '';
      const target = HANDOFF_TARGETS[resolvedAgent];

      if (resolvedAgent === 'amy') {
        // Amy just needs to send FYI to hannibal
        if (recipient === 'hannibal' && content.includes('FYI')) {
          foundHandoff = true;
        }
      } else if (agentStopOutcome === 'rejected') {
        // Rejection path: validate recipient matches --return-to stage
        const rejTargets = REJECTION_TARGETS[resolvedAgent];
        const expectedType = rejTargets && agentStopReturnTo ? rejTargets[agentStopReturnTo] : null;

        if (expectedType && recipient.startsWith(expectedType) && content.includes('REJECTED')) {
          // Correct rejection target
          foundHandoff = true;
        } else if (!expectedType && content.includes('REJECTED')) {
          // --return-to not parseable or agent not in REJECTION_TARGETS — fall back to any REJECTED
          foundHandoff = true;
        }
      } else if (target?.next) {
        // Forward flow: START to next agent OR ALERT to hannibal
        if (claimedNext) {
          // Strict: verify exact instance match from agentStop response
          if (recipient === claimedNext && content.includes('START')) {
            foundHandoff = true;
          }
        } else {
          // Fallback: claimedNext not extractable, accept any instance of correct type
          if (recipient.startsWith(target.next) && content.includes('START')) {
            foundHandoff = true;
          }
        }
        if (recipient === 'hannibal' && content.includes('ALERT')) {
          foundHandoff = true;
        }
      }

      // FYI to hannibal is expected after START but must NOT satisfy the handoff
      // requirement by itself for non-Amy agents — otherwise it bypasses routing
      // validation (e.g. B.A. sends START to wrong agent, FYI to hannibal, hook allows stop).
    }
  }
}

// Build block message based on what's missing
if (foundAgentStop && foundHandoff) {
  // Both done, allow stop
  console.log(JSON.stringify({}));
  process.exit(0);
}

const target = HANDOFF_TARGETS[resolvedAgent];
const missing = [];

if (!foundAgentStop) {
  missing.push(
    `1. Call agentStop to record your work:\n` +
    `   ateam agents-stop agentStop --json --itemId "<ITEM_ID>" --agent "<YOUR_INSTANCE_NAME>" --outcome completed --summary "<what you did>"`
  );
}

if (!foundHandoff) {
  if (resolvedAgent === 'amy') {
    missing.push(
      `${missing.length + 1}. Send FYI to Hannibal:\n` +
      `   SendMessage to "hannibal" with content: "FYI: <itemId> - probing complete. VERIFIED."`
    );
  } else if (agentStopOutcome === 'rejected') {
    const rejTargets = REJECTION_TARGETS[resolvedAgent];
    const expectedType = rejTargets && agentStopReturnTo ? rejTargets[agentStopReturnTo] : null;
    if (expectedType) {
      missing.push(
        `${missing.length + 1}. Send REJECTED to a ${expectedType} instance (matches --return-to ${agentStopReturnTo}).\n` +
        `   SendMessage to "${expectedType}-N" with content including "REJECTED: <itemId> - <reason>"\n` +
        `   Then send FYI to Hannibal.`
      );
    } else {
      missing.push(
        `${missing.length + 1}. Send REJECTED message to the responsible agent and FYI to Hannibal.\n` +
        `   See the pool-handoff skill for rejection message templates.`
      );
    }
  } else {
    if (claimedNext) {
      missing.push(
        `${missing.length + 1}. Send START to the exact instance from your agentStop response: "${claimedNext}"\n` +
        `   SendMessage to "${claimedNext}" with content "START: <itemId> - <summary>", then SendMessage "FYI" to hannibal`
      );
    } else {
      missing.push(
        `${missing.length + 1}. Complete the handoff. Parse claimedNext from your agentStop --json response:\n` +
        `   - If claimedNext is set: SendMessage to that instance with "START: <itemId> - <summary>", then SendMessage "FYI" to hannibal\n` +
        `   - If poolAlert is set (no idle ${target?.desc || 'next'} instance): SendMessage "ALERT: <itemId> - <poolAlert>" to hannibal`
      );
    }
  }
}

const reason = `You cannot stop yet. Complete these steps first:\n\n${missing.join('\n\n')}`;

console.log(
  JSON.stringify({
    decision: 'block',
    reason,
  })
);
process.exit(0);
