/**
 * Tests for block-raw-mv.js's operator-facing stage list (WI-793 AC5).
 *
 * No test file existed for this hook before this item. The hook blocks raw
 * `mv` commands targeting mission files (Hannibal must use board_move
 * instead) and prints the "Available stages" list to guide the operator to
 * a valid target — that list is a hand-typed string literal that must stay
 * in sync with the real 9-stage set (WI-787 added 'staged' between 'probing'
 * and 'done'), or the operator is guided toward invalid/incomplete options.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';

const HOOK_PATH = join(__dirname, '..', 'block-raw-mv.js');

function runHook(stdin) {
  try {
    execFileSync('node', [HOOK_PATH], {
      input: JSON.stringify(stdin),
      encoding: 'utf8',
      timeout: 5000,
    });
    return { stdout: '', stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
      exitCode: err.status ?? 1,
    };
  }
}

describe('block-raw-mv.js — operator-facing stage list (WI-793)', () => {
  it('blocks a raw mv on mission files for Hannibal and lists staged between probing and done', () => {
    const result = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'mv mission/briefings/WI-001.md mission/done/WI-001.md' },
      agent_type: 'hannibal',
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Available stages:/);

    // Pin the exact 9-stage order, not just "contains staged" — a stage
    // list that mentions staged out of order or without probing/done still
    // misguides the operator.
    const match = result.stderr.match(/Available stages: ([^\n]+)/);
    expect(match, `expected an "Available stages:" line in stderr: ${result.stderr}`).not.toBeNull();
    const stages = match[1].split(',').map((s) => s.trim());
    expect(stages).toEqual([
      'briefings',
      'ready',
      'testing',
      'implementing',
      'review',
      'probing',
      'staged',
      'done',
      'blocked',
    ]);
  });

  it('does not block (and prints nothing) for a non-Hannibal agent, regardless of the stage list content', () => {
    const result = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'mv mission/briefings/WI-001.md mission/done/WI-001.md' },
      agent_type: 'ba',
    });

    expect(result.exitCode).toBe(0);
  });

  it('does not block a Hannibal mv command that does not target mission files', () => {
    const result = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'mv /tmp/scratch.txt /tmp/scratch2.txt' },
      agent_type: 'hannibal',
    });

    expect(result.exitCode).toBe(0);
  });
});
