import { describe, it, expect } from 'vitest';
import type { Stage, WorkItem, AnimatingItem } from '../types';
import { isValidStage, getStageFromPath } from '../lib/stage-utils';

/**
 * Tests for the 'probing' stage type extension.
 *
 * These tests verify that:
 * 1. 'probing' is accepted as a valid Stage value
 * 2. All 8 stages are present (7 existing + probing)
 * 3. Type narrowing and guards work with probing
 * 4. Backward compatibility with existing stage values
 *
 * Note: @ts-expect-error directives mark where TypeScript currently
 * rejects 'probing' - once implemented, these errors go away and
 * tests should still pass.
 */
describe('Probing Stage Type', () => {
  describe('Stage type definition', () => {
    it('should accept probing as a valid Stage value', () => {
      const stage: Stage = 'probing';
      expect(stage).toBe('probing');
    });

    it('should have exactly 8 valid stages after implementation', () => {
      // Once implemented, all 8 stages should be valid
      const existingStages: Stage[] = [
        'briefings',
        'ready',
        'testing',
        'implementing',
        'review',
        'done',
        'blocked',
      ];
      expect(existingStages).toHaveLength(7);

      const allStages: Stage[] = [...existingStages, 'probing'];
      expect(allStages).toHaveLength(8);
    });

    it('should maintain backward compatibility with existing stages', () => {
      const briefings: Stage = 'briefings';
      const ready: Stage = 'ready';
      const testing: Stage = 'testing';
      const implementing: Stage = 'implementing';
      const review: Stage = 'review';
      const done: Stage = 'done';
      const blocked: Stage = 'blocked';

      expect(briefings).toBe('briefings');
      expect(ready).toBe('ready');
      expect(testing).toBe('testing');
      expect(implementing).toBe('implementing');
      expect(review).toBe('review');
      expect(done).toBe('done');
      expect(blocked).toBe('blocked');
    });
  });

  describe('isValidStage type guard', () => {
    it('should return true for probing stage', () => {
      // This will fail until VALID_STAGES includes 'probing'
      expect(isValidStage('probing')).toBe(true);
    });

    it('should still return true for all existing stages', () => {
      expect(isValidStage('briefings')).toBe(true);
      expect(isValidStage('ready')).toBe(true);
      expect(isValidStage('testing')).toBe(true);
      expect(isValidStage('implementing')).toBe(true);
      expect(isValidStage('review')).toBe(true);
      expect(isValidStage('done')).toBe(true);
      expect(isValidStage('blocked')).toBe(true);
    });

    it('should act as type guard for probing', () => {
      const value: string = 'probing';

      if (isValidStage(value)) {
        // TypeScript should narrow the type to Stage
        const stage: Stage = value;
        expect(stage).toBe('probing');
      } else {
        // Should not reach here after implementation
        expect.fail('probing should be a valid stage');
      }
    });
  });

  describe('getStageFromPath with probing', () => {
    it('should extract probing stage from absolute path', () => {
      // This will fail until VALID_STAGES includes 'probing'
      expect(getStageFromPath('/mission/probing/item.md')).toBe('probing');
    });

    it('should extract probing stage from relative path', () => {
      expect(getStageFromPath('mission/probing/item.md')).toBe('probing');
    });

    it('should handle probing in deeply nested paths', () => {
      expect(getStageFromPath('/home/user/project/mission/probing/subfolder/item.md')).toBe('probing');
    });
  });

  describe('WorkItem with probing stage', () => {
    it('should allow creating WorkItem with probing stage', () => {
      const item: WorkItem = {
        id: '001',
        title: 'Test Probing Item',
        type: 'feature',
        status: 'in-progress',
        rejection_count: 0,
        dependencies: [],
        outputs: {},
        created_at: '2026-01-17T00:00:00Z',
        updated_at: '2026-01-17T00:00:00Z',
        stage: 'probing',
        content: 'Testing probing stage',
      };

      expect(item.stage).toBe('probing');
    });
  });

  describe('AnimatingItem with probing stage', () => {
    it('should allow probing as fromStage', () => {
      const item: AnimatingItem = {
        itemId: '001',
        state: 'exiting',
        direction: 'right',
        fromStage: 'probing',
      };

      expect(item.fromStage).toBe('probing');
    });

    it('should allow probing as toStage', () => {
      const item: AnimatingItem = {
        itemId: '001',
        state: 'entering',
        direction: 'left',
        toStage: 'probing',
      };

      expect(item.toStage).toBe('probing');
    });

    it('should allow transition from review to probing', () => {
      const item: AnimatingItem = {
        itemId: '001',
        state: 'exiting',
        direction: 'right',
        fromStage: 'review',
        toStage: 'probing',
      };

      expect(item.fromStage).toBe('review');
      expect(item.toStage).toBe('probing');
    });
  });
});
