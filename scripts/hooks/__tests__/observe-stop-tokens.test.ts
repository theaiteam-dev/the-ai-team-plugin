/**
 * Tests for observe-stop.js token integration (WI-275).
 *
 * observe-stop.js is extended to:
 * 1. Read transcript_path from hookInput (Stop event stdin)
 * 2. Call parseTranscriptUsage(transcript_path) from lib/parse-transcript.js
 * 3. Merge token fields into the sendObserverEvent payload
 * 4. Always send the event — token data is best-effort (graceful degradation)
 *
 * The updated script uses agentName "hannibal" (stop events always belong
 * to the main session, i.e. Hannibal).
 *
 * We test the payload construction logic directly rather than running the
 * script as a subprocess, following the pattern in observe-hooks.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  const tokenUsage = parseTranscriptUsage(transcriptPath);

  // Step 3: merge token fields (only when non-null)
  return {
    ...base,
    ...(tokenUsage.inputTokens !== null && { inputTokens: tokenUsage.inputTokens }),
    ...(tokenUsage.outputTokens !== null && { outputTokens: tokenUsage.outputTokens }),
    ...(tokenUsage.cacheCreationTokens !== null && { cacheCreationTokens: tokenUsage.cacheCreationTokens }),
    ...(tokenUsage.cacheReadTokens !== null && { cacheReadTokens: tokenUsage.cacheReadTokens }),
    ...(tokenUsage.model !== null && { model: tokenUsage.model }),
  };
}

const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch {}
  }
  tempFiles.length = 0;
  vi.restoreAllMocks();
});

describe('observe-stop.js token integration - happy path', () => {
  it('should include token fields in stop payload when transcript_path is present', () => {
    const transcriptPath = writeTempTranscript([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 5000,
            output_tokens: 1200,
            cache_creation_input_tokens: 2000,
            cache_read_input_tokens: 8000,
          },
        },
      },
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 3000,
            output_tokens: 800,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 6000,
          },
        },
      },
    ]);
    tempFiles.push(transcriptPath);

    const hookInput = {
      hook_event_name: 'Stop',
      transcript_path: transcriptPath,
    };

    const payload = buildStopPayload(hookInput);

    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.agentName).toBe('hannibal');
    // Token sums across both turns
    expect(payload!.inputTokens).toBe(8000);          // 5000 + 3000
    expect(payload!.outputTokens).toBe(2000);         // 1200 + 800
    expect(payload!.cacheCreationTokens).toBe(2000);  // 2000 + 0
    expect(payload!.cacheReadTokens).toBe(14000);     // 8000 + 6000
    expect(payload!.model).toBe('claude-opus-4-6');
  });
});

describe('observe-stop.js token integration - missing transcript_path', () => {
  it('should send stop event without token fields when transcript_path is absent', () => {
    const hookInput = {
      hook_event_name: 'Stop',
      // No transcript_path
    };

    const payload = buildStopPayload(hookInput);

    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.agentName).toBe('hannibal');
    // Token fields must be absent (not null, not undefined-keyed)
    expect(payload).not.toHaveProperty('inputTokens');
    expect(payload).not.toHaveProperty('outputTokens');
    expect(payload).not.toHaveProperty('cacheCreationTokens');
    expect(payload).not.toHaveProperty('cacheReadTokens');
    expect(payload).not.toHaveProperty('model');
  });
});

describe('observe-stop.js token integration - failed transcript parsing', () => {
  it('should send stop event without token fields when parseTranscriptUsage returns nulls', () => {
    const hookInput = {
      hook_event_name: 'Stop',
      transcript_path: '/nonexistent/hannibal-transcript.jsonl', // File does not exist
    };

    const payload = buildStopPayload(hookInput);

    // Event is still sent (fire-and-forget — never block the agent)
    expect(payload).not.toBeNull();
    expect(payload!.eventType).toBe('stop');
    expect(payload!.agentName).toBe('hannibal');
    // Token fields are absent because parsing returned nulls
    expect(payload).not.toHaveProperty('inputTokens');
    expect(payload).not.toHaveProperty('outputTokens');
    expect(payload).not.toHaveProperty('cacheCreationTokens');
    expect(payload).not.toHaveProperty('cacheReadTokens');
    expect(payload).not.toHaveProperty('model');
  });
});

describe('observe-stop.js token integration - agentName is always hannibal', () => {
  it('should always attribute stop events to hannibal regardless of other hook input', () => {
    // Stop events fire in the main session (Hannibal), not in subagent sessions.
    // Even if agent_type or other fields are present, stop belongs to hannibal.
    const transcriptPath = writeTempTranscript([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    tempFiles.push(transcriptPath);

    const hookInput = {
      hook_event_name: 'Stop',
      transcript_path: transcriptPath,
      // No CLI arg agent override — stop always belongs to hannibal
    };

    const payload = buildStopPayload(hookInput);

    expect(payload).not.toBeNull();
    expect(payload!.agentName).toBe('hannibal');
    expect(payload!.eventType).toBe('stop');
    // Token data present because transcript is valid
    expect(payload!.inputTokens).toBe(100);
    expect(payload!.outputTokens).toBe(50);
    expect(payload!.model).toBe('claude-opus-4-6');
  });
});
