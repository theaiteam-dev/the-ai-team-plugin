import { describe, it, expect } from 'vitest';

/**
 * Tests for validation utilities and error types.
 *
 * These tests verify:
 * 1. isValidTransition(from, to) - Stage transition validation for 8-stage A-Team pipeline
 * 2. checkWipLimit(stageId, currentCount) - WIP limit checking
 * 3. validateDependencies(itemId, dependsOnIds) - Cycle detection
 * 4. ApiError class and error factory functions
 *
 * Stage transition matrix (A-Team Pipeline):
 * - briefings -> ready, blocked
 * - ready -> testing, implementing, probing, blocked, briefings
 * - testing -> review, blocked (Murdock completes)
 * - implementing -> review, blocked (B.A. completes)
 * - probing -> ready, done, blocked (Amy can return to ready or mark done)
 * - review -> done, testing, implementing, probing, blocked (Lynch can approve or reject)
 * - done -> (terminal, no transitions)
 * - blocked -> ready
 */

// Import validation functions
import {
  isValidTransition,
  checkWipLimit,
  validateDependencies,
} from '@/lib/validation';

// Import error types and factories
import {
  ApiError,
  ErrorCodes,
  createItemNotFoundError,
  createInvalidTransitionError,
  createWipLimitExceededError,
  createDependencyCycleError,
  createOutputCollisionError,
  createValidationError,
  createUnauthorizedError,
  createServerError,
} from '@/lib/errors';

// ============ isValidTransition Tests ============

describe('isValidTransition', () => {
  describe('briefings transitions', () => {
    it('should allow briefings -> ready', () => {
      expect(isValidTransition('briefings', 'ready')).toBe(true);
    });

    it('should allow briefings -> blocked', () => {
      expect(isValidTransition('briefings', 'blocked')).toBe(true);
    });

    it('should reject briefings -> testing', () => {
      expect(isValidTransition('briefings', 'testing')).toBe(false);
    });

    it('should reject briefings -> implementing', () => {
      expect(isValidTransition('briefings', 'implementing')).toBe(false);
    });

    it('should reject briefings -> review', () => {
      expect(isValidTransition('briefings', 'review')).toBe(false);
    });

    it('should reject briefings -> done', () => {
      expect(isValidTransition('briefings', 'done')).toBe(false);
    });

    it('should reject briefings -> briefings (self)', () => {
      expect(isValidTransition('briefings', 'briefings')).toBe(false);
    });
  });

  describe('ready transitions', () => {
    it('should allow ready -> testing (Murdock)', () => {
      expect(isValidTransition('ready', 'testing')).toBe(true);
    });

    it('should allow ready -> implementing (B.A.)', () => {
      expect(isValidTransition('ready', 'implementing')).toBe(true);
    });

    it('should allow ready -> probing (Amy)', () => {
      expect(isValidTransition('ready', 'probing')).toBe(true);
    });

    it('should allow ready -> blocked', () => {
      expect(isValidTransition('ready', 'blocked')).toBe(true);
    });

    it('should allow ready -> briefings', () => {
      expect(isValidTransition('ready', 'briefings')).toBe(true);
    });

    it('should reject ready -> review', () => {
      expect(isValidTransition('ready', 'review')).toBe(false);
    });

    it('should reject ready -> done', () => {
      expect(isValidTransition('ready', 'done')).toBe(false);
    });

    it('should reject ready -> ready (self)', () => {
      expect(isValidTransition('ready', 'ready')).toBe(false);
    });
  });

  describe('testing transitions (Murdock)', () => {
    it('should allow testing -> implementing', () => {
      expect(isValidTransition('testing', 'implementing')).toBe(true);
    });

    it('should allow testing -> blocked', () => {
      expect(isValidTransition('testing', 'blocked')).toBe(true);
    });

    it('should reject testing -> briefings', () => {
      expect(isValidTransition('testing', 'briefings')).toBe(false);
    });

    it('should reject testing -> ready', () => {
      expect(isValidTransition('testing', 'ready')).toBe(false);
    });

    it('should reject testing -> done', () => {
      expect(isValidTransition('testing', 'done')).toBe(false);
    });

    it('should reject testing -> testing (self)', () => {
      expect(isValidTransition('testing', 'testing')).toBe(false);
    });
  });

  describe('implementing transitions (B.A.)', () => {
    it('should allow implementing -> review', () => {
      expect(isValidTransition('implementing', 'review')).toBe(true);
    });

    it('should allow implementing -> blocked', () => {
      expect(isValidTransition('implementing', 'blocked')).toBe(true);
    });

    it('should reject implementing -> briefings', () => {
      expect(isValidTransition('implementing', 'briefings')).toBe(false);
    });

    it('should reject implementing -> ready', () => {
      expect(isValidTransition('implementing', 'ready')).toBe(false);
    });

    it('should reject implementing -> done', () => {
      expect(isValidTransition('implementing', 'done')).toBe(false);
    });

    it('should reject implementing -> implementing (self)', () => {
      expect(isValidTransition('implementing', 'implementing')).toBe(false);
    });
  });

  describe('probing transitions (Amy)', () => {
    it('should allow probing -> ready (needs more work)', () => {
      expect(isValidTransition('probing', 'ready')).toBe(true);
    });

    it('should allow probing -> done (verified)', () => {
      expect(isValidTransition('probing', 'done')).toBe(true);
    });

    it('should allow probing -> blocked', () => {
      expect(isValidTransition('probing', 'blocked')).toBe(true);
    });

    it('should reject probing -> briefings', () => {
      expect(isValidTransition('probing', 'briefings')).toBe(false);
    });

    it('should reject probing -> review', () => {
      expect(isValidTransition('probing', 'review')).toBe(false);
    });

    it('should reject probing -> probing (self)', () => {
      expect(isValidTransition('probing', 'probing')).toBe(false);
    });
  });

  describe('review transitions (Lynch)', () => {
    it('should reject review -> done', () => {
      expect(isValidTransition('review', 'done')).toBe(false);
    });

    it('should allow review -> testing (rejected, needs tests)', () => {
      expect(isValidTransition('review', 'testing')).toBe(true);
    });

    it('should allow review -> implementing (rejected, needs impl)', () => {
      expect(isValidTransition('review', 'implementing')).toBe(true);
    });

    it('should allow review -> probing (send to Amy)', () => {
      expect(isValidTransition('review', 'probing')).toBe(true);
    });

    it('should allow review -> blocked', () => {
      expect(isValidTransition('review', 'blocked')).toBe(true);
    });

    it('should reject review -> briefings', () => {
      expect(isValidTransition('review', 'briefings')).toBe(false);
    });

    it('should reject review -> ready', () => {
      expect(isValidTransition('review', 'ready')).toBe(false);
    });

    it('should reject review -> review (self)', () => {
      expect(isValidTransition('review', 'review')).toBe(false);
    });
  });

  describe('done transitions (terminal)', () => {
    it('should reject done -> briefings', () => {
      expect(isValidTransition('done', 'briefings')).toBe(false);
    });

    it('should reject done -> ready', () => {
      expect(isValidTransition('done', 'ready')).toBe(false);
    });

    it('should reject done -> testing', () => {
      expect(isValidTransition('done', 'testing')).toBe(false);
    });

    it('should reject done -> implementing', () => {
      expect(isValidTransition('done', 'implementing')).toBe(false);
    });

    it('should reject done -> probing', () => {
      expect(isValidTransition('done', 'probing')).toBe(false);
    });

    it('should reject done -> review', () => {
      expect(isValidTransition('done', 'review')).toBe(false);
    });

    it('should reject done -> blocked', () => {
      expect(isValidTransition('done', 'blocked')).toBe(false);
    });

    it('should reject done -> done (self)', () => {
      expect(isValidTransition('done', 'done')).toBe(false);
    });
  });

  describe('blocked transitions', () => {
    it('should allow blocked -> ready', () => {
      expect(isValidTransition('blocked', 'ready')).toBe(true);
    });

    it('should reject blocked -> briefings', () => {
      expect(isValidTransition('blocked', 'briefings')).toBe(false);
    });

    it('should reject blocked -> testing', () => {
      expect(isValidTransition('blocked', 'testing')).toBe(false);
    });

    it('should reject blocked -> implementing', () => {
      expect(isValidTransition('blocked', 'implementing')).toBe(false);
    });

    it('should reject blocked -> probing', () => {
      expect(isValidTransition('blocked', 'probing')).toBe(false);
    });

    it('should reject blocked -> review', () => {
      expect(isValidTransition('blocked', 'review')).toBe(false);
    });

    it('should reject blocked -> done', () => {
      expect(isValidTransition('blocked', 'done')).toBe(false);
    });

    it('should reject blocked -> blocked (self)', () => {
      expect(isValidTransition('blocked', 'blocked')).toBe(false);
    });
  });
});

// ============ checkWipLimit Tests ============

describe('checkWipLimit', () => {
  describe('happy path', () => {
    it('should return ok when under limit', () => {
      const result = checkWipLimit('testing', 2, 3);
      expect(result.allowed).toBe(true);
      expect(result.available).toBe(1);
    });

    it('should return ok when at zero with limit', () => {
      const result = checkWipLimit('implementing', 0, 3);
      expect(result.allowed).toBe(true);
      expect(result.available).toBe(3);
    });

    it('should return ok when limit is null (unlimited)', () => {
      const result = checkWipLimit('briefings', 100, null);
      expect(result.allowed).toBe(true);
      expect(result.available).toBeNull();
    });
  });

  describe('at capacity', () => {
    it('should return not allowed when at limit', () => {
      const result = checkWipLimit('testing', 3, 3);
      expect(result.allowed).toBe(false);
      expect(result.available).toBe(0);
    });
  });

  describe('over capacity', () => {
    it('should return not allowed when over limit', () => {
      const result = checkWipLimit('implementing', 5, 3);
      expect(result.allowed).toBe(false);
      expect(result.available).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle limit of 1', () => {
      const resultEmpty = checkWipLimit('probing', 0, 1);
      expect(resultEmpty.allowed).toBe(true);
      expect(resultEmpty.available).toBe(1);

      const resultFull = checkWipLimit('probing', 1, 1);
      expect(resultFull.allowed).toBe(false);
      expect(resultFull.available).toBe(0);
    });

    it('should handle limit of 0 (no items allowed)', () => {
      const result = checkWipLimit('review', 0, 0);
      expect(result.allowed).toBe(false);
      expect(result.available).toBe(0);
    });
  });
});

// ============ validateDependencies Tests ============

describe('validateDependencies', () => {
  describe('happy path - no cycles', () => {
    it('should validate item with no dependencies', () => {
      const graph: Record<string, string[]> = {
        'WI-001': [],
        'WI-002': ['WI-001'],
      };
      const result = validateDependencies('WI-001', [], graph);
      expect(result.valid).toBe(true);
      expect(result.cycle).toBeNull();
    });

    it('should validate linear dependency chain', () => {
      const graph: Record<string, string[]> = {
        'WI-001': [],
        'WI-002': ['WI-001'],
        'WI-003': ['WI-002'],
      };
      const result = validateDependencies('WI-003', ['WI-002'], graph);
      expect(result.valid).toBe(true);
      expect(result.cycle).toBeNull();
    });

    it('should validate diamond dependency pattern', () => {
      // WI-004 depends on WI-002 and WI-003, both depend on WI-001
      const graph: Record<string, string[]> = {
        'WI-001': [],
        'WI-002': ['WI-001'],
        'WI-003': ['WI-001'],
        'WI-004': ['WI-002', 'WI-003'],
      };
      const result = validateDependencies('WI-004', ['WI-002', 'WI-003'], graph);
      expect(result.valid).toBe(true);
      expect(result.cycle).toBeNull();
    });
  });

  describe('cycle detection', () => {
    it('should detect direct self-reference', () => {
      const graph: Record<string, string[]> = {
        'WI-001': [],
      };
      // Trying to add WI-001 as dependency of itself
      const result = validateDependencies('WI-001', ['WI-001'], graph);
      expect(result.valid).toBe(false);
      expect(result.cycle).toContain('WI-001');
    });

    it('should detect two-node cycle', () => {
      const graph: Record<string, string[]> = {
        'WI-001': ['WI-002'],
        'WI-002': [],
      };
      // Trying to make WI-002 depend on WI-001 creates cycle
      const result = validateDependencies('WI-002', ['WI-001'], graph);
      expect(result.valid).toBe(false);
      expect(result.cycle).not.toBeNull();
      expect(result.cycle?.length).toBeGreaterThan(0);
    });

    it('should detect three-node cycle', () => {
      const graph: Record<string, string[]> = {
        'WI-001': ['WI-002'],
        'WI-002': ['WI-003'],
        'WI-003': [],
      };
      // Trying to make WI-003 depend on WI-001 creates cycle
      const result = validateDependencies('WI-003', ['WI-001'], graph);
      expect(result.valid).toBe(false);
      expect(result.cycle).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle empty graph', () => {
      const result = validateDependencies('WI-001', [], {});
      expect(result.valid).toBe(true);
      expect(result.cycle).toBeNull();
    });

    it('should handle dependency to non-existent item', () => {
      const graph: Record<string, string[]> = {
        'WI-001': [],
      };
      // Depending on non-existent item - should still be valid (no cycle possible)
      const result = validateDependencies('WI-001', ['WI-999'], graph);
      expect(result.valid).toBe(true);
      expect(result.cycle).toBeNull();
    });

    it('should handle new item not in graph yet', () => {
      const graph: Record<string, string[]> = {
        'WI-001': [],
      };
      // New item WI-002 depending on WI-001
      const result = validateDependencies('WI-002', ['WI-001'], graph);
      expect(result.valid).toBe(true);
      expect(result.cycle).toBeNull();
    });
  });
});

// ============ ApiError Class Tests ============

describe('ApiError', () => {
  it('should be an instance of Error', () => {
    const error = new ApiError('ITEM_NOT_FOUND', 'Item not found');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
  });

  it('should have code and message properties', () => {
    const error = new ApiError('ITEM_NOT_FOUND', 'Item WI-001 not found');
    expect(error.code).toBe('ITEM_NOT_FOUND');
    expect(error.message).toBe('Item WI-001 not found');
  });

  it('should accept optional details', () => {
    const error = new ApiError('VALIDATION_ERROR', 'Invalid input', {
      field: 'title',
      reason: 'required',
    });
    expect(error.details).toEqual({ field: 'title', reason: 'required' });
  });

  it('should have undefined details when not provided', () => {
    const error = new ApiError('ITEM_NOT_FOUND', 'Item not found');
    expect(error.details).toBeUndefined();
  });

  it('should serialize to API response format', () => {
    const error = new ApiError('ITEM_NOT_FOUND', 'Item WI-001 not found', {
      itemId: 'WI-001',
    });
    const response = error.toResponse();

    expect(response).toEqual({
      success: false,
      error: {
        code: 'ITEM_NOT_FOUND',
        message: 'Item WI-001 not found',
        details: { itemId: 'WI-001' },
      },
    });
  });

  it('should omit details in response when not provided', () => {
    const error = new ApiError('SERVER_ERROR', 'Internal server error');
    const response = error.toResponse();

    expect(response).toEqual({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Internal server error',
      },
    });
    expect(response.error.details).toBeUndefined();
  });
});

// ============ Error Factory Functions Tests ============

describe('Error Factory Functions', () => {
  describe('createItemNotFoundError', () => {
    it('should create error with ITEM_NOT_FOUND code', () => {
      const error = createItemNotFoundError('WI-001');
      expect(error.code).toBe('ITEM_NOT_FOUND');
      expect(error.message).toContain('WI-001');
    });

    it('should include itemId in details', () => {
      const error = createItemNotFoundError('WI-999');
      expect(error.details).toEqual({ itemId: 'WI-999' });
    });
  });

  describe('createInvalidTransitionError', () => {
    it('should create error with INVALID_TRANSITION code', () => {
      const error = createInvalidTransitionError('ready', 'done');
      expect(error.code).toBe('INVALID_TRANSITION');
    });

    it('should include from and to stages in message', () => {
      const error = createInvalidTransitionError('ready', 'done');
      expect(error.message).toContain('ready');
      expect(error.message).toContain('done');
    });

    it('should include stages in details', () => {
      const error = createInvalidTransitionError('ready', 'done');
      expect(error.details).toEqual({ from: 'ready', to: 'done' });
    });
  });

  describe('createWipLimitExceededError', () => {
    it('should create error with WIP_LIMIT_EXCEEDED code', () => {
      const error = createWipLimitExceededError('testing', 3, 3);
      expect(error.code).toBe('WIP_LIMIT_EXCEEDED');
    });

    it('should include stage and limit info in message', () => {
      const error = createWipLimitExceededError('implementing', 3, 3);
      expect(error.message).toContain('implementing');
      expect(error.message).toContain('3');
    });

    it('should include limit details', () => {
      const error = createWipLimitExceededError('probing', 3, 3);
      expect(error.details).toEqual({
        stageId: 'probing',
        limit: 3,
        current: 3,
      });
    });
  });

  describe('createDependencyCycleError', () => {
    it('should create error with DEPENDENCY_CYCLE code', () => {
      const error = createDependencyCycleError(['WI-001', 'WI-002', 'WI-001']);
      expect(error.code).toBe('DEPENDENCY_CYCLE');
    });

    it('should include cycle in details', () => {
      const cycle = ['WI-001', 'WI-002', 'WI-003', 'WI-001'];
      const error = createDependencyCycleError(cycle);
      expect(error.details).toEqual({ cycle });
    });
  });

  describe('createOutputCollisionError', () => {
    it('should create error with OUTPUT_COLLISION code', () => {
      const error = createOutputCollisionError([
        { file: 'src/feature.ts', items: ['WI-001', 'WI-002'] },
      ]);
      expect(error.code).toBe('OUTPUT_COLLISION');
    });

    it('should include collision file in message', () => {
      const error = createOutputCollisionError([
        { file: 'src/services/feature.ts', items: ['WI-001', 'WI-002'] },
      ]);
      expect(error.message).toContain('src/services/feature.ts');
    });

    it('should include multiple collision files in message', () => {
      const error = createOutputCollisionError([
        { file: 'src/a.ts', items: ['WI-001', 'WI-002'] },
        { file: 'src/b.ts', items: ['WI-003', 'WI-004'] },
      ]);
      expect(error.message).toContain('src/a.ts');
      expect(error.message).toContain('src/b.ts');
    });

    it('should include collisions in details', () => {
      const collisions = [
        { file: 'src/feature.ts', items: ['WI-001', 'WI-002'] },
        { file: 'src/other.ts', items: ['WI-003', 'WI-004', 'WI-005'] },
      ];
      const error = createOutputCollisionError(collisions);
      expect(error.details).toEqual({ collisions });
    });

    it('should serialize to API response format', () => {
      const collisions = [
        { file: 'src/feature.ts', items: ['WI-001', 'WI-002'] },
      ];
      const error = createOutputCollisionError(collisions);
      const response = error.toResponse();

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('OUTPUT_COLLISION');
      expect(response.error.details).toEqual({ collisions });
    });
  });

  describe('createValidationError', () => {
    it('should create error with VALIDATION_ERROR code', () => {
      const error = createValidationError('Invalid title');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toBe('Invalid title');
    });

    it('should accept optional details', () => {
      const error = createValidationError('Invalid input', {
        field: 'title',
        reason: 'too_long',
      });
      expect(error.details).toEqual({ field: 'title', reason: 'too_long' });
    });
  });

  describe('createUnauthorizedError', () => {
    it('should create error with UNAUTHORIZED code', () => {
      const error = createUnauthorizedError();
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should have default message', () => {
      const error = createUnauthorizedError();
      expect(error.message).toBeTruthy();
    });

    it('should accept custom message', () => {
      const error = createUnauthorizedError('Agent not authorized');
      expect(error.message).toBe('Agent not authorized');
    });
  });

  describe('createServerError', () => {
    it('should create error with SERVER_ERROR code', () => {
      const error = createServerError();
      expect(error.code).toBe('SERVER_ERROR');
    });

    it('should have default message', () => {
      const error = createServerError();
      expect(error.message).toBeTruthy();
    });

    it('should accept custom message', () => {
      const error = createServerError('Database connection failed');
      expect(error.message).toBe('Database connection failed');
    });
  });
});

// ============ Error Codes Constant Tests ============

describe('Error Codes', () => {
  /**
   * This test documents the expected error codes per PRD.
   * These codes should be exported as constants from the errors module.
   */
  it('should define all required error codes', () => {
    // ErrorCodes imported at top of file
    expect(ErrorCodes.ITEM_NOT_FOUND).toBe('ITEM_NOT_FOUND');
    expect(ErrorCodes.INVALID_TRANSITION).toBe('INVALID_TRANSITION');
    expect(ErrorCodes.WIP_LIMIT_EXCEEDED).toBe('WIP_LIMIT_EXCEEDED');
    expect(ErrorCodes.DEPENDENCY_CYCLE).toBe('DEPENDENCY_CYCLE');
    expect(ErrorCodes.OUTPUT_COLLISION).toBe('OUTPUT_COLLISION');
    expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ErrorCodes.SERVER_ERROR).toBe('SERVER_ERROR');
  });
});

// ============ Integration-style Type Tests ============

describe('Type Safety', () => {
  it('should use StageId type for isValidTransition', () => {
    // These would cause TypeScript errors if types are wrong
    const result = isValidTransition('ready', 'testing');
    expect(typeof result).toBe('boolean');
  });

  it('should return properly typed WipCheckResult', () => {
    const result = checkWipLimit('implementing', 2, 3);
    expect(typeof result.allowed).toBe('boolean');
    expect(typeof result.available === 'number' || result.available === null).toBe(true);
  });

  it('should return properly typed DependencyValidationResult', () => {
    const result = validateDependencies('WI-001', [], {});
    expect(typeof result.valid).toBe('boolean');
    expect(result.cycle === null || Array.isArray(result.cycle)).toBe(true);
  });
});

// ============ validateOutputCollisions Tests ============

import { validateOutputCollisions } from '@/lib/validation';
import type { OutputCollisionItem } from '@/lib/validation';

describe('validateOutputCollisions', () => {
  describe('no collisions - unique outputs', () => {
    it('should return valid when all outputs are unique', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/services/feature-a.ts', test: 'src/__tests__/feature-a.test.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/services/feature-b.ts', test: 'src/__tests__/feature-b.test.ts' },
          dependencies: [],
        },
        {
          id: 'WI-003',
          outputs: { impl: 'src/services/feature-c.ts' },
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });

    it('should return valid when items have no outputs', () => {
      const items: OutputCollisionItem[] = [
        { id: 'WI-001', outputs: {}, dependencies: [] },
        { id: 'WI-002', outputs: {}, dependencies: [] },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });

    it('should ignore empty-string output paths (regression: M-20260410-001)', () => {
      // Legacy CLI serialized unset --outputs.types as "" which was persisted
      // to the DB and then treated as a shared empty-string path by the
      // collision detector, causing spurious 400 OUTPUT_COLLISION errors on
      // every 4th work item a mission tried to create. Empty strings must be
      // treated the same as undefined.
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/a.ts', test: 'src/__tests__/a.test.ts', types: '' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/b.ts', test: 'src/__tests__/b.test.ts', types: '' },
          dependencies: [],
        },
        {
          id: 'WI-003',
          outputs: { impl: 'src/c.ts', test: 'src/__tests__/c.test.ts', types: '' },
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });

    it('should return valid for empty item list', () => {
      const result = validateOutputCollisions([]);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });

    it('should return valid for single item', () => {
      const items: OutputCollisionItem[] = [
        { id: 'WI-001', outputs: { impl: 'src/feature.ts' }, dependencies: [] },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });
  });

  describe('no collisions - same output with direct dependency', () => {
    it('should return valid when same impl output has direct dependency', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: ['WI-001'], // WI-002 depends on WI-001 - safe
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });

    it('should return valid when same test output has direct dependency', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { test: 'src/__tests__/feature.test.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { test: 'src/__tests__/feature.test.ts' },
          dependencies: ['WI-001'],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });

    it('should return valid when same types output has direct dependency', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { types: 'src/types/feature.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { types: 'src/types/feature.ts' },
          dependencies: ['WI-001'],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });

    it('should return valid with reverse dependency direction', () => {
      // If WI-001 depends on WI-002, they still have a dependency relationship
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: ['WI-002'],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });
  });

  describe('no collisions - same output with transitive dependency', () => {
    it('should return valid when same output has transitive dependency', () => {
      // WI-003 -> WI-002 -> WI-001 (transitive chain)
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/other.ts' },
          dependencies: ['WI-001'],
        },
        {
          id: 'WI-003',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: ['WI-002'], // Transitive dependency on WI-001
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });

    it('should return valid with longer transitive chain', () => {
      // WI-004 -> WI-003 -> WI-002 -> WI-001
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: {},
          dependencies: ['WI-001'],
        },
        {
          id: 'WI-003',
          outputs: {},
          dependencies: ['WI-002'],
        },
        {
          id: 'WI-004',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: ['WI-003'],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });
  });

  describe('collisions detected - same output without dependency', () => {
    it('should detect collision when same impl output has no dependency', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/services/feature.ts' },
          dependencies: [], // No dependency on WI-001 - collision!
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(false);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].file).toBe('src/services/feature.ts');
      expect(result.collisions[0].items).toContain('WI-001');
      expect(result.collisions[0].items).toContain('WI-002');
    });

    it('should detect collision when same test output has no dependency', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { test: 'src/__tests__/feature.test.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { test: 'src/__tests__/feature.test.ts' },
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(false);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].file).toBe('src/__tests__/feature.test.ts');
    });

    it('should detect collision when same types output has no dependency', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { types: 'src/types/feature.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { types: 'src/types/feature.ts' },
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(false);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].file).toBe('src/types/feature.ts');
    });
  });

  describe('collisions detected - multiple collisions', () => {
    it('should detect multiple collisions in different files', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/a.ts', test: 'src/__tests__/a.test.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/a.ts' }, // Collision on impl
          dependencies: [],
        },
        {
          id: 'WI-003',
          outputs: { test: 'src/__tests__/a.test.ts' }, // Collision on test
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(false);
      expect(result.collisions).toHaveLength(2);

      const files = result.collisions.map((c) => c.file).sort();
      expect(files).toEqual(['src/__tests__/a.test.ts', 'src/a.ts']);
    });

    it('should detect collision with more than two items', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/shared.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/shared.ts' },
          dependencies: [],
        },
        {
          id: 'WI-003',
          outputs: { impl: 'src/shared.ts' },
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(false);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].items).toHaveLength(3);
      expect(result.collisions[0].items).toContain('WI-001');
      expect(result.collisions[0].items).toContain('WI-002');
      expect(result.collisions[0].items).toContain('WI-003');
    });
  });

  describe('edge cases', () => {
    it('should handle mixed output types with same path', () => {
      // If impl and test happen to be same file (unusual but possible)
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/feature.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { test: 'src/feature.ts' }, // Same path, different output type
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(false);
      expect(result.collisions).toHaveLength(1);
    });

    it('should not consider undefined outputs as collisions', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: undefined, test: 'src/__tests__/a.test.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: undefined, test: 'src/__tests__/b.test.ts' },
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });

    it('should handle partial dependency chain with collision', () => {
      // WI-003 depends on WI-001, but not on WI-002
      // WI-001 and WI-002 have same output - collision between WI-002 and WI-003
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/feature.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/feature.ts' },
          dependencies: [], // No dependency chain
        },
        {
          id: 'WI-003',
          outputs: { impl: 'src/feature.ts' },
          dependencies: ['WI-001'], // Only depends on WI-001
        },
      ];

      const result = validateOutputCollisions(items);
      // WI-001 and WI-002 have no dependency - collision
      // WI-001 and WI-003 have dependency - OK
      // WI-002 and WI-003 have no dependency - collision
      expect(result.valid).toBe(false);
      expect(result.collisions).toHaveLength(1);
      expect(result.collisions[0].items).toContain('WI-001');
      expect(result.collisions[0].items).toContain('WI-002');
    });

    it('should use exact string matching for paths', () => {
      const items: OutputCollisionItem[] = [
        {
          id: 'WI-001',
          outputs: { impl: 'src/feature.ts' },
          dependencies: [],
        },
        {
          id: 'WI-002',
          outputs: { impl: 'src/Feature.ts' }, // Different case
          dependencies: [],
        },
        {
          id: 'WI-003',
          outputs: { impl: './src/feature.ts' }, // Different format
          dependencies: [],
        },
      ];

      const result = validateOutputCollisions(items);
      // These are considered different paths (exact string match)
      expect(result.valid).toBe(true);
      expect(result.collisions).toHaveLength(0);
    });
  });
});
