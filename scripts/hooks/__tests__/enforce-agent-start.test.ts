/**
 * Tests for enforce-agent-start.js — PreToolUse hook that blocks
 * `ateam agents-stop` / `ateam activity` when the session never
 * called `ateam agents-start`.
 *
 * Regression focus: the original implementation used naive substring
 * matching on the command (`command.includes('agents-stop')`), which
 * false-positived on ordinary shell commands that merely mentioned
 * these strings in file paths or grep patterns — e.g.
 * `git log packages/ateam-cli/cmd/agents-stop_agentStop.go`.
 * An agent tripping on such a command would mis-diagnose the block
 * and chase a phantom fix. The "regression" describe blocks below
 * lock that class of bug out.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';

const HOOK = join(__dirname, '..', 'enforce-agent-start.js');
const STARTED_DIR = join(tmpdir(), 'ateam-agent-started');

function runHook(stdin: object) {
  try {
    const stdout = execFileSync('node', [HOOK], {
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

function markerPath(sessionId: string) {
  return join(STARTED_DIR, sessionId);
}

function writeMarker(sessionId: string) {
  mkdirSync(STARTED_DIR, { recursive: true });
  writeFileSync(markerPath(sessionId), 'test');
}

function clearMarker(sessionId: string) {
  const p = markerPath(sessionId);
  if (existsSync(p)) rmSync(p);
}

const SESSION_WITH_START = `test-enforce-start-with-${process.pid}-${Date.now()}`;
const SESSION_WITHOUT_START = `test-enforce-start-without-${process.pid}-${Date.now()}`;

describe('enforce-agent-start', () => {
  beforeEach(() => {
    writeMarker(SESSION_WITH_START);
    clearMarker(SESSION_WITHOUT_START);
  });

  afterEach(() => {
    clearMarker(SESSION_WITH_START);
    clearMarker(SESSION_WITHOUT_START);
  });

  describe('blocks genuine ateam CLI calls that require prior agentStart', () => {
    it('blocks `ateam agents-stop agentStop` without marker (exit 2)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command:
            'ateam agents-stop agentStop --itemId WI-001 --agent Murdock --outcome completed --summary done',
        },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/agentStart/i);
    });

    it('blocks `ateam activity createActivityEntry` without marker (exit 2)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command: 'ateam activity createActivityEntry --agent Murdock --message hi --level info',
        },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
    });
  });

  describe('allows genuine ateam CLI calls after prior agentStart', () => {
    it('allows `ateam agents-stop agentStop` with marker (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITH_START,
        tool_name: 'Bash',
        tool_input: {
          command:
            'ateam agents-stop agentStop --itemId WI-001 --agent Murdock --outcome completed --summary done',
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows `ateam activity createActivityEntry` with marker (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITH_START,
        tool_name: 'Bash',
        tool_input: {
          command: 'ateam activity createActivityEntry --agent Murdock --message hi',
        },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('always allows `ateam agents-start` (creates the marker)', () => {
    it('allows `ateam agents-start agentStart` even without marker (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command: 'ateam agents-start agentStart --itemId WI-001 --agent Murdock',
        },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('regression: composed-command bypass (CodeRabbit PR #35)', () => {
    // Previously, a composed command that mentioned `ateam agents-start`
    // anywhere in the string (e.g. via printf/echo) would short-circuit
    // the early-exit branch, letting the actual `agents-stop` invocation
    // skip the marker check and fail downstream with NOT_CLAIMED.
    it('blocks composed bypass: printf "ateam agents-start"; ateam agents-stop ... (exit 2)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command:
            "printf 'ateam agents-start'; ateam agents-stop agentStop --itemId WI-001 --agent Murdock --outcome completed --summary done",
        },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/BLOCKED/i);
      expect(result.stderr).toMatch(/agentStart/i);
    });

    it('still allows pure `ateam agents-start` after the early-exit is removed (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command: 'ateam agents-start agentStart --itemId WI-001 --agent murdock',
        },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('regression: false-positive on file paths or grep patterns', () => {
    it('does NOT block `git log` on a path containing "agents-stop" (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command:
            'git log --oneline -20 -- packages/ateam-cli/cmd/agents-stop_agentStop.go',
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('does NOT block `grep` searching for the literal string "agents-stop" (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command: 'grep -r agents-stop packages/ateam-cli/cmd/',
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('does NOT block `cat` on a file whose name contains "agents-stop" (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command: 'cat packages/ateam-cli/cmd/agents-stop_agentStop.go',
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('does NOT block `ls` on paths whose name contains "activity" (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command: 'ls packages/ateam-cli/cmd/activity_*.go',
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('does NOT block a command that just contains "ateam" in a directory path (exit 0)', () => {
      // e.g. `ls ~/Code/TheAITeam/the-ai-team-plugin` contains "ateam" but
      // is not an ateam CLI invocation. Previously the gate `includes('ateam')`
      // would pass, then `includes('agents-stop')` would also pass on a
      // filename, producing a false block. The gate must require the CLI
      // form `ateam <subcommand>`.
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: {
          command:
            'ls /home/josh/Code/TheAITeam/the-ai-team-plugin/packages/ateam-cli/cmd/agents-stop_agentStop.go',
        },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('allows other ateam subcommands that do not require prior start', () => {
    it('allows `ateam board getBoard` without marker (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: { command: 'ateam board getBoard --json' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows `ateam items listItems` without marker (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: { command: 'ateam items listItems --json' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows `ateam deps-check checkDeps` without marker (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Bash',
        tool_input: { command: 'ateam deps-check checkDeps --json' },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('non-Bash tool calls are never checked', () => {
    it('allows Write tool even when content mentions agents-stop (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Write',
        tool_input: {
          file_path: 'notes.md',
          content: 'to run ateam agents-stop agentStop later',
        },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows Read tool (exit 0)', () => {
      const result = runHook({
        session_id: SESSION_WITHOUT_START,
        tool_name: 'Read',
        tool_input: { file_path: 'packages/ateam-cli/cmd/agents-stop_agentStop.go' },
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('fail-open on malformed input', () => {
    it('exits 0 when stdin is not valid JSON', () => {
      try {
        execFileSync('node', [HOOK], {
          encoding: 'utf8',
          timeout: 5000,
          input: 'not json',
        });
        // reached here → exit 0
        expect(true).toBe(true);
      } catch (err: any) {
        throw new Error(`expected exit 0 on bad stdin, got ${err.status}`);
      }
    });

    it('exits 0 when session_id is missing (cannot verify either way)', () => {
      const result = runHook({
        tool_name: 'Bash',
        tool_input: {
          command:
            'ateam agents-stop agentStop --itemId WI-001 --agent Murdock --outcome completed --summary done',
        },
      });
      expect(result.exitCode).toBe(0);
    });
  });
});
