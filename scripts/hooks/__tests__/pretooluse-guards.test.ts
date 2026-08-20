/**
 * Tests for agent guards in PreToolUse enforcement hooks.
 *
 * After adding resolveAgent() guards, each hook must:
 *   1. Block its target agent's prohibited action
 *   2. Allow non-target agents through (exit 0)
 *   3. Allow unknown/system agents like "Explore" (exit 0, fail-open)
 *   4. Handle null/missing agent_type gracefully (exit 0, fail-open)
 *
 * Exception: block-raw-echo-log.js blocks via JSON stdout { decision: "block" }
 * at exit 0, NOT exit 2. Its guard behavior is the same (non-target = pass).
 *
 * Also verifies that all hooks are registered in hooks/hooks.json with the
 * correct event matchers.
 *
 * NOTE: enforce-orchestrator-boundary.js is covered in orchestrator-boundary.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { readFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync, rmSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { foldSpecKey, isCaseInsensitiveFs } from '../lib/frankie-spec-key.js';

const HOOKS_DIR = join(__dirname, '..');
const REPO_ROOT = join(__dirname, '..', '..', '..');
const HOOKS_JSON_PATH = join(REPO_ROOT, 'hooks', 'hooks.json');

function hookPath(name: string) {
  return join(HOOKS_DIR, name);
}

/** Run a hook as a child process with optional stdin JSON and env. */
function runHook(
  scriptPath: string,
  stdin: object = {},
  env: Record<string, string> = {}
) {
  const fullEnv = {
    ...process.env,
    ATEAM_API_URL: 'http://localhost:3000',
    ATEAM_PROJECT_ID: 'test-project',
    ...env,
  };
  try {
    const stdout = execFileSync('node', [scriptPath], {
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
      exitCode: err.status ?? 1,
    };
  }
}

/** Parse JSON stdout from a hook response, or return {} if empty/invalid. */
function parseOutput(stdout: string): Record<string, unknown> {
  if (!stdout) return {};
  try {
    return JSON.parse(stdout);
  } catch {
    return {};
  }
}

// =============================================================================
// hooks/hooks.json — registration checks
// =============================================================================
describe('hooks/hooks.json — all PreToolUse hooks registered', () => {
  let hooksJson: Record<string, unknown>;

  it('hooks.json is valid JSON', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(() => { hooksJson = JSON.parse(raw); }).not.toThrow();
  });

  it('contains PreToolUse section', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    const json = JSON.parse(raw);
    expect(json.hooks).toHaveProperty('PreToolUse');
    expect(Array.isArray(json.hooks.PreToolUse)).toBe(true);
  });

  it('registers block-amy-writes.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-amy-writes\.js/);
  });

  it('registers block-amy-test-writes.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-amy-test-writes\.js/);
  });

  it('registers block-murdock-impl-writes.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-murdock-impl-writes\.js/);
  });

  it('registers block-ba-test-writes.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-ba-test-writes\.js/);
  });

  it('registers block-ba-bash-restrictions.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-ba-bash-restrictions\.js/);
  });

  it('registers block-sosa-writes.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-sosa-writes\.js/);
  });

  it('registers block-lynch-browser.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-lynch-browser\.js/);
  });

  it('registers block-lynch-writes.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-lynch-writes\.js/);
  });

  it('registers block-hannibal-writes.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-hannibal-writes\.js/);
  });

  it('registers block-raw-echo-log.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-raw-echo-log\.js/);
  });

  it('registers block-raw-mv.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-raw-mv\.js/);
  });

  it('registers block-worker-board-claim.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-worker-board-claim\.js/);
  });

  it('registers block-worker-board-move.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-worker-board-move\.js/);
  });

  it('registers block-frankie-writes.js in PreToolUse', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    expect(raw).toMatch(/block-frankie-writes\.js/);
  });

  it('all registered hook commands use ${CLAUDE_PLUGIN_ROOT} path prefix', () => {
    const raw = readFileSync(HOOKS_JSON_PATH, 'utf8');
    const json = JSON.parse(raw);
    const preToolUse: any[] = json.hooks.PreToolUse || [];
    for (const entry of preToolUse) {
      for (const hook of (entry.hooks || [])) {
        if (hook.command && hook.command.includes('block-')) {
          expect(hook.command).toMatch(/\$\{CLAUDE_PLUGIN_ROOT\}/);
        }
      }
    }
  });
});

// =============================================================================
// Static checks — all 13 hooks must use resolveAgent()
// =============================================================================
describe('PreToolUse hooks — static resolveAgent() usage', () => {
  const TARGETED_HOOKS = [
    'block-amy-writes.js',
    'block-amy-test-writes.js',
    'block-murdock-impl-writes.js',
    'block-ba-test-writes.js',
    'block-ba-bash-restrictions.js',
    'block-sosa-writes.js',
    'block-lynch-browser.js',
    'block-lynch-writes.js',
    'block-hannibal-writes.js',
    'block-raw-echo-log.js',
    'block-raw-mv.js',
    'block-worker-board-claim.js',
    'block-worker-board-move.js',
    'block-frankie-writes.js',
  ];

  for (const hook of TARGETED_HOOKS) {
    it(`${hook} imports and uses resolveAgent()`, () => {
      const source = readFileSync(hookPath(hook), 'utf8');
      expect(source).toMatch(/resolveAgent/);
      expect(source).toMatch(/resolve-agent/);
    });
  }
});

// =============================================================================
// block-amy-writes.js — target: amy
// =============================================================================
describe('block-amy-writes — agent guards', () => {
  const HOOK = hookPath('block-amy-writes.js');

  it('blocks amy writing to src/ (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('allows non-target agent ba to write src/ (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows non-target agent lynch to write (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows amy to write to /tmp/ (allowlisted)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/debug.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Regression: hook is named *-WRITES but currently also blocks Reads/Glob/Grep.
  // Amy must be able to read source files to investigate bugs and probe
  // behavior. Mirror of the Murdock M-20260428-003 over-blocking bug.
  // ---------------------------------------------------------------------------
  it('allows amy reading src/services/auth.ts (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Read',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows amy reading src/components/Foo.tsx (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Read',
      tool_input: { file_path: 'src/components/Foo.tsx' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows amy Glob-ing src/**/*.ts (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Glob',
      tool_input: { pattern: 'src/**/*.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows amy Grep-ing src/** (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Grep',
      tool_input: { pattern: 'export', path: 'src/' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('still blocks amy Write to src/services/auth.ts (exit 2, regression guard)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  // ---------------------------------------------------------------------------
  // NotebookEdit / MultiEdit path-extraction coverage (PR #35 fix)
  // NotebookEdit uses notebook_path, not file_path — must not bypass block.
  // MultiEdit uses file_path (same as Write/Edit) — verified here for parity.
  // ---------------------------------------------------------------------------
  it('blocks amy MultiEdit to src/services/auth.ts (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'MultiEdit',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks amy NotebookEdit to src/lib/analysis.ipynb via notebook_path (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'src/lib/analysis.ipynb' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });
});

// =============================================================================
// block-amy-test-writes.js — target: amy
// =============================================================================
describe('block-amy-test-writes — agent guards', () => {
  const HOOK = hookPath('block-amy-test-writes.js');

  it('blocks amy writing a .test.ts file (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('allows non-target agent murdock writing .test.ts (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore writing test files (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-murdock-impl-writes.js — target: murdock
// =============================================================================
describe('block-murdock-impl-writes — agent guards', () => {
  const HOOK = hookPath('block-murdock-impl-writes.js');

  it('blocks murdock writing src/services/auth.ts (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('allows non-target agent ba writing src/ impl (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows non-target agent tawnia writing docs (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'tawnia',
      tool_name: 'Write',
      tool_input: { file_path: 'docs/CHANGELOG.md' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore writing impl files (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('murdock can still write test files (allowed)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Regression: hook is named *-impl-WRITES but currently also blocks Reads.
  // Murdock must be able to read implementation source files to write tests
  // against them (TDD). Repro from mission M-20260428-003 / WI-272 where
  // Murdock-1 was blocked reading CreateTodo.tsx, TodoItem.tsx, EmptyState.tsx,
  // ErrorBanner.tsx, and todosApi.ts before writing App integration tests.
  // ---------------------------------------------------------------------------
  it('allows murdock reading src/services/auth.ts (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Read',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows murdock reading src/components/Button.tsx (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Read',
      tool_input: { file_path: 'src/components/Button.tsx' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows murdock reading src/components/CreateTodo.tsx (exit 0, M-20260428-003 repro)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Read',
      tool_input: { file_path: 'src/components/CreateTodo.tsx' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows murdock reading src/api/todosApi.ts (exit 0, M-20260428-003 repro)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Read',
      tool_input: { file_path: 'src/api/todosApi.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows murdock Glob-ing impl files (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Glob',
      tool_input: { pattern: 'src/**/*.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows murdock Grep-ing impl source (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Grep',
      tool_input: { pattern: 'export function', path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Consider #14: drop the /var/ allowlist. Only /tmp/ is a true throwaway dir.
  // Writes to /var/log/* should be blocked just like any other impl path.
  // ---------------------------------------------------------------------------
  it('blocks murdock writing to /var/log/foo.ts (exit 2, /var/ no longer allowlisted)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Write',
      tool_input: { file_path: '/var/log/foo.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  // ---------------------------------------------------------------------------
  // NotebookEdit / MultiEdit path-extraction coverage (PR #35 fix)
  // NotebookEdit uses notebook_path, not file_path — must not bypass block.
  // MultiEdit uses file_path (same as Write/Edit) — verified here for parity.
  // ---------------------------------------------------------------------------
  it('blocks murdock MultiEdit to src/whatever.ts (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'MultiEdit',
      tool_input: { file_path: 'src/whatever.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks murdock NotebookEdit to src/whatever.ipynb via notebook_path (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'src/whatever.ipynb' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });
});

// =============================================================================
// block-ba-test-writes.js — target: ba
// =============================================================================
describe('block-ba-test-writes — agent guards', () => {
  const HOOK = hookPath('block-ba-test-writes.js');

  it('blocks ba writing a .test.ts file (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks ba editing a .spec.tsx file (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/components/Button.spec.tsx' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('allows non-target agent murdock writing .test.ts (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore writing test files (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('ba can still write src/ impl files (allowed)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-ba-bash-restrictions.js — target: ba
// =============================================================================
describe('block-ba-bash-restrictions — agent guards', () => {
  const HOOK = hookPath('block-ba-bash-restrictions.js');

  it('blocks ba running pnpm dev (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm dev' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks ba running git stash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Bash',
      tool_input: { command: 'git stash' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('allows non-target agent murdock running pnpm dev (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm dev' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows non-target agent hannibal running git stash (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Bash',
      tool_input: { command: 'git stash' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore running dev server (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm dev' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'git stash' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('ba can still run tests (allowed)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Bash',
      tool_input: { command: 'bun run test' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-sosa-writes.js — target: sosa
// =============================================================================
describe('block-sosa-writes — agent guards', () => {
  const HOOK = hookPath('block-sosa-writes.js');

  it('blocks sosa writing any file (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'sosa',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks sosa editing any file (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'sosa',
      tool_name: 'Edit',
      tool_input: { file_path: 'docs/CHANGELOG.md' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('allows non-target agent face to write (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'face',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows non-target agent ba to write (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore to write (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-lynch-browser.js — target: lynch, lynch-final
// =============================================================================
describe('block-lynch-browser — agent guards', () => {
  const HOOK = hookPath('block-lynch-browser.js');

  it('blocks lynch using browser_navigate (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch',
      tool_name: 'mcp__plugin_playwright_playwright__browser_navigate',
      tool_input: { url: 'http://localhost:3000' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks lynch using browser_snapshot (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch',
      tool_name: 'mcp__plugin_playwright_playwright__browser_snapshot',
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks lynch-final using browser_navigate (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ai-team:lynch-final',
      tool_name: 'mcp__plugin_playwright_playwright__browser_navigate',
      tool_input: { url: 'http://localhost:3000' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks lynch-final using browser_snapshot (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ai-team:lynch-final',
      tool_name: 'mcp__plugin_playwright_playwright__browser_snapshot',
    });
    expect(result.exitCode).toBe(2);
  });

  // Regression: the final reviewer resolves as 'stockwell' since the rename
  // (resolve-agent.js KNOWN_AGENTS), so a gate listing only lynch/lynch-final
  // silently fails open for the agent stockwell.md actually registers it for.
  it('blocks stockwell using browser_navigate (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ai-team:stockwell',
      tool_name: 'mcp__plugin_playwright_playwright__browser_navigate',
      tool_input: { url: 'http://localhost:3000' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks stockwell using browser_snapshot (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'stockwell',
      tool_name: 'mcp__plugin_playwright_playwright__browser_snapshot',
    });
    expect(result.exitCode).toBe(2);
  });

  it('allows non-target agent amy to use browser tools (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'mcp__plugin_playwright_playwright__browser_navigate',
      tool_input: { url: 'http://localhost:3000' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows non-target agent hannibal to use browser tools via this hook (exit 0)', () => {
    // enforce-orchestrator-boundary handles hannibal; this hook is for lynch only
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'mcp__plugin_playwright_playwright__browser_navigate',
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore to use browser tools (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'mcp__plugin_playwright_playwright__browser_snapshot',
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'mcp__plugin_playwright_playwright__browser_navigate',
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-lynch-writes.js — target: lynch, lynch-final (added in WI-230)
// =============================================================================
describe('block-lynch-writes — agent guards (regression)', () => {
  const HOOK = hookPath('block-lynch-writes.js');

  it('blocks lynch writing src/ file (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks lynch-final writing project files (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ai-team:lynch-final',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks lynch-final editing project files (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ai-team:lynch-final',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/components/Button.tsx' },
    });
    expect(result.exitCode).toBe(2);
  });

  // Regression: same rename gap as block-lynch-browser — 'stockwell' is the
  // resolved name of the final reviewer, and he must never write project files
  // (the write-guard incident that motivated these hooks was a Stockwell run).
  it('blocks stockwell writing project files (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ai-team:stockwell',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks stockwell editing project files (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'stockwell',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/components/Button.tsx' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('allows stockwell scratch writes to /tmp/ (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'stockwell',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/review-notes.md' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows non-target agent ba writing src/ (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-hannibal-writes.js — target: hannibal
// =============================================================================
describe('block-hannibal-writes — agent guards', () => {
  const HOOK = hookPath('block-hannibal-writes.js');

  it('blocks hannibal writing src/ file (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks hannibal writing a test file (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('allows non-target agent ba writing src/ (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows non-target agent murdock writing test file (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/auth.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore writing src/ (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    // block-hannibal-writes is a frontmatter hook for hannibal's subagent session;
    // after guard is added, null agent (unknown session) should fail-open
    const result = runHook(HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('hannibal can write ateam.config.json (allowed)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Write',
      tool_input: { file_path: 'ateam.config.json' },
    });
    expect(result.exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Regression: hook is named *-WRITES but currently also blocks Reads/Glob/Grep.
  // Hannibal must be able to read source files to orchestrate and report
  // status. Mirror of the Murdock M-20260428-003 over-blocking bug.
  // ---------------------------------------------------------------------------
  it('allows hannibal reading src/services/auth.ts (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Read',
      tool_input: { file_path: 'src/services/auth.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows hannibal reading any src/** file (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Read',
      tool_input: { file_path: 'src/components/Button.tsx' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows hannibal Glob-ing src/**/*.ts (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Glob',
      tool_input: { pattern: 'src/**/*.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows hannibal Grep-ing src/** (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Grep',
      tool_input: { pattern: 'export', path: 'src/' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('still blocks hannibal Write to src/whatever.ts (exit 2, regression guard)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Write',
      tool_input: { file_path: 'src/whatever.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  // ---------------------------------------------------------------------------
  // NotebookEdit / MultiEdit path-extraction coverage (PR #35 fix)
  // NotebookEdit uses notebook_path, not file_path — must not bypass block.
  // MultiEdit uses file_path (same as Write/Edit) — verified here for parity.
  // ---------------------------------------------------------------------------
  it('blocks hannibal MultiEdit to src/whatever.ts (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'MultiEdit',
      tool_input: { file_path: 'src/whatever.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks hannibal NotebookEdit to src/whatever.ipynb via notebook_path (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'src/whatever.ipynb' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });
});

// =============================================================================
// block-raw-echo-log.js — target: murdock,ba,lynch,amy,frankie,stockwell,tawnia
// NOTE: blocks via JSON stdout { decision: "block" } at exit 0, NOT exit 2
// =============================================================================
describe('block-raw-echo-log — agent guards (JSON block, exit 0)', () => {
  const HOOK = hookPath('block-raw-echo-log.js');

  it('outputs { decision: "block" } JSON for murdock echoing to activity.log', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Bash',
      tool_input: { command: 'echo "test" >> mission/activity.log' },
    });
    expect(result.exitCode).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('outputs { decision: "block" } JSON for amy echoing to activity.log', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Bash',
      tool_input: { command: 'echo "result" >> mission/activity.log' },
    });
    expect(result.exitCode).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('outputs { decision: "block" } JSON for frankie echoing to activity.log', () => {
    const result = runHook(HOOK, {
      agent_type: 'frankie',
      tool_name: 'Bash',
      tool_input: { command: 'echo "walk complete" >> mission/activity.log' },
    });
    expect(result.exitCode).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('outputs { decision: "block" } JSON for stockwell echoing to activity.log', () => {
    const result = runHook(HOOK, {
      agent_type: 'stockwell',
      tool_name: 'Bash',
      tool_input: { command: 'echo "FINAL APPROVED" >> mission/activity.log' },
    });
    expect(result.exitCode).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('allows non-target agent hannibal echoing to activity.log (exit 0, no block)', () => {
    // hannibal is the orchestrator — block-raw-echo-log targets workers only
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Bash',
      tool_input: { command: 'echo "test" >> mission/activity.log' },
    });
    expect(result.exitCode).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('allows non-target agent face (exit 0, no block)', () => {
    const result = runHook(HOOK, {
      agent_type: 'face',
      tool_name: 'Bash',
      tool_input: { command: 'echo "test" >> mission/activity.log' },
    });
    expect(result.exitCode).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('allows unknown agent Explore (exit 0, fail-open, no block)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Bash',
      tool_input: { command: 'echo "test" >> mission/activity.log' },
    });
    expect(result.exitCode).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'echo "test" >> mission/activity.log' },
    });
    expect(result.exitCode).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });

  it('does NOT block tawnia echoing to non-activity-log (normal echo is fine)', () => {
    const result = runHook(HOOK, {
      agent_type: 'tawnia',
      tool_name: 'Bash',
      tool_input: { command: 'echo "hello world"' },
    });
    expect(result.exitCode).toBe(0);
    const output = parseOutput(result.stdout);
    expect(output.decision).not.toBe('block');
  });
});

// =============================================================================
// block-raw-mv.js — target: hannibal
// =============================================================================
describe('block-raw-mv — agent guards', () => {
  const HOOK = hookPath('block-raw-mv.js');

  it('blocks hannibal mv-ing mission files (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Bash',
      tool_input: { command: 'mv mission/ready/WI-001 mission/done/WI-001' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('allows non-target agent ba to use mv on mission files (exit 0)', () => {
    // Workers should never touch mission files, but this hook only guards hannibal
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Bash',
      tool_input: { command: 'mv mission/ready/WI-001 mission/done/WI-001' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows non-target agent murdock to use mv (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Bash',
      tool_input: { command: 'mv mission/ready/WI-001 mission/done/WI-001' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Bash',
      tool_input: { command: 'mv mission/ready/WI-001 mission/done/WI-001' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'mv mission/ready/WI-001 mission/done/WI-001' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('hannibal can still mv non-mission files (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Bash',
      tool_input: { command: 'mv old-config.json new-config.json' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-worker-board-claim.js — target: murdock,ba,lynch,lynch-final,stockwell,amy,frankie,tawnia
// =============================================================================
describe('block-worker-board-claim — agent guards', () => {
  const HOOK = hookPath('block-worker-board-claim.js');

  it('blocks murdock calling ateam board-claim via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks ba calling ateam board-claim via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks lynch calling ateam board-claim via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks amy calling ateam board-claim via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks tawnia calling ateam board-claim via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'tawnia',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks lynch-final calling ateam board-claim via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch-final',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks frankie calling ateam board-claim via Bash (exit 2)', () => {
    // ADR 0005: Frankie never claims board items — his walk uses no item claim.
    const result = runHook(HOOK, {
      agent_type: 'frankie',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks stockwell calling ateam board-claim via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'stockwell',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('allows non-target agent hannibal to call ateam board-claim (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore to call ateam board-claim (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-claim WI-001' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-worker-board-move.js — target: murdock,ba,lynch,lynch-final,stockwell,amy,frankie,tawnia
// =============================================================================
describe('block-worker-board-move — agent guards', () => {
  const HOOK = hookPath('block-worker-board-move.js');

  it('blocks murdock calling ateam board-move via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'murdock',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to review' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks ba calling ateam board-move via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to review' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks lynch calling ateam board-move via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to probing' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks amy calling ateam board-move via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'amy',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to done' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks tawnia calling ateam board-move via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'tawnia',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to done' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks stockwell calling ateam board-move via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'stockwell',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to done' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks frankie calling ateam board-move via Bash (exit 2)', () => {
    // ADR 0005: `done` is terminal — Frankie reports failures, never moves items.
    const result = runHook(HOOK, {
      agent_type: 'frankie',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-007 --to implementing' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks lynch-final calling ateam board-move via Bash (exit 2)', () => {
    const result = runHook(HOOK, {
      agent_type: 'lynch-final',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to done' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('allows non-target agent hannibal to call ateam board-move (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'hannibal',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to done' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows unknown agent Explore to call ateam board-move (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      agent_type: 'Explore',
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to done' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows null/missing agent_type (exit 0, fail-open)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Bash',
      tool_input: { command: 'ateam board-move WI-001 --to done' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// block-frankie-writes.js — target: frankie
//
// Enforces Frankie's two structural hard rules from prd/ready/010-frankie-profile.md:
// never fix the code (no implementation/test writes), and never edit an
// existing file under specs/ (graduated specs are immutable — new flow files
// only). His evidence bundle under .qa-evidence/ writes freely.
// =============================================================================
describe('block-frankie-writes — agent guards', () => {
  const HOOK = hookPath('block-frankie-writes.js');

  // The hook resolves relative file paths against its own process cwd, which
  // inherits the test runner's cwd (repo root) — runHook's execFileSync does
  // not override cwd. So "already exists under specs/" can only be exercised
  // with a REAL file on disk at that relative path; fs.existsSync cannot be
  // satisfied any other way without also mocking the hook process's own fs
  // module (a separate child process — vi.spyOn in this file would not reach
  // it). Create a real, throwaway fixture for the duration of this describe
  // block and remove it afterward. This repo has no specs/ directory
  // otherwise (verified before adding this), so only remove the directory
  // if it ends up empty — never touch it if something else populated it
  // concurrently.
  const SPECS_DIR = join(REPO_ROOT, 'specs');
  const EXISTING_SPEC_PATH = join(SPECS_DIR, 'checkout.flow.yaml');

  beforeAll(() => {
    mkdirSync(SPECS_DIR, { recursive: true });
    writeFileSync(EXISTING_SPEC_PATH, 'name: checkout\nsteps: []\n');
  });

  afterAll(() => {
    rmSync(EXISTING_SPEC_PATH, { force: true });
    try {
      rmdirSync(SPECS_DIR); // throws ENOTEMPTY (not recursive) if anything else is in there — leave it alone
    } catch {
      // Directory not empty (something else is using it concurrently) — leave it.
    }
  });

  it('blocks frankie writing an implementation file (exit 2, names the path, tells him to bounce to B.A.)', () => {
    const result = runHook(HOOK, {
      agent_type: 'frankie',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/order.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
    expect(result.stderr).toMatch(/src\/services\/order\.ts/);
    expect(result.stderr).toMatch(/B\.A\./i);
    expect(result.stderr).toMatch(/repro/i);
  });

  it('blocks frankie editing a test file (exit 2, names the path, tells him to bounce to B.A.)', () => {
    const result = runHook(HOOK, {
      agent_type: 'frankie',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/__tests__/order.test.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
    expect(result.stderr).toMatch(/src\/__tests__\/order\.test\.ts/);
    expect(result.stderr).toMatch(/B\.A\./i);
    expect(result.stderr).toMatch(/repro/i);
  });

  it('blocks frankie editing a file that already exists under specs/ (exit 2, immutability message)', () => {
    const result = runHook(HOOK, {
      agent_type: 'frankie',
      tool_name: 'Edit',
      tool_input: { file_path: 'specs/checkout.flow.yaml' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
    expect(result.stderr).toMatch(/immutable/i);
  });

  it('allows frankie writing a NEW file under specs/ that does not yet exist (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'frankie',
      tool_name: 'Write',
      tool_input: { file_path: 'specs/new-checkout-flow.flow.yaml' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows frankie writing anywhere under .qa-evidence/ (exit 0)', () => {
    const result = runHook(HOOK, {
      agent_type: 'frankie',
      tool_name: 'Write',
      tool_input: { file_path: '.qa-evidence/M-20260812-003/report.md' },
    });
    expect(result.exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Adversarial path-traversal matrix (Amy's rejection, round 3).
  //
  // isUnderDir() must reject any file_path containing a literal ".." PATH
  // SEGMENT before treating it as "under" specs/ or .qa-evidence/ — checked
  // by splitting on "/" and testing for an exact ".." component, not by a
  // naive substring/startsWith check on the raw string. Any ".." segment
  // anywhere in the path falls through to the default block branch (the
  // same "implementation/test territory" exit-2 path already required by
  // AC1) regardless of what it would resolve to — categorical denial, not
  // best-effort normalization. This is deliberately strict: even a traversal
  // segment that happens to cancel out to a benign specs/ path is rejected
  // (case below), because Frankie has no legitimate reason to ever construct
  // a path containing ".." in the first place.
  //
  // Dimensions covered: traversal position (embedded / leading / multiple),
  // target directory (specs/ vs .qa-evidence/ — the latter had NO existsSync
  // guard at all per Amy's report, so is the higher-severity variant),
  // resolved-target existence (new file vs a real existing file), and
  // false-positive avoidance (a literal ".." substring that is part of a
  // filename, not a path segment, must NOT be treated as traversal).
  // ---------------------------------------------------------------------------
  describe('adversarial: ".." path-traversal segments must never escape specs/ or .qa-evidence/', () => {
    const BLOCKED_TRAVERSAL_CASES = [
      [
        'embedded traversal escapes specs/ into a NEW implementation-directory file',
        'specs/../src/services/order-traversal-should-not-exist.ts',
      ],
      [
        'embedded traversal escapes .qa-evidence/ into an EXISTING real implementation file (no existsSync guard on this branch at all)',
        '.qa-evidence/../packages/shared/src/agents.ts',
      ],
      ['leading traversal before any real segment', '../specs/escape-traversal.flow.yaml'],
      ['multiple traversal segments escaping specs/', 'specs/a/../../src/multi-traversal-should-not-exist.ts'],
      [
        'multiple/nested traversal segments escaping .qa-evidence/ into an existing file',
        '.qa-evidence/../.qa-evidence/../../packages/shared/src/agents.ts',
      ],
      [
        'traversal segment present even though it resolves to a benign specs/ path (strict categorical denial)',
        'specs/sub/../benign-after-resolution.flow.yaml',
      ],
    ];

    for (const [label, filePath] of BLOCKED_TRAVERSAL_CASES) {
      it(`blocks: ${label} (exit 2)`, () => {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: filePath.includes('agents.ts') ? 'Edit' : 'Write',
          tool_input: { file_path: filePath },
        });
        expect(result.exitCode, `file_path=${filePath}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
      });
    }

    it('regression: a nested NEW specs/ file with no traversal is still allowed (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Write',
        tool_input: { file_path: 'specs/sub/nested-new-flow.flow.yaml' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('regression: a nested .qa-evidence/ file with no traversal is still allowed (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Write',
        tool_input: { file_path: '.qa-evidence/M-20260812-003/screenshots/step1.png' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('regression: a literal ".." substring inside a filename (not a path segment) is NOT treated as traversal (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Write',
        tool_input: { file_path: 'specs/release-notes..v2.flow.yaml' },
      });
      expect(result.exitCode).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Second escape vector on the same helper (sweep review, CRITICAL): even
    // with every ".." segment denied, an UNANCHORED match on the raw string
    // ("does the path contain a component named specs/.qa-evidence anywhere?")
    // treats any path with a same-named component as allowlisted. That covers
    // real production code nested inside the repo (packages/shared/src/specs/…)
    // AND anything at all on the filesystem outside the repo (/tmp/x/specs/…).
    // Frankie runs with permissionMode: acceptEdits, so this hook is the only
    // barrier — there is no human confirmation behind it.
    //
    // The allowlist must therefore be anchored: resolve the path against the
    // process cwd (the target project root) and prefix-match against the
    // repo-root specs/ and .qa-evidence/ directories themselves.
    // -------------------------------------------------------------------------
    describe('adversarial: allowlisted dirs are anchored at the repo root, not matched by component name', () => {
      const BLOCKED_LOOKALIKE_CASES: Array<[string, string]> = [
        [
          'nested in-repo path with a "specs" component that is NOT the repo-root specs/ dir',
          'packages/shared/src/specs/hack.ts',
        ],
        [
          'nested in-repo path with a ".qa-evidence" component that is NOT the repo-root .qa-evidence/ dir',
          'packages/kanban-viewer/.qa-evidence/exfil.ts',
        ],
        [
          'absolute out-of-repo path with a "/specs/" component',
          '/tmp/ateam-hook-escape/specs/pwn.sh',
        ],
        [
          'absolute out-of-repo path with a "/.qa-evidence/" component',
          '/tmp/ateam-hook-escape/.qa-evidence/exfil.md',
        ],
        [
          'sibling directory whose name merely starts with the allowlisted name (specs-backup/)',
          'specs-backup/order.ts',
        ],
        [
          'sibling directory whose name merely starts with the allowlisted name (.qa-evidence-old/)',
          '.qa-evidence-old/order.ts',
        ],
      ];

      for (const [label, filePath] of BLOCKED_LOOKALIKE_CASES) {
        it(`blocks: ${label} (exit 2)`, () => {
          const result = runHook(HOOK, {
            agent_type: 'frankie',
            tool_name: 'Write',
            tool_input: { file_path: filePath },
          });
          expect(result.exitCode, `file_path=${filePath}`).toBe(2);
          expect(result.stderr).toMatch(/BLOCKED/i);
        });
      }

      it('regression: an ABSOLUTE path to a NEW file under the real repo-root specs/ is still allowed (exit 0)', () => {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Write',
          tool_input: { file_path: join(REPO_ROOT, 'specs', 'abs-new-flow.flow.yaml') },
        });
        expect(result.exitCode).toBe(0);
      });

      it('regression: an ABSOLUTE path to a NEW file under the real repo-root .qa-evidence/ is still allowed (exit 0)', () => {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Write',
          tool_input: { file_path: join(REPO_ROOT, '.qa-evidence', 'M-20260812-003', 'report.md') },
        });
        expect(result.exitCode).toBe(0);
      });

      it('regression: an ABSOLUTE path to an EXISTING file under the real repo-root specs/ is still blocked as immutable (exit 2)', () => {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Edit',
          tool_input: { file_path: EXISTING_SPEC_PATH },
        });
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
        expect(result.stderr).toMatch(/immutable/i);
      });

      it('regression: a "./"-prefixed relative path to a NEW repo-root specs/ file is still allowed (exit 0)', () => {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Write',
          tool_input: { file_path: './specs/dot-slash-new-flow.flow.yaml' },
        });
        expect(result.exitCode).toBe(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Fresh-spec edit window (finding B5): "immutable" is judged against a
  // session-scoped snapshot of specs/ taken on the hook's FIRST invocation
  // for a session (keyed by stdin's session_id, stored under
  // <tmpdir>/ateam-frankie-spec-snapshot/<session_id>.json). A flow file
  // Frankie creates AFTER the snapshot is his own in-mission draft and stays
  // editable by him; anything present AT the snapshot is a graduated spec and
  // stays immutable (PRD 010 §2.5). Missing/unsafe session_id or any snapshot
  // read/write failure falls back to the strict at-call-time existsSync
  // behavior — errors fail CLOSED, never open.
  // ---------------------------------------------------------------------------
  describe('session-scoped spec snapshot: fresh-spec edit window (finding B5)', () => {
    const RUN_TAG = `${process.pid}-${Date.now()}`; // unique per run — never reuse a stale snapshot
    const SNAPSHOT_DIR = join(tmpdir(), 'ateam-frankie-spec-snapshot');
    const MID_SESSION_SPEC = join(SPECS_DIR, 'mid-session-draft.flow.yaml');
    const SECOND_SESSION_SPEC = join(SPECS_DIR, 'first-session-draft.flow.yaml');
    const STRICT_FALLBACK_SPEC = join(SPECS_DIR, 'strict-fallback.flow.yaml');

    /** Warm-up invocation that freezes the session's specs/ snapshot. */
    function takeSnapshot(sessionId: string) {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Write',
        tool_input: { file_path: '.qa-evidence/snapshot-warmup/report.md' },
      });
      expect(result.exitCode).toBe(0); // .qa-evidence is always allowed
    }

    afterAll(() => {
      rmSync(MID_SESSION_SPEC, { force: true });
      rmSync(SECOND_SESSION_SPEC, { force: true });
      rmSync(STRICT_FALLBACK_SPEC, { force: true });
      // Remove only THIS run's snapshot files — the dir is shared with any
      // concurrently running real session, so never rm it wholesale.
      for (const name of ['preexisting', 'midsession', 'session-a', 'session-b', 'newwrite']) {
        rmSync(join(SNAPSHOT_DIR, `frankie-b5-${name}-${RUN_TAG}.json`), { force: true });
      }
    });

    it('still blocks editing a spec that pre-dates the session snapshot (exit 2, immutable)', () => {
      const sessionId = `frankie-b5-preexisting-${RUN_TAG}`;
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('allows editing a spec created AFTER the session snapshot (Frankie fixing his own fresh draft, exit 0)', () => {
      const sessionId = `frankie-b5-midsession-${RUN_TAG}`;
      takeSnapshot(sessionId);

      // Simulate Frankie's own Write landing after the snapshot was taken.
      writeFileSync(MID_SESSION_SPEC, 'name: mid-session draft\nsteps: []\n');

      const result = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/mid-session-draft.flow.yaml' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('a SECOND session (different session_id) treats the first session\'s new spec as immutable (exit 2)', () => {
      const firstSession = `frankie-b5-session-a-${RUN_TAG}`;
      const secondSession = `frankie-b5-session-b-${RUN_TAG}`;

      // Session A: snapshot, then author a new flow file.
      takeSnapshot(firstSession);
      writeFileSync(SECOND_SESSION_SPEC, 'name: first-session draft\nsteps: []\n');

      // Session A can still edit its own draft…
      const sameSession = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: firstSession,
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/first-session-draft.flow.yaml' },
      });
      expect(sameSession.exitCode).toBe(0);

      // …but session B's snapshot is taken NOW, with the file on disk: graduated.
      const crossSession = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: secondSession,
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/first-session-draft.flow.yaml' },
      });
      expect(crossSession.exitCode).toBe(2);
      expect(crossSession.stderr).toMatch(/BLOCKED/i);
      expect(crossSession.stderr).toMatch(/immutable/i);
    });

    it('missing session_id falls back to strict existsSync behavior (existing file blocked, exit 2)', () => {
      writeFileSync(STRICT_FALLBACK_SPEC, 'name: strict fallback\nsteps: []\n');

      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/strict-fallback.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('a filesystem-unsafe session_id also falls back to strict behavior instead of trusting it as a filename (exit 2)', () => {
      writeFileSync(STRICT_FALLBACK_SPEC, 'name: strict fallback\nsteps: []\n');

      const result = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: '../../session-escape',
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/strict-fallback.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('with a session snapshot active, writing a brand-new spec file is still allowed (exit 0, regression)', () => {
      const sessionId = `frankie-b5-newwrite-${RUN_TAG}`;
      takeSnapshot(sessionId);

      const result = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Write',
        tool_input: { file_path: 'specs/brand-new-after-snapshot.flow.yaml' },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot trust hardening (CodeRabbit PR #55, FIX 6). Two fail-OPEN
  // inversions of the fail-closed contract above:
  //   (a) SNAPSHOT_DIR sits under the world-writable system tmpdir with
  //       default mkdirSync perms — any other local process could pre-create
  //       <tmpdir>/ateam-frankie-spec-snapshot/<session_id>.json containing a
  //       bare `[]`, making every pre-existing graduated spec look "new" and
  //       therefore editable.
  //   (b) the payload was a bare array of paths with no cwd binding, so a
  //       snapshot taken from a different working directory could be reused
  //       to (mis)judge "new" for this one.
  // Fixed by writing `{ cwd, specs }` (0o600) into a 0o700 SNAPSHOT_DIR, and
  // by rejecting (→ strict existsSync fallback) any payload that is the
  // legacy bare-array shape, is malformed, or whose cwd doesn't match.
  // ---------------------------------------------------------------------------
  describe('snapshot trust hardening: forged/foreign snapshots fall back to strict (finding FIX 6)', () => {
    const RUN_TAG_B6 = `${process.pid}-${Date.now()}-b6`;
    const SNAPSHOT_DIR = join(tmpdir(), 'ateam-frankie-spec-snapshot');

    afterAll(() => {
      for (const name of ['legacy-array', 'foreign-cwd', 'own-draft']) {
        rmSync(join(SNAPSHOT_DIR, `frankie-b6-${name}-${RUN_TAG_B6}.json`), { force: true });
      }
      rmSync(join(SPECS_DIR, 'b6-own-draft.flow.yaml'), { force: true });
    });

    it('a pre-seeded legacy bare-array snapshot ([]) no longer permits editing an existing graduated spec (exit 2, immutable)', () => {
      const sessionId = `frankie-b6-legacy-array-${RUN_TAG_B6}`;
      // Simulate a hostile/pre-existing process planting the OLD shape before
      // Frankie's hook ever runs for this session — an empty legacy array
      // claims "nothing existed at session start", which would make the
      // real, pre-existing checkout.flow.yaml look new under the old code.
      mkdirSync(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(join(SNAPSHOT_DIR, `${sessionId}.json`), JSON.stringify([]), { mode: 0o600 });

      const result = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('a snapshot recorded under a different cwd falls back to strict (existing spec stays immutable, exit 2)', () => {
      const sessionId = `frankie-b6-foreign-cwd-${RUN_TAG_B6}`;
      mkdirSync(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
      // A well-formed { cwd, specs } payload, but cwd points somewhere else —
      // e.g. a snapshot taken while running from a different working
      // directory. Its claim that specs/checkout.flow.yaml "didn't exist"
      // must not be trusted for THIS process's cwd.
      writeFileSync(
        join(SNAPSHOT_DIR, `${sessionId}.json`),
        JSON.stringify({ cwd: '/nonexistent/other-project', specs: [] }),
        { mode: 0o600 }
      );

      const result = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('happy path still works: Frankie can create and then edit HIS OWN new flow file within a session (exit 0)', () => {
      const sessionId = `frankie-b6-own-draft-${RUN_TAG_B6}`;

      // First invocation of the session takes the real snapshot (freezes
      // "graduated" = whatever's on disk right now, which does not include
      // the file below).
      const warmup = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Write',
        tool_input: { file_path: 'specs/b6-own-draft.flow.yaml' },
      });
      expect(warmup.exitCode).toBe(0);

      // Simulate the Write actually landing on disk, then Frankie editing
      // his own fresh draft in the same session.
      writeFileSync(join(SPECS_DIR, 'b6-own-draft.flow.yaml'), 'name: b6 own draft\nsteps: []\n');

      const edit = runHook(HOOK, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/b6-own-draft.flow.yaml' },
      });
      expect(edit.exitCode).toBe(0);

      // Sanity: the on-disk snapshot for this session is the new shape, not
      // the legacy bare array.
      const raw = readFileSync(join(SNAPSHOT_DIR, `${sessionId}.json`), 'utf8');
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(false);
      expect(parsed.cwd).toBe(REPO_ROOT);
      expect(Array.isArray(parsed.specs)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Bash bypass (CodeRabbit PR #55, FIX 7). Write/Edit tool gating alone
  // doesn't stop Frankie from using Bash to write into a protected path
  // (`bash -c 'echo x > specs/foo.flow.yaml'`). Full shell interdiction is
  // impossible — this is a best-effort pattern scan (mirrors
  // block-ba-bash-restrictions.js), not a sandbox: it recognizes common
  // write-shaped ops (redirection, tee, mv/cp destinations, rm/rmdir, sed
  // -i, touch, truncate, dd of=) and classifies their target path with the
  // exact same allow/block rule Write/Edit uses. Unrecognized syntax fails
  // open; a recognized op targeting a protected path fails closed.
  // ---------------------------------------------------------------------------
  describe('Bash bypass: write-shaped shell commands into protected paths (finding FIX 7)', () => {
    it('blocks a redirect into an existing graduated spec (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo "hacked" > specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('blocks a redirect appending into an existing graduated spec via >> (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo "extra step" >> specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('blocks `sed -i` on an implementation file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: "sed -i 's/foo/bar/' src/services/order.ts" },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('blocks `rm` on a test file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'rm src/__tests__/order.test.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('blocks `mv` whose destination is an implementation file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv /tmp/scratch.ts src/services/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('blocks `tee` writing into an implementation file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo "x" | tee src/services/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('blocks `dd of=` targeting a test file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'dd if=/dev/zero of=src/__tests__/order.test.ts bs=1 count=0' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('allows a redirect into .qa-evidence/<mission>/report.md (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo "walk complete" > .qa-evidence/M-20260817-001/report.md' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows `touch` on a brand-new specs/ flow file (exit 0, consistent with Write/Edit rules)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'touch specs/bash-new-flow.flow.yaml' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows plain `ls` (exit 0, no write op recognized)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la specs/' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows plain `grep` (exit 0, no write op recognized)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'grep -r "checkout" src/' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows a plain `ateam` CLI invocation (exit 0, no write op recognized)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'ateam board-move moveItem --itemId WI-100 --toStage testing' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('blocks a protected write buried after a benign command via && (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'ls specs/ && echo "hacked" > specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('allows non-target agent ba to run the same write-shaped Bash command (exit 0, no interference)', () => {
      const result = runHook(HOOK, {
        agent_type: 'ba',
        tool_name: 'Bash',
        tool_input: { command: 'echo "fine" > src/services/order.ts' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('exits 0 when tool_input.command is missing (exit 0, fail-open)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: {},
      });
      expect(result.exitCode).toBe(0);
    });

    // -------------------------------------------------------------------------
    // False-positive guards: naive redirect scanning would otherwise treat
    // extremely common, benign shell idioms as protected-path writes.
    // -------------------------------------------------------------------------
    it('does not block fd-duplication (`2>&1`) as a write to a path named "&1" (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'npx playwright test 2>&1 | tee .qa-evidence/M-1/run.log' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('does not block redirecting to /dev/null (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'some-noisy-command > /dev/null 2>&1' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('does not mis-split on a shell metacharacter INSIDE a quoted argument (exit 0)', () => {
      // A literal ";" inside a quoted --summary must not be treated as a
      // statement separator that then exposes "needs fix\"" as a bogus
      // write target.
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: {
          command: 'ateam agents-stop agentStop --itemId WI-1 --agent frankie --outcome completed --summary "found bug; needs fix"',
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('does not treat ">" INSIDE a quoted argument as a redirect operator (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'ateam items updateItem --id WI-1 --description "before > after"' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('still blocks a real redirect that FOLLOWS a quoted argument containing metacharacters (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo "before > after; still one statement" > specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    // -------------------------------------------------------------------------
    // Redirect glued to the PRECEDING token (sweep finding #1). The tokenizer
    // treats `hi>specs/x.flow.yaml` as one opaque word, so an operator that
    // does not start its own token used to extract ZERO targets — every
    // `echo hi>file` form sailed through while the byte-identical spaced form
    // `echo hi > file` was blocked. Bash makes no such distinction, and
    // neither may this scan. padRedirectOperators() normalizes the spacing
    // before tokenizing.
    // -------------------------------------------------------------------------
    it('blocks a redirect glued to the preceding token into an existing graduated spec (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi>specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('blocks a redirect glued to a QUOTED preceding token into an implementation file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo "hi">src/app.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/src\/app\.ts/);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('blocks a glued APPEND redirect (>>) into an existing graduated spec (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'cat file>>specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('blocks a glued fd-qualified redirect (2>) into an implementation file (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'some-command 2>src/services/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('regression: the spaced forms of the same redirects are still blocked (exit 2)', () => {
      for (const command of [
        'echo hi > specs/checkout.flow.yaml',
        'echo "hi" > src/app.ts',
        'cat file >> specs/checkout.flow.yaml',
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
      }
    });

    it('regression: glued redirects into allowed paths are still allowed (exit 0)', () => {
      for (const command of [
        'echo "walk complete">.qa-evidence/M-20260817-001/report.md',
        'echo "new flow">>specs/glued-new-flow.flow.yaml',
        'noisy-command>/dev/null 2>&1',
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });

    it('regression: a digit run that is part of a WORD is not mistaken for an fd prefix (exit 2, target still extracted)', () => {
      // `hi2>file` is the word "hi2" followed by `>file` — not fd 2. Either
      // reading must still surface `src/app.ts` as the write target.
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi2>src/app.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/app\.ts/);
    });
  });

  // ---------------------------------------------------------------------------
  // Heredoc bodies are DATA, not statements (sweep finding #6). The statement
  // splitter treats a newline as a separator, so every line of a heredoc body
  // used to be scanned as its own command — which blocked Frankie writing his
  // OWN evidence bundle: a markdown blockquote (`> Expected the total ...`)
  // reads as a redirect to a file named "Expected", and prose like
  // `see report>summary` reads as a glued redirect once padRedirectOperators()
  // normalizes it. The opener LINE is still scanned (its `> path` is a real
  // write), and an unterminated heredoc still scans everything (fail closed).
  // ---------------------------------------------------------------------------
  describe('heredoc bodies: prose is not scanned as commands (finding FIX/sweep #6)', () => {
    it('allows a heredoc whose body contains blockquote and comparison prose, when the sink is .qa-evidence/ (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: {
          command: [
            'cat > .qa-evidence/M-20260817-001/report.md <<EOF',
            '> Expected the total to update',
            'latency 200 > 100 budget',
            'see report>summary',
            'EOF',
          ].join('\n'),
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows a QUOTED heredoc (<<\'EOF\') whose body names an implementation path in prose (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: {
          command: [
            "cat >> .qa-evidence/M-20260817-001/report.md <<'EOF'",
            '> the failure surfaced in src/app.ts > line 40',
            'EOF',
          ].join('\n'),
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows a tab-indented heredoc (<<-EOF) whose terminator is tab-indented (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: {
          command: ['cat > .qa-evidence/M-1/notes.md <<-EOF', '\t> checkout > cart regression', '\tEOF'].join('\n'),
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('still blocks the heredoc OPENER line when it redirects into an implementation file (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'cat > src/app.ts <<EOF\nexport const patched = true;\nEOF' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/src\/app\.ts/);
    });

    it('still blocks the heredoc OPENER line when it redirects into an existing graduated spec (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'cat > specs/checkout.flow.yaml <<EOF\nname: hacked\nEOF' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('still blocks a real write on a line AFTER the heredoc terminator (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: {
          command: [
            'cat > .qa-evidence/M-1/report.md <<EOF',
            '> just prose here',
            'EOF',
            'echo "patched" > src/services/order.ts',
          ].join('\n'),
        },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
    });

    it('fails CLOSED on an UNTERMINATED heredoc — every line is still scanned (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: {
          command: ['cat > .qa-evidence/M-1/report.md <<EOF', 'echo "patched" > src/services/order.ts'].join('\n'),
        },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
    });

    it('does not treat a here-STRING (<<<) as a heredoc opener — the following line is still scanned (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'grep foo <<< "haystack"\necho "patched" > src/app.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/app\.ts/);
    });
  });

  // ---------------------------------------------------------------------------
  // Subshell-wrapped writes (sweep finding #7). `(echo hi > specs/x.flow.yaml)`
  // tokenizes with the closing paren glued to the path, so the graduated-spec
  // lookup missed and the write classified as a NEW spec (allowed) rather than
  // an edit to an existing one (blocked). pushTarget() now peels the wrapper
  // punctuation off before classification. (`bash -c "..."` wrapping remains
  // out of scope — this scan is documented best-effort, not a shell sandbox.)
  // ---------------------------------------------------------------------------
  describe('subshell-wrapped writes: wrapper punctuation must not launder the target (finding sweep #7)', () => {
    it('blocks a subshell-wrapped redirect into an existing graduated spec (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: '(echo hi > specs/checkout.flow.yaml)' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
      expect(result.stderr).toMatch(/specs\/checkout\.flow\.yaml(?!\))/);
    });

    it('blocks a subshell-wrapped redirect into an implementation file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: '(echo hi > src/services/order.ts)' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('blocks a brace-group redirect terminated by ";" into an existing graduated spec (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: '{ echo hi > specs/checkout.flow.yaml; }' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('regression: a subshell-wrapped write into an allowed path is still allowed (exit 0)', () => {
      for (const command of [
        '(echo "walk complete" > .qa-evidence/M-20260817-001/report.md)',
        '(echo "new flow" > specs/subshell-new-flow.flow.yaml)',
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Symlink escapes (sweep finding #2). path.resolve() never follows symlinks,
  // so a lexical prefix match answers "is this path spelled like it is under
  // .qa-evidence/?" — not "does writing here land under .qa-evidence/?". Two
  // escapes follow: a link INSIDE an allowed dir pointing at implementation
  // code (`ln -s ../../src/services/order.ts .qa-evidence/M-1/x`, then Write
  // to that path), and the allowed dir ITSELF being a link planted before it
  // exists (`ln -s / .qa-evidence`, which would make the entire filesystem
  // "allowed"). Both are closed by canonicalizing through realpath and
  // re-checking containment, and `ln` is now a recognized write command so the
  // Bash half is caught at link-creation time too.
  //
  // These run in a throwaway sandbox project rather than the repo root: the
  // vectors require planting symlinks at fixed names (.qa-evidence, specs/)
  // that other tests — and other agents working in this tree — depend on.
  // ---------------------------------------------------------------------------
  describe('adversarial: symlinks must not launder a write out of an allowlisted directory', () => {
    const SANDBOXES: string[] = [];

    /** Same contract as runHook(), but with an explicit cwd (the hook anchors its allowlist on process.cwd()). */
    function runHookIn(cwd: string, stdin: object) {
      try {
        const stdout = execFileSync('node', [HOOK], {
          cwd,
          env: { ...process.env, ATEAM_API_URL: 'http://localhost:3000', ATEAM_PROJECT_ID: 'test-project' },
          encoding: 'utf8',
          timeout: 5000,
          input: JSON.stringify(stdin),
        });
        return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
      } catch (err: any) {
        return { stdout: (err.stdout || '').trim(), stderr: (err.stderr || '').trim(), exitCode: err.status ?? 1 };
      }
    }

    function newSandbox() {
      const dir = mkdtempSync(join(tmpdir(), 'ateam-frankie-symlink-'));
      SANDBOXES.push(dir);
      return dir;
    }

    afterAll(() => {
      for (const dir of SANDBOXES) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('blocks a Write through a symlink inside .qa-evidence/ that points at implementation code (exit 2)', () => {
      const proj = newSandbox();
      mkdirSync(join(proj, 'src', 'services'), { recursive: true });
      writeFileSync(join(proj, 'src', 'services', 'order.ts'), 'export const order = 1;\n');
      mkdirSync(join(proj, '.qa-evidence', 'M-1'), { recursive: true });
      symlinkSync(join('..', '..', 'src', 'services', 'order.ts'), join(proj, '.qa-evidence', 'M-1', 'escape'));

      const result = runHookIn(proj, {
        agent_type: 'frankie',
        tool_name: 'Write',
        tool_input: { file_path: '.qa-evidence/M-1/escape' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('blocks an Edit through a symlink inside specs/ that points at implementation code (exit 2)', () => {
      const proj = newSandbox();
      mkdirSync(join(proj, 'src'), { recursive: true });
      writeFileSync(join(proj, 'src', 'order.ts'), 'export const order = 1;\n');
      mkdirSync(join(proj, 'specs'), { recursive: true });
      symlinkSync(join('..', 'src', 'order.ts'), join(proj, 'specs', 'linked.flow.yaml'));

      const result = runHookIn(proj, {
        agent_type: 'frankie',
        tool_name: 'Edit',
        tool_input: { file_path: 'specs/linked.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('blocks a Write when .qa-evidence/ ITSELF is a symlink pointing outside the project (exit 2)', () => {
      const proj = newSandbox();
      const outside = newSandbox();
      symlinkSync(outside, join(proj, '.qa-evidence'));

      const result = runHookIn(proj, {
        agent_type: 'frankie',
        tool_name: 'Write',
        tool_input: { file_path: '.qa-evidence/report.md' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('blocks a Write under .qa-evidence/ when a nested directory is a symlink out of the project (exit 2)', () => {
      const proj = newSandbox();
      mkdirSync(join(proj, '.qa-evidence'), { recursive: true });
      symlinkSync('/etc', join(proj, '.qa-evidence', 'etclink'));

      const result = runHookIn(proj, {
        agent_type: 'frankie',
        tool_name: 'Write',
        tool_input: { file_path: '.qa-evidence/etclink/pwn.conf' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('blocks a Write through a DANGLING symlink inside .qa-evidence/ (unresolvable → fail closed, exit 2)', () => {
      const proj = newSandbox();
      mkdirSync(join(proj, '.qa-evidence', 'M-1'), { recursive: true });
      symlinkSync('/nonexistent-target-for-frankie-test', join(proj, '.qa-evidence', 'M-1', 'dangling'));

      const result = runHookIn(proj, {
        agent_type: 'frankie',
        tool_name: 'Write',
        tool_input: { file_path: '.qa-evidence/M-1/dangling' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('blocks `ln -s` whose link TARGET is implementation code, even when the link name is inside .qa-evidence/ (exit 2)', () => {
      const proj = newSandbox();
      mkdirSync(join(proj, 'src', 'services'), { recursive: true });
      writeFileSync(join(proj, 'src', 'services', 'order.ts'), 'export const order = 1;\n');
      mkdirSync(join(proj, '.qa-evidence', 'M-1'), { recursive: true });

      const result = runHookIn(proj, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: `ln -s ${join(proj, 'src', 'services', 'order.ts')} .qa-evidence/M-1/x` },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('regression: ordinary writes inside a genuinely-real .qa-evidence/ and specs/ are still allowed (exit 0)', () => {
      const proj = newSandbox();
      mkdirSync(join(proj, '.qa-evidence', 'M-1', 'screenshots'), { recursive: true });
      mkdirSync(join(proj, 'specs'), { recursive: true });

      for (const filePath of [
        '.qa-evidence/M-1/report.md',
        '.qa-evidence/M-1/screenshots/step1.png',
        '.qa-evidence/M-2/brand-new/report.md',
        'specs/brand-new.flow.yaml',
      ]) {
        const result = runHookIn(proj, {
          agent_type: 'frankie',
          tool_name: 'Write',
          tool_input: { file_path: filePath },
        });
        expect(result.exitCode, `file_path=${filePath}`).toBe(0);
      }
    });

    it('regression: a real `ln` into .qa-evidence/ whose target is also inside .qa-evidence/ is allowed (exit 0)', () => {
      const proj = newSandbox();
      mkdirSync(join(proj, '.qa-evidence', 'M-1'), { recursive: true });
      writeFileSync(join(proj, '.qa-evidence', 'M-1', 'report.md'), '# report\n');

      const result = runHookIn(proj, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'ln -s .qa-evidence/M-1/report.md .qa-evidence/M-1/latest.md' },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Directory targets at or under specs/ (bypass review, finding 1).
  //
  // `rm -rf specs` deletes every graduated spec in one stroke, yet it used to
  // be ALLOWED: "specs" IS under the spec root (isUnderDir counts the root
  // itself), but the session snapshot records only FILES — so the directory
  // missed the immutable lookup and classified as a brand-new spec. The file
  // form (`rm specs/login.flow.yaml`) blocked correctly the whole time; the
  // directory form was the hole.
  //
  // Rule: under the spec root, a target that IS the spec root, or names an
  // existing DIRECTORY beneath it, is immutable. The directory test is made at
  // call time (statSync), not from the snapshot, so a directory created
  // mid-session is equally un-deletable — it may already hold graduated specs.
  // .qa-evidence/ is deliberately NOT given directory immutability: that tree
  // is Frankie's own evidence bundle and he may reorganize or clean it.
  // ---------------------------------------------------------------------------
  describe('adversarial: directories at or under specs/ are immutable (finding 1: rm -rf specs)', () => {
    const SANDBOXES: string[] = [];
    const SESSIONS: string[] = [];
    const SNAPSHOT_DIR = join(tmpdir(), 'ateam-frankie-spec-snapshot');

    /** Same contract as runHook(), but with an explicit cwd (the hook anchors its allowlist on process.cwd()). */
    function runHookIn(cwd: string, stdin: object) {
      try {
        const stdout = execFileSync('node', [HOOK], {
          cwd,
          env: { ...process.env, ATEAM_API_URL: 'http://localhost:3000', ATEAM_PROJECT_ID: 'test-project' },
          encoding: 'utf8',
          timeout: 5000,
          input: JSON.stringify(stdin),
        });
        return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
      } catch (err: any) {
        return { stdout: (err.stdout || '').trim(), stderr: (err.stderr || '').trim(), exitCode: err.status ?? 1 };
      }
    }

    /** Throwaway project: two graduated specs (one nested) plus an evidence bundle. */
    function newProject() {
      const dir = mkdtempSync(join(tmpdir(), 'ateam-frankie-specdir-'));
      SANDBOXES.push(dir);
      mkdirSync(join(dir, 'specs', 'sub'), { recursive: true });
      writeFileSync(join(dir, 'specs', 'login.flow.yaml'), 'name: login\nsteps: []\n');
      writeFileSync(join(dir, 'specs', 'sub', 'nested.flow.yaml'), 'name: nested\nsteps: []\n');
      mkdirSync(join(dir, '.qa-evidence', 'M-1'), { recursive: true });
      writeFileSync(join(dir, '.qa-evidence', 'M-1', 'x.md'), '# x\n');
      return dir;
    }

    /**
     * Freeze a session snapshot for this project — the mode the bypass lived
     * in. Without a session_id the hook uses the strict existsSync fallback,
     * which happens to catch directories already; the snapshot path did not.
     */
    function freshSession(cwd: string) {
      const sessionId = `frankie-specdir-${process.pid}-${SESSIONS.length}-${Date.now()}`;
      SESSIONS.push(sessionId);
      const warm = runHookIn(cwd, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Write',
        tool_input: { file_path: '.qa-evidence/M-1/warmup.md' },
      });
      expect(warm.exitCode).toBe(0);
      return sessionId;
    }

    afterAll(() => {
      for (const dir of SANDBOXES) {
        rmSync(dir, { recursive: true, force: true });
      }
      for (const sessionId of SESSIONS) {
        rmSync(join(SNAPSHOT_DIR, `${sessionId}.json`), { force: true });
      }
    });

    const BLOCKED_DIRECTORY_COMMANDS: Array<[string, string]> = [
      ['`rm -rf specs` — wipes every graduated spec', 'rm -rf specs'],
      ['trailing-slash form `rm -rf specs/`', 'rm -rf specs/'],
      ['an intermediate spec directory `rm -r specs/sub`', 'rm -r specs/sub'],
      ['`rmdir` on a spec directory', 'rmdir specs/sub'],
      ['`mv` of the whole spec tree (source is a directory)', 'mv specs .qa-evidence/M-1/stash'],
    ];

    for (const [label, command] of BLOCKED_DIRECTORY_COMMANDS) {
      it(`blocks with a session snapshot active: ${label} (exit 2, immutable)`, () => {
        const proj = newProject();
        const sessionId = freshSession(proj);
        const result = runHookIn(proj, {
          agent_type: 'frankie',
          session_id: sessionId,
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
        expect(result.stderr).toMatch(/immutable/i);
      });

      it(`blocks under the strict fallback too (no session_id): ${label} (exit 2, immutable)`, () => {
        const proj = newProject();
        const result = runHookIn(proj, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
        expect(result.stderr).toMatch(/immutable/i);
      });
    }

    it('blocks an ABSOLUTE path to the spec root (exit 2, immutable)', () => {
      const proj = newProject();
      const sessionId = freshSession(proj);
      const result = runHookIn(proj, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Bash',
        tool_input: { command: `rm -rf ${join(proj, 'specs')}` },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('blocks a directory created MID-session (not in the snapshot, may already hold graduated specs) (exit 2)', () => {
      const proj = newProject();
      const sessionId = freshSession(proj);
      mkdirSync(join(proj, 'specs', 'later'), { recursive: true });

      const result = runHookIn(proj, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf specs/later' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('regression: the file form is still blocked (exit 2, immutable)', () => {
      const proj = newProject();
      const sessionId = freshSession(proj);
      const result = runHookIn(proj, {
        agent_type: 'frankie',
        session_id: sessionId,
        tool_name: 'Bash',
        tool_input: { command: 'rm specs/login.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('regression: writing a BRAND-NEW spec file is still allowed, including into a nested spec dir (exit 0)', () => {
      const proj = newProject();
      const sessionId = freshSession(proj);
      for (const filePath of ['specs/brand-new.flow.yaml', 'specs/sub/brand-new-nested.flow.yaml']) {
        const result = runHookIn(proj, {
          agent_type: 'frankie',
          session_id: sessionId,
          tool_name: 'Write',
          tool_input: { file_path: filePath },
        });
        expect(result.exitCode, `file_path=${filePath}`).toBe(0);
      }
    });

    it('regression: .qa-evidence/ directories are NOT immutable — Frankie owns that tree (exit 0)', () => {
      const proj = newProject();
      const sessionId = freshSession(proj);
      for (const command of ['rm -rf .qa-evidence/M-1', 'rm -rf .qa-evidence', 'rmdir .qa-evidence/M-1']) {
        const result = runHookIn(proj, {
          agent_type: 'frankie',
          session_id: sessionId,
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // `mv` sources are deletions (bypass review, finding 2).
  //
  // Only the LAST non-flag operand (the destination) used to be classified for
  // mv AND cp, so `mv specs/login.flow.yaml specs/login2.flow.yaml` sailed
  // through: the destination is a new spec name (allowed) while the SOURCE —
  // a graduated spec — ceases to exist at its path. That is exactly the
  // "write op in BOTH directions" reasoning `ln` already applies.
  //
  // cp keeps destination-only classification on purpose: a cp source is
  // read-only, the original file survives untouched.
  // ---------------------------------------------------------------------------
  describe('mv sources are deletions: every operand is classified (finding 2)', () => {
    it('blocks `mv` whose SOURCE is a graduated spec, even when the destination is a new spec name (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv specs/checkout.flow.yaml specs/checkout2.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
      expect(result.stderr).toMatch(/specs\/checkout\.flow\.yaml/);
    });

    it('blocks `mv` of a graduated spec into .qa-evidence/ (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv specs/checkout.flow.yaml .qa-evidence/M-1/stashed.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('blocks `mv` whose SOURCE is an implementation file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv src/services/order.ts .qa-evidence/M-1/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('regression: `mv` entirely inside .qa-evidence/ is still allowed (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv .qa-evidence/M-1/step1.png .qa-evidence/M-1/screenshots/step1.png' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('regression: `mv` destination in implementation territory is still blocked (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv .qa-evidence/M-1/patch.ts src/services/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
    });

    it('`cp` from a graduated spec into .qa-evidence/ stays allowed — a cp source is read-only (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'cp specs/checkout.flow.yaml .qa-evidence/M-1/checkout-copy.yaml' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('regression: `cp` INTO a graduated spec is still blocked (destination classification unchanged, exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'cp .qa-evidence/M-1/hacked.yaml specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/immutable/i);
    });
  });

  // ---------------------------------------------------------------------------
  // `>|` — the noclobber-override redirect (bypass review, finding 4).
  //
  // splitBashStatements() ran BEFORE padRedirectOperators(), and its delimiter
  // alternation had no `>|` case, so the bare `|` split `echo x >| specs/x`
  // into `echo x >` (a dangling operator with no target) and a second
  // "statement" whose argv[0] was the path — ZERO targets extracted, write
  // allowed. `>|` is now consumed as a redirect operator by both the splitter
  // (never a statement break) and the padder (the `|` belongs to the operator,
  // not to the target).
  // ---------------------------------------------------------------------------
  describe('noclobber-override redirect `>|` is a redirect, not a pipe (finding 4)', () => {
    it('blocks `>|` into an existing graduated spec (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo x >| specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('blocks `>|` into an implementation file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'echo x >| src/services/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
    });

    it('blocks the glued form `>|path` and the fd-qualified form `2>|path` (exit 2)', () => {
      for (const command of ['echo x >|specs/checkout.flow.yaml', 'some-command 2>| src/app.ts']) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
      }
    });

    it('allows `>|` into a brand-new spec file and into .qa-evidence/ (exit 0)', () => {
      for (const command of [
        'echo x >| specs/noclobber-new-flow.flow.yaml',
        'echo x >| .qa-evidence/M-1/report.md',
        'noisy-command >| /dev/null',
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });

    it('regression: a real pipe still splits into two statements, and the redirect target is still classified (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'cat specs/checkout.flow.yaml | grep name > src/app.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/app\.ts/);
    });

    it('regression: an ordinary pipeline with no protected target is still allowed (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'ls specs/ | grep flow | tee .qa-evidence/M-1/listing.txt' },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // `sed -i` edits EVERY file operand (bypass review, finding 5).
  //
  // Only the LAST non-flag operand was classified — the right heuristic for an
  // mv/cp destination, wrong for sed: `sed -i "" s/a/b/ specs/login.flow.yaml
  // .qa-evidence/x.md` rewrote the graduated spec while only the allowed
  // evidence file was checked. Every operand after the script slot is now
  // classified. Boundary: a space-separated BSD suffix (`sed -i .bak s/a/b/ f`)
  // is indistinguishable from a script operand, so it occupies the script slot
  // and the real script gets classified too — erring toward MORE targets, which
  // is the fail-closed direction.
  // ---------------------------------------------------------------------------
  describe('sed -i classifies every file operand, not just the last (finding 5)', () => {
    it('blocks a multi-operand `sed -i` whose FIRST file is a graduated spec and whose last is allowed (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'sed -i "" s/a/b/ specs/checkout.flow.yaml .qa-evidence/M-1/x.md' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
      expect(result.stderr).toMatch(/specs\/checkout\.flow\.yaml/);
    });

    it('blocks a multi-operand `sed -i.bak` whose first file is implementation code (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: "sed -i.bak 's/a/b/' src/services/order.ts .qa-evidence/M-1/x.md" },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('blocks the `-e script` form with several file operands (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: "sed -i -e 's/a/b/' specs/checkout.flow.yaml .qa-evidence/M-1/x.md" },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('blocks the long `--in-place` spelling (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: "sed --in-place 's/a/b/' src/services/order.ts" },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
    });

    it('blocks the ATTACHED script forms (`-e\'s/a/b/\'`, `--expression=…`), whose only bare operand is the FILE (exit 2)', () => {
      // These are the shapes a naive "skip the first bare operand" rule gets
      // wrong in the WEAKENING direction: the script rides on the flag, so the
      // single bare operand is the file being edited, not the script.
      for (const command of [
        "sed -i -e's/a/b/' src/services/order.ts",
        "sed -i --expression='s/a/b/' src/services/order.ts",
        "sed -i -f fixup.sed src/services/order.ts",
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/src\/services\/order\.ts/);
      }
    });

    it('regression: a multi-operand `sed -i` entirely inside .qa-evidence/ is still allowed (exit 0)', () => {
      for (const command of [
        "sed -i 's/a/b/' .qa-evidence/M-1/a.md .qa-evidence/M-1/b.md",
        "sed -i '' -e 's/a/b/' .qa-evidence/M-1/a.md .qa-evidence/M-1/b.md",
        "sed -i.bak 's/a/b/' .qa-evidence/M-1/a.md",
        "sed -i -e's/a/b/' .qa-evidence/M-1/a.md .qa-evidence/M-1/b.md",
        "sed -i -f fixup.sed .qa-evidence/M-1/a.md",
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });

    it('regression: `sed` WITHOUT -i is read-only and still allowed on protected paths (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: "sed -n 's/a/b/p' specs/checkout.flow.yaml src/services/order.ts" },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 1 — bundled `sed` short-flag clusters (PR author's inline review).
  //
  // The in-place probe was a PREFIX test (`/^(?:-i|--in-place)/`), so it only
  // ever recognized a cluster whose FIRST letter is `i`. Every other bundling
  // — `sed -ni`, `sed -Ei`, `sed -ri`, and the unquoted-script form
  // `sed -Ei s/a/b/ specs/login.flow.yaml` — edits in place exactly the same
  // way, yet extracted ZERO targets and exited 0 while rewriting a graduated
  // spec (author-verified by execution).
  //
  // Rule: a token is an in-place flag when it starts with "-", is neither "-"
  // nor "--", and (short form) its leading FLAG-LETTER run — the letters
  // before any suffix, so `-i.bak` reads as the cluster "i" — contains "i";
  // or (long form) it is `--in-place` / `--in-place=SUFFIX`. Long options are
  // matched by name, never letter-scanned, so `--quiet` is not an in-place
  // flag just because it contains an "i".
  // ---------------------------------------------------------------------------
  describe('sed in-place detection covers bundled short-flag clusters (author FIX 1)', () => {
    const BLOCKED_CLUSTERS: Array<[string, string]> = [
      ["author repro: bundled `-ni`", "sed -ni 's/a/b/' specs/checkout.flow.yaml"],
      ["author repro: bundled `-Ei`", "sed -Ei 's/a/b/' specs/checkout.flow.yaml"],
      ["author repro: bundled `-ri`", "sed -ri 's/a/b/' specs/checkout.flow.yaml"],
      ['author repro: bundled `-Ei` with an UNQUOTED script', 'sed -Ei s/a/b/ specs/checkout.flow.yaml'],
      ['already-covered `-i.bak` suffix form stays blocked', "sed -i.bak 's/a/b/' specs/checkout.flow.yaml"],
      ['already-covered `--in-place=.bak` form stays blocked', "sed --in-place=.bak 's/a/b/' specs/checkout.flow.yaml"],
    ];

    for (const [label, command] of BLOCKED_CLUSTERS) {
      it(`blocks: ${label} (exit 2, immutable)`, () => {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
        expect(result.stderr).toMatch(/immutable/i);
        expect(result.stderr).toMatch(/specs\/checkout\.flow\.yaml/);
      });
    }

    it('blocks a bundled cluster against implementation code too (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: "sed -Ei 's/a/b/' src/services/order.ts" },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('regression: clusters WITHOUT an "i" are read-only and still allowed on protected paths (exit 0)', () => {
      for (const command of [
        "sed -n 's/a/b/p' specs/checkout.flow.yaml",
        "sed -En 's/a/b/p' specs/checkout.flow.yaml src/services/order.ts",
        "sed -e 's/a/b/' specs/checkout.flow.yaml",
        "sed -e's/a/b/' specs/checkout.flow.yaml",
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });

    it('regression: a bundled in-place cluster entirely inside .qa-evidence/ is still allowed (exit 0)', () => {
      for (const command of [
        "sed -Ei 's/a/b/' .qa-evidence/M-1/a.md",
        "sed -ni 's/a/b/' .qa-evidence/M-1/a.md .qa-evidence/M-1/b.md",
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 2 — brace/glob evasion on protected operands (PR author's inline
  // review).
  //
  // `mv specs/login.flow.yaml{,.disabled}` exits 0: the UN-EXPANDED token
  // never matches a snapshot entry, so it classifies as a brand-new spec name
  // (allowed) — while the shell expands it to
  // `mv specs/login.flow.yaml specs/login.flow.yaml.disabled`, which deletes
  // the graduated spec from its path (author-verified by execution). Same hole
  // for `specs/*.flow.yaml`.
  //
  // Rule (no brace expansion is attempted — that way lies a shell): if an
  // operand contains `{`, `*`, `?` or `[`, take its LITERAL prefix up to the
  // first such metacharacter; when that prefix resolves to a path at or under
  // the spec root, the operand is protected. Anything else keeps its existing
  // classification, so a glob wholly inside .qa-evidence/ stays allowed and a
  // brace token that never touches specs/ is judged exactly as it is today.
  // ---------------------------------------------------------------------------
  describe('brace/glob operands whose literal prefix lands under specs/ are protected (author FIX 2)', () => {
    const BLOCKED_META: Array<[string, string]> = [
      ["author repro: `mv specs/login.flow.yaml{,.disabled}`", 'mv specs/checkout.flow.yaml{,.disabled}'],
      ['brace suffix `{,.bak}` on a graduated spec', 'mv specs/checkout.flow.yaml{,.bak}'],
      ['a `*` glob under the spec root as an mv SOURCE', 'mv specs/*.flow.yaml /tmp/frankie-stash.yaml'],
      ['a `*` glob under the spec root as an rm operand', 'rm specs/*.flow.yaml'],
      ['a `?` glob under the spec root', 'rm specs/checkout.flow.yam?'],
      ['a `[` character class under the spec root', 'rm specs/[cd]heckout.flow.yaml'],
      ['a brace directly on the spec root', 'rm -rf specs{,-backup}'],
    ];

    for (const [label, command] of BLOCKED_META) {
      it(`blocks: ${label} (exit 2, immutable)`, () => {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
        expect(result.stderr).toMatch(/immutable/i);
      });
    }

    it('regression: a glob wholly inside .qa-evidence/ is still allowed — Frankie owns that tree (exit 0)', () => {
      for (const command of [
        'rm .qa-evidence/M-1/*.png',
        'rm -f .qa-evidence/M-1/screenshots/step?.png',
        'mv .qa-evidence/M-1/step1.png{,.bak}',
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });

    it('a brace token that never touches specs/ is unaffected by this rule (still the ordinary default-deny, not an immutability denial)', () => {
      // `mv /tmp/a{,.bak}` was blocked before this fix and stays blocked
      // after it — but via the pre-existing "everything else" rule, NOT via
      // the new spec-glob rule. Pinning the REASON is what proves the new
      // rule did not widen its reach beyond the spec root.
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv /tmp/a{,.bak}' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).not.toMatch(/immutable/i);
    });

    it('regression: metacharacter-free spec operands keep their existing classification (exit 0 for a NEW flow file)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'touch specs/brace-free-new-flow.flow.yaml' },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 3 — leading-wrapper evasion (PR author's inline review).
  //
  // Command recognition read argv[0] literally, so ANY wrapper in front of the
  // real command defeated it: `env FOO=1 sed -i s/a/b/ specs/login.flow.yaml`
  // exited 0 because argv[0] was `env`, which matches no rule
  // (author-verified). Same for `command`, `nohup`, `exec`, `xargs`, and a
  // bare `VAR=val` assignment prefix.
  //
  // Rule: before recognition, iteratively strip leading `VAR=val` assignments
  // and a known wrapper (`env`, `command`, `nohup`, `exec`, `xargs`, `sudo`,
  // `time`, `nice`) together with its own flags/assignments, then recognize on
  // what is left. Iterating covers stacked wrappers (`nohup env FOO=1 sed …`).
  // Unknown wrappers remain best-effort/fail-open, as documented.
  // ---------------------------------------------------------------------------
  describe('leading wrappers and assignment prefixes do not hide the real command (author FIX 3)', () => {
    const WRAPPED_BLOCKED: Array<[string, string]> = [
      ['author repro: `env FOO=1` prefix', 'env FOO=1 sed -i s/a/b/ specs/checkout.flow.yaml'],
      ['`command` builtin prefix', 'command sed -i s/a/b/ specs/checkout.flow.yaml'],
      ['`nohup` prefix', 'nohup sed -i s/a/b/ specs/checkout.flow.yaml'],
      ['`exec` prefix', 'exec sed -i s/a/b/ specs/checkout.flow.yaml'],
      ['`xargs` prefix', 'xargs sed -i s/a/b/ specs/checkout.flow.yaml'],
      ['bare `VAR=val` assignment prefix', 'FOO=1 sed -i s/a/b/ specs/checkout.flow.yaml'],
      ['stacked wrappers `nohup env FOO=1`', 'nohup env FOO=1 sed -i s/a/b/ specs/checkout.flow.yaml'],
      ['wrapper with its own flags (`xargs -0 -n1`)', 'xargs -0 -n1 sed -i s/a/b/ specs/checkout.flow.yaml'],
      ['`sudo` prefix', 'sudo sed -i s/a/b/ specs/checkout.flow.yaml'],
      ['absolute wrapper path (`/usr/bin/env`)', '/usr/bin/env sed -i s/a/b/ specs/checkout.flow.yaml'],
    ];

    for (const [label, command] of WRAPPED_BLOCKED) {
      it(`blocks: ${label} (exit 2, immutable)`, () => {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
        expect(result.stderr).toMatch(/immutable/i);
      });
    }

    it('blocks a wrapped `rm` of implementation code (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'env FOO=1 rm src/services/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('regression: wrapped commands writing into allowed paths are still allowed (exit 0)', () => {
      for (const command of [
        'env FOO=1 echo hi > .qa-evidence/M-1/x',
        'nohup rm .qa-evidence/M-1/old.png',
        "env FOO=1 sed -i 's/a/b/' .qa-evidence/M-1/a.md",
        'env FOO=1 touch specs/wrapper-new-flow.flow.yaml',
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });

    it('does not crash on a wrapper with no command after it (exit 0, fail-open)', () => {
      for (const command of ['env', 'env FOO=1', 'nohup', 'xargs -0', 'FOO=1']) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
        expect(result.stderr).toBe('');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 4 — the mv every-operand rule must not block Frankie's own evidence
  // collection (author-verified regression from the previous round).
  //
  // Classifying EVERY mv operand is right for a source INSIDE the project (an
  // mv source is a deletion), but it also ran the default-deny rule over
  // scratch sources: `mv /tmp/playwright/step3.png .qa-evidence/M-1/step3.png`
  // — Frankie's core evidence-collection move — exited 2, while the equivalent
  // `cp` was allowed.
  //
  // Rule: sources get a SOURCE-specific test. A source that resolves (through
  // realpath, separator-guarded) outside the project root is scratch and is
  // allowed; a source inside the project root goes through the ordinary
  // classification, so moving a graduated spec or an implementation file still
  // blocks. Destination classification is unchanged.
  // ---------------------------------------------------------------------------
  describe('mv SOURCES outside the project root are scratch, not protected writes (author FIX 4)', () => {
    it("author repro: `mv /tmp/playwright/step3.png .qa-evidence/M-1/step3.png` is allowed (exit 0)", () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv /tmp/playwright/step3.png .qa-evidence/M-1/step3.png' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('mv and cp now agree on that move — the asymmetry the author flagged is gone (both exit 0)', () => {
      const mvResult = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv /tmp/playwright/step3.png .qa-evidence/M-1/step3.png' },
      });
      const cpResult = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'cp /tmp/playwright/step3.png .qa-evidence/M-1/step3.png' },
      });
      expect(mvResult.exitCode).toBe(cpResult.exitCode);
      expect(mvResult.exitCode).toBe(0);
    });

    it('allows other scratch sources Frankie actually uses (os tmpdir, /var/tmp) (exit 0)', () => {
      for (const command of [
        `mv ${join(tmpdir(), 'frankie-run', 'video.webm')} .qa-evidence/M-1/video.webm`,
        'mv /var/tmp/trace.zip .qa-evidence/M-1/trace.zip',
      ]) {
        const result = runHook(HOOK, {
          agent_type: 'frankie',
          tool_name: 'Bash',
          tool_input: { command },
        });
        expect(result.exitCode, `command=${command}`).toBe(0);
      }
    });

    it('blocks a PROTECTED source: `mv specs/checkout.flow.yaml /tmp/x` (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv specs/checkout.flow.yaml /tmp/x' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
      expect(result.stderr).toMatch(/specs\/checkout\.flow\.yaml/);
    });

    it('blocks an implementation source: `mv src/app.ts /tmp/x` (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv src/app.ts /tmp/x' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/src\/app\.ts/);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('regression: `mv` entirely inside .qa-evidence/ is still allowed (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv .qa-evidence/M-1/a.png .qa-evidence/M-1/b.png' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('regression: an out-of-tree DESTINATION is still blocked — only SOURCES get the scratch rule (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv .qa-evidence/M-1/a.png /tmp/frankie-elsewhere.png' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });

    it('regression: a scratch source does not launder a protected DESTINATION (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv /tmp/scratch.ts src/services/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/src\/services\/order\.ts/);
    });

    it('a source containing a ".." traversal segment is never treated as scratch (exit 2, fail closed)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command: 'mv specs/../src/services/order.ts .qa-evidence/M-1/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot key case-folding (bypass review, finding 3).
  //
  // On a case-insensitive volume (darwin/win32) the snapshot's exact-string
  // Set was strictly WEAKER than the existsSync fallback it refines:
  // specs/Checkout.flow.yaml is snapshotted, a Write to
  // specs/checkout.flow.yaml misses Set.has(), classifies as NEW, and lands on
  // the graduated file (same inode on APFS) — while the no-session_id fallback
  // correctly blocks it via a case-insensitive existsSync.
  //
  // Keys are therefore folded at snapshot-write time AND at lookup time, and
  // the folding rule is derivable from the platform alone (so a snapshot
  // written by one process is read consistently by another). CI runs on a
  // case-sensitive filesystem, so the folding rule is exercised directly here
  // rather than through the hook's real filesystem behavior.
  // ---------------------------------------------------------------------------
  describe('spec-snapshot keys are case-folded on case-insensitive volumes (finding 3)', () => {
    const ABS = '/repo/specs/Checkout.flow.yaml';

    it('folds keys on darwin and win32', () => {
      expect(foldSpecKey(ABS, 'darwin')).toBe('/repo/specs/checkout.flow.yaml');
      expect(foldSpecKey(ABS, 'win32')).toBe('/repo/specs/checkout.flow.yaml');
      expect(isCaseInsensitiveFs('darwin')).toBe(true);
      expect(isCaseInsensitiveFs('win32')).toBe(true);
    });

    it('leaves keys untouched on case-sensitive platforms', () => {
      expect(foldSpecKey(ABS, 'linux')).toBe(ABS);
      expect(isCaseInsensitiveFs('linux')).toBe(false);
    });

    it('is idempotent, so re-folding an already-folded stored key is a no-op', () => {
      expect(foldSpecKey(foldSpecKey(ABS, 'darwin'), 'darwin')).toBe(foldSpecKey(ABS, 'darwin'));
    });

    it('makes a differently-cased path hit the SAME graduated-spec entry on a case-insensitive volume', () => {
      const macSnapshot = new Set([foldSpecKey('/repo/specs/Checkout.flow.yaml', 'darwin')]);
      expect(macSnapshot.has(foldSpecKey('/repo/specs/checkout.flow.yaml', 'darwin'))).toBe(true);

      // …and stays a genuinely different file where the filesystem is case-sensitive.
      const linuxSnapshot = new Set([foldSpecKey('/repo/specs/Checkout.flow.yaml', 'linux')]);
      expect(linuxSnapshot.has(foldSpecKey('/repo/specs/checkout.flow.yaml', 'linux'))).toBe(false);
    });

    it('is wired into the hook on BOTH sides: snapshot construction and the immutability lookup', () => {
      const source = readFileSync(HOOK, 'utf8');
      expect(source).toMatch(/frankie-spec-key\.js/);
      // The immutability lookup folds…
      expect(source).toMatch(/\.has\(foldSpecKey\(/);
      // …and so do both snapshot-construction paths: the one loaded from disk
      // (which also normalizes a snapshot written before folding existed) and
      // the freshly-taken one (whose keys are stored already folded).
      expect(source).toMatch(/parsed\.specs\.map\([\s\S]{0,40}foldSpecKey/);
      expect(source).toMatch(/files\.map\([\s\S]{0,40}foldSpecKey/);
    });
  });

  // ---------------------------------------------------------------------------
  // MultiEdit / NotebookEdit path-extraction coverage (finding D2).
  // MultiEdit uses file_path (same as Write/Edit); NotebookEdit uses
  // notebook_path. Both are in the hook's WRITE_TOOLS set and must hit the
  // same block AND allow branches as Write/Edit — a tool-name gap here would
  // let Frankie edit implementation via MultiEdit or a notebook unblocked.
  // ---------------------------------------------------------------------------
  describe('MultiEdit / NotebookEdit — same block and allow branches as Write/Edit', () => {
    it('blocks frankie MultiEdit to an implementation file (exit 2, bounce to B.A.)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'MultiEdit',
        tool_input: { file_path: 'src/services/order.ts' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('blocks frankie MultiEdit to an existing spec (exit 2, immutable)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'MultiEdit',
        tool_input: { file_path: 'specs/checkout.flow.yaml' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/immutable/i);
    });

    it('allows frankie MultiEdit to a NEW file under specs/ (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'MultiEdit',
        tool_input: { file_path: 'specs/multiedit-new-flow.flow.yaml' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('blocks frankie NotebookEdit to an implementation notebook via notebook_path (exit 2)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'NotebookEdit',
        tool_input: { notebook_path: 'src/notebooks/analysis.ipynb' },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/B\.A\./i);
    });

    it('allows frankie NotebookEdit under .qa-evidence/ via notebook_path (exit 0)', () => {
      const result = runHook(HOOK, {
        agent_type: 'frankie',
        tool_name: 'NotebookEdit',
        tool_input: { notebook_path: '.qa-evidence/M-20260812-003/walk.ipynb' },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // INVERTED DETECTION — write-shaped statements that cannot be VERIFIED fail
  // closed (PR author's bypass groups 1-3).
  //
  // classifyFrankiePath() was already an allowlist; the bypasses lived in
  // DETECTION. extractBashWriteTargets() yields ZERO targets for a
  // write-shaped statement it doesn't recognize, so the caller's loop found
  // nothing to classify and the statement passed. Three documented groups, all
  // exiting 0 while destroying a graduated spec:
  //   1. launchers not in WRAPPER_COMMANDS (`timeout 5 sed -i …`)
  //   2. interpreters / nested shells (`bash -c '…'`, `python3 -c '…'`)
  //   3. a writer fed by a pipe or a find action (`xargs rm -f`, `find … -delete`)
  //
  // The decision is now "block a write-shaped statement UNLESS every write it
  // performs is provably to an allowlisted location". Chasing an ever-growing
  // wrapper list is explicitly NOT the fix: group 1 is handled by peeling the
  // launcher (including `timeout`'s bare duration operand) and re-running the
  // SAME detection on the inner command, and anything still unresolved is
  // caught structurally by group 2/3's checks.
  // ---------------------------------------------------------------------------
  describe('unverifiable write-shaped Bash statements fail CLOSED (bypass groups 1-3)', () => {
    const SANDBOXES: string[] = [];
    let PROJECT = '';

    /** Same contract as runHook(), but with an explicit cwd (the hook anchors its allowlist on process.cwd()). */
    function runHookIn(cwd: string, stdin: object) {
      try {
        const stdout = execFileSync('node', [HOOK], {
          cwd,
          env: { ...process.env, ATEAM_API_URL: 'http://localhost:3000', ATEAM_PROJECT_ID: 'test-project' },
          encoding: 'utf8',
          timeout: 5000,
          input: JSON.stringify(stdin),
        });
        return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
      } catch (err: any) {
        return { stdout: (err.stdout || '').trim(), stderr: (err.stderr || '').trim(), exitCode: err.status ?? 1 };
      }
    }

    /**
     * Fixture project: ONE graduated spec (specs/login.flow.yaml) and an
     * evidence bundle Frankie owns (.qa-evidence/M-1/). No session_id is sent,
     * so the hook uses its strict at-call-time fallback — login.flow.yaml is
     * graduated because it exists, specs/brand-new.flow.yaml is new because it
     * does not. Nothing here mutates the fixture, so one project is shared.
     */
    beforeAll(() => {
      PROJECT = mkdtempSync(join(tmpdir(), 'ateam-frankie-invert-'));
      SANDBOXES.push(PROJECT);
      mkdirSync(join(PROJECT, 'specs'), { recursive: true });
      writeFileSync(join(PROJECT, 'specs', 'login.flow.yaml'), 'name: login\nsteps: []\n');
      mkdirSync(join(PROJECT, '.qa-evidence', 'M-1'), { recursive: true });
    });

    afterAll(() => {
      for (const dir of SANDBOXES) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    function runBash(command: string) {
      return runHookIn(PROJECT, {
        agent_type: 'frankie',
        tool_name: 'Bash',
        tool_input: { command },
      });
    }

    // -------------------------------------------------------------------------
    // Group 1 — launchers whose first operand is a VALUE, not a command. Peeled
    // like any other wrapper, then the INNER command goes through the same
    // detection, so the real target is extracted and blocked by name.
    // -------------------------------------------------------------------------
    const GROUP_1: Array<[string, string]> = [
      ['author repro: `timeout 5 sed -i` (bare duration operand)', 'timeout 5 sed -i "" s/login/x/ specs/login.flow.yaml'],
      ['author repro: `stdbuf -oL sed -i`', 'stdbuf -oL sed -i "" s/a/b/ specs/login.flow.yaml'],
      ['author repro: `setsid truncate -s0`', 'setsid truncate -s0 specs/login.flow.yaml'],
      ['`timeout` with a value-taking flag before the duration', 'timeout -s KILL 5 sed -i "" s/a/b/ specs/login.flow.yaml'],
      ['`nice -n 10` (separate-value flag)', 'nice -n 10 rm specs/login.flow.yaml'],
      ['`ionice -c 3` (separate-value flag)', 'ionice -c 3 rm specs/login.flow.yaml'],
      ['`chrt 10` (bare priority operand)', 'chrt 10 rm specs/login.flow.yaml'],
    ];

    for (const [label, command] of GROUP_1) {
      it(`group 1 — blocks ${label} (exit 2, immutable, names the spec)`, () => {
        const result = runBash(command);
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
        expect(result.stderr).toMatch(/immutable/i);
        expect(result.stderr).toMatch(/specs\/login\.flow\.yaml/);
      });
    }

    // -------------------------------------------------------------------------
    // Group 2 — an interpreter invoked with an inline-script/eval flag. The
    // script body is opaque to any pattern scan and can write anywhere, so the
    // statement is unverifiable by construction and blocks outright.
    // -------------------------------------------------------------------------
    const GROUP_2: Array<[string, string]> = [
      ['author repro: `bash -c` truncating a graduated spec', "bash -c ': > specs/login.flow.yaml'"],
      ['author repro: `sh -c` redirecting into a graduated spec', "sh -c 'echo pwn > specs/login.flow.yaml'"],
      ['author repro: `python3 -c`', 'python3 -c "open(\'specs/login.flow.yaml\',\'w\').write(\'x\')"'],
      ['author repro: `perl -pi -e`', "perl -pi -e 's/login/x/' specs/login.flow.yaml"],
      ['author repro: `node -e`', 'node -e "require(\'fs\').writeFileSync(\'specs/login.flow.yaml\',\'x\')"'],
      ['`zsh -c`', "zsh -c 'rm specs/login.flow.yaml'"],
      ['`ruby -e`', "ruby -e 'File.write(\"specs/login.flow.yaml\", \"x\")'"],
      ['`node --eval`', 'node --eval "require(\'fs\').unlinkSync(\'specs/login.flow.yaml\')"'],
      ['`perl -i` alone (in-place, no -e)', "perl -i.bak -ne 'print' specs/login.flow.yaml"],
      ['an interpreter reached THROUGH a launcher', "timeout 5 bash -c 'rm specs/login.flow.yaml'"],
    ];

    for (const [label, command] of GROUP_2) {
      it(`group 2 — blocks ${label} (exit 2, unverifiable)`, () => {
        const result = runBash(command);
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
        expect(result.stderr).toMatch(/unverifiable/i);
      });
    }

    // -------------------------------------------------------------------------
    // Group 3 — a destructive writer whose target set could not be extracted at
    // all (it arrives on stdin, or it is a directory walk). Nothing to verify
    // means nothing can be proven allowlisted, so it blocks.
    // -------------------------------------------------------------------------
    const GROUP_3: Array<[string, string]> = [
      ['author repro: `find … -delete`', "find specs -name '*.flow.yaml' -delete"],
      ['author repro: `xargs rm -f` (path arrives on stdin)', 'echo specs/login.flow.yaml | xargs rm -f'],
      ['`find … -exec rm`', "find specs -name '*.yaml' -exec rm {} ;"],
      ['`find … -execdir`', "find . -name '*.yaml' -execdir truncate -s0 {} ;"],
      ['`find … -fprint`', 'find . -fprint specs/login.flow.yaml'],
      ['`xargs truncate` fed by a pipe', 'ls specs | xargs truncate -s0'],
      ['`rm` with no extractable operand at all', 'rm -rf'],
      ['`sed -i` with no file operand', "sed -i 's/a/b/'"],
    ];

    for (const [label, command] of GROUP_3) {
      it(`group 3 — blocks ${label} (exit 2, unverifiable)`, () => {
        const result = runBash(command);
        expect(result.exitCode, `command=${command}`).toBe(2);
        expect(result.stderr).toMatch(/BLOCKED/i);
        expect(result.stderr).toMatch(/unverifiable/i);
      });
    }

    // -------------------------------------------------------------------------
    // The inversion must not swallow Frankie's legitimate Bash. If any of these
    // block, the rule is too aggressive — tune the command-position test, never
    // loosen the writer detection.
    // -------------------------------------------------------------------------
    const ALLOWED: Array<[string, string]> = [
      ['`npm test`', 'npm test'],
      ['`bun run test`', 'bun run test'],
      ['`npx playwright test`', 'npx playwright test'],
      ['a playwright run tee\'d into the evidence bundle', 'npx playwright test 2>&1 | tee .qa-evidence/M-1/run.log'],
      ['`curl` against the dev server', 'curl -s http://localhost:5173'],
      ['`git status`', 'git status'],
      ['`git diff`', 'git diff'],
      ['reading his own evidence bundle', 'cat .qa-evidence/M-1/report.md'],
      ['`grep -rn` over the tree', 'grep -rn foo .'],
      ['a writer NAME appearing as a grep ARGUMENT, not in command position', 'grep -rn "rm -rf specs" .'],
      ['a writer NAME inside a quoted echo argument', 'echo "next step: rm specs/login.flow.yaml (do not)"'],
      ['`ls specs/`', 'ls specs/'],
      ['appending a step into the evidence report', 'echo "## Step 1" >> .qa-evidence/M-1/report.md'],
      ['copying a screenshot out of scratch into the bundle', 'cp /tmp/playwright/shot.png .qa-evidence/M-1/shot.png'],
      ['writing a BRAND-NEW flow file', "printf 'name: brand-new\\n' > specs/brand-new.flow.yaml"],
      ['`python3 script.py` — running a FILE, not an inline eval', 'python3 script.py'],
      ['`node app.js` — running a FILE, not an inline eval', 'node app.js'],
      ['`bash ./run.sh` — running a FILE, not an inline eval', 'bash ./run.sh'],
      ['a read-only `find` with no mutating action', "find . -name '*.flow.yaml'"],
      ['a read-only `find -print`', 'find specs -type f -print'],
      ['`timeout` wrapping a read-only command', 'timeout 30 npx playwright test'],
      ['cleaning his own evidence bundle', 'rm -rf .qa-evidence/M-1/screenshots'],
    ];

    for (const [label, command] of ALLOWED) {
      it(`allows ${label} (exit 0)`, () => {
        const result = runBash(command);
        expect(result.exitCode, `command=${command}\nstderr=${result.stderr}`).toBe(0);
      });
    }

    it('regression: subshell-wrapped `rm` of a graduated spec is blocked (argv[0] is normalized past "(" )', () => {
      const result = runBash('(rm specs/login.flow.yaml)');
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/immutable/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Honest wording (PR author's group-2 point): "immutable" oversells a
  // best-effort scanner. The hook's own header must describe graduated-spec
  // protection as enforced best-effort — now inverted, so an unverifiable
  // write fails CLOSED — and must name true filesystem-level immutability as a
  // separate follow-up rather than implying the scanner already provides it.
  // ---------------------------------------------------------------------------
  it('header doc describes the protection as best-effort + fail-closed, not shell-proof immutability (wording check)', () => {
    const source = readFileSync(HOOK, 'utf8');
    const header = source.slice(0, source.indexOf('*/') + 2);

    expect(header).toMatch(/best-effort/i);
    expect(header).toMatch(/fails? CLOSED/i);
    expect(header).toMatch(/unverifiable/i);
    // The follow-up is named, not implied.
    expect(header).toMatch(/filesystem-level immutability/i);
    expect(header).toMatch(/follow-up/i);
    // No claim that the scanner makes specs immutable against arbitrary shell.
    expect(header).not.toMatch(/immutable by design/i);
    expect(header).not.toMatch(/"immutable"/);
  });

  it('allows non-target agent ba to write implementation files (exit 0, no interference)', () => {
    const result = runHook(HOOK, {
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/order.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows an unrecognised agent (exit 0, fail-open, no interference)', () => {
    const result = runHook(HOOK, {
      agent_type: 'NotAnAgent',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/order.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows a payload with no agent identity at all (exit 0, fail-open, no interference)', () => {
    const result = runHook(HOOK, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/order.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 on unparseable stdin JSON (fail-open)', () => {
    const fullEnv = {
      ...process.env,
      ATEAM_API_URL: 'http://localhost:3000',
      ATEAM_PROJECT_ID: 'test-project',
    };
    let exitCode: number;
    try {
      execFileSync('node', [HOOK], {
        env: fullEnv,
        encoding: 'utf8',
        timeout: 5000,
        input: 'not valid json',
      });
      exitCode = 0;
    } catch (err: any) {
      exitCode = err.status ?? 1;
    }
    expect(exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Telemetry: a live-network behavioral assertion here would need a stub API
  // server per denial, so the wiring is verified statically instead, matching
  // the resolveAgent() check convention already established above for all
  // thirteen other PreToolUse guard hooks.
  //
  // The call MUST be denyAndExit(), not a bare sendDeniedEvent(): the latter
  // is fire-and-forget, and every one of these hooks calls process.exit(2) on
  // the very next line, tearing the process down before the POST's socket work
  // ever runs — the denial telemetry was silently never delivered. denyAndExit
  // awaits the POST (bounded by a short timeout) and only then exits.
  // ---------------------------------------------------------------------------
  it('reports the denial via denyAndExit with agent name, tool name, and reason before exiting 2 (static wiring check)', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/resolveAgent/);
    expect(source).toMatch(/resolve-agent/);
    expect(source).toMatch(/denyAndExit/);
    expect(source).toMatch(/send-denied-event/);

    const callMatch = source.match(/denyAndExit\(([\s\S]*?)\)/);
    expect(callMatch, 'expected a denyAndExit({...}) call in the hook source').not.toBeNull();
    const callArgs = callMatch![1];
    expect(callArgs).toMatch(/agentName/);
    expect(callArgs).toMatch(/toolName/);
    expect(callArgs).toMatch(/reason/);

    // Fire-and-forget denial telemetry must not creep back in.
    expect(source).not.toMatch(/\bsendDeniedEvent\(/);
    // Every denial must be awaited before the exit.
    expect((source.match(/await denyAndExit\(/g) || []).length).toBe(
      (source.match(/denyAndExit\(/g) || []).length
    );
  });

  // ---------------------------------------------------------------------------
  // Single registration (sweep finding #19). The hook used to be registered
  // TWICE — matcher-less in hooks/hooks.json AND with a "Write|Edit" matcher
  // in agents/frankie.md's own frontmatter — so Claude Code spawned two
  // identical node processes for every Write/Edit Frankie attempted, each
  // re-reading stdin, re-taking the specs/ snapshot, and reaching the same
  // verdict. The hooks.json registration is the load-bearing one: being
  // matcher-less, it also fires for Bash, which is what catches
  // `echo x > specs/foo.flow.yaml`. A "Write|Edit" matcher would never fire
  // for Bash at all, so removing the frontmatter copy loses no coverage.
  // ---------------------------------------------------------------------------
  it('is registered ONLY in hooks/hooks.json, not a second time in agents/frankie.md frontmatter', () => {
    const frankieMdPath = join(REPO_ROOT, 'agents', 'frankie.md');
    const content = readFileSync(frankieMdPath, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch, 'expected agents/frankie.md to have parseable frontmatter').not.toBeNull();
    const frontmatter = frontmatterMatch![1];

    // Only a YAML comment may mention the hook here — never a command line
    // that would re-register it.
    const registrationLines = frontmatter
      .split('\n')
      .filter((line) => line.includes('block-frankie-writes.js') && !line.trim().startsWith('#'));
    expect(
      registrationLines,
      'block-frankie-writes.js must be registered once, in hooks/hooks.json only'
    ).toEqual([]);

    // The load-bearing registration is still matcher-less in hooks.json, so it
    // covers Bash as well as the write tools.
    const hooksJson = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));
    const entries: any[] = (hooksJson.hooks.PreToolUse || []).filter((entry: any) =>
      (entry.hooks || []).some((hook: any) => (hook.command || '').includes('block-frankie-writes.js'))
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBeUndefined();
  });
});
