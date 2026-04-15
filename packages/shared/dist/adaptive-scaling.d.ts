/**
 * Adaptive scaling calculator.
 *
 * Composes dep-graph parallelism and memory budget into a final instance count
 * using min(depGraphMax, memoryCeiling). An optional concurrencyOverride
 * bypasses the formula entirely — useful for manual tuning or testing.
 */
import type { ScalingRationale } from './scaling.js';
import type { AdaptiveScalingInput } from './adaptive-scaling-types.js';
/**
 * Computes the adaptive instance count and returns a full ScalingRationale
 * explaining which constraint was binding.
 *
 * @param input - depGraphMax, memoryCeiling, and optional concurrencyOverride
 * @returns ScalingRationale with instanceCount and binding constraint
 */
export declare function computeAdaptiveScaling(input: AdaptiveScalingInput): ScalingRationale;
