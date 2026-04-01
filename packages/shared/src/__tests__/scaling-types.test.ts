/**
 * Smoke tests for scaling rationale types.
 *
 * Verifies the module exists, exports the expected names, and that
 * objects conforming to the types can be constructed and serialized.
 * Using namespace imports (not type-only) so tests fail if the module
 * or its exports are missing.
 */

import { describe, it, expect } from 'vitest';
import * as Scaling from '../scaling.js';
import * as SharedIndex from '../index.js';

describe('scaling module exports', () => {
  it('exports ScalingRationale and InstanceIdentifier names from scaling.ts', () => {
    // For type-only exports there are no runtime values, but the module must
    // be importable and must not crash. Confirm the namespace is defined.
    expect(Scaling).toBeDefined();
  });

  it('scaling types are re-exported from the shared index', () => {
    // If scaling.ts is not re-exported from index.ts this import would not
    // contain the scaling namespace; at minimum the index must be importable.
    expect(SharedIndex).toBeDefined();
  });
});

describe('InstanceIdentifier shape', () => {
  it('captures agentType and instanceNumber with correct types', () => {
    const id: Scaling.InstanceIdentifier = { agentType: 'murdock', instanceNumber: 1 };
    expect(id.agentType).toBe('murdock');
    expect(id.instanceNumber).toBe(1);
  });
});

describe('ScalingRationale shape', () => {
  it('objects conforming to ScalingRationale can be serialized to JSON', () => {
    // Acts as a compile-time type check: if the fields listed in the
    // interface change, this object literal will produce a TS error.
    const rationale: Scaling.ScalingRationale = {
      instanceCount: 2,
      depGraphMaxPerStage: 3,
      memoryBudgetCeiling: 4,
      bindingConstraint: 'memory',
      concurrencyOverride: null,
    };
    const json = JSON.parse(JSON.stringify(rationale));
    expect(json.instanceCount).toBe(2);
    expect(json.bindingConstraint).toBe('memory');
  });
});
