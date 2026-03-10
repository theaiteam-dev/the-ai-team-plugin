import { describe, it, expect } from 'vitest';
import type {
  WorkItem,
  WorkItemModalProps,
  RejectionHistoryEntry,
  AgentName,
} from '../types';

describe('Work Item Modal Types', () => {
  describe('RejectionHistoryEntry', () => {
    it('should have all required fields', () => {
      const entry: RejectionHistoryEntry = {
        number: 1,
        reason: 'Tests are failing',
        agent: 'Hannibal',
      };

      expect(entry.number).toBe(1);
      expect(entry.reason).toBe('Tests are failing');
      expect(entry.agent).toBe('Hannibal');
    });

    it('should accept all valid agent names', () => {
      const agents: AgentName[] = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Lynch'];

      agents.forEach((agent, index) => {
        const entry: RejectionHistoryEntry = {
          number: index + 1,
          reason: `Rejected by ${agent}`,
          agent,
        };
        expect(entry.agent).toBe(agent);
      });
    });

    it('should enforce agent type at compile time', () => {
      const invalidEntry: RejectionHistoryEntry = {
        number: 1,
        reason: 'Some reason',
        // @ts-expect-error - invalid agent name
        agent: 'InvalidAgent',
      };
      expect(invalidEntry).toBeDefined();
    });

    it('should require number field', () => {
      // @ts-expect-error - missing number field
      const missingNumber: RejectionHistoryEntry = {
        reason: 'Some reason',
        agent: 'Hannibal',
      };
      expect(missingNumber).toBeDefined();
    });

    it('should require reason field', () => {
      // @ts-expect-error - missing reason field
      const missingReason: RejectionHistoryEntry = {
        number: 1,
        agent: 'Hannibal',
      };
      expect(missingReason).toBeDefined();
    });

    it('should require agent field', () => {
      // @ts-expect-error - missing agent field
      const missingAgent: RejectionHistoryEntry = {
        number: 1,
        reason: 'Some reason',
      };
      expect(missingAgent).toBeDefined();
    });
  });

  describe('WorkItemModalProps', () => {
    const createMockWorkItem = (): WorkItem => ({
      id: '001',
      title: 'Test Item',
      type: 'feature',
      status: 'ready',
      rejection_count: 0,
      dependencies: [],
      outputs: {},
      created_at: '2026-01-15T00:00:00Z',
      updated_at: '2026-01-15T00:00:00Z',
      stage: 'briefings',
      content: 'Test content',
    });

    it('should have all required fields', () => {
      const closeFn = () => {};
      const props: WorkItemModalProps = {
        item: createMockWorkItem(),
        isOpen: true,
        onClose: closeFn,
      };

      expect(props.item).toBeDefined();
      expect(props.isOpen).toBe(true);
      expect(props.onClose).toBe(closeFn);
    });

    it('should accept isOpen as false', () => {
      const props: WorkItemModalProps = {
        item: createMockWorkItem(),
        isOpen: false,
        onClose: () => {},
      };

      expect(props.isOpen).toBe(false);
    });

    it('should require item field', () => {
      // @ts-expect-error - missing item field
      const missingItem: WorkItemModalProps = {
        isOpen: true,
        onClose: () => {},
      };
      expect(missingItem).toBeDefined();
    });

    it('should require isOpen field', () => {
      // @ts-expect-error - missing isOpen field
      const missingIsOpen: WorkItemModalProps = {
        item: createMockWorkItem(),
        onClose: () => {},
      };
      expect(missingIsOpen).toBeDefined();
    });

    it('should require onClose field', () => {
      // @ts-expect-error - missing onClose field
      const missingOnClose: WorkItemModalProps = {
        item: createMockWorkItem(),
        isOpen: true,
      };
      expect(missingOnClose).toBeDefined();
    });

    it('should enforce onClose as a function with no parameters and void return', () => {
      const invalidOnClose: WorkItemModalProps = {
        item: createMockWorkItem(),
        isOpen: true,
        // @ts-expect-error - onClose should not accept parameters
        onClose: (param: string) => param,
      };
      expect(invalidOnClose).toBeDefined();
    });
  });

  describe('WorkItem with rejection_history', () => {
    it('should allow WorkItem without rejection_history', () => {
      const item: WorkItem = {
        id: '001',
        title: 'Test Item',
        type: 'feature',
        status: 'ready',
        rejection_count: 0,
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'briefings',
        content: 'Test content',
      };

      expect(item.rejection_history).toBeUndefined();
    });

    it('should allow WorkItem with empty rejection_history array', () => {
      const item: WorkItem = {
        id: '002',
        title: 'Test Item',
        type: 'feature',
        status: 'ready',
        rejection_count: 0,
        rejection_history: [],
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'briefings',
        content: 'Test content',
      };

      expect(item.rejection_history).toEqual([]);
      expect(item.rejection_history?.length).toBe(0);
    });

    it('should allow WorkItem with populated rejection_history', () => {
      const item: WorkItem = {
        id: '003',
        title: 'Rejected Item',
        type: 'feature',
        status: 'ready',
        rejection_count: 2,
        rejection_history: [
          { number: 1, reason: 'Missing unit tests', agent: 'Murdock' },
          { number: 2, reason: 'Code style issues', agent: 'Hannibal' },
        ],
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'review',
        content: 'Test content',
      };

      expect(item.rejection_history).toHaveLength(2);
      expect(item.rejection_history?.[0].number).toBe(1);
      expect(item.rejection_history?.[0].reason).toBe('Missing unit tests');
      expect(item.rejection_history?.[0].agent).toBe('Murdock');
      expect(item.rejection_history?.[1].number).toBe(2);
      expect(item.rejection_history?.[1].agent).toBe('Hannibal');
    });

    it('should maintain consistency between rejection_count and rejection_history length', () => {
      const rejectionHistory: RejectionHistoryEntry[] = [
        { number: 1, reason: 'First rejection', agent: 'Hannibal' },
        { number: 2, reason: 'Second rejection', agent: 'Face' },
        { number: 3, reason: 'Third rejection', agent: 'B.A.' },
      ];

      const item: WorkItem = {
        id: '004',
        title: 'Multi-rejected Item',
        type: 'bug',
        status: 'review',
        rejection_count: rejectionHistory.length,
        rejection_history: rejectionHistory,
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'review',
        content: 'Test content',
      };

      expect(item.rejection_count).toBe(item.rejection_history?.length);
    });
  });

  describe('Type exports', () => {
    it('should export RejectionHistoryEntry type', () => {
      const entry: RejectionHistoryEntry = {
        number: 1,
        reason: 'Test',
        agent: 'Hannibal',
      };
      expect(entry).toBeDefined();
    });

    it('should export WorkItemModalProps type', () => {
      const props: WorkItemModalProps = {
        item: {
          id: '001',
          title: 'Test',
          type: 'feature',
          status: 'ready',
          rejection_count: 0,
          dependencies: [],
          outputs: {},
          created_at: '2026-01-15T00:00:00Z',
          updated_at: '2026-01-15T00:00:00Z',
          stage: 'briefings',
          content: 'Content',
        },
        isOpen: true,
        onClose: () => {},
      };
      expect(props).toBeDefined();
    });
  });
});
