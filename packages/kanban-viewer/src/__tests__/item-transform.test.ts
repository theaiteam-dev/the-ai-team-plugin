import { describe, it, expect } from 'vitest';
import { transformItemToResponse, type DbItem } from '@/lib/item-transform';

function makeDbItem(overrides: Partial<DbItem> = {}): DbItem {
  return {
    id: 'WI-001',
    title: 'Test Item',
    description: 'A test item',
    objective: null,
    acceptance: null,
    context: null,
    type: 'feature',
    priority: 'medium',
    stageId: 'ready',
    assignedAgent: null,
    rejectionCount: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    completedAt: null,
    outputTest: null,
    outputImpl: null,
    outputTypes: null,
    ...overrides,
  };
}

describe('transformItemToResponse — acceptance field', () => {
  it('returns undefined when acceptance is null', () => {
    const item = transformItemToResponse(makeDbItem({ acceptance: null }));
    expect(item.acceptance).toBeUndefined();
  });

  it('parses a valid string array', () => {
    const item = transformItemToResponse(
      makeDbItem({ acceptance: JSON.stringify(['criterion one', 'criterion two']) })
    );
    expect(item.acceptance).toEqual(['criterion one', 'criterion two']);
  });

  it('filters out non-string elements from a mixed array', () => {
    // [1, {}, "valid"] — only "valid" should survive
    const item = transformItemToResponse(
      makeDbItem({ acceptance: JSON.stringify([1, {}, 'valid criterion']) })
    );
    expect(item.acceptance).toEqual(['valid criterion']);
  });

  it('returns undefined when acceptance is not a JSON array', () => {
    const item = transformItemToResponse(makeDbItem({ acceptance: '"just a string"' }));
    expect(item.acceptance).toBeUndefined();
  });

  it('returns undefined when acceptance is invalid JSON', () => {
    const item = transformItemToResponse(makeDbItem({ acceptance: 'not-json' }));
    expect(item.acceptance).toBeUndefined();
  });
});
