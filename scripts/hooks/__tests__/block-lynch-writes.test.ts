/**
 * Tests for block-lynch-writes.js enforcement hook.
 *
 * This PreToolUse hook blocks Lynch from writing or editing any files.
 * Lynch is a code reviewer — he reviews statically and must NOT modify files.
 *
 * Pattern: same as block-sosa-writes.js, but for Lynch and with /tmp/ allowlist.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { readFileSync, mkdtempSync, symlinkSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';

const HOOK = join(__dirname, '..', 'block-lynch-writes.js');

/**
 * Run the hook script as a child process with optional stdin JSON.
 */
function runHook(stdin: object = {}, env: Record<string, string> = {}) {
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
  } catch (err: any) {
    return {
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
      exitCode: err.status,
    };
  }
}

// =============================================================================
// Static code checks
// =============================================================================
describe('block-lynch-writes — static checks', () => {
  it('imports and uses resolveAgent() for agent detection', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/resolveAgent/);
    expect(source).toMatch(/resolve-agent/);
  });

  it('references lynch by name in the implementation', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source.toLowerCase()).toMatch(/lynch/);
  });
});

// =============================================================================
// Lynch — blocked paths
// =============================================================================
describe('block-lynch-writes — Lynch is blocked', () => {
  it('blocks Write to src/ file with exit 2', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks Edit to a test file with exit 2', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks Write to a project root file', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: 'README.md' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('error message mentions Lynch by name', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toLowerCase()).toMatch(/lynch/);
  });

  it('blocks when agent uses ai-team: prefix', () => {
    const result = runHook({
      agent_type: 'ai-team:lynch',
      tool_name: 'Write',
      tool_input: { file_path: 'src/utils.ts' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks when agent name is uppercase Lynch (case normalization)', () => {
    const result = runHook({
      agent_type: 'Lynch',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(2);
  });
});

// =============================================================================
// Lynch — allowed paths (/tmp/, /var/)
// =============================================================================
describe('block-lynch-writes — Lynch allowlist', () => {
  it('allows Write to /tmp/ (exit 0)', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/review-notes.md' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Write to /var/ (exit 0)', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: '/var/tmp/scratch.txt' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Lynch/Stockwell — the scratch allowlist must not be traversable
//
// This is an allow-then-block hook: a path judged "scratch" exits 0 and skips
// the block entirely. When the test was a raw startsWith('/tmp/'), a path that
// merely BEGAN with a scratch root escaped the guard — `/tmp/../<repo>/src/app.ts`
// was allowed while the `src/app.ts` it resolves to was blocked. The allowlist
// now canonicalizes first (lib/scratch-path.js).
// =============================================================================
describe('block-lynch-writes — scratch allowlist canonicalization', () => {
  const REPO_ROOT = realpathSync(join(__dirname, '..', '..', '..'));

  it('blocks /tmp/../<repo>/src/app.ts (traversal back into the repo)', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: `/tmp/..${REPO_ROOT}/src/app.ts` },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks /tmp/x/../../etc/hosts (traversal out of /tmp entirely)', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/x/../../etc/hosts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks /var/../etc/passwd', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: '/var/../etc/passwd' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks a sibling directory that merely starts with the root name', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: '/tmpfoo/notes.md' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks a /tmp symlink that resolves into the repo (laundering)', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'lynch-scratch-test-'));
    try {
      const link = join(sandbox, 'launder');
      symlinkSync(join(REPO_ROOT, 'src'), link);
      const result = runHook({
        agent_type: 'lynch',
        tool_name: 'Write',
        tool_input: { file_path: join(link, 'app.ts') },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('still allows a genuine nested /tmp/ scratch file', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/scratch/review-notes.md' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('still allows a ".." that stays inside the scratch root', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/a/../b/review-notes.md' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Lynch — non-Write/Edit tools are allowed
// =============================================================================
describe('block-lynch-writes — non-Write/Edit tools', () => {
  it('allows Read tool for Lynch', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Read',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Bash tool for Lynch', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Grep tool for Lynch', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Grep',
      tool_input: { pattern: 'TODO' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Non-Lynch agents — not affected
// =============================================================================
describe('block-lynch-writes — non-Lynch agents not affected', () => {
  it('allows Write for ba (exit 0)', () => {
    const result = runHook({
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Write for murdock (exit 0)', () => {
    const result = runHook({
      agent_type: 'murdock',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Write for tawnia (exit 0)', () => {
    const result = runHook({
      agent_type: 'tawnia',
      tool_name: 'Write',
      tool_input: { file_path: 'docs/CHANGELOG.md' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Write for unknown/system agents like Explore (exit 0)', () => {
    const result = runHook({
      agent_type: 'Explore',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Edge cases
// =============================================================================
describe('block-lynch-writes — edge cases', () => {
  it('handles missing stdin gracefully (exit 0)', () => {
    // Run hook without any stdin input
    const fullEnv = { ...process.env, ATEAM_API_URL: 'http://localhost:3000', ATEAM_PROJECT_ID: 'test-project' };
    try {
      execFileSync('node', [HOOK], { env: fullEnv, encoding: 'utf8', timeout: 5000 });
      // exit 0 is fine
    } catch (err: any) {
      // exit 0 is also fine — what matters is it doesn't crash with exit 2
      expect(err.status).not.toBe(2);
    }
  });

  it('handles null agent gracefully (exit 0, fail-open)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
      // no agent_type or teammate_name
    });
    expect(result.exitCode).toBe(0);
  });

  it('handles missing tool_input gracefully (exit 0)', () => {
    const result = runHook({
      agent_type: 'lynch',
      tool_name: 'Write',
      // no tool_input
    });
    // No file path means nothing to block
    expect(result.exitCode).toBe(0);
  });
});
