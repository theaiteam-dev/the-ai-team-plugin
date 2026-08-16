import { describe, it, expect } from 'vitest';
import { transformApiItemsToWorkItems, transformBoardStateToMetadata } from '@/lib/api-transform';
import type { ItemWithRelations, WorkLogEntry } from '@/types/item';
import type { BoardState } from '@/types/board';
import type { WorkItem } from '@/types';

/**
 * Tests for API data transformation utilities.
 *
 * These tests verify the transformation of API data structures to UI format,
 * specifically focusing on work_logs transformation from the new database-backed
 * API format to the frontend format.
 */

describe('transformApiItemsToWorkItems', () => {
  describe('work logs transformation', () => {
    it('should transform work logs from API camelCase to UI snake_case', () => {
      const apiWorkLogs: WorkLogEntry[] = [
        {
          id: 1,
          agent: 'B.A.',
          action: 'started',
          summary: 'Beginning implementation',
          timestamp: new Date('2026-01-15T10:00:00Z'),
        },
        {
          id: 2,
          agent: 'B.A.',
          action: 'completed',
          summary: 'Finished implementation',
          timestamp: new Date('2026-01-15T14:00:00Z'),
        },
      ];

      const apiItem: ItemWithRelations = {
        id: '001',
        title: 'Test Feature',
        description: 'Test description',
        type: 'feature',
        priority: 'high',
        stageId: 'implementing',
        assignedAgent: 'B.A.',
        rejectionCount: 0,
        createdAt: new Date('2026-01-15T09:00:00Z'),
        updatedAt: new Date('2026-01-15T15:00:00Z'),
        completedAt: null,
        outputs: {},
        dependencies: [],
        workLogs: apiWorkLogs,
      };

      const result = transformApiItemsToWorkItems([apiItem]);

      expect(result).toHaveLength(1);
      expect(result[0].work_logs).toBeDefined();
      expect(result[0].work_logs).toHaveLength(2);

      // Verify first work log entry
      expect(result[0].work_logs![0]).toEqual({
        id: 1,
        agent: 'B.A.',
        action: 'started',
        summary: 'Beginning implementation',
        timestamp: new Date('2026-01-15T10:00:00Z'),
      });

      // Verify second work log entry
      expect(result[0].work_logs![1]).toEqual({
        id: 2,
        agent: 'B.A.',
        action: 'completed',
        summary: 'Finished implementation',
        timestamp: new Date('2026-01-15T14:00:00Z'),
      });
    });

    it('should handle empty work logs array', () => {
      const apiItem: ItemWithRelations = {
        id: '002',
        title: 'Test Feature',
        description: 'Test description',
        type: 'feature',
        priority: 'high',
        stageId: 'briefings',
        assignedAgent: null,
        rejectionCount: 0,
        createdAt: new Date('2026-01-15T09:00:00Z'),
        updatedAt: new Date('2026-01-15T09:00:00Z'),
        completedAt: null,
        outputs: {},
        dependencies: [],
        workLogs: [],
      };

      const result = transformApiItemsToWorkItems([apiItem]);

      expect(result).toHaveLength(1);
      expect(result[0].work_logs).toBeDefined();
      expect(result[0].work_logs).toHaveLength(0);
    });

    it('should handle undefined work logs', () => {
      const apiItem: ItemWithRelations = {
        id: '003',
        title: 'Test Feature',
        description: 'Test description',
        type: 'feature',
        priority: 'high',
        stageId: 'ready',
        assignedAgent: null,
        rejectionCount: 0,
        createdAt: new Date('2026-01-15T09:00:00Z'),
        updatedAt: new Date('2026-01-15T09:00:00Z'),
        completedAt: null,
        outputs: {},
        dependencies: [],
        workLogs: undefined as unknown as [],
      };

      const result = transformApiItemsToWorkItems([apiItem]);

      expect(result).toHaveLength(1);
      expect(result[0].work_logs).toBeUndefined();
    });

    it('should preserve all work log action types', () => {
      const apiWorkLogs: WorkLogEntry[] = [
        {
          id: 1,
          agent: 'Hannibal',
          action: 'started',
          summary: 'Starting work',
          timestamp: new Date('2026-01-15T10:00:00Z'),
        },
        {
          id: 2,
          agent: 'Face',
          action: 'completed',
          summary: 'Work completed',
          timestamp: new Date('2026-01-15T11:00:00Z'),
        },
        {
          id: 3,
          agent: 'Murdock',
          action: 'rejected',
          summary: 'Issues found',
          timestamp: new Date('2026-01-15T12:00:00Z'),
        },
        {
          id: 4,
          agent: 'Amy',
          action: 'note',
          summary: 'Additional context',
          timestamp: new Date('2026-01-15T13:00:00Z'),
        },
      ];

      const apiItem: ItemWithRelations = {
        id: '004',
        title: 'Test Feature',
        description: 'Test description',
        type: 'feature',
        priority: 'high',
        stageId: 'review',
        assignedAgent: 'Hannibal',
        rejectionCount: 1,
        createdAt: new Date('2026-01-15T09:00:00Z'),
        updatedAt: new Date('2026-01-15T13:00:00Z'),
        completedAt: null,
        outputs: {},
        dependencies: [],
        workLogs: apiWorkLogs,
      };

      const result = transformApiItemsToWorkItems([apiItem]);

      expect(result[0].work_logs).toHaveLength(4);
      expect(result[0].work_logs![0].action).toBe('started');
      expect(result[0].work_logs![1].action).toBe('completed');
      expect(result[0].work_logs![2].action).toBe('rejected');
      expect(result[0].work_logs![3].action).toBe('note');
    });

    it('should preserve all work log fields', () => {
      const timestamp = new Date('2026-01-15T10:30:45.123Z');
      const apiWorkLogs: WorkLogEntry[] = [
        {
          id: 42,
          agent: 'B.A.',
          action: 'completed',
          summary: 'This is a detailed summary with lots of context',
          timestamp,
        },
      ];

      const apiItem: ItemWithRelations = {
        id: '005',
        title: 'Test Feature',
        description: 'Test description',
        type: 'bug',
        priority: 'critical',
        stageId: 'done',
        assignedAgent: 'B.A.',
        rejectionCount: 0,
        createdAt: new Date('2026-01-15T09:00:00Z'),
        updatedAt: new Date('2026-01-15T11:00:00Z'),
        completedAt: new Date('2026-01-15T11:00:00Z'),
        outputs: {
          impl: 'src/fix.ts',
        },
        dependencies: [],
        workLogs: apiWorkLogs,
      };

      const result = transformApiItemsToWorkItems([apiItem]);

      expect(result[0].work_logs![0]).toEqual({
        id: 42,
        agent: 'B.A.',
        action: 'completed',
        summary: 'This is a detailed summary with lots of context',
        timestamp,
      });
    });

    it('should handle multiple work logs with different agents', () => {
      const apiWorkLogs: WorkLogEntry[] = [
        {
          id: 1,
          agent: 'Hannibal',
          action: 'started',
          summary: 'Planning the approach',
          timestamp: new Date('2026-01-15T10:00:00Z'),
        },
        {
          id: 2,
          agent: 'Face',
          action: 'note',
          summary: 'Coordinating with stakeholders',
          timestamp: new Date('2026-01-15T10:30:00Z'),
        },
        {
          id: 3,
          agent: 'Murdock',
          action: 'completed',
          summary: 'Implementation finished',
          timestamp: new Date('2026-01-15T11:00:00Z'),
        },
        {
          id: 4,
          agent: 'B.A.',
          action: 'rejected',
          summary: 'Code style issues',
          timestamp: new Date('2026-01-15T11:30:00Z'),
        },
        {
          id: 5,
          agent: 'Murdock',
          action: 'completed',
          summary: 'Fixed style issues',
          timestamp: new Date('2026-01-15T12:00:00Z'),
        },
      ];

      const apiItem: ItemWithRelations = {
        id: '006',
        title: 'Complex Feature',
        description: 'Feature with multiple agents',
        type: 'feature',
        priority: 'high',
        stageId: 'done',
        assignedAgent: null,
        rejectionCount: 1,
        createdAt: new Date('2026-01-15T09:00:00Z'),
        updatedAt: new Date('2026-01-15T12:00:00Z'),
        completedAt: new Date('2026-01-15T12:00:00Z'),
        outputs: {},
        dependencies: [],
        workLogs: apiWorkLogs,
      };

      const result = transformApiItemsToWorkItems([apiItem]);

      expect(result[0].work_logs).toHaveLength(5);
      expect(result[0].work_logs!.map(log => log.agent)).toEqual([
        'Hannibal',
        'Face',
        'Murdock',
        'B.A.',
        'Murdock',
      ]);
    });

    it('should transform work logs for multiple items', () => {
      const apiItems: ItemWithRelations[] = [
        {
          id: '007',
          title: 'First Item',
          description: 'First description',
          type: 'feature',
          priority: 'high',
          stageId: 'implementing',
          assignedAgent: 'B.A.',
          rejectionCount: 0,
          createdAt: new Date('2026-01-15T09:00:00Z'),
          updatedAt: new Date('2026-01-15T10:00:00Z'),
          completedAt: null,
          outputs: {},
          dependencies: [],
          workLogs: [
            {
              id: 1,
              agent: 'B.A.',
              action: 'started',
              summary: 'First item work',
              timestamp: new Date('2026-01-15T10:00:00Z'),
            },
          ],
        },
        {
          id: '008',
          title: 'Second Item',
          description: 'Second description',
          type: 'bug',
          priority: 'medium',
          stageId: 'testing',
          assignedAgent: 'Murdock',
          rejectionCount: 0,
          createdAt: new Date('2026-01-15T09:00:00Z'),
          updatedAt: new Date('2026-01-15T11:00:00Z'),
          completedAt: null,
          outputs: {},
          dependencies: [],
          workLogs: [
            {
              id: 2,
              agent: 'Murdock',
              action: 'started',
              summary: 'Second item work',
              timestamp: new Date('2026-01-15T11:00:00Z'),
            },
          ],
        },
      ];

      const result = transformApiItemsToWorkItems(apiItems);

      expect(result).toHaveLength(2);
      expect(result[0].work_logs).toHaveLength(1);
      expect(result[0].work_logs![0].summary).toBe('First item work');
      expect(result[1].work_logs).toHaveLength(1);
      expect(result[1].work_logs![0].summary).toBe('Second item work');
    });
  });

  describe('integration with other item fields', () => {
    it('should transform work logs alongside all other item properties', () => {
      const apiItem: ItemWithRelations = {
        id: '009',
        title: 'Complete Feature',
        description: '# Feature Description\n\nComplete markdown content.',
        type: 'feature',
        priority: 'high',
        stageId: 'review',
        assignedAgent: 'Face',
        rejectionCount: 1,
        createdAt: new Date('2026-01-15T09:00:00Z'),
        updatedAt: new Date('2026-01-15T14:00:00Z'),
        completedAt: null,
        outputs: {
          impl: 'src/feature.ts',
          test: 'src/__tests__/feature.test.ts',
          types: 'src/types/feature.ts',
        },
        dependencies: ['001', '002'],
        workLogs: [
          {
            id: 1,
            agent: 'Face',
            action: 'started',
            summary: 'Starting feature implementation',
            timestamp: new Date('2026-01-15T10:00:00Z'),
          },
          {
            id: 2,
            agent: 'B.A.',
            action: 'rejected',
            summary: 'Missing test coverage',
            timestamp: new Date('2026-01-15T12:00:00Z'),
          },
          {
            id: 3,
            agent: 'Face',
            action: 'completed',
            summary: 'Added comprehensive tests',
            timestamp: new Date('2026-01-15T14:00:00Z'),
          },
        ],
      };

      const result = transformApiItemsToWorkItems([apiItem]);
      const workItem = result[0];

      // Verify all properties are correctly transformed
      expect(workItem.id).toBe('009');
      expect(workItem.title).toBe('Complete Feature');
      expect(workItem.type).toBe('feature');
      expect(workItem.assigned_agent).toBe('Face');
      expect(workItem.rejection_count).toBe(1);
      expect(workItem.dependencies).toEqual(['001', '002']);
      expect(workItem.outputs).toEqual({
        impl: 'src/feature.ts',
        test: 'src/__tests__/feature.test.ts',
        types: 'src/types/feature.ts',
      });
      expect(workItem.content).toBe('# Feature Description\n\nComplete markdown content.');

      // Verify work logs are included
      expect(workItem.work_logs).toHaveLength(3);
      expect(workItem.work_logs![0].action).toBe('started');
      expect(workItem.work_logs![1].action).toBe('rejected');
      expect(workItem.work_logs![2].action).toBe('completed');
    });
  });
});

// WI-792 AC: buildWipLimitsFromStages (private, exercised via the exported
// transformBoardStateToMetadata) must treat the staged Stage row's null
// wipLimit as unlimited — i.e. absent from wip_limits entirely, matching
// every other unlimited stage (briefings, done, blocked) — not coerced to a
// limit of 0. board-column.tsx already renders '∞' for undefined/null, so
// this pins the transform layer feeding it, consistent with the Stage row
// WI-786 seeds (staged: wipLimit null).
describe('transformBoardStateToMetadata — wip_limits (WI-792)', () => {
  function makeBoardState(stages: BoardState['stages']): BoardState {
    return {
      stages,
      items: [],
      claims: [],
      currentMission: null,
    };
  }

  it('omits staged from wip_limits when its wipLimit is null (renders as unlimited, not 0)', () => {
    const boardState = makeBoardState([
      { id: 'testing', name: 'Testing', order: 2, wipLimit: 3 },
      { id: 'staged', name: 'Staged', order: 6, wipLimit: null },
      { id: 'done', name: 'Done', order: 7, wipLimit: null },
    ]);

    const metadata = transformBoardStateToMetadata(boardState);

    expect(metadata.wip_limits.staged).toBeUndefined();
    expect(metadata.wip_limits.testing).toBe(3);
  });

  it('does not silently default staged to a hardcoded limit the way testing/implementing/review/probing do', () => {
    // buildWipLimitsFromStages hardcodes defaults ONLY for
    // testing/implementing/review/probing when the API doesn't supply them.
    // staged must never gain a default here — an unlimited stage staying
    // unlimited even when the API row is missing entirely.
    const boardState = makeBoardState([]); // no stages returned by the API at all

    const metadata = transformBoardStateToMetadata(boardState);

    expect(metadata.wip_limits.staged).toBeUndefined();
    expect(metadata.wip_limits.testing).toBe(2); // the documented hardcoded default
  });
});
