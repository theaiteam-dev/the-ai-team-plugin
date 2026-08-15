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
import { readFileSync, mkdirSync, writeFileSync, rmSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';

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
  // Telemetry: the fetch inside sendDeniedEvent races process.exit(2) in every
  // hook using this fire-and-forget pattern (see block-murdock-impl-writes.js),
  // so a live-network behavioral assertion here would be genuinely flaky, not
  // just slow. Verified statically instead, matching the resolveAgent() check
  // convention already established above for all thirteen other PreToolUse
  // guard hooks.
  // ---------------------------------------------------------------------------
  it('reports the denial via sendDeniedEvent with agent name, tool name, and reason before exiting 2 (static wiring check)', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/resolveAgent/);
    expect(source).toMatch(/resolve-agent/);
    expect(source).toMatch(/sendDeniedEvent/);
    expect(source).toMatch(/send-denied-event/);

    const callMatch = source.match(/sendDeniedEvent\(([\s\S]*?)\)/);
    expect(callMatch, 'expected a sendDeniedEvent({...}) call in the hook source').not.toBeNull();
    const callArgs = callMatch![1];
    expect(callArgs).toMatch(/agentName/);
    expect(callArgs).toMatch(/toolName/);
    expect(callArgs).toMatch(/reason/);
  });

  // ---------------------------------------------------------------------------
  // Dual registration, half two: agents/frankie.md's own hooks block (the
  // hooks.json half is covered by "registers block-frankie-writes.js in
  // PreToolUse" above). WI-778 reserves this slot in agents/frankie.md by
  // comment; this item is the one that actually fills it in with a Write|Edit
  // matcher, per the item's context notes.
  // ---------------------------------------------------------------------------
  it('is registered in agents/frankie.md under a Write|Edit PreToolUse matcher', () => {
    const frankieMdPath = join(REPO_ROOT, 'agents', 'frankie.md');
    const content = readFileSync(frankieMdPath, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch, 'expected agents/frankie.md to have parseable frontmatter').not.toBeNull();
    const frontmatter = frontmatterMatch![1];

    const sectionMatch = frontmatter.match(/^  PreToolUse:\n((?:(?:    |\n).*\n?)*)/m);
    expect(sectionMatch, 'expected a PreToolUse section in agents/frankie.md frontmatter').not.toBeNull();
    const sectionLines = sectionMatch![1].split('\n');
    const preToolUseText: string[] = [];
    for (const line of sectionLines) {
      if (/^  \S/.test(line)) break;
      preToolUseText.push(line);
    }
    const preToolUse = preToolUseText.join('\n');

    const blocks = preToolUse.split(/^    - /m).filter(Boolean);
    const hasWriteEditGuard = blocks.some(
      (block) => block.includes('matcher: "Write|Edit"') && block.includes('block-frankie-writes.js')
    );
    expect(
      hasWriteEditGuard,
      'expected a "- matcher: \\"Write|Edit\\"" block containing block-frankie-writes.js in agents/frankie.md PreToolUse'
    ).toBe(true);
  });
});
