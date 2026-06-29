/**
 * parse-transcript.js - JSONL transcript parser for token usage extraction.
 *
 * Reads a Claude Code agent transcript (JSONL format) and sums token usage
 * across all assistant messages. Used by observe-subagent.js to attach
 * token metrics to SubagentStop events.
 */

import { readFileSync } from 'fs';

/**
 * Parses a JSONL transcript file and returns one usage record per distinct assistant message.
 *
 * Claude Code streams the same assistant message 2-3 times; dedup by message.id (last-write-wins)
 * prevents over-counting. Id-less messages each emit their own record under a synthetic key
 * scoped by sessionId so records from different sessions never collide.
 *
 * @param {string} transcriptPath - Absolute path to the .jsonl transcript file
 * @returns {Array<{ messageId: string, model: string|null, inputTokens: number, outputTokens: number, cacheCreationTokens: number, cacheReadTokens: number }>}
 */
export function parseTranscriptUsage(transcriptPath) {
  let content;
  try {
    content = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  // Map from dedup key -> per-message record. Named messages dedup by id (last-write-wins).
  // Id-less messages get a unique synthetic key per session so they are never collapsed.
  const usageByKey = new Map();
  // Per-session counters for synthetic keys on id-less messages.
  const sessionCounters = new Map();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const usage = entry?.message?.usage;
      if (!usage) continue;

      const id = entry?.message?.id;
      const model = entry?.message?.model ?? null;
      const sessionId = entry?.sessionId ?? 'unknown';

      let key;
      let messageId;

      if (id != null) {
        key = `id:${id}`;
        messageId = id;
      } else {
        const n = sessionCounters.get(sessionId) ?? 0;
        sessionCounters.set(sessionId, n + 1);
        messageId = `${sessionId}:idx:${n}`;
        key = messageId;
      }

      usageByKey.set(key, {
        messageId,
        model,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      });
    } catch {
      // Skip malformed lines
    }
  }

  return Array.from(usageByKey.values());
}

/**
 * Scans a transcript for ateam agents-stop calls and detects --advance=false usage.
 *
 * When an agent calls agentStop with --advance=false, they are releasing their
 * claim without advancing the stage (e.g., because the next stage is at WIP capacity).
 * Capturing this is useful for observability into pipeline flow and WIP pressure.
 *
 * @param {string} transcriptPath - Absolute path to the .jsonl transcript file
 * @returns {{ advanceFlagUsed: boolean|null }} - false if --advance=false detected, null if not found or unreadable
 */
export function parseAdvanceFlagUsage(transcriptPath) {
  let content;
  try {
    content = readFileSync(transcriptPath, 'utf8');
  } catch {
    return { advanceFlagUsed: null };
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const contentBlocks = entry?.message?.content;
      if (!Array.isArray(contentBlocks)) continue;
      for (const block of contentBlocks) {
        if (block?.type === 'tool_use' && block?.name === 'Bash') {
          const command = block?.input?.command || '';
          if (command.includes('ateam agents-stop') && command.includes('--advance=false')) {
            return { advanceFlagUsed: false };
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { advanceFlagUsed: null };
}

/**
 * Scans a transcript for ateam agents-stop calls and extracts the --itemId value.
 *
 * Used by observe-stop.js to emit a handoff-stop event with the itemId of the
 * work item the agent just finished. This enables measuring true handoff latency
 * (delta between handoff-stop and the next agent's first handoff-start on the same itemId).
 *
 * @param {string} transcriptPath - Absolute path to the .jsonl transcript file
 * @returns {{ itemId: string|null }}
 */
export function parseAgentStopItemId(transcriptPath) {
  let content;
  try {
    content = readFileSync(transcriptPath, 'utf8');
  } catch {
    return { itemId: null };
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const contentBlocks = entry?.message?.content;
      if (!Array.isArray(contentBlocks)) continue;
      for (const block of contentBlocks) {
        if (block?.type === 'tool_use' && block?.name === 'Bash') {
          const command = block?.input?.command || '';
          if (command.includes('agents-stop') && command.includes('--itemId')) {
            const match = command.match(/--itemId\s+["']?([^\s"']+)["']?/);
            if (match) return { itemId: match[1] };
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { itemId: null };
}
