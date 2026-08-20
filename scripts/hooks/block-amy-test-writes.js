#!/usr/bin/env node
/**
 * block-amy-test-writes.js - PreToolUse hook for Amy
 *
 * Blocks Write/Edit operations to test files.
 * Amy investigates and reports - she does NOT write tests.
 * Her findings go in the agent_stop summary, not file artifacts.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input).
 */

import { readFileSync } from 'fs';
import { resolveAgent } from './lib/resolve-agent.js';
import { isScratchPath } from './lib/scratch-path.js';
import { denyAndExit } from './lib/send-denied-event.js';

/**
 * Project root for the scratch-space exclusion. Claude Code sends the session
 * cwd in the hook payload; the hook process is started there too, so
 * process.cwd() is the fallback. Passed EXPLICITLY into isScratchPath so a
 * repo that lives under a temp root (macOS $TMPDIR, a /tmp worktree, a CI
 * sandbox) never gets a scratch allowance for its own files.
 */
function projectRootFrom(input) {
  const fromPayload = input && typeof input.cwd === 'string' ? input.cwd : '';
  return fromPayload !== '' ? fromPayload : process.cwd();
}

let hookInput = {};
try {
  const raw = readFileSync(0, 'utf8');
  hookInput = JSON.parse(raw);
} catch {
  // Can't read stdin, allow through
  process.exit(0);
}

try {
  const agent = resolveAgent(hookInput);

  // Only enforce for Amy
  if (agent !== 'amy') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const filePath = toolInput.file_path || '';

  if (!filePath) {
    process.exit(0);
  }

  // Allow writes to the temp dirs (throwaway debug scripts, investigation
  // artifacts) — only where the path REALLY resolves under them AND outside
  // this project (lib/scratch-path.js collapses "..", follows symlinks, and
  // excludes the project root first).
  if (isScratchPath(filePath, undefined, projectRootFrom(hookInput))) {
    process.exit(0);
  }

  // Block writes to test/spec files
  if (filePath.match(/\.(test|spec)\.(ts|js|tsx|jsx)$/)) {
    const reason = `BLOCKED: Amy cannot write to ${filePath}. Test files are Murdock's responsibility.`;
    process.stderr.write(`BLOCKED: Amy cannot write to ${filePath}\n`);
    process.stderr.write('Test files are Murdock\'s responsibility.\n');
    process.stderr.write('Document your findings in the agent_stop summary instead.\n');
    await denyAndExit({ agentName: agent, toolName, reason });
  }

  // Block writes to raptor files
  if (filePath.match(/raptor/i)) {
    const reason = `BLOCKED: Amy cannot write raptor files: ${filePath}`;
    process.stderr.write(`BLOCKED: Amy cannot write raptor files: ${filePath}\n`);
    process.stderr.write('Document your investigation in the agent_stop summary instead.\n');
    await denyAndExit({ agentName: agent, toolName, reason });
  }

  // Block writes to project source code (src/, app/, lib/, components/, etc.)
  if (filePath.match(/\/(src|app|lib|components|pages|utils|services|hooks|styles|public)\//)) {
    const reason = `BLOCKED: Amy cannot modify project source code: ${filePath}`;
    process.stderr.write(`BLOCKED: Amy cannot modify project source code: ${filePath}\n`);
    process.stderr.write('Amy investigates and reports. She does NOT fix bugs or modify code.\n');
    process.stderr.write('Document your findings in the agent_stop summary instead.\n');
    await denyAndExit({ agentName: agent, toolName, reason });
  }

  // Block writes to config files that affect the project
  if (filePath.match(/\/(package\.json|tsconfig.*|biome\.json|vitest\.config|next\.config|prisma\/schema)/)) {
    const reason = `BLOCKED: Amy cannot modify project config: ${filePath}`;
    process.stderr.write(`BLOCKED: Amy cannot modify project config: ${filePath}\n`);
    process.stderr.write('Report config issues in the agent_stop summary instead.\n');
    await denyAndExit({ agentName: agent, toolName, reason });
  }

  // Allow other writes (files outside project directories)
  process.exit(0);
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
