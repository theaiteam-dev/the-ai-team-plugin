import { describe, it, expect } from 'vitest';
import type {
  WorkItem,
  BoardMetadata,
  BoardEvent,
  BoardEventType,
  AgentName,
  AgentStatus,
  Stage,
  WorkItemType,
} from '../types';

describe('Type Definitions', () => {
  describe('AgentName', () => {
    it('should accept valid agent names', () => {
      const hannibal: AgentName = 'Hannibal';
      const face: AgentName = 'Face';
      const murdock: AgentName = 'Murdock';
      const ba: AgentName = 'B.A.';
      const lynch: AgentName = 'Lynch';

      expect(hannibal).toBe('Hannibal');
      expect(face).toBe('Face');
      expect(murdock).toBe('Murdock');
      expect(ba).toBe('B.A.');
      expect(lynch).toBe('Lynch');
    });

    it('should be compile-time type safe', () => {
      // @ts-expect-error - invalid agent name
      const invalid: AgentName = 'InvalidAgent';
      expect(invalid).toBeDefined();
    });
  });

  describe('AgentStatus', () => {
    it('should accept valid agent statuses', () => {
      const watching: AgentStatus = 'watching';
      const active: AgentStatus = 'active';
      const idle: AgentStatus = 'idle';

      expect(watching).toBe('watching');
      expect(active).toBe('active');
      expect(idle).toBe('idle');
    });

    it('should be compile-time type safe', () => {
      // @ts-expect-error - invalid status
      const invalid: AgentStatus = 'busy';
      expect(invalid).toBeDefined();
    });
  });

  describe('Stage', () => {
    it('should accept valid stage names', () => {
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

    it('should be compile-time type safe', () => {
      // @ts-expect-error - invalid stage
      const invalid: Stage = 'pending';
      expect(invalid).toBeDefined();
    });
  });

  describe('WorkItemType', () => {
    it('should accept valid work item types', () => {
      const implementation: WorkItemType = 'implementation';
      const interfaceType: WorkItemType = 'interface';
      const integration: WorkItemType = 'integration';
      const test: WorkItemType = 'test';

      expect(implementation).toBe('implementation');
      expect(interfaceType).toBe('interface');
      expect(integration).toBe('integration');
      expect(test).toBe('test');
    });

    it('should be compile-time type safe', () => {
      // @ts-expect-error - invalid type
      const invalid: WorkItemType = 'deployment';
      expect(invalid).toBeDefined();
    });
  });

  describe('BoardEventType', () => {
    it('should accept valid board event types', () => {
      const itemAdded: BoardEventType = 'item-added';
      const itemMoved: BoardEventType = 'item-moved';
      const itemUpdated: BoardEventType = 'item-updated';
      const itemDeleted: BoardEventType = 'item-deleted';
      const boardUpdated: BoardEventType = 'board-updated';

      expect(itemAdded).toBe('item-added');
      expect(itemMoved).toBe('item-moved');
      expect(itemUpdated).toBe('item-updated');
      expect(itemDeleted).toBe('item-deleted');
      expect(boardUpdated).toBe('board-updated');
    });

    it('should be compile-time type safe', () => {
      // @ts-expect-error - invalid event type
      const invalid: BoardEventType = 'item-created';
      expect(invalid).toBeDefined();
    });
  });

  describe('WorkItem', () => {
    it('should have all required fields', () => {
      const workItem: WorkItem = {
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

      expect(workItem.id).toBe('001');
      expect(workItem.title).toBe('Test Item');
      expect(workItem.type).toBe('feature');
      expect(workItem.status).toBe('ready');
      expect(workItem.rejection_count).toBe(0);
      expect(workItem.dependencies).toEqual([]);
      expect(workItem.outputs).toEqual({});
      expect(workItem.created_at).toBe('2026-01-15T00:00:00Z');
      expect(workItem.updated_at).toBe('2026-01-15T00:00:00Z');
      expect(workItem.stage).toBe('briefings');
      expect(workItem.content).toBe('Test content');
    });

    it('should support optional assigned_agent field', () => {
      const withAgent: WorkItem = {
        id: '002',
        title: 'Assigned Item',
        type: 'task',
        status: 'active',
        assigned_agent: 'Hannibal',
        rejection_count: 0,
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'implementing',
        content: 'Content',
      };

      expect(withAgent.assigned_agent).toBe('Hannibal');

      const withoutAgent: WorkItem = {
        id: '003',
        title: 'Unassigned Item',
        type: 'bug',
        status: 'ready',
        rejection_count: 0,
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'ready',
        content: 'Content',
      };

      expect(withoutAgent.assigned_agent).toBeUndefined();
    });

    it('should support all work item types', () => {
      const types: WorkItem['type'][] = ['feature', 'bug', 'enhancement', 'task'];

      types.forEach((type) => {
        const item: WorkItem = {
          id: '004',
          title: 'Item',
          type,
          status: 'ready',
          rejection_count: 0,
          dependencies: [],
          outputs: {},
          created_at: '2026-01-15T00:00:00Z',
          updated_at: '2026-01-15T00:00:00Z',
          stage: 'ready',
          content: 'Content',
        };
        expect(item.type).toBe(type);
      });
    });

    it('should handle outputs with optional fields', () => {
      const withAllOutputs: WorkItem = {
        id: '005',
        title: 'Full Outputs',
        type: 'feature',
        status: 'done',
        rejection_count: 0,
        dependencies: [],
        outputs: {
          test: 'src/__tests__/feature.test.ts',
          impl: 'src/feature.ts',
          types: 'src/types/feature.ts',
        },
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'done',
        content: 'Content',
      };

      expect(withAllOutputs.outputs.test).toBe('src/__tests__/feature.test.ts');
      expect(withAllOutputs.outputs.impl).toBe('src/feature.ts');
      expect(withAllOutputs.outputs.types).toBe('src/types/feature.ts');
    });

    it('should handle empty dependencies array', () => {
      const noDeps: WorkItem = {
        id: '006',
        title: 'No Dependencies',
        type: 'task',
        status: 'ready',
        rejection_count: 0,
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'ready',
        content: 'Content',
      };

      expect(noDeps.dependencies).toEqual([]);
      expect(noDeps.dependencies.length).toBe(0);
    });
  });

  describe('BoardMetadata', () => {
    it('should have all required fields', () => {
      const metadata: BoardMetadata = {
        mission: {
          name: 'Test Mission',
          started_at: '2026-01-15T00:00:00Z',
          status: 'active',
        },
        wip_limits: {
          implementing: 2,
          testing: 1,
        },
        phases: {
          development: ['briefings', 'ready', 'testing'],
        },
        assignments: {
          '001': {
            agent: 'Hannibal',
            task_id: '001',
            started_at: '2026-01-15T00:00:00Z',
          },
        },
        agents: {
          Hannibal: {
            status: 'active',
            current_item: '001',
          },
        },
        stats: {
          total_items: 10,
          completed: 5,
          in_progress: 3,
          blocked: 1,
          backlog: 1,
        },
        last_updated: '2026-01-15T00:00:00Z',
      };

      expect(metadata.mission.name).toBe('Test Mission');
      expect(metadata.mission.status).toBe('active');
      expect(metadata.stats.total_items).toBe(10);
      expect(metadata.last_updated).toBe('2026-01-15T00:00:00Z');
    });

    it('should support all mission statuses', () => {
      const statuses: BoardMetadata['mission']['status'][] = ['active', 'paused', 'completed'];

      statuses.forEach((status) => {
        const metadata: BoardMetadata = {
          mission: {
            name: 'Mission',
            started_at: '2026-01-15T00:00:00Z',
            status,
          },
          wip_limits: {},
          phases: {},
          assignments: {},
          agents: {},
          stats: {
            total_items: 0,
            completed: 0,
            in_progress: 0,
            blocked: 0,
            backlog: 0,
          },
          last_updated: '2026-01-15T00:00:00Z',
        };
        expect(metadata.mission.status).toBe(status);
      });
    });

    it('should handle empty Records', () => {
      const minimal: BoardMetadata = {
        mission: {
          name: 'Minimal Mission',
          started_at: '2026-01-15T00:00:00Z',
          status: 'active',
        },
        wip_limits: {},
        phases: {},
        assignments: {},
        agents: {},
        stats: {
          total_items: 0,
          completed: 0,
          in_progress: 0,
          blocked: 0,
          backlog: 0,
        },
        last_updated: '2026-01-15T00:00:00Z',
      };

      expect(Object.keys(minimal.wip_limits)).toHaveLength(0);
      expect(Object.keys(minimal.phases)).toHaveLength(0);
      expect(Object.keys(minimal.assignments)).toHaveLength(0);
      expect(Object.keys(minimal.agents)).toHaveLength(0);
    });

    it('should support optional current_item in agent status', () => {
      const withItem: BoardMetadata = {
        mission: {
          name: 'Mission',
          started_at: '2026-01-15T00:00:00Z',
          status: 'active',
        },
        wip_limits: {},
        phases: {},
        assignments: {},
        agents: {
          Hannibal: {
            status: 'active',
            current_item: '001',
          },
          Face: {
            status: 'idle',
          },
        },
        stats: {
          total_items: 0,
          completed: 0,
          in_progress: 0,
          blocked: 0,
          backlog: 0,
        },
        last_updated: '2026-01-15T00:00:00Z',
      };

      expect(withItem.agents.Hannibal.current_item).toBe('001');
      expect(withItem.agents.Face.current_item).toBeUndefined();
    });
  });

  describe('BoardEvent', () => {
    it('should support item-added event', () => {
      const item: WorkItem = {
        id: '001',
        title: 'New Item',
        type: 'feature',
        status: 'ready',
        rejection_count: 0,
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'briefings',
        content: 'Content',
      };

      const event: BoardEvent = {
        type: 'item-added',
        timestamp: '2026-01-15T00:00:00Z',
        data: {
          itemId: '001',
          item,
        },
      };

      expect(event.type).toBe('item-added');
      expect(event.data.itemId).toBe('001');
      expect(event.data.item).toBe(item);
    });

    it('should support item-moved event', () => {
      const event: BoardEvent = {
        type: 'item-moved',
        timestamp: '2026-01-15T00:00:00Z',
        data: {
          itemId: '001',
          fromStage: 'ready',
          toStage: 'testing',
        },
      };

      expect(event.type).toBe('item-moved');
      expect(event.data.fromStage).toBe('ready');
      expect(event.data.toStage).toBe('testing');
    });

    it('should support item-updated event', () => {
      const item: WorkItem = {
        id: '001',
        title: 'Updated Item',
        type: 'feature',
        status: 'in-progress',
        rejection_count: 0,
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T01:00:00Z',
        stage: 'implementing',
        content: 'Updated content',
      };

      const event: BoardEvent = {
        type: 'item-updated',
        timestamp: '2026-01-15T01:00:00Z',
        data: {
          itemId: '001',
          item,
        },
      };

      expect(event.type).toBe('item-updated');
      expect(event.data.item?.title).toBe('Updated Item');
    });

    it('should support item-deleted event', () => {
      const event: BoardEvent = {
        type: 'item-deleted',
        timestamp: '2026-01-15T00:00:00Z',
        data: {
          itemId: '001',
        },
      };

      expect(event.type).toBe('item-deleted');
      expect(event.data.itemId).toBe('001');
    });

    it('should support board-updated event', () => {
      const board: BoardMetadata = {
        mission: {
          name: 'Mission',
          started_at: '2026-01-15T00:00:00Z',
          status: 'active',
        },
        wip_limits: {},
        phases: {},
        assignments: {},
        agents: {},
        stats: {
          total_items: 5,
          completed: 2,
          in_progress: 2,
          blocked: 0,
          backlog: 1,
        },
        last_updated: '2026-01-15T00:00:00Z',
      };

      const event: BoardEvent = {
        type: 'board-updated',
        timestamp: '2026-01-15T00:00:00Z',
        data: {
          board,
        },
      };

      expect(event.type).toBe('board-updated');
      expect(event.data.board?.stats.total_items).toBe(5);
    });

    it('should allow empty data object', () => {
      const event: BoardEvent = {
        type: 'board-updated',
        timestamp: '2026-01-15T00:00:00Z',
        data: {},
      };

      expect(event.data).toEqual({});
      const eventData = event.data as Record<string, unknown>;
      expect(eventData.itemId).toBeUndefined();
      expect(eventData.item).toBeUndefined();
      expect(event.data.board).toBeUndefined();
    });
  });
});
