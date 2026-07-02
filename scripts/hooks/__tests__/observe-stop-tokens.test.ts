/**
 * Tests for observe-stop.js token integration (per-message attribution).
 *
 * Real contract (see scripts/hooks/observe-stop.js):
 * 1. Reads transcript_path from hookInput (Stop event stdin) and calls
 *    parseTranscriptUsage(transcript_path) from lib/parse-transcript.js.
 * 2. The per-message records are NEVER attached to the legacy stop event sent
 *    to POST /api/hooks/events — that event stays a scalar summary. There is
 *    no `messages` field on it. Instead the records are summed back into
 *    legacy scalar fields (inputTokens, outputTokens, cacheCreationTokens,
 *    cacheReadTokens) plus a `model` chosen by dominantModel(), and merged
 *    onto the base observer payload built by buildObserverPayload().
 * 3. The per-message records themselves are POSTed separately to
 *    POST /api/hooks/token-usage as a bare JSON array. Each record is
 *    enriched with `agentName` (the SAME resolved identity used for the
 *    legacy event — payload.agentName — not the raw CLI arg, since the main
 *    orchestrator session's CLI arg is empty) and a `timestamp`.
 * 4. Token attachment is best-effort: a missing/unreadable transcript still
 *    lets the (fields-free) stop event go out — token data is never allowed
 *    to block the agent.
 *
 * This suite tests those two real payload shapes directly. Wiring of the
 * per-message POST end-to-end is covered by observe-per-message-emit.test.js
 * (owned separately) — this file focuses on the payload-construction contract.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildObserverPayload } from '../lib/observer.js';
import { parseTranscriptUsage, dominantModel } from '../lib/parse-transcript.js';

/** Helper to write a minimal JSONL transcript for testing. */
function writeTempTranscript(messages: unknown[]): string {
  const dir = join(tmpdir(), 'ateam-stop-test-transcripts');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `stop-transcript-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(path, messages.map((m) => JSON.stringify(m)).join('\n'), 'utf8');
  return path;
}

/**
 * Mirrors the legacy /api/hooks/events payload construction in observe-stop.js:
 * per-message records are summed to scalars + a dominant model, merged onto
 * the base payload. No `messages` field is ever attached.
 */
function buildLegacyStopPayload(hookInput: Record<string, unknown>, agentNameArg?: string) {
  const base = buildObserverPayload(hookInput, agentNameArg);
  if (!base) return null;

  const transcriptPath = hookInput.transcript_path as string | undefined;
  if (!transcriptPath) return base;

  const perMessageRecords = parseTranscriptUsage(transcriptPath);
  if (perMessageRecords.length === 0) return base;

  const tokenSum = perMessageRecords.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + r.cacheCreationTokens,
      cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
  );
  const representativeModel = dominantModel(perMessageRecords);

  return {
    ...base,
    ...tokenSum,
    ...(representativeModel && { model: representativeModel }),
  };
}

/**
 * Mirrors the /api/hooks/token-usage POST body construction in observe-stop.js:
 * each per-message record enriched with the RESOLVED agentName (matching the
 * legacy event's payload.agentName) and a timestamp.
 */
function buildTokenUsageRecords(
  perMessageRecords: ReturnType<typeof parseTranscriptUsage>,
  resolvedAgentName: string,
  timestamp: string
) {
  return perMessageRecords.map((r) => ({ ...r, agentName: resolvedAgentName, timestamp }));
}

const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch {}
  }
  tempFiles.length = 0;
});

describe('observe-stop.js legacy /api/hooks/events payload - scalar summary, no messages field', () => {
  it('sums per-message records into legacy scalar token fields and picks the dominant model', () => {
    const transcriptPath = writeTempTranscript([
      {
        type: 'assistant',
        sessionId: 'sess_stop',
        message: {
          id: 'stop_msg_1',
          model: 'claude-opus-4-6',
          usage: { input_tokens: 5000, output_tokens: 1200, cache_creation_input_tokens: 2000, cache_read_input_tokens: 8000 },
        },
      },
      {
        type: 'assistant',
        sessionId: 'sess_stop',
        message: {
          id: 'stop_msg_2',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 3000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 6000 },
        },
      },
    ]);
    tempFiles.push(transcriptPath);

    const payload = buildLegacyStopPayload({ hook_event_name: 'Stop', transcript_path: transcriptPath });

    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.agentName).toBe('hannibal');

    // Scalar sums across both messages.
    expect(payload!.inputTokens).toBe(8000);
    expect(payload!.outputTokens).toBe(2000);
    expect(payload!.cacheCreationTokens).toBe(2000);
    expect(payload!.cacheReadTokens).toBe(14000);
    // Opus drives more total tokens (5000+1200+2000+8000=16200 vs sonnet's 9800) → dominant.
    expect(payload!.model).toBe('claude-opus-4-6');

    // The legacy event never carries the raw per-message array.
    expect(payload).not.toHaveProperty('messages');
  });

  it('sends the stop event without token fields when transcript_path is absent', () => {
    const payload = buildLegacyStopPayload({ hook_event_name: 'Stop' });

    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.agentName).toBe('hannibal');
    expect(payload).not.toHaveProperty('inputTokens');
    expect(payload).not.toHaveProperty('model');
    expect(payload).not.toHaveProperty('messages');
  });

  it('sends the stop event without token fields when parsing yields no records (unreadable transcript)', () => {
    // Event is still sent (fire-and-forget — never block the agent) even though
    // the transcript can't be read.
    const payload = buildLegacyStopPayload({
      hook_event_name: 'Stop',
      transcript_path: '/nonexistent/hannibal-transcript.jsonl',
    });

    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.agentName).toBe('hannibal');
    expect(payload).not.toHaveProperty('inputTokens');
    expect(payload).not.toHaveProperty('messages');
  });

  it('attributes stop events to hannibal by default (main session, no CLI agent arg)', () => {
    const transcriptPath = writeTempTranscript([
      {
        type: 'assistant',
        sessionId: 'sess_stop',
        message: {
          id: 'only_msg',
          model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    tempFiles.push(transcriptPath);

    const payload = buildLegacyStopPayload({ hook_event_name: 'Stop', transcript_path: transcriptPath });

    expect(payload!.agentName).toBe('hannibal');
    expect(payload!.eventType).toBe('stop');
    expect(payload!.inputTokens).toBe(100);
    expect(payload!.outputTokens).toBe(50);
    expect(payload!.model).toBe('claude-opus-4-6');
  });
});

describe('observe-stop.js /api/hooks/token-usage payload - per-message records enriched with resolved agentName', () => {
  it('enriches each parseTranscriptUsage record with agentName and timestamp, preserving per-message model/deltas', () => {
    const transcriptPath = writeTempTranscript([
      {
        type: 'assistant',
        sessionId: 'sess_stop',
        message: {
          id: 'msg_a',
          model: 'claude-opus-4-6',
          usage: { input_tokens: 2000, output_tokens: 400, cache_creation_input_tokens: 1000, cache_read_input_tokens: 500 },
        },
      },
      {
        type: 'assistant',
        sessionId: 'sess_stop',
        message: {
          id: 'msg_b',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 300, output_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 },
        },
      },
    ]);
    tempFiles.push(transcriptPath);

    const perMessageRecords = parseTranscriptUsage(transcriptPath);
    const timestamp = '2026-07-02T00:00:00.000Z';
    const records = buildTokenUsageRecords(perMessageRecords, 'hannibal', timestamp);

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      messageId: 'msg_a',
      model: 'claude-opus-4-6',
      inputTokens: 2000,
      outputTokens: 400,
      cacheCreationTokens: 1000,
      cacheReadTokens: 500,
      agentName: 'hannibal',
      timestamp,
    });
    expect(records[1]).toEqual({
      messageId: 'msg_b',
      model: 'claude-sonnet-4-6',
      inputTokens: 300,
      outputTokens: 60,
      cacheCreationTokens: 0,
      cacheReadTokens: 900,
      agentName: 'hannibal',
      timestamp,
    });
  });

  it('uses the RESOLVED agentName (payload.agentName), not a raw empty CLI arg, for the main session', () => {
    // Regression: for the main orchestrator session, process.argv[2] is empty
    // (it fires the generic hooks.json Stop hook, not a frontmatter hook), so
    // a bare `agentName || 'unknown'` would mislabel Hannibal's tokens as
    // 'unknown'. The resolved identity comes from buildObserverPayload's full
    // resolve chain (CLI arg → resolveAgent(stdin) → session map → 'hannibal').
    const transcriptPath = writeTempTranscript([
      {
        type: 'assistant',
        sessionId: 'sess_stop',
        message: {
          id: 'msg_main',
          model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    tempFiles.push(transcriptPath);

    const base = buildObserverPayload({ hook_event_name: 'Stop', transcript_path: transcriptPath }, undefined);
    const perMessageRecords = parseTranscriptUsage(transcriptPath);
    const records = buildTokenUsageRecords(perMessageRecords, base!.agentName, '2026-07-02T00:00:00.000Z');

    expect(base!.agentName).toBe('hannibal');
    expect(records[0].agentName).toBe('hannibal');
    expect(records[0].agentName).not.toBe('unknown');
  });

  it('produces no records when the transcript yields no usage', () => {
    const transcriptPath = writeTempTranscript([
      { type: 'assistant', sessionId: 'sess_stop', message: { id: 'no_usage', model: 'claude-opus-4-6' } },
    ]);
    tempFiles.push(transcriptPath);

    const perMessageRecords = parseTranscriptUsage(transcriptPath);
    expect(perMessageRecords).toEqual([]);

    const records = buildTokenUsageRecords(perMessageRecords, 'hannibal', '2026-07-02T00:00:00.000Z');
    expect(records).toEqual([]);
  });

  it('matches the TokenUsageRecord shape required by the /api/hooks/token-usage route (messageId, agentName, model required; token fields numeric)', () => {
    const transcriptPath = writeTempTranscript([
      {
        type: 'assistant',
        sessionId: 'sess_stop',
        message: {
          id: 'msg_shape',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    tempFiles.push(transcriptPath);

    const perMessageRecords = parseTranscriptUsage(transcriptPath);
    const [record] = buildTokenUsageRecords(perMessageRecords, 'murdock', '2026-07-02T00:00:00.000Z');

    expect(typeof record.messageId).toBe('string');
    expect(record.messageId.length).toBeGreaterThan(0);
    expect(typeof record.agentName).toBe('string');
    expect(record.agentName.length).toBeGreaterThan(0);
    expect(typeof record.model).toBe('string');
    expect(record.model.length).toBeGreaterThan(0);
    for (const field of ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens'] as const) {
      expect(typeof record[field]).toBe('number');
      expect(Number.isFinite(record[field])).toBe(true);
      expect(record[field]).toBeGreaterThanOrEqual(0);
    }
  });
});
