/**
 * Tests for parseTranscriptUsage() and observe-subagent.js integration.
 *
 * parseTranscriptUsage(filePath) reads a JSONL transcript file and sums
 * token usage across all assistant messages:
 *   - inputTokens: sum of usage.input_tokens
 *   - outputTokens: sum of usage.output_tokens
 *   - cacheCreationTokens: sum of usage.cache_creation_input_tokens
 *   - cacheReadTokens: sum of usage.cache_read_input_tokens
 *   - model: last model value found in a message that ALSO has usage data
 *
 * Returns null values for all fields when the file cannot be read.
 * Skips malformed JSONL lines and sums remaining valid ones.
 *
 * The function lives at: scripts/hooks/lib/parse-transcript.js
 *
 * MODULE FORMAT NOTE: Implementation uses ESM (export function) to match
 * the observer hook ecosystem which uses ESM imports.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('parseTranscriptUsage() - happy path', () => {
  it('should sum token counts across all assistant messages and return last model', () => {
    const path = writeTempTranscript([
      // First assistant turn
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 1000,
            output_tokens: 200,
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 0,
          },
        },
      },
      // Second assistant turn (different model — last one wins)
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
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

    expect(result.inputTokens).toBe(1800);       // 1000 + 800
    expect(result.outputTokens).toBe(350);        // 200 + 150
    expect(result.cacheCreationTokens).toBe(500); // 500 + 0
    expect(result.cacheReadTokens).toBe(300);     // 0 + 300
    expect(result.model).toBe('claude-opus-4-6'); // last model wins
  });
});

describe('parseTranscriptUsage() - missing/unreadable file', () => {
  it('should return null values when file does not exist', () => {
    const result = parseTranscriptUsage('/nonexistent/path/transcript.jsonl');

    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
    expect(result.cacheCreationTokens).toBeNull();
    expect(result.cacheReadTokens).toBeNull();
    expect(result.model).toBeNull();
  });
});

describe('parseTranscriptUsage() - malformed JSONL lines', () => {
  it('should skip bad lines and sum token counts from valid lines', () => {
    const path = writeTempTranscript([
      'not valid json at all {{{',
      // Valid line
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 500,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      '{"incomplete": true',  // Truncated JSON
      // Another valid line
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 300,
            output_tokens: 50,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 200,
          },
        },
      },
    ]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    // Only valid lines are summed — bad lines are skipped
    expect(result.inputTokens).toBe(800);         // 500 + 300
    expect(result.outputTokens).toBe(150);         // 100 + 50
    expect(result.cacheCreationTokens).toBe(100);  // 0 + 100
    expect(result.cacheReadTokens).toBe(200);      // 0 + 200
    expect(result.model).toBe('claude-sonnet-4-6');
  });
});

describe('parseTranscriptUsage() - empty transcript', () => {
  it('should return zero counts and null model for an empty file', () => {
    const path = writeTempTranscript([]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.model).toBeNull();
  });
});

describe('parseTranscriptUsage() - model only from messages with usage data', () => {
  it('should ignore model from a trailing message that has no usage data', () => {
    // Bug scenario: a message with a model but no usage appearing AFTER a message
    // that has both a model and usage should NOT override the model — the "last
    // model wins" logic must only consider entries that also carry usage data.
    const path = writeTempTranscript([
      // First message: has both model and usage — this model should be returned
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 500,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      // Last message: has a model but NO usage — should NOT override the model
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          // No usage field
        },
      },
    ]);
    tempFiles.push(path);

    const result = parseTranscriptUsage(path);

    // Token totals come only from the first message
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(100);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    // Model must come from the message that had usage data, not the trailing one
    expect(result.model).toBe('claude-sonnet-4-6');
  });
});

describe('observe-subagent.js integration - SubagentStop payload construction', () => {
  it('should include token fields in SubagentStop event payload when transcript path is present', () => {
    // The SubagentStop handler reads agent_transcript_path from hook input,
    // calls parseTranscriptUsage(), and includes token fields in the POST payload.
    //
    // We test the payload construction logic by verifying that a SubagentStop
    // payload with token data has the expected shape.

    const transcriptPath = writeTempTranscript([
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 2000,
            output_tokens: 400,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 500,
          },
        },
      },
    ]);
    tempFiles.push(transcriptPath);

    // Parse as observe-subagent.js would
    const tokenUsage = parseTranscriptUsage(transcriptPath);

    // Simulate building the payload for sendObserverEvent
    const payload = {
      eventType: 'subagent_stop',
      agentName: 'murdock',
      status: 'completed',
      summary: 'murdock completed',
      timestamp: new Date().toISOString(),
      // Token fields spread in from transcript parsing
      ...(tokenUsage.inputTokens !== null && { inputTokens: tokenUsage.inputTokens }),
      ...(tokenUsage.outputTokens !== null && { outputTokens: tokenUsage.outputTokens }),
      ...(tokenUsage.cacheCreationTokens !== null && { cacheCreationTokens: tokenUsage.cacheCreationTokens }),
      ...(tokenUsage.cacheReadTokens !== null && { cacheReadTokens: tokenUsage.cacheReadTokens }),
      ...(tokenUsage.model !== null && { model: tokenUsage.model }),
    };

    // Token fields should be present when transcript path is provided
    expect(payload.inputTokens).toBe(2000);
    expect(payload.outputTokens).toBe(400);
    expect(payload.cacheCreationTokens).toBe(1000);
    expect(payload.cacheReadTokens).toBe(500);
    expect(payload.model).toBe('claude-sonnet-4-6');
    expect(payload.eventType).toBe('subagent_stop');
    expect(payload.agentName).toBe('murdock');
  });
});
