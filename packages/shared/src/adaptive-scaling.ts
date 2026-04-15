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
export function computeAdaptiveScaling(input: AdaptiveScalingInput): ScalingRationale {
  const { depGraphMax, memoryCeiling, wipLimit, concurrencyOverride } = input;

  if (concurrencyOverride !== undefined) {
    return {
      instanceCount: concurrencyOverride,
      depGraphMaxPerStage: depGraphMax,
      memoryBudgetCeiling: memoryCeiling,
      wipLimit,
      bindingConstraint: 'override',
      concurrencyOverride,
    };
  }

  const instanceCount = Math.min(depGraphMax, memoryCeiling, wipLimit);
  const bindingConstraint =
    instanceCount === wipLimit && wipLimit <= depGraphMax && wipLimit <= memoryCeiling
      ? 'wip'
      : depGraphMax <= memoryCeiling
        ? 'dep_graph'
        : 'memory';

  return {
    instanceCount,
    depGraphMaxPerStage: depGraphMax,
    memoryBudgetCeiling: memoryCeiling,
    wipLimit,
    bindingConstraint,
    concurrencyOverride: null,
  };
}
