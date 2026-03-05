/**
 * parse-transcript.js - JSONL transcript parser for token usage extraction.
 *
 * Reads a Claude Code agent transcript (JSONL format) and sums token usage
 * across all assistant messages. Used by observe-subagent.js to attach
 * token metrics to SubagentStop events.
 */

import { readFileSync } from 'fs';

/**
 * Parses a JSONL transcript file and sums token usage across all messages.
 *
 * @param {string} transcriptPath - Absolute path to the .jsonl transcript file
 * @returns {{ inputTokens: number|null, outputTokens: number|null, cacheCreationTokens: number|null, cacheReadTokens: number|null, model: string|null }}
 */
export function parseTranscriptUsage(transcriptPath) {
  let content;
  try {
    content = readFileSync(transcriptPath, 'utf8');
  } catch {
    return { inputTokens: null, outputTokens: null, cacheCreationTokens: null, cacheReadTokens: null, model: null };
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  // If file is empty (no non-blank lines), return zero counts
  if (lines.length === 0) {
    return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, model: null };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let model = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const usage = entry?.message?.usage;
      if (usage) {
        inputTokens += usage.input_tokens || 0;
        outputTokens += usage.output_tokens || 0;
        cacheCreationTokens += usage.cache_creation_input_tokens || 0;
        cacheReadTokens += usage.cache_read_input_tokens || 0;
      }
      if (usage && entry?.message?.model) {
        model = entry.message.model;
      }
    } catch {
      // Skip malformed lines
    }
  }

  // If no valid lines had usage data at all, still return zero counts
  // (file was readable, just no usage data found)
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model };
}
