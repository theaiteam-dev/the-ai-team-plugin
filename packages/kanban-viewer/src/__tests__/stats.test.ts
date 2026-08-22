import { describe, it, expect } from 'vitest';
import {
  calculateBoardStats,
  getWipStatus,
  isOverWipLimit,
  calculateProgress,
} from '../lib/stats';
import type { WorkItem, Stage } from '../types';

// Helper to create a minimal work item for testing
function createWorkItem(id: string, stage: Stage): WorkItem {
  return {
    id,
    title: `Test Item ${id}`,
    type: 'feature',
    status: 'active',
    rejection_count: 0,
    dependencies: [],
    outputs: {},
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    stage,
    content: '',
  };
}

describe('Board Statistics Calculator', () => {
  describe('calculateBoardStats', () => {
    it('should compute correct stats for a board with items in various stages', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'briefings'),
        createWorkItem('002', 'briefings'),
        createWorkItem('003', 'ready'),
        createWorkItem('004', 'testing'),
        createWorkItem('005', 'implementing'),
        createWorkItem('006', 'implementing'),
        createWorkItem('007', 'review'),
        createWorkItem('008', 'done'),
        createWorkItem('009', 'done'),
        createWorkItem('010', 'done'),
        createWorkItem('011', 'blocked'),
      ];

      const stats = calculateBoardStats(items);

      expect(stats.total_items).toBe(11);
      expect(stats.completed).toBe(3); // done
      expect(stats.in_progress).toBe(4); // testing + implementing + review
      expect(stats.blocked).toBe(1);
      expect(stats.backlog).toBe(3); // briefings + ready
    });

    it('should handle empty board with zero items', () => {
      const items: WorkItem[] = [];

      const stats = calculateBoardStats(items);

      expect(stats.total_items).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.in_progress).toBe(0);
      expect(stats.blocked).toBe(0);
      expect(stats.backlog).toBe(0);
    });

    it('should count items per stage correctly', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'testing'),
        createWorkItem('002', 'testing'),
        createWorkItem('003', 'testing'),
      ];

      const stats = calculateBoardStats(items);

      expect(stats.total_items).toBe(3);
      expect(stats.in_progress).toBe(3);
      expect(stats.completed).toBe(0);
      expect(stats.blocked).toBe(0);
      expect(stats.backlog).toBe(0);
    });

    it('should categorize briefings as backlog', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'briefings'),
        createWorkItem('002', 'briefings'),
      ];

      const stats = calculateBoardStats(items);

      expect(stats.backlog).toBe(2);
      expect(stats.in_progress).toBe(0);
    });

    it('should categorize ready as backlog', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'ready'),
        createWorkItem('002', 'ready'),
      ];

      const stats = calculateBoardStats(items);

      expect(stats.backlog).toBe(2);
      expect(stats.in_progress).toBe(0);
    });

    it('should categorize testing, implementing, review as in_progress', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'testing'),
        createWorkItem('002', 'implementing'),
        createWorkItem('003', 'review'),
      ];

      const stats = calculateBoardStats(items);

      expect(stats.in_progress).toBe(3);
      expect(stats.backlog).toBe(0);
    });
  });

  describe('getWipStatus', () => {
    const wipLimits: Record<string, number> = {
      testing: 2,
      implementing: 3,
      review: 2,
    };

    it('should return current count and limit for a stage', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'testing'),
        createWorkItem('002', 'testing'),
      ];

      const status = getWipStatus('testing', items, wipLimits);

      expect(status.current).toBe(2);
      expect(status.limit).toBe(2);
    });

    it('should return 0 current when no items in stage', () => {
      const items: WorkItem[] = [];

      const status = getWipStatus('testing', items, wipLimits);

      expect(status.current).toBe(0);
      expect(status.limit).toBe(2);
    });

    it('should return undefined limit for stages without WIP limits', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'briefings'),
      ];

      const status = getWipStatus('briefings', items, wipLimits);

      expect(status.current).toBe(1);
      expect(status.limit).toBeUndefined();
    });

    it('should count only items in the specified stage', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'testing'),
        createWorkItem('002', 'implementing'),
        createWorkItem('003', 'implementing'),
        createWorkItem('004', 'implementing'),
        createWorkItem('005', 'review'),
      ];

      expect(getWipStatus('testing', items, wipLimits)).toEqual({ current: 1, limit: 2 });
      expect(getWipStatus('implementing', items, wipLimits)).toEqual({ current: 3, limit: 3 });
      expect(getWipStatus('review', items, wipLimits)).toEqual({ current: 1, limit: 2 });
    });
  });

  describe('isOverWipLimit', () => {
    const wipLimits: Record<string, number> = {
      testing: 2,
      implementing: 3,
      review: 2,
    };

    it('should return true when stage exceeds WIP limit', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'testing'),
        createWorkItem('002', 'testing'),
        createWorkItem('003', 'testing'), // Over limit of 2
      ];

      expect(isOverWipLimit('testing', items, wipLimits)).toBe(true);
    });

    it('should return false when stage is at WIP limit', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'testing'),
        createWorkItem('002', 'testing'), // At limit of 2
      ];

      expect(isOverWipLimit('testing', items, wipLimits)).toBe(false);
    });

    it('should return false when stage is under WIP limit', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'testing'), // Under limit of 2
      ];

      expect(isOverWipLimit('testing', items, wipLimits)).toBe(false);
    });

    it('should return false for stages without WIP limits', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'briefings'),
        createWorkItem('002', 'briefings'),
        createWorkItem('003', 'briefings'),
        createWorkItem('004', 'briefings'),
        createWorkItem('005', 'briefings'),
      ];

      expect(isOverWipLimit('briefings', items, wipLimits)).toBe(false);
    });

    it('should return false for empty stage', () => {
      const items: WorkItem[] = [];

      expect(isOverWipLimit('testing', items, wipLimits)).toBe(false);
    });
  });

  describe('calculateProgress', () => {
    it('should return percentage complete as done/total', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'done'),
        createWorkItem('002', 'done'),
        createWorkItem('003', 'testing'),
        createWorkItem('004', 'implementing'),
      ];

      expect(calculateProgress(items)).toBe(50); // 2 done out of 4
    });

    it('should return 0 for empty board', () => {
      const items: WorkItem[] = [];

      expect(calculateProgress(items)).toBe(0);
    });

    it('should return 100 when all items are done', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'done'),
        createWorkItem('002', 'done'),
        createWorkItem('003', 'done'),
      ];

      expect(calculateProgress(items)).toBe(100);
    });

    it('should return 0 when no items are done', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'testing'),
        createWorkItem('002', 'implementing'),
        createWorkItem('003', 'review'),
      ];

      expect(calculateProgress(items)).toBe(0);
    });

    it('should handle fractional percentages', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'done'),
        createWorkItem('002', 'testing'),
        createWorkItem('003', 'implementing'),
      ];

      // 1 out of 3 = 33.333...%
      const progress = calculateProgress(items);
      expect(progress).toBeCloseTo(33.33, 1);
    });
  });

  // WI-792 (Josh's refinement-gate decision): staged does NOT count as
  // Completed — only done is completion. staged counts as in-progress in
  // the stats breakdown (awaiting mission-tail verification, not yet
  // sealed).
  describe('staged stage handling (WI-792)', () => {
    it('calculateBoardStats counts a staged item as in_progress, not completed', () => {
      const items: WorkItem[] = [createWorkItem('001', 'staged')];
      const stats = calculateBoardStats(items);

      expect(stats.completed).toBe(0);
      expect(stats.in_progress).toBe(1);
    });

    it('calculateBoardStats buckets sum to total_items even when items are staged (no item goes uncounted)', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'staged'),
        createWorkItem('002', 'done'),
        createWorkItem('003', 'testing'),
        createWorkItem('004', 'blocked'),
        createWorkItem('005', 'briefings'),
      ];
      const stats = calculateBoardStats(items);

      expect(stats.total_items).toBe(5);
      expect(stats.completed + stats.in_progress + stats.blocked + stats.backlog).toBe(5);
    });

    it('calculateProgress treats a fully-staged board as 0% complete (only done counts)', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'staged'),
        createWorkItem('002', 'staged'),
        createWorkItem('003', 'staged'),
      ];

      expect(calculateProgress(items)).toBe(0);
    });

    it('calculateProgress excludes staged items from the numerator even alongside done items', () => {
      const items: WorkItem[] = [
        createWorkItem('001', 'done'),
        createWorkItem('002', 'staged'),
        createWorkItem('003', 'staged'),
      ];

      // 1 of 3 done = 33.33%, not 100% and not counting staged as done.
      expect(calculateProgress(items)).toBeCloseTo(33.33, 1);
    });
  });
});
