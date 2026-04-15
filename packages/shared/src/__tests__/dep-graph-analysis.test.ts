/**
 * Tests for the dep-graph max-per-stage analysis function.
 *
 * The function accepts an array of work items with dependency arrays and
 * returns the maximum number of items that could occupy any single pipeline
 * stage simultaneously — the "independent set" width of the dep graph.
 */

import { describe, it, expect } from 'vitest';
import { computeDepGraphMaxPerStage } from '../dep-graph-analysis.js';

describe('computeDepGraphMaxPerStage()', () => {
  it('returns N for N items with zero dependencies', () => {
    const items = [
      { id: 'WI-001', dependencies: [] },
      { id: 'WI-002', dependencies: [] },
      { id: 'WI-003', dependencies: [] },
    ];
    expect(computeDepGraphMaxPerStage(items)).toBe(3);
  });

  it('returns 1 for a fully serial dependency chain', () => {
    // WI-001 → WI-002 → WI-003: each stage can only have 1 item at a time
    const items = [
      { id: 'WI-001', dependencies: [] },
      { id: 'WI-002', dependencies: ['WI-001'] },
      { id: 'WI-003', dependencies: ['WI-002'] },
    ];
    expect(computeDepGraphMaxPerStage(items)).toBe(1);
  });

  it('counts concurrent siblings correctly when blocked by shared dep', () => {
    // WI-001 is the shared dep; WI-002 and WI-003 fan out from it
    // Max concurrent in the fan-out stage is 2
    const items = [
      { id: 'WI-001', dependencies: [] },
      { id: 'WI-002', dependencies: ['WI-001'] },
      { id: 'WI-003', dependencies: ['WI-001'] },
    ];
    expect(computeDepGraphMaxPerStage(items)).toBe(2);
  });

  it('does not double-count items blocked by a shared dependency', () => {
    // WI-002 and WI-003 both depend on WI-001 — they're siblings, not stacked
    const items = [
      { id: 'WI-001', dependencies: [] },
      { id: 'WI-002', dependencies: ['WI-001'] },
      { id: 'WI-003', dependencies: ['WI-001'] },
      { id: 'WI-004', dependencies: ['WI-002', 'WI-003'] }, // joins after both
    ];
    // Wave widths: [1, 2, 1] → max is 2
    expect(computeDepGraphMaxPerStage(items)).toBe(2);
  });

  it('returns 1 for a single item with no dependencies', () => {
    expect(computeDepGraphMaxPerStage([{ id: 'WI-001', dependencies: [] }])).toBe(1);
  });
});
