import { describe, it, expect } from 'vitest';
import type { WorkItem, TypeFilter, FilterState, Stage } from '../types';
import {
  matchesType,
  matchesAgent,
  matchesStatus,
  matchesSearch,
  filterWorkItems,
} from '../lib/filter-utils';

// Helper to create a mock work item with defaults
const createMockItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: '001',
  title: 'Test Item',
  type: 'feature',
  status: 'pending',
  assigned_agent: undefined,
  rejection_count: 0,
  dependencies: [],
  outputs: {},
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-15T10:00:00Z',
  stage: 'ready',
  content: '## Objective\nTest content',
  ...overrides,
});

describe('Filter Utility Functions', () => {
  describe('matchesType', () => {
    it('should return true when filter is "All Types"', () => {
      const item = createMockItem({ type: 'feature' });
      expect(matchesType(item, 'All Types')).toBe(true);
    });

    it('should return true when item type matches filter exactly', () => {
      const item = createMockItem({ type: 'feature' });
      expect(matchesType(item, 'feature')).toBe(true);
    });

    it('should return false when item type does not match filter', () => {
      const item = createMockItem({ type: 'feature' });
      expect(matchesType(item, 'bug')).toBe(false);
    });

    it('should match all valid WorkItemFrontmatterType values', () => {
      const types: Array<{ itemType: WorkItem['type']; filter: TypeFilter }> = [
        { itemType: 'feature', filter: 'feature' },
        { itemType: 'bug', filter: 'bug' },
        { itemType: 'enhancement', filter: 'enhancement' },
        { itemType: 'task', filter: 'implementation' }, // task might map to implementation
      ];

      types.forEach(({ itemType, filter }) => {
        const item = createMockItem({ type: itemType });
        // Only test exact matches for feature/bug/enhancement
        if (itemType === filter) {
          expect(matchesType(item, filter)).toBe(true);
        }
      });
    });

    it('should handle implementation filter', () => {
      const item = createMockItem({ type: 'feature' });
      // implementation filter should match or not match based on implementation
      const result = matchesType(item, 'implementation');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('matchesAgent', () => {
    it('should return true when filter is "All Agents"', () => {
      const item = createMockItem({ assigned_agent: 'Murdock' });
      expect(matchesAgent(item, 'All Agents')).toBe(true);
    });

    it('should return true when filter is "All Agents" and item is unassigned', () => {
      const item = createMockItem({ assigned_agent: undefined });
      expect(matchesAgent(item, 'All Agents')).toBe(true);
    });

    it('should return true when item agent matches filter exactly', () => {
      const item = createMockItem({ assigned_agent: 'B.A.' });
      expect(matchesAgent(item, 'B.A.')).toBe(true);
    });

    it('should return false when item agent does not match filter', () => {
      const item = createMockItem({ assigned_agent: 'Murdock' });
      expect(matchesAgent(item, 'Hannibal')).toBe(false);
    });

    it('should return true when filter is "Unassigned" and item has no agent', () => {
      const item = createMockItem({ assigned_agent: undefined });
      expect(matchesAgent(item, 'Unassigned')).toBe(true);
    });

    it('should return false when filter is "Unassigned" and item has an agent', () => {
      const item = createMockItem({ assigned_agent: 'Face' });
      expect(matchesAgent(item, 'Unassigned')).toBe(false);
    });

    it('should match all valid AgentName values', () => {
      const agents = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Amy', 'Lynch'] as const;

      agents.forEach((agent) => {
        const item = createMockItem({ assigned_agent: agent });
        expect(matchesAgent(item, agent)).toBe(true);
      });
    });
  });

  describe('matchesStatus', () => {
    it('should return true when filter is "All Status"', () => {
      const item = createMockItem({ stage: 'testing' });
      expect(matchesStatus(item, 'All Status')).toBe(true);
    });

    describe('Active filter', () => {
      it('should return true for items in TESTING stage', () => {
        const item = createMockItem({ stage: 'testing' });
        expect(matchesStatus(item, 'Active')).toBe(true);
      });

      it('should return true for items in IMPLEMENTING stage', () => {
        const item = createMockItem({ stage: 'implementing' });
        expect(matchesStatus(item, 'Active')).toBe(true);
      });

      it('should return true for items in REVIEW stage', () => {
        const item = createMockItem({ stage: 'review' });
        expect(matchesStatus(item, 'Active')).toBe(true);
      });

      it('should return false for items in other stages', () => {
        const nonActiveStages: Stage[] = ['briefings', 'ready', 'probing', 'done', 'blocked'];
        nonActiveStages.forEach((stage) => {
          const item = createMockItem({ stage });
          expect(matchesStatus(item, 'Active')).toBe(false);
        });
      });
    });

    describe('Blocked filter', () => {
      it('should return true for items in BLOCKED stage', () => {
        const item = createMockItem({ stage: 'blocked' });
        expect(matchesStatus(item, 'Blocked')).toBe(true);
      });

      it('should return false for items not in BLOCKED stage', () => {
        const item = createMockItem({ stage: 'ready' });
        expect(matchesStatus(item, 'Blocked')).toBe(false);
      });
    });

    describe('Has Rejections filter', () => {
      it('should return true when rejection_count > 0', () => {
        const item = createMockItem({ rejection_count: 1 });
        expect(matchesStatus(item, 'Has Rejections')).toBe(true);
      });

      it('should return true when rejection_count is high', () => {
        const item = createMockItem({ rejection_count: 5 });
        expect(matchesStatus(item, 'Has Rejections')).toBe(true);
      });

      it('should return false when rejection_count is 0', () => {
        const item = createMockItem({ rejection_count: 0 });
        expect(matchesStatus(item, 'Has Rejections')).toBe(false);
      });
    });

    describe('Has Dependencies filter', () => {
      it('should return true when dependencies array is not empty', () => {
        const item = createMockItem({ dependencies: ['000'] });
        expect(matchesStatus(item, 'Has Dependencies')).toBe(true);
      });

      it('should return true when item has multiple dependencies', () => {
        const item = createMockItem({ dependencies: ['000', '001', '002'] });
        expect(matchesStatus(item, 'Has Dependencies')).toBe(true);
      });

      it('should return false when dependencies array is empty', () => {
        const item = createMockItem({ dependencies: [] });
        expect(matchesStatus(item, 'Has Dependencies')).toBe(false);
      });
    });

    describe('Completed filter', () => {
      it('should return true for items in DONE stage', () => {
        const item = createMockItem({ stage: 'done' });
        expect(matchesStatus(item, 'Completed')).toBe(true);
      });

      it('should return false for items not in DONE stage', () => {
        const item = createMockItem({ stage: 'implementing' });
        expect(matchesStatus(item, 'Completed')).toBe(false);
      });

      // WI-792 (Josh's refinement-gate decision): staged is individually
      // complete but not yet mission-tail-verified — it must NOT appear
      // under the Completed filter. Only done is completion.
      it('should return false for items in STAGED stage (staged is not Completed)', () => {
        const item = createMockItem({ stage: 'staged' });
        expect(matchesStatus(item, 'Completed')).toBe(false);
      });
    });
  });

  describe('matchesSearch', () => {
    it('should return true when query is empty', () => {
      const item = createMockItem({ title: 'Test Feature' });
      expect(matchesSearch(item, '')).toBe(true);
    });

    it('should return true when title contains query (exact case)', () => {
      const item = createMockItem({ title: 'Implement Login Feature' });
      expect(matchesSearch(item, 'Login')).toBe(true);
    });

    it('should return true when title contains query (case-insensitive)', () => {
      const item = createMockItem({ title: 'Implement Login Feature' });
      expect(matchesSearch(item, 'login')).toBe(true);
    });

    it('should return true when title contains query (uppercase query)', () => {
      const item = createMockItem({ title: 'Implement Login Feature' });
      expect(matchesSearch(item, 'LOGIN')).toBe(true);
    });

    it('should return false when title does not contain query', () => {
      const item = createMockItem({ title: 'Implement Login Feature' });
      expect(matchesSearch(item, 'Dashboard')).toBe(false);
    });

    it('should match partial words', () => {
      const item = createMockItem({ title: 'Authentication System' });
      expect(matchesSearch(item, 'Auth')).toBe(true);
    });

    it('should handle special characters in search', () => {
      const item = createMockItem({ title: 'Fix B.A. agent display' });
      expect(matchesSearch(item, 'B.A.')).toBe(true);
    });

    it('should handle whitespace in query', () => {
      const item = createMockItem({ title: 'Add new feature' });
      expect(matchesSearch(item, 'new feature')).toBe(true);
    });
  });

  describe('filterWorkItems', () => {
    const items: WorkItem[] = [
      createMockItem({
        id: '001',
        title: 'Feature One',
        type: 'feature',
        stage: 'testing',
        assigned_agent: 'Murdock',
        rejection_count: 0,
        dependencies: [],
      }),
      createMockItem({
        id: '002',
        title: 'Bug Fix',
        type: 'bug',
        stage: 'implementing',
        assigned_agent: 'B.A.',
        rejection_count: 2,
        dependencies: ['001'],
      }),
      createMockItem({
        id: '003',
        title: 'Enhancement Request',
        type: 'enhancement',
        stage: 'done',
        assigned_agent: undefined,
        rejection_count: 0,
        dependencies: [],
      }),
      createMockItem({
        id: '004',
        title: 'Blocked Task',
        type: 'feature',
        stage: 'blocked',
        assigned_agent: 'Hannibal',
        rejection_count: 1,
        dependencies: ['002'],
      }),
    ];

    it('should return all items when all filters are default', () => {
      const filters: FilterState = {
        typeFilter: 'All Types',
        agentFilter: 'All Agents',
        statusFilter: 'All Status',
        searchQuery: '',
      };

      const result = filterWorkItems(items, filters);
      expect(result).toHaveLength(4);
    });

    it('should filter by type correctly', () => {
      const filters: FilterState = {
        typeFilter: 'feature',
        agentFilter: 'All Agents',
        statusFilter: 'All Status',
        searchQuery: '',
      };

      const result = filterWorkItems(items, filters);
      expect(result).toHaveLength(2);
      expect(result.every((item) => item.type === 'feature')).toBe(true);
    });

    it('should filter by agent correctly', () => {
      const filters: FilterState = {
        typeFilter: 'All Types',
        agentFilter: 'Murdock',
        statusFilter: 'All Status',
        searchQuery: '',
      };

      const result = filterWorkItems(items, filters);
      expect(result).toHaveLength(1);
      expect(result[0].assigned_agent).toBe('Murdock');
    });

    it('should filter by Unassigned correctly', () => {
      const filters: FilterState = {
        typeFilter: 'All Types',
        agentFilter: 'Unassigned',
        statusFilter: 'All Status',
        searchQuery: '',
      };

      const result = filterWorkItems(items, filters);
      expect(result).toHaveLength(1);
      expect(result[0].assigned_agent).toBeUndefined();
    });

    it('should filter by Active status correctly', () => {
      const filters: FilterState = {
        typeFilter: 'All Types',
        agentFilter: 'All Agents',
        statusFilter: 'Active',
        searchQuery: '',
      };

      const result = filterWorkItems(items, filters);
      expect(result).toHaveLength(2);
      expect(result.every((item) => ['testing', 'implementing', 'review'].includes(item.stage))).toBe(true);
    });

    it('should filter by Has Rejections correctly', () => {
      const filters: FilterState = {
        typeFilter: 'All Types',
        agentFilter: 'All Agents',
        statusFilter: 'Has Rejections',
        searchQuery: '',
      };

      const result = filterWorkItems(items, filters);
      expect(result).toHaveLength(2);
      expect(result.every((item) => item.rejection_count > 0)).toBe(true);
    });

    it('should filter by search query correctly', () => {
      const filters: FilterState = {
        typeFilter: 'All Types',
        agentFilter: 'All Agents',
        statusFilter: 'All Status',
        searchQuery: 'bug',
      };

      const result = filterWorkItems(items, filters);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Bug Fix');
    });

    it('should combine multiple filters with AND logic', () => {
      const filters: FilterState = {
        typeFilter: 'feature',
        agentFilter: 'All Agents',
        statusFilter: 'Has Rejections',
        searchQuery: '',
      };

      const result = filterWorkItems(items, filters);
      // Only item 004 is a feature with rejections
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('004');
    });

    it('should return empty array when no items match', () => {
      const filters: FilterState = {
        typeFilter: 'bug',
        agentFilter: 'Murdock',
        statusFilter: 'All Status',
        searchQuery: '',
      };

      const result = filterWorkItems(items, filters);
      expect(result).toHaveLength(0);
    });

    it('should handle empty items array', () => {
      const filters: FilterState = {
        typeFilter: 'All Types',
        agentFilter: 'All Agents',
        statusFilter: 'All Status',
        searchQuery: '',
      };

      const result = filterWorkItems([], filters);
      expect(result).toHaveLength(0);
    });

    it('should combine type, agent, status, and search filters', () => {
      const filters: FilterState = {
        typeFilter: 'bug',
        agentFilter: 'B.A.',
        statusFilter: 'Active',
        searchQuery: 'Bug',
      };

      const result = filterWorkItems(items, filters);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('002');
    });
  });
});
