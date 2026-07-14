/**
 * Tests for per-message token emission from the Stop / SubagentStop observer
 * hooks (WI-172).
 *
 * observe-stop.js and observe-subagent.js are wired to the rewritten
 * parseTranscriptUsage (WI-170, returns an array of per-message records) and the
 * new POST /api/hooks/token-usage endpoint (WI-171). On Stop / SubagentStop each
 * assistant message's usage is POSTed as its own record (attributed to that
 * message's own model), while the legacy /api/hooks/events stop event keeps a
 * summed scalar so existing HookEvent token fields stay populated.
 *
 * These run the real hook scripts as subprocesses against a mock HTTP server so
 * we observe exactly which endpoints are hit and with what bodies — following
 * the pattern in handoff-latency-instrumentation.test.js.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer } from 'http';
import { lookupAgent } from '../lib/observer.js';

const HOOKS_DIR = join(import.meta.dirname, '..');
const STOP_HOOK = join(HOOKS_DIR, 'observe-stop.js');
const SUBAGENT_HOOK = join(HOOKS_DIR, 'observe-subagent.js');

// ============ Mock HTTP Server ============

/** Captured requests: { url, headers, body } for every POST received. */
let captured = [];
/** When true, the server returns 500 for /api/hooks/token-usage requests. */
let failTokenUsage = false;
/** When > 0, the server accepts the /api/hooks/token-usage connection but delays the response by this many ms (simulates a hung endpoint). */
let hangTokenUsageMs = 0;
let mockServer;
let mockPort;

beforeAll(async () => {
  await new Promise((resolve) => {
    mockServer = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { body = raw; }
        captured.push({ url: req.url, headers: req.headers, body });
        if (hangTokenUsageMs > 0 && req.url.includes('/api/hooks/token-usage')) {
          // Connection accepted, response deliberately withheld to simulate a hang.
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          }, hangTokenUsageMs);
          return;
        }
        if (failTokenUsage && req.url.includes('/api/hooks/token-usage')) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => mockServer.close(resolve));
});

beforeEach(() => {
  captured = [];
  failTokenUsage = false;
  hangTokenUsageMs = 0;
});

// ============ Helpers ============

const tempFiles = [];

function writeTranscript(lines) {
  const dir = join(tmpdir(), 'ateam-per-message-emit');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `transcript-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf8');
  tempFiles.push(path);
  return path;
}

/** An assistant transcript line with a per-message usage block. */
function assistantLine({ id, sessionId, model, input, output, cacheCreate, cacheRead }) {
  const message = {
    model,
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_creation_input_tokens: cacheCreate,
      cache_read_input_tokens: cacheRead,
    },
  };
  if (id !== undefined) message.id = id;
  return { type: 'assistant', sessionId, message };
}

/** A tool_use line carrying an agentStop command (drives handoff-stop + advance flag). */
function agentStopLine(itemId, extra = '') {
  return {
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: `ateam agents-stop agentStop --itemId "${itemId}" --agent "Murdock" --outcome completed --summary "done"${extra}`,
          },
        },
      ],
    },
  };
}

/**
 * Runs a hook as an async subprocess. Async (not execFileSync) is required: the
 * mock server lives in this same process, so a synchronous spawn would block the
 * event loop and deadlock the child's fetch against the unresponsive server.
 */
function runHook(scriptPath, stdin, extraArgs = [], extraEnv = {}) {
  const env = {
    ...process.env,
    ATEAM_API_URL: `http://127.0.0.1:${mockPort}`,
    ATEAM_PROJECT_ID: 'test-project',
    ...extraEnv,
  };
  return new Promise((resolve) => {
    const child = execFile('node', [scriptPath, ...extraArgs], { env, encoding: 'utf8', timeout: 5000 });
    child.on('error', () => resolve({ exitCode: 1 }));
    child.on('close', (code) => resolve({ exitCode: code ?? 0 }));
    child.stdin.write(JSON.stringify(stdin));
    child.stdin.end();
  });
}

const drain = () => new Promise((r) => setTimeout(r, 20));

/** All captured requests whose URL contains the given path fragment. */
function requestsTo(fragment) {
  return captured.filter((r) => r.url.includes(fragment));
}

afterAll(() => {
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
});

// ============ observe-stop.js ============

describe('observe-stop.js — per-message token-usage emission', () => {
  it('POSTs one record per assistant message to /api/hooks/token-usage, each with its own model, deltas, timestamp, agentName, and X-Project-ID', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'm1', sessionId: 'sess_a', model: 'claude-opus-4-8', input: 5000, output: 1200, cacheCreate: 2000, cacheRead: 8000 }),
      assistantLine({ id: 'm2', sessionId: 'sess_a', model: 'claude-sonnet-4-6', input: 3000, output: 800, cacheCreate: 0, cacheRead: 6000 }),
    ]);

    const { exitCode } = await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_a', transcript_path: transcriptPath },
      ['murdock']
    );
    await drain();

    expect(exitCode).toBe(0);

    const tu = requestsTo('/api/hooks/token-usage');
    expect(tu).toHaveLength(1);
    expect(tu[0].headers['x-project-id']).toBe('test-project');

    const records = tu[0].body;
    expect(Array.isArray(records)).toBe(true);
    expect(records).toHaveLength(2);

    const byId = Object.fromEntries(records.map((r) => [r.messageId, r]));
    expect(byId['m1']).toMatchObject({
      messageId: 'm1',
      model: 'claude-opus-4-8',
      inputTokens: 5000,
      outputTokens: 1200,
      cacheCreationTokens: 2000,
      cacheReadTokens: 8000,
      agentName: 'murdock',
    });
    expect(byId['m2']).toMatchObject({
      messageId: 'm2',
      model: 'claude-sonnet-4-6',
      inputTokens: 3000,
      outputTokens: 800,
      cacheCreationTokens: 0,
      cacheReadTokens: 6000,
      agentName: 'murdock',
    });
    // Every record carries a parseable timestamp.
    for (const r of records) {
      expect(r.timestamp).toBeTruthy();
      expect(Number.isNaN(Date.parse(r.timestamp))).toBe(false);
    }
  });

  it('still POSTs the stop event to /api/hooks/events with the per-message records summed back to a single scalar (representative model preserved)', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'm1', sessionId: 'sess_b', model: 'claude-opus-4-8', input: 5000, output: 1200, cacheCreate: 2000, cacheRead: 8000 }),
      assistantLine({ id: 'm2', sessionId: 'sess_b', model: 'claude-sonnet-4-6', input: 3000, output: 800, cacheCreate: 0, cacheRead: 6000 }),
    ]);

    await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_b', transcript_path: transcriptPath },
      ['hannibal']
    );
    await drain();

    const stopEvents = requestsTo('/api/hooks/events').map((r) => r.body).filter((b) => b && b.eventType === 'stop');
    expect(stopEvents).toHaveLength(1);
    const stop = stopEvents[0];

    // Summed scalar — exactly what the single-total parser produced before.
    expect(stop.inputTokens).toBe(8000);
    expect(stop.outputTokens).toBe(2000);
    expect(stop.cacheCreationTokens).toBe(2000);
    expect(stop.cacheReadTokens).toBe(14000);
    // Representative model is the token-dominant one: m1 (opus) totals 16200
    // tokens (5000+1200+2000+8000) vs m2 (sonnet) 9800 (3000+800+0+6000).
    expect(stop.model).toBe('claude-opus-4-8');
  });

  it('is fire-and-forget: a failing token-usage POST does not block the hook (exit 0) and the legacy stop event is still delivered', async () => {
    failTokenUsage = true;
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'm1', sessionId: 'sess_c', model: 'claude-opus-4-8', input: 100, output: 50, cacheCreate: 0, cacheRead: 0 }),
    ]);

    const { exitCode } = await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_c', transcript_path: transcriptPath },
      ['hannibal']
    );
    await drain();

    expect(exitCode).toBe(0);
    // token-usage was attempted (and 500'd) ...
    expect(requestsTo('/api/hooks/token-usage')).toHaveLength(1);
    // ... but the legacy events stop POST still went through unaffected.
    const stopEvents = requestsTo('/api/hooks/events').map((r) => r.body).filter((b) => b && b.eventType === 'stop');
    expect(stopEvents).toHaveLength(1);
  });

  it('preserves existing handoff-stop and advance-flag emission alongside the new token-usage POST', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'm1', sessionId: 'sess_d', model: 'claude-opus-4-8', input: 10, output: 20, cacheCreate: 0, cacheRead: 0 }),
      agentStopLine('WI-999', ' --advance=false'),
    ]);

    await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_d', transcript_path: transcriptPath },
      ['murdock']
    );
    await drain();

    const events = requestsTo('/api/hooks/events').map((r) => r.body);

    // handoff-stop event still emitted with the parsed itemId.
    const handoffStop = events.find((b) => b && b.eventType === 'handoff-stop');
    expect(handoffStop, 'expected handoff-stop event').toBeTruthy();
    expect(handoffStop.itemId).toBe('WI-999');

    // advance-flag still merged into the stop event payload.
    const stop = events.find((b) => b && b.eventType === 'stop');
    expect(stop).toBeTruthy();
    expect(stop.advanceFlagUsed).toBe(false);

    // And the new token-usage POST still fired.
    expect(requestsTo('/api/hooks/token-usage')).toHaveLength(1);
  });

  it('attributes per-message records to the resolved agent (hannibal) when no CLI agent arg is passed — the main orchestrator session fires the generic hooks.json Stop hook', async () => {
    // The main orchestrator session is not a spawned subagent, so its
    // ai-team:hannibal frontmatter Stop hook does not apply; it fires the
    // plugin-level hooks.json Stop hook, which passes NO agent name (no argv[2]).
    // stdin carries neither teammate_name nor agent_type. The records must still
    // resolve to 'hannibal', not fall through to a bogus 'unknown' bucket.
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'orch1', sessionId: 'sess_orch', model: 'claude-sonnet-4-6', input: 78, output: 20563, cacheCreate: 120610, cacheRead: 3444236 }),
    ]);

    const { exitCode } = await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_orch', transcript_path: transcriptPath },
      [] // no agent arg — mirrors the generic hooks.json Stop wiring
    );
    await drain();

    expect(exitCode).toBe(0);

    const tu = requestsTo('/api/hooks/token-usage');
    expect(tu).toHaveLength(1);
    const records = tu[0].body;
    expect(records).toHaveLength(1);
    expect(records[0].agentName).toBe('hannibal');
    expect(records[0].agentName).not.toBe('unknown');
  });

  it('aborts a hanging token-usage POST via timeout so the hook still exits 0 promptly and delivers the legacy stop event', async () => {
    hangTokenUsageMs = 2000; // the mock server never responds within the low timeout below
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'm1', sessionId: 'sess_hang', model: 'claude-opus-4-8', input: 100, output: 50, cacheCreate: 0, cacheRead: 0 }),
    ]);

    const start = Date.now();
    const { exitCode } = await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_hang', transcript_path: transcriptPath },
      ['hannibal'],
      { ATEAM_TOKEN_USAGE_TIMEOUT_MS: '100' }
    );
    const elapsedMs = Date.now() - start;
    await drain();

    expect(exitCode).toBe(0);
    // The hook must not have waited out the full 2000ms hang.
    expect(elapsedMs).toBeLessThan(1500);

    // The legacy stop event still went through unaffected by the aborted POST.
    const stopEvents = requestsTo('/api/hooks/events').map((r) => r.body).filter((b) => b && b.eventType === 'stop');
    expect(stopEvents).toHaveLength(1);
  });

  it('mints sessionId-namespaced synthetic messageIds for id-less assistant messages', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ sessionId: 'sess_idless', model: 'claude-opus-4-8', input: 1, output: 2, cacheCreate: 0, cacheRead: 0 }),
      assistantLine({ sessionId: 'sess_idless', model: 'claude-opus-4-8', input: 3, output: 4, cacheCreate: 0, cacheRead: 0 }),
    ]);

    await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_idless', transcript_path: transcriptPath },
      ['hannibal']
    );
    await drain();

    const tu = requestsTo('/api/hooks/token-usage');
    expect(tu).toHaveLength(1);
    const ids = tu[0].body.map((r) => r.messageId).sort();
    expect(ids).toEqual(['sess_idless:idx:0', 'sess_idless:idx:1']);
  });
});

// ============ observe-subagent.js ============

describe('observe-subagent.js — per-message token-usage emission on SubagentStop', () => {
  it('POSTs per-message records to /api/hooks/token-usage using the resolved agentName and agent_transcript_path', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ id: 's1', sessionId: 'sub_a', model: 'claude-opus-4-8', input: 700, output: 90, cacheCreate: 10, cacheRead: 20 }),
    ]);

    const { exitCode } = await runHook(SUBAGENT_HOOK, {
      hook_event_name: 'SubagentStop',
      session_id: 'sub_a',
      agent_id: 'agent-xyz',
      agent_type: 'ai-team:murdock',
      agent_transcript_path: transcriptPath,
    });
    await drain();

    expect(exitCode).toBe(0);

    const tu = requestsTo('/api/hooks/token-usage');
    expect(tu).toHaveLength(1);
    expect(tu[0].headers['x-project-id']).toBe('test-project');

    const records = tu[0].body;
    expect(Array.isArray(records)).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      messageId: 's1',
      model: 'claude-opus-4-8',
      inputTokens: 700,
      outputTokens: 90,
      cacheCreationTokens: 10,
      cacheReadTokens: 20,
      agentName: 'murdock',
    });
    expect(records[0].timestamp).toBeTruthy();
  });

  it('still posts the subagent_stop event to /api/hooks/events with summed scalar tokens and re-registers hannibal', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ id: 's1', sessionId: 'sub_b', model: 'claude-opus-4-8', input: 700, output: 90, cacheCreate: 10, cacheRead: 20 }),
      assistantLine({ id: 's2', sessionId: 'sub_b', model: 'claude-sonnet-4-6', input: 300, output: 10, cacheCreate: 5, cacheRead: 80 }),
    ]);

    await runHook(SUBAGENT_HOOK, {
      hook_event_name: 'SubagentStop',
      session_id: 'sub_b',
      agent_id: 'agent-b',
      agent_type: 'ai-team:murdock',
      agent_transcript_path: transcriptPath,
    });
    await drain();

    const subStops = requestsTo('/api/hooks/events').map((r) => r.body).filter((b) => b && b.eventType === 'subagent_stop');
    expect(subStops).toHaveLength(1);
    const ev = subStops[0];
    expect(ev.inputTokens).toBe(1000);
    expect(ev.outputTokens).toBe(100);
    expect(ev.cacheCreationTokens).toBe(15);
    expect(ev.cacheReadTokens).toBe(100);
    // Representative model is the token-dominant one: s1 (opus) totals 820
    // tokens (700+90+10+20) vs s2 (sonnet) 395 (300+10+5+80).
    expect(ev.model).toBe('claude-opus-4-8');

    // Control returns to the main session: hannibal is re-registered for this session.
    expect(lookupAgent('sub_b')).toBe('hannibal');
  });

  it('aborts a hanging token-usage POST via timeout so the hook still exits 0 promptly and delivers the legacy subagent_stop event', async () => {
    hangTokenUsageMs = 2000; // the mock server never responds within the low timeout below
    const transcriptPath = writeTranscript([
      assistantLine({ id: 's1', sessionId: 'sub_hang', model: 'claude-opus-4-8', input: 100, output: 50, cacheCreate: 0, cacheRead: 0 }),
    ]);

    const start = Date.now();
    const { exitCode } = await runHook(
      SUBAGENT_HOOK,
      {
        hook_event_name: 'SubagentStop',
        session_id: 'sub_hang',
        agent_id: 'agent-hang',
        agent_type: 'ai-team:murdock',
        agent_transcript_path: transcriptPath,
      },
      [],
      { ATEAM_TOKEN_USAGE_TIMEOUT_MS: '100' }
    );
    const elapsedMs = Date.now() - start;
    await drain();

    expect(exitCode).toBe(0);
    expect(elapsedMs).toBeLessThan(1500);

    const subStops = requestsTo('/api/hooks/events').map((r) => r.body).filter((b) => b && b.eventType === 'subagent_stop');
    expect(subStops).toHaveLength(1);
  });
});

// ============ auth + attribution contracts (CF-Access headers, skip-when-unattributed) ============

describe('token-usage POST auth + attribution', () => {
  it('carries CF-Access headers on the token-usage POST when creds are present (the v1.9.0 fix missed this call site)', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'm1', sessionId: 'sess_cf', model: 'claude-opus-4-8', input: 100, output: 50, cacheCreate: 0, cacheRead: 0 }),
    ]);

    const { exitCode } = await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_cf', transcript_path: transcriptPath },
      ['murdock'],
      { ACCESS_CLIENT_ID: 'cf-id-123', ACCESS_CLIENT_SECRET: 'cf-secret-456' }
    );
    await drain();
    expect(exitCode).toBe(0);

    const tu = requestsTo('/api/hooks/token-usage');
    expect(tu).toHaveLength(1);
    expect(tu[0].headers['cf-access-client-id']).toBe('cf-id-123');
    expect(tu[0].headers['cf-access-client-secret']).toBe('cf-secret-456');
    // The events POST must carry them too — both paths share apiEventHeaders.
    const ev = requestsTo('/api/hooks/events');
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0].headers['cf-access-client-id']).toBe('cf-id-123');
  });

  it('omits CF-Access headers when creds are absent', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'm1', sessionId: 'sess_nocf', model: 'claude-opus-4-8', input: 100, output: 50, cacheCreate: 0, cacheRead: 0 }),
    ]);

    // Empty strings override any ambient creds from the test runner's env.
    const { exitCode } = await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_nocf', transcript_path: transcriptPath },
      ['murdock'],
      { ACCESS_CLIENT_ID: '', ACCESS_CLIENT_SECRET: '' }
    );
    await drain();
    expect(exitCode).toBe(0);

    const tu = requestsTo('/api/hooks/token-usage');
    expect(tu).toHaveLength(1);
    expect(tu[0].headers['cf-access-client-id']).toBeUndefined();
  });

  it('skips ALL observer POSTs when ATEAM_PROJECT_ID is unset (no default-project spam)', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'm1', sessionId: 'sess_noproj', model: 'claude-opus-4-8', input: 100, output: 50, cacheCreate: 0, cacheRead: 0 }),
    ]);

    const { exitCode } = await runHook(
      STOP_HOOK,
      { hook_event_name: 'Stop', session_id: 'sess_noproj', transcript_path: transcriptPath },
      ['murdock'],
      { ATEAM_PROJECT_ID: '' }
    );
    await drain();
    expect(exitCode).toBe(0);

    expect(requestsTo('/api/hooks/token-usage')).toHaveLength(0);
    expect(requestsTo('/api/hooks/events')).toHaveLength(0);
  });

  it('subagent-stop token-usage POST also carries CF-Access headers (sibling call site)', async () => {
    const transcriptPath = writeTranscript([
      assistantLine({ id: 'm1', sessionId: 'sess_sub_cf', model: 'claude-sonnet-4-6', input: 100, output: 50, cacheCreate: 0, cacheRead: 0 }),
    ]);

    const { exitCode } = await runHook(
      SUBAGENT_HOOK,
      { hook_event_name: 'SubagentStop', session_id: 'sess_sub_cf', agent_type: 'murdock', agent_transcript_path: transcriptPath },
      [],
      { ACCESS_CLIENT_ID: 'cf-id-123', ACCESS_CLIENT_SECRET: 'cf-secret-456' }
    );
    await drain();
    expect(exitCode).toBe(0);

    const tu = requestsTo('/api/hooks/token-usage');
    expect(tu).toHaveLength(1);
    expect(tu[0].headers['cf-access-client-id']).toBe('cf-id-123');
  });
});
