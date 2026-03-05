/**
 * token-cost.ts - Token usage cost calculator.
 *
 * Calculates estimated USD cost from token counts and model name.
 * Loads pricing from ateam.config.json at the project root (process.cwd()) at
 * runtime; falls back to DEFAULT_PRICING if the file is absent or has no
 * "pricing" key.  The loaded config is cached at the module level so the file
 * is only read once per process lifetime.
 */

import fs from 'fs';
import path from 'path';

interface ModelPricing {
  input_per_1m: number;
  output_per_1m: number;
  cache_read_per_1m: number;
}

interface PricingConfig {
  models: Record<string, ModelPricing>;
  fallback: ModelPricing;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface TokenCostResult {
  totalUsd: number;
  model: string;
  usedFallback: boolean;
}

/** Built-in pricing config (USD per 1M tokens). */
const DEFAULT_PRICING: PricingConfig = {
  models: {
    'claude-opus-4-6': {
      input_per_1m: 15.00,
      output_per_1m: 75.00,
      cache_read_per_1m: 1.50,
    },
    'claude-sonnet-4-6': {
      input_per_1m: 3.00,
      output_per_1m: 15.00,
      cache_read_per_1m: 0.30,
    },
    'claude-haiku-4-5-20251001': {
      input_per_1m: 0.80,
      output_per_1m: 4.00,
      cache_read_per_1m: 0.08,
    },
  },
  fallback: {
    input_per_1m: 3.00,
    output_per_1m: 15.00,
    cache_read_per_1m: 0.30,
  },
};

function isModelPricing(value: unknown): value is ModelPricing {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.input_per_1m === 'number' &&
    typeof v.output_per_1m === 'number' &&
    typeof v.cache_read_per_1m === 'number'
  );
}

function isPricingConfig(value: unknown): value is PricingConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!v.models || typeof v.models !== 'object' || !isModelPricing(v.fallback)) return false;
  return Object.values(v.models as Record<string, unknown>).every(isModelPricing);
}

/**
 * Module-level cache for the pricing config loaded from ateam.config.json.
 * null  = not yet attempted
 * false = attempted but file was absent or had no valid "pricing" key
 * PricingConfig = successfully loaded
 */
let _cachedPricing: PricingConfig | null | false = null;

/**
 * Reads pricing from <project-root>/ateam.config.json synchronously.
 * Returns the PricingConfig on success, or null if unavailable.
 * Result is cached so the file is read at most once per process.
 */
export function loadPricingFromConfig(): PricingConfig | null {
  if (_cachedPricing !== null) {
    return _cachedPricing || null;
  }

  try {
    const configPath = path.join(process.cwd(), 'ateam.config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (isPricingConfig(parsed.pricing)) {
      _cachedPricing = parsed.pricing;
      return _cachedPricing;
    }

    console.warn('[token-cost] Invalid pricing config shape, using defaults');
    _cachedPricing = false;
    return null;
  } catch {
    _cachedPricing = false;
    return null;
  }
}

/**
 * Resets the module-level pricing cache.
 * Intended for use in tests only — do not call in production code.
 */
export function _resetPricingCache(): void {
  _cachedPricing = null;
}

/**
 * Calculates the estimated USD cost for a set of token counts and model.
 *
 * Cache creation tokens are billed at the input rate.
 * Cache read tokens are billed at the discounted cache_read rate.
 *
 * If no explicit pricingConfig is provided, the function loads pricing from
 * ateam.config.json (cached), falling back to DEFAULT_PRICING.
 *
 * @param tokens - Token count breakdown
 * @param model - Model name (e.g., 'claude-sonnet-4-6')
 * @param pricingConfig - Optional explicit pricing override
 */
export function calculateTokenCost(
  tokens: TokenCounts,
  model: string,
  pricingConfig?: PricingConfig
): TokenCostResult {
  const effectivePricing = pricingConfig ?? loadPricingFromConfig() ?? DEFAULT_PRICING;

  const pricing = effectivePricing.models[model];
  let usedFallback = false;
  let rates: ModelPricing;

  if (!pricing) {
    console.warn(`[token-cost] Unknown model "${model}", using fallback pricing`);
    rates = effectivePricing.fallback;
    usedFallback = true;
  } else {
    rates = pricing;
  }

  const inputCost = (tokens.inputTokens / 1_000_000) * rates.input_per_1m;
  const outputCost = (tokens.outputTokens / 1_000_000) * rates.output_per_1m;
  const cacheCreationCost = (tokens.cacheCreationTokens / 1_000_000) * rates.input_per_1m;
  const cacheReadCost = (tokens.cacheReadTokens / 1_000_000) * rates.cache_read_per_1m;

  const totalUsd = inputCost + outputCost + cacheCreationCost + cacheReadCost;

  return { totalUsd, model, usedFallback };
}
