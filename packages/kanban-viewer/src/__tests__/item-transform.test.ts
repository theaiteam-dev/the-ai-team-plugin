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

describe('transformItemToResponse — outputs field', () => {
  it('omits keys whose column is null', () => {
    const item = transformItemToResponse(makeDbItem());
    expect(item.outputs).toEqual({});
  });

  it('preserves an empty-string test path as the NO_TEST_NEEDED marker', () => {
    const item = transformItemToResponse(
      makeDbItem({ outputTest: '', outputImpl: 'README.md' })
    );
    expect(item.outputs).toEqual({ test: '', impl: 'README.md' });
    expect(item.outputs.test).toBe('');
  });

  it('distinguishes an empty-string path from an absent one', () => {
    const empty = transformItemToResponse(makeDbItem({ outputTest: '' }));
    const absent = transformItemToResponse(makeDbItem({ outputTest: null }));
    expect('test' in empty.outputs).toBe(true);
    expect('test' in absent.outputs).toBe(false);
  });

  it('preserves empty strings across all three output columns', () => {
    const item = transformItemToResponse(
      makeDbItem({ outputTest: '', outputImpl: '', outputTypes: '' })
    );
    expect(item.outputs).toEqual({ test: '', impl: '', types: '' });
  });

  it('passes through populated paths unchanged', () => {
    const item = transformItemToResponse(
      makeDbItem({
        outputTest: 'src/__tests__/feature.test.ts',
        outputImpl: 'src/services/feature.ts',
        outputTypes: 'src/types/feature.ts',
      })
    );
    expect(item.outputs).toEqual({
      test: 'src/__tests__/feature.test.ts',
      impl: 'src/services/feature.ts',
      types: 'src/types/feature.ts',
    });
  });
});
