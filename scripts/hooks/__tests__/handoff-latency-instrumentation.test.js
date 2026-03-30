/**
 * Tests for handoff latency instrumentation in observer hooks.
 *
 * New behavior:
 * - observe-stop.js emits a `handoff-stop` event with ms-precision timestamp,
 *   agentName, and itemId parsed from the transcript (agentStop --itemId call).
 * - observe-pre-tool-use.js emits a `handoff-start` event on the first tool
 *   call for a new item (detected via agents-start --itemId in the command).
 *
 * The delta between handoff-stop and handoff-start on the same itemId is
 * the true handoff latency.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer } from 'http';

const HOOKS_DIR = join(import.meta.dirname, '..');
const STOP_HOOK = join(HOOKS_DIR, 'observe-stop.js');
const PRE_TOOL_HOOK = join(HOOKS_DIR, 'observe-pre-tool-use.js');

// ============ Mock HTTP Server ============

/** Captured POST bodies from the mock API server */
let capturedEvents = [];
let mockServer;
let mockServerPort;

beforeAll(async () => {
  await new Promise((resolve) => {
    mockServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try { capturedEvents.push(JSON.parse(body)); } catch { /* ignore */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockServerPort = mockServer.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => mockServer.close(resolve));
});

beforeEach(() => {
  capturedEvents = [];
});

/** Run a hook as a subprocess against the mock server. */
function runHook(scriptPath, stdin = {}, extraArgs = [], transcriptPath = '') {
  const env = {
    ...process.env,
    ATEAM_API_URL: `http://127.0.0.1:${mockServerPort}`,
    ATEAM_PROJECT_ID: 'test-project',
  };
  try {
    execFileSync('node', [scriptPath, ...extraArgs], {
      env,
      encoding: 'utf8',
      timeout: 5000,
      input: JSON.stringify({ ...stdin, ...(transcriptPath && { transcript_path: transcriptPath }) }),
    });
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: err.status ?? 1, stderr: (err.stderr || '').trim() };
  }
}

/** Build a minimal JSONL transcript line with a Bash tool_use containing agentStop. */
function makeTranscriptWithAgentStop(itemId) {
  const line = JSON.stringify({
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: `ateam agents-stop agentStop --itemId "${itemId}" --agent "Murdock" --outcome completed --summary "Tests written"`,
          },
        },
      ],
    },
  });
  const path = join(tmpdir(), `handoff-test-transcript-${Date.now()}.jsonl`);
  writeFileSync(path, line + '\n');
  return path;
}

// ============ Tests ============

describe('observe-stop — handoff-stop event', () => {
  it('emits a handoff-stop event with the itemId extracted from the transcript', async () => {
    const transcriptPath = makeTranscriptWithAgentStop('WI-001');
    try {
      runHook(STOP_HOOK, { hook_event_name: 'Stop', session_id: 'sess-1' }, ['Murdock'], transcriptPath);

      // The hook awaits all HTTP requests before exiting, so the mock server has received
      // everything by the time execFileSync returns. The brief wait allows the test process's
      // event loop to drain any remaining async callbacks from the mock server's req.on('end').
      await new Promise((r) => setTimeout(r, 50));

      const handoffStop = capturedEvents.find((e) => e.eventType === 'handoff-stop');
      expect(handoffStop, 'expected a handoff-stop event to be emitted').toBeTruthy();
      expect(handoffStop.itemId).toBe('WI-001');
      expect(handoffStop.agentName).toBe('Murdock');
    } finally {
      try { unlinkSync(transcriptPath); } catch { /* ignore */ }
    }
  });

  it('handoff-stop timestamp has millisecond precision (epoch ms, not just ISO string)', async () => {
    const transcriptPath = makeTranscriptWithAgentStop('WI-002');
    try {
      runHook(STOP_HOOK, { hook_event_name: 'Stop', session_id: 'sess-2' }, ['B.A.'], transcriptPath);

      await new Promise((r) => setTimeout(r, 50));

      const handoffStop = capturedEvents.find((e) => e.eventType === 'handoff-stop');
      expect(handoffStop, 'expected a handoff-stop event').toBeTruthy();
      // timestampMs must be a number (epoch milliseconds), not just an ISO string
      expect(typeof handoffStop.timestampMs).toBe('number');
      expect(handoffStop.timestampMs).toBeGreaterThan(Date.now() - 10_000);
    } finally {
      try { unlinkSync(transcriptPath); } catch { /* ignore */ }
    }
  });
});

describe('observe-pre-tool-use — handoff-start event', () => {
  it('emits a handoff-start event when first tool call command contains agents-start --itemId', async () => {
    runHook(PRE_TOOL_HOOK, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ateam agents-start agentStart --itemId "WI-003" --agent "B.A."' },
      session_id: 'sess-3',
      agent_type: 'ba',
    });

    await new Promise((r) => setTimeout(r, 200)); // pre-tool-use hook is still fire-and-forget

    const handoffStart = capturedEvents.find((e) => e.eventType === 'handoff-start');
    expect(handoffStart, 'expected a handoff-start event to be emitted').toBeTruthy();
    expect(handoffStart.itemId).toBe('WI-003');
  });

  it('does not emit handoff-start for non-agentStart tool calls', async () => {
    runHook(PRE_TOOL_HOOK, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      session_id: 'sess-4',
      agent_type: 'murdock',
    });

    await new Promise((r) => setTimeout(r, 200)); // pre-tool-use hook is still fire-and-forget

    const handoffStart = capturedEvents.find((e) => e.eventType === 'handoff-start');
    expect(handoffStart).toBeUndefined();
  });
});
