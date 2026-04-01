/**
 * Tests for the adaptive scaling calculator.
 *
 * computeAdaptiveScaling takes depGraphMax and memoryCeiling (already computed
 * by their respective modules) plus an optional concurrencyOverride, and returns
 * a ScalingRationale explaining what instance count to use and why.
 */

import { describe, it, expect } from 'vitest';
import { computeAdaptiveScaling } from '../adaptive-scaling.js';

describe('computeAdaptiveScaling()', () => {
  it('returns dep graph max when it is the binding constraint', () => {
    const result = computeAdaptiveScaling({ depGraphMax: 2, memoryCeiling: 5 });

    expect(result.instanceCount).toBe(2);
    expect(result.bindingConstraint).toBe('dep_graph');
    expect(result.depGraphMaxPerStage).toBe(2);
    expect(result.memoryBudgetCeiling).toBe(5);
    expect(result.concurrencyOverride).toBeNull();
  });

  it('returns memory ceiling when it is the binding constraint', () => {
    const result = computeAdaptiveScaling({ depGraphMax: 8, memoryCeiling: 3 });

    expect(result.instanceCount).toBe(3);
    expect(result.bindingConstraint).toBe('memory');
  });

  it('returns concurrencyOverride when provided, regardless of computed values', () => {
    const result = computeAdaptiveScaling({
      depGraphMax: 8,
      memoryCeiling: 6,
      concurrencyOverride: 4,
    });

    expect(result.instanceCount).toBe(4);
    expect(result.bindingConstraint).toBe('override');
    expect(result.concurrencyOverride).toBe(4);
  });

  it('still uses override even when it exceeds both computed ceilings', () => {
    const result = computeAdaptiveScaling({
      depGraphMax: 2,
      memoryCeiling: 2,
      concurrencyOverride: 10,
    });

    expect(result.instanceCount).toBe(10);
    expect(result.bindingConstraint).toBe('override');
  });

  it('returns a complete ScalingRationale with all required fields', () => {
    const result = computeAdaptiveScaling({ depGraphMax: 3, memoryCeiling: 3 });

    expect(result).toHaveProperty('instanceCount');
    expect(result).toHaveProperty('depGraphMaxPerStage', 3);
    expect(result).toHaveProperty('memoryBudgetCeiling', 3);
    expect(result).toHaveProperty('bindingConstraint');
    expect(result).toHaveProperty('concurrencyOverride', null);
  });
});
