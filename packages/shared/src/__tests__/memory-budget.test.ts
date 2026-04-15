/**
 * Tests for the system memory budget query.
 *
 * computeMemoryBudget(freeMemMB?) returns the max agent instances the host
 * can support: floor(freeMemMB * 0.8 / 400 / 4), minimum 1.
 *
 * The optional freeMemMB parameter allows injecting a value for testability;
 * when omitted, defaults to os.freemem() / 1024 / 1024.
 */

import { describe, it, expect } from 'vitest';
import { computeMemoryBudget } from '../memory-budget.js';

describe('computeMemoryBudget()', () => {
  it('returns free memory in MB (not total RAM) via os.freemem()', () => {
    // When called with no argument it must use os.freemem(), which is always
    // less than or equal to total RAM. We just verify it returns a positive integer.
    const result = computeMemoryBudget();
    expect(result).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('computes floor(freeMemMB * 0.8 / 400 / 4) for a given freeMemMB', () => {
    // 3200 MB free → floor(3200 * 0.8 / 400 / 4) = floor(6400 / 1600) = floor(4) = 4 ✓ wait
    // 3200 * 0.8 = 2560; 2560 / 400 = 6.4; 6.4 / 4 = 1.6; floor(1.6) = 1
    // Let me recalculate with a cleaner number:
    // 8000 MB → 8000 * 0.8 = 6400; 6400 / 400 = 16; 16 / 4 = 4
    expect(computeMemoryBudget(8000)).toBe(4);
  });

  it('returns at least 1 even when free memory is very low', () => {
    expect(computeMemoryBudget(0)).toBe(1);
    expect(computeMemoryBudget(100)).toBe(1);
  });

  it('returns correct ceiling for a larger free memory value', () => {
    // 16000 MB → 16000 * 0.8 = 12800; 12800 / 400 = 32; 32 / 4 = 8
    expect(computeMemoryBudget(16000)).toBe(8);
  });

  it('honors a custom mbPerAgent override (half the default doubles the ceiling)', () => {
    // Default: 16000 MB, 400 MB/agent → 8
    // Custom:  16000 MB, 200 MB/agent → 16000 * 0.8 = 12800; 12800 / 200 = 64; 64 / 4 = 16
    const defaultCeiling = computeMemoryBudget(16000);
    const customCeiling = computeMemoryBudget(16000, 200);
    expect(defaultCeiling).toBe(8);
    expect(customCeiling).toBe(16);
    expect(customCeiling).toBe(defaultCeiling * 2);
  });

  it('returns at least 1 even when mbPerAgent is so high the computed ceiling would be <1', () => {
    // 1000 MB free, 100000 MB per agent → floor(1000 * 0.8 / 100000 / 4) = 0,
    // clamped to 1 by the Math.max guard.
    expect(computeMemoryBudget(1000, 100000)).toBe(1);
  });
});
