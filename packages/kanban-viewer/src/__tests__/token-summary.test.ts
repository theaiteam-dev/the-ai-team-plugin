/**
 * Tests for formatTokenSummary() utility (WI-287).
 *
 * formatTokenSummary(agents) takes an array of AgentTokenUsage objects and
 * returns a one-line commit summary string showing token counts grouped by
 * model tier (Opus/Sonnet/Haiku).
 *
 * Expected format:
 *   "Tokens: 1.2M input, 45.0K output (Opus: 820.0K/32.0K, Sonnet: 350.0K/12.0K, Haiku: 30.0K/1.0K)"
 *
 * Rules:
 *   - Numbers formatted with K (thousands, one decimal) or M (millions, one decimal) suffixes
 *   - Per-model format: "Tier: inputK/outputK" (input/output)
 *   - Model tiers with zero tokens are omitted
 *   - Returns empty string when passed empty array
 *   - No cost or dollar amounts in output
 *
 * Implementation lives at: packages/kanban-viewer/src/lib/token-summary.ts
 */

import { describe, it, expect } from 'vitest';
import { formatTokenSummary } from '@/lib/token-summary';

/** Minimal AgentTokenUsage shape the formatter consumes. */
interface AgentTokenUsage {
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

describe('formatTokenSummary()', () => {
  describe('full format with multiple model tiers', () => {
    it('should produce correctly formatted summary with Opus, Sonnet, and Haiku tiers', () => {
      const agents: AgentTokenUsage[] = [
        // Opus agents: hannibal + face
        {
          agentName: 'hannibal',
          model: 'claude-opus-4-6',
          inputTokens: 500_000,
          outputTokens: 20_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 7.5,
        },
        {
          agentName: 'face',
          model: 'claude-opus-4-6',
          inputTokens: 320_000,
          outputTokens: 12_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 4.8,
        },
        // Sonnet agent: murdock
        {
          agentName: 'murdock',
          model: 'claude-sonnet-4-6',
          inputTokens: 350_000,
          outputTokens: 12_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 1.05,
        },
        // Haiku agent: tawnia
        {
          agentName: 'tawnia',
          model: 'claude-haiku-4-5-20251001',
          inputTokens: 30_000,
          outputTokens: 1_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 0.024,
        },
      ];

      const result = formatTokenSummary(agents);

      // Totals: input = 1_200_000, output = 45_000
      expect(result).toContain('Tokens:');
      expect(result).toContain('1.2M input');
      expect(result).toContain('45.0K output');

      // Per-model tier breakdown: Opus input=820K, output=32K
      expect(result).toContain('Opus: 820.0K/32.0K');
      // Sonnet input=350K, output=12K
      expect(result).toContain('Sonnet: 350.0K/12.0K');
      // Haiku input=30K, output=1K
      expect(result).toContain('Haiku: 30.0K/1.0K');

      // No dollar amounts
      expect(result).not.toMatch(/\$/);
      expect(result).not.toMatch(/usd/i);
      expect(result).not.toMatch(/cost/i);
    });
  });

  describe('empty data', () => {
    it('should return empty string when passed an empty array', () => {
      const result = formatTokenSummary([]);
      expect(result).toBe('');
    });
  });

  describe('single model tier', () => {
    it('should include only Sonnet in the per-tier breakdown when only sonnet agents are present', () => {
      const agents: AgentTokenUsage[] = [
        {
          agentName: 'murdock',
          model: 'claude-sonnet-4-6',
          inputTokens: 200_000,
          outputTokens: 8_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 0.6,
        },
        {
          agentName: 'ba',
          model: 'claude-sonnet-4-6',
          inputTokens: 150_000,
          outputTokens: 5_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 0.45,
        },
      ];

      const result = formatTokenSummary(agents);

      expect(result).toContain('Sonnet:');
      expect(result).not.toContain('Opus:');
      expect(result).not.toContain('Haiku:');
    });
  });

  describe('zero-token model tier omitted', () => {
    it('should skip a model tier when all its agents have zero input and output tokens', () => {
      const agents: AgentTokenUsage[] = [
        // Opus with real tokens
        {
          agentName: 'hannibal',
          model: 'claude-opus-4-6',
          inputTokens: 100_000,
          outputTokens: 5_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 1.5,
        },
        // Sonnet with zero tokens (should be omitted)
        {
          agentName: 'murdock',
          model: 'claude-sonnet-4-6',
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          estimatedCostUsd: 0,
        },
      ];

      const result = formatTokenSummary(agents);

      expect(result).toContain('Opus:');
      expect(result).not.toContain('Sonnet:');
    });
  });
});
