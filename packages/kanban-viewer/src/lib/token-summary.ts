/**
 * token-summary.ts - Format token usage into a one-line commit summary string.
 *
 * Produces a compact human-readable summary of token usage grouped by model
 * tier (Opus/Sonnet/Haiku), suitable for inclusion in commit messages or
 * CHANGELOG entries.
 *
 * Example output:
 *   "Tokens: 1.2M input, 45.0K output (Opus: 820.0K/32.0K, Sonnet: 350.0K/12.0K, Haiku: 30.0K/1.0K)"
 */

import { formatTokenCount } from "@/lib/format-tokens";

/** Minimal token usage record consumed by the formatter. */
export interface AgentTokenUsage {
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

/** Recognised model tiers, ordered highest-to-lowest cost. */
const MODEL_TIERS = ['Opus', 'Sonnet', 'Haiku'] as const;
type ModelTier = (typeof MODEL_TIERS)[number];

/** Maps a model name to its display tier, or null for unrecognised models. */
function classifyModel(model: string): ModelTier | null {
  if (model.startsWith('claude-opus-')) return 'Opus';
  if (model.startsWith('claude-sonnet-')) return 'Sonnet';
  if (model.startsWith('claude-haiku-')) return 'Haiku';
  return null;
}

/**
 * Format an array of AgentTokenUsage records into a one-line token summary.
 *
 * Returns an empty string when the array is empty.
 * Token counts are grouped by model tier; tiers with zero tokens are omitted.
 *
 * @param agents - Array of per-agent token usage records
 * @returns Formatted summary string, e.g.
 *   "Tokens: 1.2M input, 45.0K output (Opus: 820.0K/32.0K, Sonnet: 350.0K/12.0K)"
 */
export function formatTokenSummary(agents: AgentTokenUsage[]): string {
  if (agents.length === 0) return '';

  // Accumulate totals and per-tier sums in a single pass.
  let totalInput = 0;
  let totalOutput = 0;

  const tierInput: Record<ModelTier, number> = { Opus: 0, Sonnet: 0, Haiku: 0 };
  const tierOutput: Record<ModelTier, number> = { Opus: 0, Sonnet: 0, Haiku: 0 };

  for (const agent of agents) {
    totalInput += agent.inputTokens;
    totalOutput += agent.outputTokens;

    const tier = classifyModel(agent.model);
    if (tier !== null) {
      tierInput[tier] += agent.inputTokens;
      tierOutput[tier] += agent.outputTokens;
    }
  }

  // Build per-tier breakdown, respecting Opus → Sonnet → Haiku order.
  const tierParts: string[] = [];
  for (const tier of MODEL_TIERS) {
    const input = tierInput[tier];
    const output = tierOutput[tier];
    if (input === 0 && output === 0) continue;
    tierParts.push(`${tier}: ${formatTokenCount(input)}/${formatTokenCount(output)}`);
  }

  const totalPart = `Tokens: ${formatTokenCount(totalInput)} input, ${formatTokenCount(totalOutput)} output`;

  if (tierParts.length === 0) {
    return totalPart;
  }

  return `${totalPart} (${tierParts.join(', ')})`;
}
