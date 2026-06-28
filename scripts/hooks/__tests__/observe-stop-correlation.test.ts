/**
 * Tests for the Stop-event correlationId scheme (FIX 1) and the observer
 * failure log (FIX 3).
 *
 * FIX 1: Stop events must carry a correlationId that is
 *   - STABLE across network retries of the same stop firing (so a retry dedups
 *     to a single row), and
 *   - DISTINCT across different turns (so legitimate per-turn cumulative stops
 *     are NOT collapsed into one row).
 * The scheme is `${session_id}:${lastAssistantMessageId}`, where the last
 * assistant message id is read from the transcript.
 *
 * FIX 3: send failures must be appended to a local JSONL failure log so that
 * dropped token events are observable, without breaking the fire-and-forget
 * contract.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, unlinkSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildObserverPayload,
  readLastAssistantMessageId,
  sendObserverEvent,
  logObserverFailure,
  observerFailureLogPath,
} from '../lib/observer.js';

const tempFiles: string[] = [];

function writeTempTranscript(messages: unknown[]): string {
  const dir = join(tmpdir(), 'ateam-stop-correlation-test');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `t-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(path, messages.map((m) => JSON.stringify(m)).join('\n'), 'utf8');
  tempFiles.push(path);
  return path;
}

/** Build a stop correlationId exactly as observe-stop.js does. */
function buildStopCorrelationId(sessionId: string, transcriptPath: string | undefined): string | undefined {
  const lastId = readLastAssistantMessageId(transcriptPath);
  if (!lastId) return undefined;
  return sessionId ? `${sessionId}:${lastId}` : lastId;
}

afterEach(() => {
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch {}
  }
  tempFiles.length = 0;
  vi.restoreAllMocks();
});

describe('readLastAssistantMessageId', () => {
  it('returns the id of the LAST assistant message', () => {
    const path = writeTempTranscript([
      { type: 'assistant', message: { id: 'msg_first', role: 'assistant', usage: {} } },
      { type: 'user', message: { role: 'user', content: 'x' } },
      { type: 'assistant', message: { id: 'msg_last', role: 'assistant', usage: {} } },
    ]);
    expect(readLastAssistantMessageId(path)).toBe('msg_last');
  });

  it('skips trailing non-assistant lines and blank lines', () => {
    const path = writeTempTranscript([
      { type: 'assistant', message: { id: 'msg_real', role: 'assistant' } },
      { type: 'user', message: { role: 'user', content: 'done' } },
    ]);
    // Append a blank line to simulate trailing newline.
    writeFileSync(path, readFileSync(path, 'utf8') + '\n', 'utf8');
    expect(readLastAssistantMessageId(path)).toBe('msg_real');
  });

  it('returns null for an unreadable transcript', () => {
    expect(readLastAssistantMessageId('/nonexistent/transcript.jsonl')).toBeNull();
  });

  it('returns null when no assistant message id is present', () => {
    const path = writeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'hi' } },
    ]);
    expect(readLastAssistantMessageId(path)).toBeNull();
  });
});

describe('Stop correlationId scheme — retry-stable but turn-distinct', () => {
  it('produces the SAME correlationId across retries of the same turn (same transcript)', () => {
    const path = writeTempTranscript([
      { type: 'assistant', message: { id: 'msg_turn1', role: 'assistant', usage: { input_tokens: 1 } } },
    ]);
    const a = buildStopCorrelationId('sess-1', path);
    const b = buildStopCorrelationId('sess-1', path);
    expect(a).toBe('sess-1:msg_turn1');
    expect(b).toBe(a); // retry → identical id → dedups to one row
  });

  it('produces DISTINCT correlationIds across different turns (different last message id)', () => {
    const turn1 = writeTempTranscript([
      { type: 'assistant', message: { id: 'msg_turn1', role: 'assistant', usage: { input_tokens: 1 } } },
    ]);
    const turn2 = writeTempTranscript([
      { type: 'assistant', message: { id: 'msg_turn1', role: 'assistant', usage: { input_tokens: 1 } } },
      { type: 'assistant', message: { id: 'msg_turn2', role: 'assistant', usage: { input_tokens: 2 } } },
    ]);
    const c1 = buildStopCorrelationId('sess-1', turn1);
    const c2 = buildStopCorrelationId('sess-1', turn2);
    expect(c1).toBe('sess-1:msg_turn1');
    expect(c2).toBe('sess-1:msg_turn2');
    expect(c1).not.toBe(c2); // distinct turns → distinct rows (not collapsed)
  });

  it('falls back to undefined correlationId when no assistant message id is available', () => {
    const path = writeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'nothing here' } },
    ]);
    expect(buildStopCorrelationId('sess-1', path)).toBeUndefined();
  });
});

describe('buildObserverPayload — correlationId override for stop events', () => {
  it('uses the provided correlationId for stop events', () => {
    const payload = buildObserverPayload(
      { hook_event_name: 'Stop', session_id: 'sess-9' },
      'hannibal',
      { correlationId: 'sess-9:msg_abc' }
    );
    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.correlationId).toBe('sess-9:msg_abc');
  });

  it('falls back to a random UUID when no correlationId override is given', () => {
    const p1 = buildObserverPayload({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, 'murdock');
    const p2 = buildObserverPayload({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, 'murdock');
    expect(p1!.correlationId).toBeTruthy();
    expect(p1!.correlationId).not.toBe(p2!.correlationId);
  });
});

describe('FIX 3 — observer failure logging', () => {
  let failureLog: string;

  beforeEach(() => {
    // Point the failure log at an isolated temp dir.
    process.env.CLAUDE_PROJECT_DIR = join(tmpdir(), `ateam-fail-log-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(process.env.CLAUDE_PROJECT_DIR, { recursive: true });
    failureLog = observerFailureLogPath();
  });

  afterEach(() => {
    try { rmSync(process.env.CLAUDE_PROJECT_DIR!, { recursive: true, force: true }); } catch {}
    delete process.env.CLAUDE_PROJECT_DIR;
  });

  it('logObserverFailure appends a structured JSON line', () => {
    logObserverFailure({ url: 'http://x/api', status: 500, error: 'boom', agentName: 'hannibal', eventType: 'stop' });
    expect(existsSync(failureLog)).toBe(true);
    const lines = readFileSync(failureLog, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec).toMatchObject({ url: 'http://x/api', status: 500, error: 'boom', agentName: 'hannibal', eventType: 'stop' });
    expect(typeof rec.timestamp).toBe('string');
  });

  it('sendObserverEvent logs a failure line when the response is not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });
    vi.stubGlobal('fetch', mockFetch);

    const ok = await sendObserverEvent({
      eventType: 'stop',
      agentName: 'hannibal',
      status: 'stopped',
      summary: 'hannibal stopped',
      timestamp: new Date().toISOString(),
      correlationId: 'sess:msg_1',
    });

    expect(ok).toBe(false);
    const rec = JSON.parse(readFileSync(failureLog, 'utf8').trim());
    expect(rec.status).toBe(503);
    expect(rec.agentName).toBe('hannibal');
    expect(rec.eventType).toBe('stop');
  });

  it('sendObserverEvent logs a failure line when fetch throws (network error)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const ok = await sendObserverEvent({
      eventType: 'stop',
      agentName: 'hannibal',
      status: 'stopped',
      summary: 'hannibal stopped',
      timestamp: new Date().toISOString(),
    });

    expect(ok).toBe(false);
    const rec = JSON.parse(readFileSync(failureLog, 'utf8').trim());
    expect(rec.status).toBeNull();
    expect(rec.error).toContain('ECONNREFUSED');
    expect(rec.eventType).toBe('stop');
  });

  it('does not write a failure line on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    vi.stubGlobal('fetch', mockFetch);

    const ok = await sendObserverEvent({
      eventType: 'stop',
      agentName: 'hannibal',
      status: 'stopped',
      summary: 'ok',
      timestamp: new Date().toISOString(),
    });

    expect(ok).toBe(true);
    expect(existsSync(failureLog)).toBe(false);
  });
});
