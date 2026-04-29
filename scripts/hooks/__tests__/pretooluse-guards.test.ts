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

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { readFileSync } from 'fs';

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
});

// =============================================================================
// block-raw-echo-log.js — target: murdock,ba,lynch,amy,tawnia
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
// block-worker-board-claim.js — target: murdock,ba,lynch,lynch-final,amy,tawnia
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
// block-worker-board-move.js — target: murdock,ba,lynch,lynch-final,amy,tawnia
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
