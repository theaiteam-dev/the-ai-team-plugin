/**
 * Tests for block-pike-writes.js enforcement hook.
 *
 * This PreToolUse hook blocks Pike (the bug triage agent, agents/pike.md)
 * from writing or editing repo source, tests, config, or docs. Pike's
 * output is work items via `ateam items createItem`; the only repo file he
 * authors is the mission brief under `.mission-briefs/`, and scratch writes
 * outside the project are allowed.
 *
 * Pattern: same as block-lynch-writes.test.ts (allow-then-block with a
 * canonicalized scratch allowlist), plus the `.mission-briefs/` carve-out
 * and a Murdock-naming message on test-file writes.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';

const HOOK = join(__dirname, '..', 'block-pike-writes.js');
const REPO_ROOT = realpathSync(join(__dirname, '..', '..', '..'));
const HOOKS_JSON_PATH = join(REPO_ROOT, 'hooks', 'hooks.json');
const PIKE_MD_PATH = join(REPO_ROOT, 'agents', 'pike.md');

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
      cwd: REPO_ROOT,
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
describe('block-pike-writes — static checks', () => {
  it('imports and uses resolveAgent() for agent detection', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/resolveAgent/);
    expect(source).toMatch(/resolve-agent/);
  });

  it('uses the shared scratch-path allowlist rather than a raw prefix test', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toMatch(/isScratchPath/);
    expect(source).toMatch(/scratch-path/);
  });

  it('references pike by name in the implementation', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source.toLowerCase()).toMatch(/pike/);
  });
});

// =============================================================================
// Registration — dual: matcher-less in hooks/hooks.json, Write|Edit|Bash in
// agents/pike.md frontmatter (the documented pattern for per-agent guards).
// The frontmatter matcher must name Bash: the matcher-less hooks.json entry
// already delivers Bash events, but a narrower frontmatter matcher would read
// as though the Bash branch below were dead code.
// =============================================================================
describe('block-pike-writes — registration', () => {
  it('is registered matcher-less in hooks/hooks.json PreToolUse', () => {
    const hooksJson = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));
    const entries: any[] = (hooksJson.hooks.PreToolUse || []).filter((entry: any) =>
      (entry.hooks || []).some((hook: any) => (hook.command || '').includes('block-pike-writes.js'))
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBeUndefined();
    expect(entries[0].hooks[0].command).toMatch(/\$\{CLAUDE_PLUGIN_ROOT\}/);
  });

  it('is registered under a Write|Edit|Bash matcher in agents/pike.md frontmatter', () => {
    const content = readFileSync(PIKE_MD_PATH, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch, 'expected agents/pike.md to have parseable frontmatter').not.toBeNull();
    const frontmatter = frontmatterMatch![1];
    expect(frontmatter).toMatch(/^name:\s*pike\s*$/m);
    const blocks = frontmatter.split(/^    - /m);
    const registered = blocks.some(
      (block) => block.includes('matcher: "Write|Edit|Bash"') && block.includes('block-pike-writes.js')
    );
    expect(registered).toBe(true);
  });
});

// =============================================================================
// Pike — blocked paths
// =============================================================================
describe('block-pike-writes — Pike is blocked', () => {
  it('blocks Write to a src/ file with exit 2', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/search.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks Edit to an absolute src/ path with exit 2', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Edit',
      tool_input: { file_path: join(REPO_ROOT, 'src', 'services', 'search.ts') },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks Write to a project root file (README.md)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: 'README.md' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks Write to project config (package.json)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: 'package.json' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks MultiEdit and NotebookEdit too (no tool-name bypass)', () => {
    const multi = runHook({
      agent_type: 'pike',
      tool_name: 'MultiEdit',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(multi.exitCode).toBe(2);
    const notebook = runHook({
      agent_type: 'pike',
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'notebooks/probe.ipynb' },
    });
    expect(notebook.exitCode).toBe(2);
  });

  it('error message mentions Pike by name', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.stderr.toLowerCase()).toMatch(/pike/);
  });

  it('blocks when agent uses ai-team: prefix', () => {
    const result = runHook({
      agent_type: 'ai-team:pike',
      tool_name: 'Write',
      tool_input: { file_path: 'src/utils.ts' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks when agent name is uppercase Pike (case normalization)', () => {
    const result = runHook({
      agent_type: 'Pike',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks a pool-suffixed instance name (pike-1)', () => {
    const result = runHook({
      agent_type: 'pike-1',
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(2);
  });
});

// =============================================================================
// Pike — the failing-test temptation gets its own message
// =============================================================================
describe('block-pike-writes — test files are blocked and the message names Murdock', () => {
  const TEST_PATHS = [
    'src/__tests__/search.test.ts',
    'src/services/search.spec.tsx',
    'tests/search.test.js',
    'packages/ateam-cli/cmd/search_test.go',
    join(REPO_ROOT, 'src', 'search.test.ts'),
  ];

  for (const filePath of TEST_PATHS) {
    it(`blocks Write to ${filePath} and names Murdock`, () => {
      const result = runHook({
        agent_type: 'pike',
        tool_name: 'Write',
        tool_input: { file_path: filePath },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/Murdock/);
      expect(result.stderr).toMatch(/failing test/i);
    });
  }
});

// =============================================================================
// Pike — allowlist: scratch space and the mission brief
// =============================================================================
describe('block-pike-writes — allowlist', () => {
  it('allows Write to /tmp/ (exit 0)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/pike-probe.sh' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Write to /var/tmp/ (exit 0)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: '/var/tmp/pike-screenshot.png' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows a relative mission brief path (.mission-briefs/<slug>.md)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: '.mission-briefs/bug-empty-search-query.md' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows an absolute mission brief path under the project root', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: join(REPO_ROOT, '.mission-briefs', 'bug-empty-search-query.md') },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Edit on an existing-or-not brief (fixing a typo in his own draft)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Edit',
      tool_input: { file_path: '.mission-briefs/bug-empty-search-query.md' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('resolves the brief dir against the payload cwd, not the hook process cwd', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'pike-brief-test-'));
    try {
      const result = runHook({
        agent_type: 'pike',
        cwd: sandbox,
        tool_name: 'Write',
        tool_input: { file_path: join(sandbox, '.mission-briefs', 'bug-x.md') },
      });
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('blocks a non-markdown file under .mission-briefs/ (the brief is a .md)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: '.mission-briefs/probe.test.ts' },
    });
    expect(result.exitCode).toBe(2);
  });
});

// =============================================================================
// Pike — the allowlist must not be traversable
// =============================================================================
describe('block-pike-writes — allowlist cannot be traversed', () => {
  it('blocks a ".." that escapes .mission-briefs/ into src/', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: '.mission-briefs/../src/app.ts' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks a ".." that escapes .mission-briefs/ into a test file', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: '.mission-briefs/../src/__tests__/app.test.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/Murdock/);
  });

  it('blocks a ".." that escapes /tmp/ into the repo', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: `/tmp/..${REPO_ROOT}/src/app.ts` },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks a sibling directory that merely starts with the brief dir name', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: '.mission-briefs-extra/notes.md' },
    });
    expect(result.exitCode).toBe(2);
  });

  it('blocks a symlink inside .mission-briefs/ that resolves into src/ (laundering)', () => {
    const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'pike-launder-test-')));
    try {
      mkdirSync(join(sandbox, 'src'));
      mkdirSync(join(sandbox, '.mission-briefs'));
      symlinkSync(join(sandbox, 'src'), join(sandbox, '.mission-briefs', 'launder'));
      const result = runHook({
        agent_type: 'pike',
        cwd: sandbox,
        tool_name: 'Write',
        tool_input: { file_path: join(sandbox, '.mission-briefs', 'launder', 'app.md') },
      });
      expect(result.exitCode).toBe(2);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('blocks a /tmp symlink that resolves into the repo (laundering)', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'pike-scratch-test-'));
    try {
      const link = join(sandbox, 'launder');
      symlinkSync(join(REPO_ROOT, 'src'), link);
      const result = runHook({
        agent_type: 'pike',
        tool_name: 'Write',
        tool_input: { file_path: join(link, 'app.ts') },
      });
      expect(result.exitCode).toBe(2);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('still allows a ".." that stays inside .mission-briefs/', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
      tool_input: { file_path: '.mission-briefs/a/../bug-x.md' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Pike — non-write tools are allowed (he must read and run to reproduce)
// =============================================================================
describe('block-pike-writes — non-write tools', () => {
  it('allows Read', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Read',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Bash (dev server, curl, ateam CLI)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'ateam items createItem --title "Fix: x" --type bug' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Grep', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Grep',
      tool_input: { pattern: 'TODO' },
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Pike — Bash bypass: write-shaped shell commands into project paths
//
// CodeRabbit finding: block-pike-writes.js gated only Write/Edit/MultiEdit/
// NotebookEdit, so Pike could write any project file through shell
// redirection, `tee`, `sed -i`, `cp`, or `mv` — none of it seen by the
// Write/Edit guard above. The Bash branch reuses lib/bash-write-scan.js
// (shared with block-frankie-writes.js) to extract write targets from a
// shell command, then classifies each with the exact same
// isScratchPath/isMissionBriefPath/looksLikeTestFile rule the Write/Edit
// branch uses. A write-shaped statement whose target cannot be verified
// (an inline interpreter, a mutating `find`, a destructive writer with
// nothing extractable) is denied rather than assumed safe, matching
// block-frankie-writes.js's precedent.
// =============================================================================
describe('block-pike-writes — Bash bypass: write-shaped shell commands into project paths', () => {
  it('blocks `>` redirection into a project file (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'echo "patched" > src/services/search.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
    expect(result.stderr).toMatch(/src\/services\/search\.ts/);
  });

  it('blocks `>>` append redirection into a project file (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'echo "extra line" >> src/services/search.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks `tee` writing into a project file (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'echo "x" | tee src/services/search.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks `sed -i` editing a project file (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: "sed -i 's/foo/bar/' src/services/search.ts" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks `cp` whose destination is a project file (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'cp /tmp/patched.ts src/services/search.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks `mv` whose destination is a project file (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'mv /tmp/patched.ts src/services/search.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks `rm` targeting a project file (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'rm src/services/search.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks a heredoc writing a project file (exit 2, opener line still scanned)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: {
        command: ['cat > src/services/search.ts <<EOF', 'export const x = 1;', 'EOF'].join('\n'),
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks a ".." traversal out of .mission-briefs/ via a shell redirect (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'echo "patched" > .mission-briefs/../src/app.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
  });

  it('blocks a test-file target reached via shell redirection, and names Murdock (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'echo "it(\'x\')" > src/__tests__/x.test.ts' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
    expect(result.stderr).toMatch(/Murdock/);
    expect(result.stderr).toMatch(/failing test/i);
  });

  it('allows a `>` redirect into a scratch dir (exit 0)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'echo "probe output" > /tmp/pike-probe-output.txt' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows a `>` redirect into .mission-briefs/foo.md (exit 0)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'echo "# Title" > .mission-briefs/foo.md' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('blocks an inline interpreter write as unverifiable (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: "python3 -c \"open('src/services/search.ts','w').write('x')\"" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
    expect(result.stderr).toMatch(/cannot verify/i);
  });

  it('blocks a piped destructive writer with no extractable target as unverifiable (exit 2)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: { command: 'echo src/services/search.ts | xargs rm -f' },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/BLOCKED/i);
    expect(result.stderr).toMatch(/cannot verify/i);
  });

  it('does not affect non-Pike agents running the same write-shaped Bash command (exit 0)', () => {
    const result = runHook({
      agent_type: 'ba',
      tool_name: 'Bash',
      tool_input: { command: 'echo "fine" > src/services/search.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('still allows Pike\'s real repro tooling: curl, git status, gh issue view, ateam, dev-server commands (exit 0)', () => {
    const commands = [
      'curl -s http://localhost:5567/api/search?q=',
      'git status',
      'gh issue view 42',
      'ateam deps-check checkDeps --json',
      'ateam activity createActivityEntry --agent "Pike" --message "reproduced" --level info',
      'npm run dev:qa &',
      'cat src/services/search.ts',
      "sed -n '1,40p' src/services/search.ts",
      'grep -rn "TODO" src/',
      'head -50 src/services/search.ts',
    ];
    for (const command of commands) {
      const result = runHook({
        agent_type: 'pike',
        tool_name: 'Bash',
        tool_input: { command },
      });
      expect(result.exitCode, `command=${command}`).toBe(0);
    }
  });

  it('exits 0 when tool_input.command is missing (fail-open)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Bash',
      tool_input: {},
    });
    expect(result.exitCode).toBe(0);
  });
});

// =============================================================================
// Non-Pike agents — not affected
// =============================================================================
describe('block-pike-writes — non-Pike agents not affected', () => {
  it('allows Write for ba (exit 0)', () => {
    const result = runHook({
      agent_type: 'ba',
      tool_name: 'Write',
      tool_input: { file_path: 'src/services/search.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Write for murdock to a test file (exit 0)', () => {
    const result = runHook({
      agent_type: 'murdock',
      tool_name: 'Write',
      tool_input: { file_path: 'src/__tests__/search.test.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('allows Write for face (exit 0)', () => {
    const result = runHook({
      agent_type: 'face',
      tool_name: 'Write',
      tool_input: { file_path: 'adr/0042-example.md' },
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
describe('block-pike-writes — edge cases', () => {
  it('handles missing stdin gracefully (never exit 2)', () => {
    const fullEnv = { ...process.env, ATEAM_API_URL: 'http://localhost:3000', ATEAM_PROJECT_ID: 'test-project' };
    try {
      execFileSync('node', [HOOK], { env: fullEnv, encoding: 'utf8', timeout: 5000 });
    } catch (err: any) {
      expect(err.status).not.toBe(2);
    }
  });

  it('handles null agent gracefully (exit 0, fail-open)', () => {
    const result = runHook({
      tool_name: 'Write',
      tool_input: { file_path: 'src/index.ts' },
    });
    expect(result.exitCode).toBe(0);
  });

  it('handles missing tool_input gracefully (exit 0)', () => {
    const result = runHook({
      agent_type: 'pike',
      tool_name: 'Write',
    });
    expect(result.exitCode).toBe(0);
  });
});
