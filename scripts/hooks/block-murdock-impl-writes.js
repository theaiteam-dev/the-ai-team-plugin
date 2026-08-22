#!/usr/bin/env node
/**
 * block-murdock-impl-writes.js - PreToolUse hook for Murdock
 *
 * Blocks Murdock from writing or editing implementation files. Implementation
 * is B.A.'s responsibility. Murdock writes tests and type definitions ONLY.
 *
 * Allowed:
 *   - Test files: *.test.{ts,tsx,js,jsx}, *.spec.{ts,tsx,js,jsx}
 *   - Files inside __tests__/ directories
 *   - Files inside top-level tests/ directories
 *   - Type definition files: *.d.ts
 *   - Files inside /types/ directories
 *   - Vitest/Jest setup files: vitest.setup.*, jest.setup.*
 *   - Files in the system temp dirs (throwaway scripts) — canonicalized
 *     before the allowlist test (see lib/scratch-path.js), so
 *     `/tmp/../<repo>/src/app.ts` is not treated as scratch, and neither is
 *     anything under the project root when the repo itself lives under /tmp.
 *
 * Claude Code sends hook context via stdin JSON (tool_name, tool_input).
 */

import { readFileSync } from 'fs';
import { resolveAgent } from './lib/resolve-agent.js';
import { isScratchPath, TMP_ONLY_SCRATCH_ROOTS } from './lib/scratch-path.js';
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

  // Only enforce for Murdock
  if (agent !== 'murdock') {
    process.exit(0);
  }

  const toolName = hookInput.tool_name || '';
  const toolInput = hookInput.tool_input || {};
  const filePath = toolInput.file_path || toolInput.notebook_path || '';

  // Only gate write-capable tools. Reads, searches, and execs are unrelated
  // to this hook's intent ("impl writes") — Murdock must read implementation
  // sources to write tests against them (TDD).
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
  if (!WRITE_TOOLS.has(toolName)) {
    process.exit(0);
  }

  if (!filePath) {
    process.exit(0);
  }

  // Allow writes to the temp dirs (throwaway scripts, debugging artifacts) —
  // only where the path REALLY resolves under one of them AND outside this
  // project. Murdock's allowlist has never included /var/tmp, so keep it to
  // /tmp and $TMPDIR alone.
  if (isScratchPath(filePath, TMP_ONLY_SCRATCH_ROOTS, projectRootFrom(hookInput))) {
    process.exit(0);
  }

  // Allow test files: *.test.{ts,tsx,js,jsx}, *.spec.{ts,tsx,js,jsx}
  if (filePath.match(/\.(test|spec)\.(ts|js|tsx|jsx)$/)) {
    process.exit(0);
  }

  // Allow Go test files: *_test.go
  if (filePath.match(/_test\.go$/)) {
    process.exit(0);
  }

  // Allow files inside __tests__/ directories
  if (filePath.includes('/__tests__/')) {
    process.exit(0);
  }

  // Allow files inside top-level tests/ directories
  if (filePath.match(/\/tests\//)) {
    process.exit(0);
  }

  // Allow type definition files: *.d.ts
  if (filePath.match(/\.d\.ts$/)) {
    process.exit(0);
  }

  // Allow files inside /types/ directories
  if (filePath.match(/\/types\//)) {
    process.exit(0);
  }

  // Allow vitest/jest setup files
  if (filePath.match(/\/(vitest|jest)\.setup\.(ts|js|tsx|jsx)$/)) {
    process.exit(0);
  }

  // Block everything else — this is implementation territory
  const reason = `BLOCKED: Murdock cannot write implementation files: ${filePath}. Implementation is B.A.'s job.`;
  process.stderr.write(`BLOCKED: Murdock cannot write implementation files: ${filePath}\n`);
  process.stderr.write('Implementation is B.A.\'s job. Murdock writes tests and type definitions ONLY.\n');
  process.stderr.write('If you need a type, create a .d.ts file or place it in a /types/ directory.\n');
  await denyAndExit({ agentName: agent, toolName, reason });
} catch {
  // Fail open on any unexpected error
  process.exit(0);
}
