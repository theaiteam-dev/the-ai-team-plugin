import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const HANDOFF_HOOK = join(__dirname, '..', 'enforce-handoff.js');

/**
 * Helper: run the hook with given stdin and optional env overrides.
 */
function runHook(stdin, env = {}) {
  const fullEnv = {
    ...process.env,
    ATEAM_API_URL: 'http://localhost:3000',
    ATEAM_PROJECT_ID: 'test-project',
    ...env,
  };
  try {
    const stdout = execFileSync('node', [HANDOFF_HOOK], {
      env: fullEnv,
      encoding: 'utf8',
      timeout: 10000,
      input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
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

function parseOutput(stdout) {
  if (!stdout) return {};
  try { return JSON.parse(stdout); } catch { return {}; }
}

/**
 * Build a minimal JSONL transcript with tool_use entries.
 * Each entry can be a tool_use or tool_result block.
 */
function buildTranscript(blocks) {
  return blocks
    .map((block) => {
      if (block.type === 'tool_result') {
        return JSON.stringify({
          message: {
            content: [{ type: 'tool_result', text: block.text }],
          },
        });
      }
      return JSON.stringify({
        message: {
          content: [
            {
              type: 'tool_use',
              name: block.name,
              input: block.input || {},
            },
          ],
        },
      });
    })
    .join('\n');
}

let tmpDir;

beforeEach(() => {
  tmpDir = join(tmpdir(), `handoff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeTranscript(blocks) {
  const path = join(tmpDir, 'transcript.jsonl');
  writeFileSync(path, buildTranscript(blocks));
  return path;
}

// =============================================================================
// Fail-open behavior
// =============================================================================
describe('enforce-handoff — fail-open', () => {
  it('allows stop for non-pipeline agents', () => {
    const result = runHook({ agent_type: 'ai-team:face', transcript_path: '/tmp/none.jsonl' });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('allows stop when no transcript_path', () => {
    const result = runHook({ agent_type: 'ai-team:murdock-1' });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('allows stop when transcript is unreadable', () => {
    const result = runHook({
      agent_type: 'ai-team:murdock-1',
      transcript_path: '/tmp/nonexistent-transcript.jsonl',
    });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('allows stop with bad stdin', () => {
    const result = runHook('not-json');
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });
});

// =============================================================================
// Forward flow — claimedNext strict matching
// =============================================================================
describe('enforce-handoff — forward flow with claimedNext', () => {
  it('allows when START goes to exact claimedNext instance', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "murdock-1" --outcome completed --summary "tests" --json' },
      },
      {
        type: 'tool_result',
        text: '{"success":true,"data":{"claimedNext":"ba-2","poolAlert":""}}',
      },
      {
        name: 'SendMessage',
        input: { to: 'ba-2', content: 'START: WI-005 - tests written' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-005 - handed off to ba-2' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:murdock-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('blocks when START goes to wrong instance despite claimedNext', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "murdock-1" --outcome completed --summary "tests" --json' },
      },
      {
        type: 'tool_result',
        text: '{"success":true,"data":{"claimedNext":"ba-2","poolAlert":""}}',
      },
      {
        name: 'SendMessage',
        input: { to: 'ba-1', content: 'START: WI-005 - tests written' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:murdock-1', transcript_path: transcriptPath });
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('ba-2');
  });

  it('falls back to startsWith when claimedNext not in transcript', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "murdock-1" --outcome completed --summary "tests"' },
      },
      {
        name: 'SendMessage',
        input: { to: 'ba-1', content: 'START: WI-005 - tests written' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-005 - handed off' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:murdock-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('allows ALERT to hannibal on pool alert (no idle next agent)', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "ba-1" --outcome completed --summary "impl" --json' },
      },
      {
        type: 'tool_result',
        text: '{"success":true,"data":{"claimedNext":"","poolAlert":"no idle lynch instance available"}}',
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'ALERT: WI-005 - no idle lynch instance available' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:ba-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });
});

// =============================================================================
// B.A. → Lynch forward flow
// =============================================================================
describe('enforce-handoff — B.A. forward flow', () => {
  it('allows B.A. START to lynch instance', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-003" --agent "ba-1" --outcome completed --summary "impl" --json' },
      },
      {
        type: 'tool_result',
        text: '{"success":true,"data":{"claimedNext":"lynch-1","poolAlert":""}}',
      },
      {
        name: 'SendMessage',
        input: { to: 'lynch-1', content: 'START: WI-003 - implemented' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-003 - handed off to lynch-1' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:ba-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });
});

// =============================================================================
// Lynch → Amy forward flow
// =============================================================================
describe('enforce-handoff — Lynch forward flow', () => {
  it('allows Lynch START to amy instance', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-003" --agent "lynch-1" --outcome completed --summary "approved" --json' },
      },
      {
        type: 'tool_result',
        text: '{"success":true,"data":{"claimedNext":"amy-1","poolAlert":""}}',
      },
      {
        name: 'SendMessage',
        input: { to: 'amy-1', content: 'START: WI-003 - approved' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-003 - handed off to amy-1' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:lynch-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });
});

// =============================================================================
// Amy — FYI to hannibal only
// =============================================================================
describe('enforce-handoff — Amy terminal handoff', () => {
  it('allows Amy with FYI to hannibal', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-003" --agent "amy-1" --outcome completed --summary "verified" --json' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-003 - probing complete. VERIFIED.' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:amy-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('allows Amy with missionComplete=true sending MISSION_COMPLETE to hannibal', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-003" --agent "amy-1" --outcome completed --summary "verified" --json' },
      },
      {
        type: 'tool_result',
        text: '{"success":true,"data":{"claimedNext":"","missionComplete":true}}',
      },
      {
        name: 'SendMessage',
        input: {
          to: 'hannibal',
          content: 'MISSION_COMPLETE: WI-003 - all items verified and in done stage. Ready for final review.',
        },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:amy-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('blocks Amy with missionComplete=true sending only plain FYI (no MISSION_COMPLETE)', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-003" --agent "amy-1" --outcome completed --summary "verified" --json' },
      },
      {
        type: 'tool_result',
        text: '{"success":true,"data":{"claimedNext":"","missionComplete":true}}',
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-003 - probing complete. VERIFIED.' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:amy-1', transcript_path: transcriptPath });
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('MISSION_COMPLETE');
  });

  it('blocks Amy with missionComplete=false sending premature MISSION_COMPLETE', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-003" --agent "amy-1" --outcome completed --summary "verified" --json' },
      },
      {
        type: 'tool_result',
        text: '{"success":true,"data":{"claimedNext":"","missionComplete":false}}',
      },
      {
        name: 'SendMessage',
        input: {
          to: 'hannibal',
          content: 'MISSION_COMPLETE: WI-003 - all items verified and in done stage. Ready for final review.',
        },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:amy-1', transcript_path: transcriptPath });
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('FYI');
  });
});

// =============================================================================
// Rejection flow — routing validation
// =============================================================================
describe('enforce-handoff — rejection routing', () => {
  it('allows Lynch rejecting to testing → REJECTED to murdock instance', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "lynch-1" --outcome rejected --return-to testing --summary "tests are wrong" --json' },
      },
      {
        name: 'SendMessage',
        input: { to: 'murdock-1', content: 'REJECTED: WI-005 - tests are wrong' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-005 - rejected to testing' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:lynch-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('blocks Lynch rejecting to testing but REJECTED sent to ba (wrong target)', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "lynch-1" --outcome rejected --return-to testing --summary "tests bad" --json' },
      },
      {
        name: 'SendMessage',
        input: { to: 'ba-1', content: 'REJECTED: WI-005 - tests bad' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:lynch-1', transcript_path: transcriptPath });
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('murdock');
  });

  it('allows Lynch rejecting to implementing → REJECTED to ba instance', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "lynch-1" --outcome rejected --return-to implementing --summary "impl broken" --json' },
      },
      {
        name: 'SendMessage',
        input: { to: 'ba-2', content: 'REJECTED: WI-005 - impl broken' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-005 - rejected to implementing' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:lynch-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('allows Amy rejecting to implementing → REJECTED to ba instance', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "amy-1" --outcome rejected --return-to implementing --summary "bugs found" --json' },
      },
      {
        name: 'SendMessage',
        input: { to: 'ba-1', content: 'REJECTED: WI-005 - bugs found' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-005 - rejected to implementing' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:amy-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('falls back to any REJECTED when --return-to is not parseable', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "lynch-1" --outcome rejected --summary "issues" --json' },
      },
      {
        name: 'SendMessage',
        input: { to: 'someone', content: 'REJECTED: WI-005 - issues found' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:lynch-1', transcript_path: transcriptPath });
    expect(result.exitCode).toBe(0);
    expect(parseOutput(result.stdout)).toEqual({});
  });

  it('blocks rejection with no handoff message at all', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "lynch-1" --outcome rejected --return-to testing --summary "bad" --json' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:lynch-1', transcript_path: transcriptPath });
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('murdock');
  });
});

// =============================================================================
// FYI alone must NOT satisfy handoff for non-Amy agents
// =============================================================================
describe('enforce-handoff — FYI catch-all removed', () => {
  it('blocks B.A. when only FYI sent to hannibal (no START to lynch)', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "ba-1" --outcome completed --summary "impl" --json' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-005 - done' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:ba-1', transcript_path: transcriptPath });
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
  });

  it('blocks B.A. when START goes to wrong agent even with FYI to hannibal', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "ba-1" --outcome completed --summary "impl" --json' },
      },
      {
        type: 'tool_result',
        text: '{"success":true,"data":{"claimedNext":"lynch-1","poolAlert":""}}',
      },
      {
        name: 'SendMessage',
        input: { to: 'amy-1', content: 'START: WI-005 - skipping Lynch' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-005 - handed off' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:ba-1', transcript_path: transcriptPath });
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('lynch-1');
  });

  it('blocks Murdock when only FYI sent (no START to B.A.)', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'Bash',
        input: { command: 'ateam agents-stop agentStop --itemId "WI-005" --agent "murdock-1" --outcome completed --summary "tests" --json' },
      },
      {
        name: 'SendMessage',
        input: { to: 'hannibal', content: 'FYI: WI-005 - done' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:murdock-1', transcript_path: transcriptPath });
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
  });
});

// =============================================================================
// Blocks when agentStop not called
// =============================================================================
describe('enforce-handoff — missing agentStop', () => {
  it('blocks when no agentStop in transcript', () => {
    const transcriptPath = writeTranscript([
      {
        name: 'SendMessage',
        input: { to: 'ba-1', content: 'START: WI-005 - done' },
      },
    ]);

    const result = runHook({ agent_type: 'ai-team:murdock-1', transcript_path: transcriptPath });
    const output = parseOutput(result.stdout);
    expect(output.decision).toBe('block');
    expect(output.reason).toContain('agentStop');
  });
});
