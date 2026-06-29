/**
 * Tests for parseTranscriptUsage() — per-message token attribution.
 *
 * parseTranscriptUsage(filePath) reads a JSONL transcript file and returns an
 * ARRAY of per-message usage records. Each element corresponds to one distinct
 * assistant message and carries that message's OWN model and token deltas:
 *
 *   { messageId, model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens }
 *
 * Key contract (replaces the old lossy "sum-all + last-model" scalar object):
 *   - One record per distinct assistant message — tokens are NOT summed across
 *     messages and models are NOT collapsed to "the last one".
 *   - Repeated emissions of the same message.id (Claude Code streams a message
 *     2-3 times) collapse to a single record keyed by messageId, using the
 *     message's FINAL usage (last-write-wins, no over-count).
 *   - A message whose usage block has no message.id is still emitted as its own
 *     record under a synthetic key `${sessionId}:idx:${n}` so no usage is dropped
 *     and id-less messages from different sessions cannot collide.
 *   - No usage data / unreadable / missing file => empty array (never throws).
 *
 * The function lives at: scripts/hooks/lib/parse-transcript.js
 *
 * MODULE FORMAT NOTE: Implementation uses ESM (export function) to match the
 * observer hook ecosystem which uses ESM imports.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseTranscriptUsage } from '../lib/parse-transcript.js';

/** Helper to write a temporary JSONL transcript file for testing. */
function writeTempTranscript(lines: unknown[]): string {
  const dir = join(tmpdir(), 'ateam-test-transcripts');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `transcript-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const content = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
  writeFileSync(path, content, 'utf8');
  return path;
}

const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch {}
  }
  tempFiles.length = 0;
});

describe('parseTranscriptUsage() - per-message records preserve each message model', () => {
  it('returns one record per distinct message, each carrying its own model and deltas (NOT summed)', () => {
    const path = writeTempTranscript([
      // First assistant turn — opus
      {
        type: 'assistant',
        sessionId: 'sess_1',
        message: {
          id: 'msg_opus',
          model: 'claude-opus-4-6',
          usage: {
            input_tokens: 1000,
            output_tokens: 200,
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 0,
          },
        },
      },
      // Second assistant turn — sonnet (DIFFERENT model)
      {
        type: 'assistant',
        sessionId: 'sess_1',
        message: {
          id: 'msg_sonnet',
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 800,
            output_tokens: 150,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 300,
          },
        },
      },
    ]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);

    // Records preserve first-seen order; each keeps its own model — not collapsed.
    expect(result[0]).toEqual({
      messageId: 'msg_opus',
      model: 'claude-opus-4-6',
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 500,
      cacheReadTokens: 0,
    });
    expect(result[1]).toEqual({
      messageId: 'msg_sonnet',
      model: 'claude-sonnet-4-6',
      inputTokens: 800,
      outputTokens: 150,
      cacheCreationTokens: 0,
      cacheReadTokens: 300,
    });
  });
});

describe('parseTranscriptUsage() - duplicate message emissions collapse by messageId', () => {
  it('collapses repeated emissions of the same id to one record using FINAL usage (last-write-wins)', () => {
    // Claude Code writes the same assistant message several times as it streams
    // then finalizes. Early emissions can carry partial usage; the final emission
    // carries the message's authoritative totals. The record must reflect the
    // FINAL emission — neither the first, nor the sum of emissions.
    const partialA = {
      type: 'assistant',
      sessionId: 'sess_1',
      message: {
        id: 'msg_A',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 400, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    const finalA = {
      type: 'assistant',
      sessionId: 'sess_1',
      message: {
        id: 'msg_A',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 100 },
      },
    };
    const finalB = {
      type: 'assistant',
      sessionId: 'sess_1',
      message: {
        id: 'msg_B',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 50, output_tokens: 300, cache_creation_input_tokens: 2000, cache_read_input_tokens: 6000 },
      },
    };
    // msg_A emitted 3x (partial, partial, final), msg_B emitted 2x (final, final).
    const path = writeTempTranscript([partialA, partialA, finalA, finalB, finalB]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    expect(result).toHaveLength(2);

    const recA = result.find((r) => r.messageId === 'msg_A');
    const recB = result.find((r) => r.messageId === 'msg_B');

    // msg_A reflects the FINAL emission's usage, not the partial and not the sum.
    expect(recA).toEqual({
      messageId: 'msg_A',
      model: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 5000,
      cacheReadTokens: 100,
    });
    expect(recB).toEqual({
      messageId: 'msg_B',
      model: 'claude-sonnet-4-6',
      inputTokens: 50,
      outputTokens: 300,
      cacheCreationTokens: 2000,
      cacheReadTokens: 6000,
    });
  });
});

describe('parseTranscriptUsage() - id-less messages emitted under synthetic keys', () => {
  it('emits each id-less usage-bearing message as its own record (no usage dropped)', () => {
    // Older/malformed transcripts may omit message.id. Those cannot be deduped,
    // so each usage-bearing line must still surface as its own record — never
    // dropped and never merged into another message's totals.
    const noIdA = {
      type: 'assistant',
      sessionId: 'sess_X',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    const noIdB = {
      type: 'assistant',
      sessionId: 'sess_X',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 70, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    const path = writeTempTranscript([noIdA, noIdB]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    // Two distinct records — neither dropped, neither merged.
    expect(result).toHaveLength(2);

    // Each carries its own deltas.
    expect(result[0].inputTokens).toBe(100);
    expect(result[0].outputTokens).toBe(10);
    expect(result[1].inputTokens).toBe(70);
    expect(result[1].outputTokens).toBe(5);

    // Synthetic keys are session-scoped (`${sessionId}:idx:${n}`), not bare indices.
    expect(result[0].messageId).toMatch(/^sess_X:idx:\d+$/);
    expect(result[1].messageId).toMatch(/^sess_X:idx:\d+$/);
    // And distinct from each other within the session.
    expect(result[0].messageId).not.toBe(result[1].messageId);
  });

  it('scopes synthetic keys by sessionId so id-less messages from different sessions cannot collide', () => {
    // Two id-less messages that would share a bare index — but they belong to
    // different sessions. Session-scoped keys must keep them distinct.
    const session1 = {
      type: 'assistant',
      sessionId: 'sess_1',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    const session2 = {
      type: 'assistant',
      sessionId: 'sess_2',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    const path = writeTempTranscript([session1, session2]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.messageId);
    expect(ids[0]).toMatch(/^sess_1:idx:\d+$/);
    expect(ids[1]).toMatch(/^sess_2:idx:\d+$/);
    // Cross-session keys never collide.
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('keeps id-bearing and id-less messages as separate records in one transcript', () => {
    const withId = {
      type: 'assistant',
      sessionId: 'sess_1',
      message: {
        id: 'msg_real',
        model: 'claude-opus-4-6',
        usage: { input_tokens: 900, output_tokens: 90, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    const withoutId = {
      type: 'assistant',
      sessionId: 'sess_1',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    const path = writeTempTranscript([withId, withoutId]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.messageId === 'msg_real')).toEqual({
      messageId: 'msg_real',
      model: 'claude-opus-4-6',
      inputTokens: 900,
      outputTokens: 90,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    const synthetic = result.find((r) => r.messageId !== 'msg_real');
    expect(synthetic!.messageId).toMatch(/^sess_1:idx:\d+$/);
    expect(synthetic!.inputTokens).toBe(100);
  });
});

describe('parseTranscriptUsage() - missing/unreadable file', () => {
  it('returns an empty array when the file does not exist (never throws)', () => {
    const result = parseTranscriptUsage('/nonexistent/path/transcript.jsonl');
    expect(result).toEqual([]);
  });
});

describe('parseTranscriptUsage() - no usage data', () => {
  it('returns an empty array for an empty file', () => {
    const path = writeTempTranscript([]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);
    expect(result).toEqual([]);
  });

  it('returns an empty array when no message carries a usage block', () => {
    // Messages with a model but no usage produce no records — only usage-bearing
    // assistant messages become records.
    const path = writeTempTranscript([
      { type: 'assistant', sessionId: 'sess_1', message: { id: 'm1', model: 'claude-opus-4-6' } },
      { type: 'user', sessionId: 'sess_1', message: { content: 'hello' } },
    ]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);
    expect(result).toEqual([]);
  });

  it('does not emit a record for a trailing message that has a model but no usage', () => {
    const path = writeTempTranscript([
      {
        type: 'assistant',
        sessionId: 'sess_1',
        message: {
          id: 'm_with_usage',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
      // Trailing message: model but NO usage — must NOT produce a record and must
      // NOT alter the prior record's model.
      { type: 'assistant', sessionId: 'sess_1', message: { id: 'm_no_usage', model: 'claude-opus-4-6' } },
    ]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      messageId: 'm_with_usage',
      model: 'claude-sonnet-4-6',
      inputTokens: 500,
      outputTokens: 100,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });
});

describe('parseTranscriptUsage() - malformed JSONL lines', () => {
  it('skips unparseable lines and emits records from valid usage-bearing messages', () => {
    const path = writeTempTranscript([
      'not valid json at all {{{',
      {
        type: 'assistant',
        sessionId: 'sess_1',
        message: {
          id: 'good_1',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
      '{"incomplete": true',
      {
        type: 'assistant',
        sessionId: 'sess_1',
        message: {
          id: 'good_2',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 300, output_tokens: 50, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 },
        },
      },
    ]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.messageId === 'good_1')).toEqual({
      messageId: 'good_1',
      model: 'claude-sonnet-4-6',
      inputTokens: 500,
      outputTokens: 100,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    expect(result.find((r) => r.messageId === 'good_2')).toEqual({
      messageId: 'good_2',
      model: 'claude-sonnet-4-6',
      inputTokens: 300,
      outputTokens: 50,
      cacheCreationTokens: 100,
      cacheReadTokens: 200,
    });
  });
});

describe('parseTranscriptUsage() - missing usage subfields default to zero', () => {
  it('treats absent token subfields as 0 within a record', () => {
    const path = writeTempTranscript([
      {
        type: 'assistant',
        sessionId: 'sess_1',
        message: {
          id: 'sparse',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 123 }, // other subfields absent
        },
      },
    ]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      messageId: 'sparse',
      model: 'claude-sonnet-4-6',
      inputTokens: 123,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });
});

describe('observe-subagent.js integration - SubagentStop payload carries per-message records', () => {
  it('attaches the per-message usage array to the SubagentStop payload', () => {
    // The SubagentStop handler reads agent_transcript_path from hook input, calls
    // parseTranscriptUsage(), and attaches the per-message records so downstream
    // attribution can persist tokens per message (and per model) rather than one
    // collapsed total. We verify the array of records flows into the payload.
    const transcriptPath = writeTempTranscript([
      {
        type: 'assistant',
        sessionId: 'sess_sub',
        message: {
          id: 'sub_msg_1',
          model: 'claude-opus-4-6',
          usage: { input_tokens: 2000, output_tokens: 400, cache_creation_input_tokens: 1000, cache_read_input_tokens: 500 },
        },
      },
      {
        type: 'assistant',
        sessionId: 'sess_sub',
        message: {
          id: 'sub_msg_2',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 300, output_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 },
        },
      },
    ]);
    tempFiles.push(transcriptPath);

    const messages = parseTranscriptUsage(transcriptPath);

    const payload = {
      eventType: 'subagent_stop',
      agentName: 'murdock',
      status: 'completed',
      summary: 'murdock completed',
      timestamp: new Date().toISOString(),
      ...(messages.length > 0 && { messages }),
    };

    expect(payload.eventType).toBe('subagent_stop');
    expect(payload.agentName).toBe('murdock');
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages![0]).toEqual({
      messageId: 'sub_msg_1',
      model: 'claude-opus-4-6',
      inputTokens: 2000,
      outputTokens: 400,
      cacheCreationTokens: 1000,
      cacheReadTokens: 500,
    });
    expect(payload.messages![1].model).toBe('claude-sonnet-4-6');
    expect(payload.messages![1].cacheReadTokens).toBe(900);
  });

  it('omits the messages field when the transcript yields no usage', () => {
    const transcriptPath = writeTempTranscript([
      { type: 'assistant', sessionId: 'sess_sub', message: { id: 'no_usage', model: 'claude-opus-4-6' } },
    ]);
    tempFiles.push(transcriptPath);

    const messages = parseTranscriptUsage(transcriptPath);

    const payload = {
      eventType: 'subagent_stop',
      agentName: 'murdock',
      ...(messages.length > 0 && { messages }),
    };

    expect(messages).toEqual([]);
    expect(payload).not.toHaveProperty('messages');
  });
});
