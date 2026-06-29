/**
 * Tests for observe-stop.js token integration (per-message attribution).
 *
 * observe-stop.js:
 * 1. Reads transcript_path from hookInput (Stop event stdin)
 * 2. Calls parseTranscriptUsage(transcript_path) from lib/parse-transcript.js
 * 3. Attaches the per-message usage records to the sendObserverEvent payload
 * 4. Always sends the event — token data is best-effort (graceful degradation)
 *
 * parseTranscriptUsage now returns an ARRAY of per-message records
 * ({ messageId, model, inputTokens, outputTokens, cacheCreationTokens,
 * cacheReadTokens }) rather than one collapsed scalar { inputTokens, model }
 * object. This suite asserts the payload carries those per-message records.
 *
 * The updated script uses agentName "hannibal" (stop events always belong to
 * the main session, i.e. Hannibal).
 *
 * We test the payload construction logic directly rather than running the
 * script as a subprocess, following the pattern in observe-hooks.test.ts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildObserverPayload } from '../lib/observer.js';
import { parseTranscriptUsage } from '../lib/parse-transcript.js';

/** Helper to write a minimal JSONL transcript for testing. */
function writeTempTranscript(messages: unknown[]): string {
  const dir = join(tmpdir(), 'ateam-stop-test-transcripts');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `stop-transcript-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(path, messages.map((m) => JSON.stringify(m)).join('\n'), 'utf8');
  return path;
}

/** Build a stop payload as the updated observe-stop.js would. */
function buildStopPayload(hookInput: Record<string, unknown>) {
  // Step 1: build base payload via shared helper (agentName defaults to "hannibal")
  const base = buildObserverPayload(hookInput);
  if (!base) return null;

  // Step 2: parse transcript if path is present
  const transcriptPath = hookInput.transcript_path as string | undefined;
  if (!transcriptPath) return base;

  const messages = parseTranscriptUsage(transcriptPath);

  // Step 3: attach per-message records only when the transcript yielded usage.
  if (messages.length === 0) return base;
  return { ...base, messages };
}

const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch {}
  }
  tempFiles.length = 0;
  vi.restoreAllMocks();
});

describe('observe-stop.js token integration - per-message records', () => {
  it('attaches a per-message record array preserving each message model and deltas', () => {
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

    const payload = buildStopPayload({ hook_event_name: 'Stop', transcript_path: transcriptPath });

    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.agentName).toBe('hannibal');

    // Two separate records — NOT one summed total stamped with the last model.
    expect(payload!.messages).toHaveLength(2);
    expect(payload!.messages[0]).toEqual({
      messageId: 'stop_msg_1',
      model: 'claude-opus-4-6',
      inputTokens: 5000,
      outputTokens: 1200,
      cacheCreationTokens: 2000,
      cacheReadTokens: 8000,
    });
    expect(payload!.messages[1]).toEqual({
      messageId: 'stop_msg_2',
      model: 'claude-sonnet-4-6',
      inputTokens: 3000,
      outputTokens: 800,
      cacheCreationTokens: 0,
      cacheReadTokens: 6000,
    });
  });
});

describe('observe-stop.js token integration - missing transcript_path', () => {
  it('sends the stop event without a messages field when transcript_path is absent', () => {
    const payload = buildStopPayload({ hook_event_name: 'Stop' });

    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.agentName).toBe('hannibal');
    expect(payload).not.toHaveProperty('messages');
  });
});

describe('observe-stop.js token integration - failed transcript parsing', () => {
  it('sends the stop event without a messages field when parsing yields no records', () => {
    const payload = buildStopPayload({
      hook_event_name: 'Stop',
      transcript_path: '/nonexistent/hannibal-transcript.jsonl',
    });

    // Event is still sent (fire-and-forget — never block the agent).
    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.agentName).toBe('hannibal');
    // parseTranscriptUsage returned [] for the unreadable file, so no records attach.
    expect(payload).not.toHaveProperty('messages');
  });
});

describe('observe-stop.js token integration - agentName is always hannibal', () => {
  it('attributes stop events to hannibal and carries the per-message record', () => {
    // Stop events fire in the main session (Hannibal), not in subagent sessions.
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

    const payload = buildStopPayload({ hook_event_name: 'Stop', transcript_path: transcriptPath });

    expect(payload).not.toBeNull();
    expect(payload!.agentName).toBe('hannibal');
    expect(payload!.eventType).toBe('stop');
    expect(payload!.messages).toHaveLength(1);
    expect(payload!.messages[0]).toEqual({
      messageId: 'only_msg',
      model: 'claude-opus-4-6',
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });
});
