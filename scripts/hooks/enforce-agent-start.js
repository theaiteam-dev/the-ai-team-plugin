#!/usr/bin/env node
/**
 * enforce-agent-start.js - PreToolUse hook that blocks ateam agents-stop
 * if agents-start has not been called in this session.
 *
 * Root cause: in native teams mode, pipeline workers (Lynch especially)
 * sometimes skip agentStart and go straight to reviewing. When they later
 * call agentStop, the API returns NOT_CLAIMED (400) because no AgentClaim
 * record exists. This breaks peer-to-peer handoff chains and forces
 * Hannibal to manually intervene (~1-2 min overhead per item).
 *
 * How it works:
 * - observe-pre-tool-use.js writes /tmp/ateam-agent-started/{session_id}
 *   when it sees an agents-start command (separate from agent-map)
 * - This hook checks for that marker when agents-stop is attempted
 * - If missing, blocks with a clear message to call agentStart first
 *
 * Also blocks ateam activity log calls before agentStart, since logging
 * before claiming is a sign the agent skipped the lifecycle setup.
 *
 * Hannibal never calls agents-start or agents-stop, so this hook
 * never fires for orchestrator sessions.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const STARTED_DIR = join(tmpdir(), 'ateam-agent-started');

let hookInput = {};
try {
  const raw = readFileSync(0, 'utf8');
  hookInput = JSON.parse(raw);
} catch {
  process.exit(0);
}

try {
  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const command = toolInput.command || '';
  const sessionId = hookInput.session_id || '';

  // Match the ateam CLI being invoked with a subcommand — not just any
  // substring "ateam" in a path. `\bateam\s+[a-z-]+` requires a word
  // boundary before `ateam`, whitespace, then a subcommand token, so
  // `ls packages/ateam-cli/...` and `grep ateam-cli` are ignored.
  const ATEAM_CLI = /\bateam\s+[a-z-]+/;
  // Component-level matcher: a shell pipeline component is "an ateam
  // command needing prior start" when the FIRST verb of the component
  // is literally `ateam` followed by `agents-stop` or `activity`.
  // This is anchored at the start of the component (after trimming) so
  // it doesn't match `ateam agents-stop` substrings inside an `echo` or
  // `printf` argument (whose first verb is `echo`/`printf`).
  const ATEAM_NEEDS_START_AT_HEAD = /^ateam\s+(agents-stop|activity)\b/;

  if (toolName !== 'Bash' || !ATEAM_CLI.test(command)) {
    process.exit(0);
  }

  // Split the bash command into pipeline/sequence components so we can
  // inspect the FIRST verb of each component independently. We split on
  // shell sequence/short-circuit operators (`;`, `&&`, `||`) and newlines.
  //
  // We deliberately do NOT split on bare `|` or `&` to keep the regex
  // simple and avoid mis-splitting `||`/`&&`. A real shell parser would
  // handle quoting, heredocs, `$( ... )`, etc.; we don't, but the
  // remaining false-positive cases are narrow (e.g. heredoc body lines
  // starting with `ateam agents-stop`) and far less common than the
  // false-positives this split fixes (echo/printf prefixes, comment
  // lines, multi-line scripts).
  //
  // Bypass attempts like `printf 'ateam agents-start'; ateam agents-stop`
  // STILL fail closed: the second component starts with `ateam agents-stop`,
  // which matches ATEAM_NEEDS_START_AT_HEAD and triggers the marker check.
  //
  // Legitimate compound commands like
  //   `echo 'next: ateam agents-stop' && ateam agents-start ...`
  // are NOT blocked: the first component's first verb is `echo`, not
  // `ateam`; the second is `ateam agents-start`, which is not in the
  // needs-start list.
  const components = command.split(/;|&&|\|\||\n/);
  let triggeringSubcommand = null; // 'agents-stop' | 'activity' | null
  for (const raw of components) {
    // Strip leading whitespace and full-line `#` comments.
    const trimmed = raw.replace(/^\s+/, '');
    if (trimmed.startsWith('#')) continue;
    const m = trimmed.match(ATEAM_NEEDS_START_AT_HEAD);
    if (m) {
      triggeringSubcommand = m[1];
      break;
    }
  }

  // Only enforce on commands that require a prior agentStart:
  // - agents-stop (will fail with NOT_CLAIMED without it)
  // - activity log (sign of skipped lifecycle setup)
  if (!triggeringSubcommand) {
    process.exit(0);
  }

  // Check if agentStart has been called in this session
  if (!sessionId || existsSync(join(STARTED_DIR, sessionId))) {
    process.exit(0);
  }

  // agentStart has NOT been called — block. Use the subcommand from the
  // component that actually triggered the block, not a substring scan
  // of the whole command (which could mis-categorize when both verbs
  // appear, e.g. inside an `echo`).
  if (triggeringSubcommand === 'agents-stop') {
    process.stderr.write('BLOCKED: agentStop called without prior agentStart in this session.\n');
    process.stderr.write('You must call agentStart FIRST to register your claim on the work item.\n');
    process.stderr.write('Run: ateam agents-start agentStart --itemId "<ITEM_ID>" --agent "<YOUR_NAME>"\n');
    process.stderr.write('Without this, agentStop will fail with NOT_CLAIMED (400).\n');
  } else {
    process.stderr.write('BLOCKED: ateam activity called without prior agentStart in this session.\n');
    process.stderr.write('Call agentStart first to register your claim, then log activity.\n');
    process.stderr.write('Run: ateam agents-start agentStart --itemId "<ITEM_ID>" --agent "<YOUR_NAME>"\n');
  }
  process.exit(2);
} catch {
  // Fail open on unexpected errors
  process.exit(0);
}
