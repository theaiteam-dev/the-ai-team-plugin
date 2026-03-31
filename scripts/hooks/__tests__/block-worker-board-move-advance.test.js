/**
 * Smoke tests for the updated block-worker-board-move.js hook.
 *
 * After WI-027 the error message should reference agentStop --advance=false
 * as the self-service escape hatch instead of telling agents to wait for Hannibal.
 *
 * Tests (task type → 3 smoke tests):
 * 1. Blocked stderr mentions --advance=false
 * 2. Blocked stderr does NOT tell agents to wait for Hannibal
 * 3. Non-target agent (Hannibal) is still allowed through (regression guard)
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';

const HOOKS_DIR = join(import.meta.dirname, '..');
const HOOK = join(HOOKS_DIR, 'block-worker-board-move.js');

function runHook(stdin = {}, env = {}) {
  const fullEnv = {
    ...process.env,
    ATEAM_API_URL: 'http://localhost:3000',
    ATEAM_PROJECT_ID: 'test-project',
    ...env,
  };
  try {
    const stdout = execFileSync('node', [HOOK], {
      env: fullEnv,
      encoding: 'utf8',
      timeout: 5000,
      input: JSON.stringify(stdin),
    });
    return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
      exitCode: err.status ?? 1,
    };
  }
}

const BOARD_MOVE_INPUT = {
  agent_type: 'murdock',
  tool_name: 'Bash',
  tool_input: { command: 'ateam board-move moveItem --itemId WI-001 --toStage implementing' },
};

describe('block-worker-board-move — advance flag message update', () => {
  it('blocked message references --advance=false as the escape hatch', () => {
    const result = runHook(BOARD_MOVE_INPUT);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--advance=false');
  });

  it('blocked message does NOT tell agents to wait for Hannibal', () => {
    const result = runHook(BOARD_MOVE_INPUT);
    expect(result.exitCode).toBe(2);
    // Old message said "wait for Hannibal" — that guidance is now superseded
    expect(result.stderr).not.toContain("wait for Hannibal");
  });

  it('allows Hannibal through (non-target agent regression guard)', () => {
    const result = runHook({
      agent_type: 'hannibal',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move moveItem --itemId WI-001 --toStage implementing' },
    });
    expect(result.exitCode).toBe(0);
  });
});
