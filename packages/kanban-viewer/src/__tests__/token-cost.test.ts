/**
 * Smoke tests for calculateTokenCost() utility (WI-278).
 *
 * calculateTokenCost(tokens, model) computes estimated USD cost given
 * token counts and a model name. Uses a pricing config structured as:
 *   {
 *     models: {
 *       "model-name": { input_per_1m, output_per_1m, cache_read_per_1m }
 *     },
 *     fallback: { input_per_1m, output_per_1m, cache_read_per_1m }
 *   }
 *
 * cache_creation tokens are billed at the input rate.
 * cache_read tokens are billed at the discounted cache_read rate.
 *
 * The function lives at: packages/kanban-viewer/src/lib/token-cost.ts
 */

import fs from 'fs';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { calculateTokenCost, _resetPricingCache, loadPricingFromConfig } from '@/lib/token-cost';

beforeEach(() => {
  _resetPricingCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetPricingCache();
});

describe('calculateTokenCost() - known model pricing', () => {
  it('should calculate correct USD cost for claude-sonnet-4-6 with all token types', () => {
    // claude-sonnet-4-6 pricing (per 1M tokens):
    //   input: $3.00, output: $15.00, cache_read: $0.30
    // cache_creation is billed at input rate
    const tokens = {
      inputTokens: 1_000_000,       // $3.00
      outputTokens: 1_000_000,      // $15.00
      cacheCreationTokens: 1_000_000, // $3.00 (input rate)
      cacheReadTokens: 1_000_000,   // $0.30
    };

    const result = calculateTokenCost(tokens, 'claude-sonnet-4-6');

    // Total: $3.00 + $15.00 + $3.00 + $0.30 = $21.30
    expect(result.totalUsd).toBeCloseTo(21.30, 2);
    expect(result.model).toBe('claude-sonnet-4-6');
    expect(result.usedFallback).toBe(false);
  });
});

describe('calculateTokenCost() - fallback pricing', () => {
  it('should use fallback rates and set usedFallback=true for unrecognized model', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tokens = {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };

    const result = calculateTokenCost(tokens, 'unknown-model-xyz');

    // Should not throw; usedFallback signals the caller
    expect(result.usedFallback).toBe(true);
    expect(result.model).toBe('unknown-model-xyz');
    // Should have logged a warning
    expect(consoleSpy).toHaveBeenCalled();
    // Cost should be a non-negative number (fallback rate applied)
    expect(result.totalUsd).toBeGreaterThanOrEqual(0);
  });
});

describe('calculateTokenCost() - edge case: zero tokens', () => {
  it('should return $0.00 when all token counts are zero', () => {
    const tokens = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };

    const result = calculateTokenCost(tokens, 'claude-sonnet-4-6');

    expect(result.totalUsd).toBe(0);
    expect(result.usedFallback).toBe(false);
  });
});

describe('loadPricingFromConfig() - config file present with pricing key', () => {
  it('should load pricing from ateam.config.json and use those rates in calculateTokenCost', () => {
    // Spy on fs.readFileSync to return a config with custom pricing distinct from DEFAULT_PRICING.
    // Custom input rate is $10/1M (vs DEFAULT $3/1M) so we can assert the loaded value was used.
    const customConfig = {
      pricing: {
        models: {
          'claude-sonnet-4-6': {
            input_per_1m: 10.00,
            output_per_1m: 50.00,
            cache_read_per_1m: 1.00,
          },
        },
        fallback: {
          input_per_1m: 5.00,
          output_per_1m: 20.00,
          cache_read_per_1m: 0.50,
        },
      },
    };

    vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: unknown, ...rest: unknown[]) => {
      if (typeof filePath === 'string' && filePath.endsWith('ateam.config.json')) {
        return JSON.stringify(customConfig);
      }
      // Delegate to real fs for anything else
      return (fs.readFileSync as unknown as (...a: unknown[]) => unknown)(filePath, ...rest) as string;
    });

    // loadPricingFromConfig should return the custom config
    const loaded = loadPricingFromConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.models['claude-sonnet-4-6'].input_per_1m).toBe(10.00);

    // calculateTokenCost (without explicit override) should use the loaded custom rates
    const tokens = {
      inputTokens: 1_000_000,  // $10.00 at custom rate (not default $3.00)
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    const result = calculateTokenCost(tokens, 'claude-sonnet-4-6');
    expect(result.totalUsd).toBeCloseTo(10.00, 2);
    expect(result.usedFallback).toBe(false);
  });
});

describe('loadPricingFromConfig() - config file absent', () => {
  it('should return null and fall back to DEFAULT_PRICING when ateam.config.json does not exist', () => {
    // Spy on fs.readFileSync so the ateam.config.json read throws ENOENT
    vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: unknown, ...rest: unknown[]) => {
      if (typeof filePath === 'string' && filePath.endsWith('ateam.config.json')) {
        const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
        throw err;
      }
      return (fs.readFileSync as unknown as (...a: unknown[]) => unknown)(filePath, ...rest) as string;
    });

    // loadPricingFromConfig should return null when the file is absent
    const loaded = loadPricingFromConfig();
    expect(loaded).toBeNull();

    // calculateTokenCost should still work correctly, using DEFAULT_PRICING rates
    const tokens = {
      inputTokens: 1_000_000,  // $3.00 at DEFAULT sonnet rate
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    const result = calculateTokenCost(tokens, 'claude-sonnet-4-6');
    expect(result.totalUsd).toBeCloseTo(3.00, 2);
    expect(result.usedFallback).toBe(false);
  });
});
