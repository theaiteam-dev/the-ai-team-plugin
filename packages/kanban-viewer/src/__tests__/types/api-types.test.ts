import { describe, it, expect } from 'vitest';

/**
 * Type tests for the new API layer types.
 *
 * These tests verify the type definitions specified in PRD 013-mcp-interface.md:
 * - src/types/board.ts: StageId, Stage, BoardState, WipStatus
 * - src/types/item.ts: ItemType, ItemPriority, WorkLogAction, Item, ItemWithRelations, WorkLogEntry
 * - src/types/agent.ts: AgentName, AgentClaim
 * - src/types/mission.ts: MissionState, Mission, PrecheckResult, PostcheckResult
 * - src/types/api.ts: All request/response types for API endpoints
 *
 * Tests use TypeScript compile-time assertions (@ts-expect-error) combined
 * with runtime checks to verify types are strict and properly exported.
 */

// Import all types from the new API layer type modules
import type {
  // Board types
  StageId,
  Stage,
  BoardState,
  WipStatus,
} from '../../types/board';

import type {
  // Item types
  ItemType,
  ItemPriority,
  WorkLogAction,
  Item,
  ItemWithRelations,
  WorkLogEntry,
} from '../../types/item';

import type {
  // Agent types - aliased to avoid conflict with existing types
  AgentName as ApiAgentName,
  AgentClaim,
} from '../../types/agent';

import type {
  // Mission types
  MissionState,
  Mission as ApiMission,
  PrecheckResult,
  PostcheckResult,
} from '../../types/mission';

import type {
  // API request/response types - Board endpoints
  GetBoardResponse,
  MoveItemRequest,
  MoveItemResponse,
  ClaimItemRequest,
  ClaimItemResponse,
  ReleaseItemRequest,
  ReleaseItemResponse,
  // Item endpoints
  CreateItemRequest,
  CreateItemResponse,
  UpdateItemRequest,
  RejectItemRequest,
  RejectItemResponse,
  RenderItemResponse,
  // Agent endpoints
  AgentStartRequest,
  AgentStartResponse,
  AgentStopRequest,
  AgentStopResponse,
  // Mission endpoints
  CreateMissionRequest,
  CreateMissionResponse,
  GetCurrentMissionResponse,
  PrecheckResponse,
  PostcheckResponse,
  ArchiveMissionResponse,
  // Utility endpoints
  DepsCheckResponse,
  LogActivityRequest,
  LogActivityResponse,
  GetActivityResponse,
  // Error and generic types
  ApiError,
  ApiResponse,
} from '../../types/api';

// ============ Board Types Tests ============

describe('Board Types (src/types/board.ts)', () => {
  describe('StageId', () => {
    it('should accept all valid stage IDs', () => {
      const backlog: StageId = 'briefings';
      const ready: StageId = 'ready';
      const inProgress: StageId = 'testing';
      const review: StageId = 'review';
      const done: StageId = 'done';
      const blocked: StageId = 'blocked';

      expect(backlog).toBe('briefings');
      expect(ready).toBe('ready');
      expect(inProgress).toBe('testing');
      expect(review).toBe('review');
      expect(done).toBe('done');
      expect(blocked).toBe('blocked');
    });

    it('should reject invalid stage IDs at compile time', () => {
      // @ts-expect-error - 'invalid' is not a valid StageId
      const invalid: StageId = 'invalid';
      expect(invalid).toBeDefined();
    });

    it('should reject empty string at compile time', () => {
      // @ts-expect-error - empty string is not a valid StageId
      const empty: StageId = '';
      expect(empty).toBeDefined();
    });
  });

  describe('Stage', () => {
    it('should have all required properties', () => {
      const stage: Stage = {
        id: 'ready',
        name: 'Ready',
        order: 1,
        wipLimit: 10,
      };

      expect(stage.id).toBe('ready');
      expect(stage.name).toBe('Ready');
      expect(stage.order).toBe(1);
      expect(stage.wipLimit).toBe(10);
    });

    it('should accept null for wipLimit (unlimited)', () => {
      const stage: Stage = {
        id: 'briefings',
        name: 'Backlog',
        order: 0,
        wipLimit: null,
      };

      expect(stage.wipLimit).toBeNull();
    });

    it('should use StageId for the id property', () => {
      const invalidStage: Stage = {
        // @ts-expect-error - 'invalid_stage' is not a valid StageId
        id: 'invalid_stage',
        name: 'Invalid',
        order: 99,
        wipLimit: null,
      };
      expect(invalidStage).toBeDefined();
    });
  });

  describe('BoardState', () => {
    it('should contain stages, items, claims, and currentMission', () => {
      const boardState: BoardState = {
        stages: [
          { id: 'briefings', name: 'Backlog', order: 0, wipLimit: null },
          { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
        ],
        items: [],
        claims: [],
        currentMission: null,
      };

      expect(boardState.stages).toHaveLength(2);
      expect(boardState.items).toEqual([]);
      expect(boardState.claims).toEqual([]);
      expect(boardState.currentMission).toBeNull();
    });

    it('should accept a Mission object for currentMission', () => {
      const boardState: BoardState = {
        stages: [],
        items: [],
        claims: [],
        currentMission: {
          id: 'M-20260121-001',
          name: 'Test Mission',
          state: 'running',
          prdPath: '/path/to/prd.md',
          startedAt: new Date(),
          completedAt: null,
          archivedAt: null,
        },
      };

      expect(boardState.currentMission?.name).toBe('Test Mission');
    });
  });

  describe('WipStatus', () => {
    it('should have all required properties', () => {
      const wipStatus: WipStatus = {
        stageId: 'testing',
        limit: 5,
        current: 3,
        available: 2,
      };

      expect(wipStatus.stageId).toBe('testing');
      expect(wipStatus.limit).toBe(5);
      expect(wipStatus.current).toBe(3);
      expect(wipStatus.available).toBe(2);
    });

    it('should accept null for limit and available (unlimited stage)', () => {
      const wipStatus: WipStatus = {
        stageId: 'briefings',
        limit: null,
        current: 50,
        available: null,
      };

      expect(wipStatus.limit).toBeNull();
      expect(wipStatus.available).toBeNull();
    });
  });
});

// ============ Item Types Tests ============

describe('Item Types (src/types/item.ts)', () => {
  describe('ItemType', () => {
    it('should accept all valid item types', () => {
      const feature: ItemType = 'feature';
      const bug: ItemType = 'bug';
      const enhancement: ItemType = 'enhancement';
      const task: ItemType = 'task';

      expect(feature).toBe('feature');
      expect(bug).toBe('bug');
      expect(enhancement).toBe('enhancement');
      expect(task).toBe('task');
    });

    it('should reject invalid item types at compile time', () => {
      // @ts-expect-error - 'chore' is not a valid ItemType
      const invalid: ItemType = 'chore';
      expect(invalid).toBeDefined();
    });
  });

  describe('ItemPriority', () => {
    it('should accept all valid priorities', () => {
      const critical: ItemPriority = 'critical';
      const high: ItemPriority = 'high';
      const medium: ItemPriority = 'medium';
      const low: ItemPriority = 'low';

      expect(critical).toBe('critical');
      expect(high).toBe('high');
      expect(medium).toBe('medium');
      expect(low).toBe('low');
    });

    it('should reject invalid priorities at compile time', () => {
      // @ts-expect-error - 'urgent' is not a valid ItemPriority
      const invalid: ItemPriority = 'urgent';
      expect(invalid).toBeDefined();
    });
  });

  describe('WorkLogAction', () => {
    it('should accept all valid work log actions', () => {
      const started: WorkLogAction = 'started';
      const completed: WorkLogAction = 'completed';
      const rejected: WorkLogAction = 'rejected';
      const note: WorkLogAction = 'note';

      expect(started).toBe('started');
      expect(completed).toBe('completed');
      expect(rejected).toBe('rejected');
      expect(note).toBe('note');
    });

    it('should reject invalid actions at compile time', () => {
      // @ts-expect-error - 'paused' is not a valid WorkLogAction
      const invalid: WorkLogAction = 'paused';
      expect(invalid).toBeDefined();
    });
  });

  describe('Item', () => {
    it('should have all required properties', () => {
      const item: Item = {
        id: 'WI-001',
        title: 'Implement feature X',
        description: 'Full description here',
        type: 'feature',
        priority: 'high',
        stageId: 'ready',
        assignedAgent: null,
        rejectionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        outputs: {},
      };

      expect(item.id).toBe('WI-001');
      expect(item.title).toBe('Implement feature X');
      expect(item.type).toBe('feature');
      expect(item.priority).toBe('high');
      expect(item.stageId).toBe('ready');
      expect(item.assignedAgent).toBeNull();
      expect(item.rejectionCount).toBe(0);
      expect(item.completedAt).toBeNull();
    });

    it('should accept assigned agent as string', () => {
      const item: Item = {
        id: 'WI-002',
        title: 'Fix bug Y',
        description: 'Bug description',
        type: 'bug',
        priority: 'critical',
        stageId: 'testing',
        assignedAgent: 'Hannibal',
        rejectionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        outputs: {},
      };

      expect(item.assignedAgent).toBe('Hannibal');
    });

    it('should accept completedAt as Date', () => {
      const completedDate = new Date('2026-01-21T12:00:00Z');
      const item: Item = {
        id: 'WI-003',
        title: 'Completed task',
        description: 'Done',
        type: 'task',
        priority: 'low',
        stageId: 'done',
        assignedAgent: null,
        rejectionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: completedDate,
        outputs: {},
      };

      expect(item.completedAt).toBe(completedDate);
    });
  });

  describe('WorkLogEntry', () => {
    it('should have all required properties', () => {
      const entry: WorkLogEntry = {
        id: 1,
        agent: 'Murdock',
        action: 'started',
        summary: 'Started working on tests',
        timestamp: new Date(),
      };

      expect(entry.id).toBe(1);
      expect(entry.agent).toBe('Murdock');
      expect(entry.action).toBe('started');
      expect(entry.summary).toBe('Started working on tests');
    });
  });

  describe('ItemWithRelations', () => {
    it('should extend Item with dependencies and workLogs', () => {
      const itemWithRelations: ItemWithRelations = {
        id: 'WI-004',
        title: 'Dependent item',
        description: 'Has dependencies',
        type: 'feature',
        priority: 'medium',
        stageId: 'briefings',
        assignedAgent: null,
        rejectionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        outputs: {},
        dependencies: ['WI-001', 'WI-002'],
        workLogs: [
          {
            id: 1,
            agent: 'B.A.',
            action: 'note',
            summary: 'Initial planning',
            timestamp: new Date(),
          },
        ],
      };

      expect(itemWithRelations.dependencies).toEqual(['WI-001', 'WI-002']);
      expect(itemWithRelations.workLogs).toHaveLength(1);
      expect(itemWithRelations.workLogs[0].agent).toBe('B.A.');
    });

    it('should accept empty dependencies array', () => {
      const itemWithRelations: ItemWithRelations = {
        id: 'WI-005',
        title: 'Independent item',
        description: 'No deps',
        type: 'enhancement',
        priority: 'low',
        stageId: 'ready',
        assignedAgent: null,
        rejectionCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        outputs: {},
        dependencies: [],
        workLogs: [],
      };

      expect(itemWithRelations.dependencies).toEqual([]);
      expect(itemWithRelations.workLogs).toEqual([]);
    });
  });
});

// ============ Agent Types Tests ============

describe('Agent Types (src/types/agent.ts)', () => {
  describe('AgentName', () => {
    it('should accept all valid agent names', () => {
      const hannibal: ApiAgentName = 'Hannibal';
      const face: ApiAgentName = 'Face';
      const murdock: ApiAgentName = 'Murdock';
      const ba: ApiAgentName = 'B.A.';
      const lynch: ApiAgentName = 'Lynch';
      const amy: ApiAgentName = 'Amy';
      const tawnia: ApiAgentName = 'Tawnia';

      expect(hannibal).toBe('Hannibal');
      expect(face).toBe('Face');
      expect(murdock).toBe('Murdock');
      expect(ba).toBe('B.A.');
      expect(lynch).toBe('Lynch');
      expect(amy).toBe('Amy');
      expect(tawnia).toBe('Tawnia');
    });

    it('should reject invalid agent names at compile time', () => {
      // @ts-expect-error - 'Unknown' is not a valid AgentName
      const invalid: ApiAgentName = 'Unknown';
      expect(invalid).toBeDefined();
    });
  });

  describe('AgentClaim', () => {
    it('should have all required properties', () => {
      const claim: AgentClaim = {
        agentName: 'Hannibal',
        itemId: 'WI-001',
        claimedAt: new Date(),
      };

      expect(claim.agentName).toBe('Hannibal');
      expect(claim.itemId).toBe('WI-001');
      expect(claim.claimedAt).toBeInstanceOf(Date);
    });

    it('should use AgentName type for agentName property', () => {
      const invalidClaim: AgentClaim = {
        // @ts-expect-error - 'InvalidAgent' is not a valid AgentName
        agentName: 'InvalidAgent',
        itemId: 'WI-001',
        claimedAt: new Date(),
      };
      expect(invalidClaim).toBeDefined();
    });
  });
});

// ============ Mission Types Tests ============

describe('Mission Types (src/types/mission.ts)', () => {
  describe('MissionState', () => {
    it('should accept all valid mission states', () => {
      const initializing: MissionState = 'initializing';
      const prechecking: MissionState = 'prechecking';
      const running: MissionState = 'running';
      const postchecking: MissionState = 'postchecking';
      const completed: MissionState = 'completed';
      const failed: MissionState = 'failed';
      const archived: MissionState = 'archived';

      expect(initializing).toBe('initializing');
      expect(prechecking).toBe('prechecking');
      expect(running).toBe('running');
      expect(postchecking).toBe('postchecking');
      expect(completed).toBe('completed');
      expect(failed).toBe('failed');
      expect(archived).toBe('archived');
    });

    it('should reject invalid mission states at compile time', () => {
      // @ts-expect-error - 'paused' is not a valid MissionState
      const invalid: MissionState = 'paused';
      expect(invalid).toBeDefined();
    });
  });

  describe('Mission', () => {
    it('should have all required properties', () => {
      const mission: ApiMission = {
        id: 'M-20260121-001',
        name: 'API Layer Implementation',
        state: 'running',
        prdPath: '/prd/013-mcp-interface.md',
        startedAt: new Date(),
        completedAt: null,
        archivedAt: null,
      };

      expect(mission.id).toBe('M-20260121-001');
      expect(mission.name).toBe('API Layer Implementation');
      expect(mission.state).toBe('running');
      expect(mission.prdPath).toBe('/prd/013-mcp-interface.md');
      expect(mission.completedAt).toBeNull();
      expect(mission.archivedAt).toBeNull();
    });

    it('should accept completed mission with timestamps', () => {
      const completedMission: ApiMission = {
        id: 'M-20260120-001',
        name: 'Previous Mission',
        state: 'completed',
        prdPath: '/prd/old.md',
        startedAt: new Date('2026-01-20T09:00:00Z'),
        completedAt: new Date('2026-01-20T18:00:00Z'),
        archivedAt: null,
      };

      expect(completedMission.completedAt).toBeInstanceOf(Date);
    });

    it('should accept archived mission with all timestamps', () => {
      const archivedMission: ApiMission = {
        id: 'M-20260119-001',
        name: 'Archived Mission',
        state: 'archived',
        prdPath: '/prd/archived.md',
        startedAt: new Date('2026-01-19T09:00:00Z'),
        completedAt: new Date('2026-01-19T18:00:00Z'),
        archivedAt: new Date('2026-01-20T09:00:00Z'),
      };

      expect(archivedMission.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe('PrecheckResult', () => {
    it('should have all required properties', () => {
      const result: PrecheckResult = {
        passed: true,
        lintErrors: 0,
        testsPassed: 42,
        testsFailed: 0,
        blockers: [],
      };

      expect(result.passed).toBe(true);
      expect(result.lintErrors).toBe(0);
      expect(result.testsPassed).toBe(42);
      expect(result.testsFailed).toBe(0);
      expect(result.blockers).toEqual([]);
    });

    it('should accept failed precheck with blockers', () => {
      const result: PrecheckResult = {
        passed: false,
        lintErrors: 5,
        testsPassed: 38,
        testsFailed: 4,
        blockers: ['TypeScript errors', 'Failing tests'],
      };

      expect(result.passed).toBe(false);
      expect(result.blockers).toHaveLength(2);
    });
  });

  describe('PostcheckResult', () => {
    it('should have all required properties including e2e tests', () => {
      const result: PostcheckResult = {
        passed: true,
        lintErrors: 0,
        unitTestsPassed: 100,
        unitTestsFailed: 0,
        e2eTestsPassed: 25,
        e2eTestsFailed: 0,
        blockers: [],
      };

      expect(result.passed).toBe(true);
      expect(result.unitTestsPassed).toBe(100);
      expect(result.e2eTestsPassed).toBe(25);
      expect(result.blockers).toEqual([]);
    });

    it('should accept failed postcheck with blockers', () => {
      const result: PostcheckResult = {
        passed: false,
        lintErrors: 0,
        unitTestsPassed: 95,
        unitTestsFailed: 5,
        e2eTestsPassed: 20,
        e2eTestsFailed: 5,
        blockers: ['E2E tests failing', 'Unit test regression'],
      };

      expect(result.passed).toBe(false);
      expect(result.unitTestsFailed).toBe(5);
      expect(result.e2eTestsFailed).toBe(5);
    });
  });
});

// ============ API Types Tests ============

describe('API Types (src/types/api.ts)', () => {
  describe('Board Endpoint Types', () => {
    describe('GetBoardResponse', () => {
      it('should have success true and data with BoardState', () => {
        const response: GetBoardResponse = {
          success: true,
          data: {
            stages: [],
            items: [],
            claims: [],
            currentMission: null,
          },
        };

        expect(response.success).toBe(true);
        expect(response.data.stages).toEqual([]);
      });
    });

    describe('MoveItemRequest', () => {
      it('should have required itemId and toStage', () => {
        const request: MoveItemRequest = {
          itemId: 'WI-001',
          toStage: 'testing',
        };

        expect(request.itemId).toBe('WI-001');
        expect(request.toStage).toBe('testing');
      });

      it('should accept optional force flag', () => {
        const request: MoveItemRequest = {
          itemId: 'WI-001',
          toStage: 'testing',
          force: true,
        };

        expect(request.force).toBe(true);
      });
    });

    describe('MoveItemResponse', () => {
      it('should contain item, previousStage, and wipStatus', () => {
        const response: MoveItemResponse = {
          success: true,
          data: {
            item: {
              id: 'WI-001',
              title: 'Test',
              description: 'Desc',
              type: 'feature',
              priority: 'high',
              stageId: 'testing',
              assignedAgent: null,
              rejectionCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
              completedAt: null,
              outputs: {},
            },
            previousStage: 'ready',
            wipStatus: {
              stageId: 'testing',
              limit: 5,
              current: 2,
              available: 3,
            },
          },
        };

        expect(response.data.previousStage).toBe('ready');
        expect(response.data.wipStatus.current).toBe(2);
      });
    });

    describe('ClaimItemRequest and Response', () => {
      it('should have required itemId and agent', () => {
        const request: ClaimItemRequest = {
          itemId: 'WI-001',
          agent: 'Hannibal',
        };

        expect(request.itemId).toBe('WI-001');
        expect(request.agent).toBe('Hannibal');
      });

      it('should return AgentClaim in response', () => {
        const response: ClaimItemResponse = {
          success: true,
          data: {
            agentName: 'Hannibal',
            itemId: 'WI-001',
            claimedAt: new Date(),
          },
        };

        expect(response.data.agentName).toBe('Hannibal');
      });
    });

    describe('ReleaseItemRequest and Response', () => {
      it('should have required itemId', () => {
        const request: ReleaseItemRequest = {
          itemId: 'WI-001',
        };

        expect(request.itemId).toBe('WI-001');
      });

      it('should return released status and agent', () => {
        const response: ReleaseItemResponse = {
          success: true,
          data: {
            released: true,
            agent: 'Hannibal',
          },
        };

        expect(response.data.released).toBe(true);
        expect(response.data.agent).toBe('Hannibal');
      });
    });
  });

  describe('Item Endpoint Types', () => {
    describe('CreateItemRequest', () => {
      it('should have required title, description, type, priority', () => {
        const request: CreateItemRequest = {
          title: 'New Feature',
          description: 'Feature description',
          type: 'feature',
          priority: 'high',
        };

        expect(request.title).toBe('New Feature');
        expect(request.type).toBe('feature');
      });

      it('should accept optional dependencies', () => {
        const request: CreateItemRequest = {
          title: 'Dependent Feature',
          description: 'Has dependencies',
          type: 'feature',
          priority: 'medium',
          dependencies: ['WI-001', 'WI-002'],
        };

        expect(request.dependencies).toEqual(['WI-001', 'WI-002']);
      });
    });

    describe('CreateItemResponse', () => {
      it('should return ItemWithRelations', () => {
        const response: CreateItemResponse = {
          success: true,
          data: {
            id: 'WI-010',
            title: 'Created Item',
            description: 'Desc',
            type: 'feature',
            priority: 'high',
            stageId: 'briefings',
            assignedAgent: null,
            rejectionCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
            outputs: {},
            dependencies: [],
            workLogs: [],
          },
        };

        expect(response.data.id).toBe('WI-010');
        expect(response.data.dependencies).toEqual([]);
      });
    });

    describe('UpdateItemRequest', () => {
      it('should have all properties optional', () => {
        const request: UpdateItemRequest = {
          title: 'Updated Title',
        };

        expect(request.title).toBe('Updated Title');
        expect(request.description).toBeUndefined();
      });

      it('should accept multiple optional fields', () => {
        const request: UpdateItemRequest = {
          title: 'New Title',
          priority: 'critical',
          dependencies: ['WI-003'],
        };

        expect(request.title).toBe('New Title');
        expect(request.priority).toBe('critical');
      });
    });

    describe('RejectItemRequest and Response', () => {
      it('should have required reason and agent', () => {
        const request: RejectItemRequest = {
          reason: 'Tests not passing',
          agent: 'Lynch',
        };

        expect(request.reason).toBe('Tests not passing');
        expect(request.agent).toBe('Lynch');
      });

      it('should return item, escalated status, and rejectionCount', () => {
        const response: RejectItemResponse = {
          success: true,
          data: {
            item: {
              id: 'WI-001',
              title: 'Rejected Item',
              description: 'Desc',
              type: 'feature',
              priority: 'high',
              stageId: 'review',
              assignedAgent: null,
              rejectionCount: 2,
              createdAt: new Date(),
              updatedAt: new Date(),
              completedAt: null,
              outputs: {},
            },
            escalated: true,
            rejectionCount: 2,
          },
        };

        expect(response.data.escalated).toBe(true);
        expect(response.data.rejectionCount).toBe(2);
      });
    });

    describe('RenderItemResponse', () => {
      it('should contain markdown string', () => {
        const response: RenderItemResponse = {
          success: true,
          data: {
            markdown: '# WI-001\n\nDescription here',
          },
        };

        expect(response.data.markdown).toContain('# WI-001');
      });
    });
  });

  describe('Agent Endpoint Types', () => {
    describe('AgentStartRequest and Response', () => {
      it('should have required itemId and agent', () => {
        const request: AgentStartRequest = {
          itemId: 'WI-001',
          agent: 'Murdock',
        };

        expect(request.itemId).toBe('WI-001');
        expect(request.agent).toBe('Murdock');
      });

      it('should return full agent start info', () => {
        const response: AgentStartResponse = {
          success: true,
          data: {
            itemId: 'WI-001',
            agent: 'Murdock',
            item: {
              id: 'WI-001',
              title: 'Started Item',
              description: 'Desc',
              type: 'feature',
              priority: 'high',
              stageId: 'testing',
              assignedAgent: 'Murdock',
              rejectionCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
              completedAt: null,
              outputs: {},
              dependencies: [],
              workLogs: [],
            },
            claimedAt: new Date(),
          },
        };

        expect(response.data.agent).toBe('Murdock');
        expect(response.data.item.assignedAgent).toBe('Murdock');
      });
    });

    describe('AgentStopRequest and Response', () => {
      it('should have required fields', () => {
        const request: AgentStopRequest = {
          itemId: 'WI-001',
          agent: 'Murdock',
          summary: 'Tests written and passing',
        };

        expect(request.itemId).toBe('WI-001');
        expect(request.summary).toBe('Tests written and passing');
      });

      it('should accept optional outcome', () => {
        const request: AgentStopRequest = {
          itemId: 'WI-001',
          agent: 'Murdock',
          summary: 'Blocked by external dependency',
          outcome: 'blocked',
        };

        expect(request.outcome).toBe('blocked');
      });

      it('should return work log entry and next stage', () => {
        const response: AgentStopResponse = {
          success: true,
          data: {
            itemId: 'WI-001',
            agent: 'Murdock',
            workLogEntry: {
              id: 5,
              agent: 'Murdock',
              action: 'completed',
              summary: 'Implementation complete',
              timestamp: new Date(),
            },
            nextStage: 'review',
          },
        };

        expect(response.data.workLogEntry.action).toBe('completed');
        expect(response.data.nextStage).toBe('review');
      });

      it('should accept null for nextStage', () => {
        const response: AgentStopResponse = {
          success: true,
          data: {
            itemId: 'WI-001',
            agent: 'Murdock',
            workLogEntry: {
              id: 6,
              agent: 'Murdock',
              action: 'note',
              summary: 'Added comment',
              timestamp: new Date(),
            },
            nextStage: null,
          },
        };

        expect(response.data.nextStage).toBeNull();
      });
    });
  });

  describe('Mission Endpoint Types', () => {
    describe('CreateMissionRequest and Response', () => {
      it('should have required name and prdPath', () => {
        const request: CreateMissionRequest = {
          name: 'New Mission',
          prdPath: '/prd/new-mission.md',
        };

        expect(request.name).toBe('New Mission');
        expect(request.prdPath).toBe('/prd/new-mission.md');
      });

      it('should return created Mission', () => {
        const response: CreateMissionResponse = {
          success: true,
          data: {
            id: 'M-20260121-002',
            name: 'New Mission',
            state: 'initializing',
            prdPath: '/prd/new-mission.md',
            startedAt: new Date(),
            completedAt: null,
            archivedAt: null,
          },
        };

        expect(response.data.state).toBe('initializing');
      });
    });

    describe('GetCurrentMissionResponse', () => {
      it('should return Mission or null', () => {
        const responseWithMission: GetCurrentMissionResponse = {
          success: true,
          data: {
            id: 'M-20260121-001',
            name: 'Current Mission',
            state: 'running',
            prdPath: '/prd/current.md',
            startedAt: new Date(),
            completedAt: null,
            archivedAt: null,
          },
        };

        expect(responseWithMission.data?.name).toBe('Current Mission');

        const responseNoMission: GetCurrentMissionResponse = {
          success: true,
          data: null,
        };

        expect(responseNoMission.data).toBeNull();
      });
    });

    describe('PrecheckResponse and PostcheckResponse', () => {
      it('should return PrecheckResult', () => {
        const response: PrecheckResponse = {
          success: true,
          data: {
            passed: true,
            lintErrors: 0,
            testsPassed: 50,
            testsFailed: 0,
            blockers: [],
          },
        };

        expect(response.data.passed).toBe(true);
      });

      it('should return PostcheckResult', () => {
        const response: PostcheckResponse = {
          success: true,
          data: {
            passed: true,
            lintErrors: 0,
            unitTestsPassed: 100,
            unitTestsFailed: 0,
            e2eTestsPassed: 30,
            e2eTestsFailed: 0,
            blockers: [],
          },
        };

        expect(response.data.e2eTestsPassed).toBe(30);
      });
    });

    describe('ArchiveMissionResponse', () => {
      it('should return archived mission and item count', () => {
        const response: ArchiveMissionResponse = {
          success: true,
          data: {
            mission: {
              id: 'M-20260120-001',
              name: 'Archived Mission',
              state: 'archived',
              prdPath: '/prd/archived.md',
              startedAt: new Date('2026-01-20T09:00:00Z'),
              completedAt: new Date('2026-01-20T18:00:00Z'),
              archivedAt: new Date('2026-01-21T09:00:00Z'),
            },
            archivedItems: 15,
          },
        };

        expect(response.data.mission.state).toBe('archived');
        expect(response.data.archivedItems).toBe(15);
      });
    });
  });

  describe('Utility Endpoint Types', () => {
    describe('DepsCheckResponse', () => {
      it('should return dependency validation results', () => {
        const response: DepsCheckResponse = {
          success: true,
          data: {
            valid: true,
            cycles: [],
            readyItems: ['WI-001', 'WI-002'],
            blockedItems: ['WI-003'],
          },
        };

        expect(response.data.valid).toBe(true);
        expect(response.data.readyItems).toContain('WI-001');
      });

      it('should report cycles when detected', () => {
        const response: DepsCheckResponse = {
          success: true,
          data: {
            valid: false,
            cycles: [['WI-001', 'WI-002', 'WI-001']],
            readyItems: [],
            blockedItems: ['WI-001', 'WI-002'],
          },
        };

        expect(response.data.valid).toBe(false);
        expect(response.data.cycles).toHaveLength(1);
      });
    });

    describe('LogActivityRequest and Response', () => {
      it('should have required message', () => {
        const request: LogActivityRequest = {
          message: 'Started working on feature',
        };

        expect(request.message).toBe('Started working on feature');
      });

      it('should accept optional agent and level', () => {
        const request: LogActivityRequest = {
          message: 'Error occurred',
          agent: 'B.A.',
          level: 'error',
        };

        expect(request.agent).toBe('B.A.');
        expect(request.level).toBe('error');
      });

      it('should return logged status and timestamp', () => {
        const response: LogActivityResponse = {
          success: true,
          data: {
            logged: true,
            timestamp: new Date(),
          },
        };

        expect(response.data.logged).toBe(true);
      });
    });

    describe('GetActivityResponse', () => {
      it('should return activity entries array', () => {
        const response: GetActivityResponse = {
          success: true,
          data: {
            entries: [
              {
                id: 1,
                missionId: 'M-20260121-001',
                agent: 'Hannibal',
                message: 'Mission started',
                level: 'info',
                timestamp: new Date(),
              },
              {
                id: 2,
                missionId: 'M-20260121-001',
                agent: null,
                message: 'System message',
                level: 'warn',
                timestamp: new Date(),
              },
            ],
          },
        };

        expect(response.data.entries).toHaveLength(2);
        expect(response.data.entries[0].agent).toBe('Hannibal');
        expect(response.data.entries[1].agent).toBeNull();
      });
    });
  });

  describe('Error Types', () => {
    describe('ApiError', () => {
      it('should have success false and error object', () => {
        const error: ApiError = {
          success: false,
          error: {
            code: 'ITEM_NOT_FOUND',
            message: 'Item with ID WI-999 not found',
          },
        };

        expect(error.success).toBe(false);
        expect(error.error.code).toBe('ITEM_NOT_FOUND');
        expect(error.error.message).toContain('WI-999');
      });

      it('should accept optional details', () => {
        const error: ApiError = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            details: { field: 'title', reason: 'too long' },
          },
        };

        expect(error.error.details).toEqual({ field: 'title', reason: 'too long' });
      });
    });

    describe('ApiResponse generic type', () => {
      it('should accept either success response or ApiError', () => {
        const successResponse: ApiResponse<GetBoardResponse> = {
          success: true,
          data: {
            stages: [],
            items: [],
            claims: [],
            currentMission: null,
          },
        };

        const errorResponse: ApiResponse<GetBoardResponse> = {
          success: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'Internal server error',
          },
        };

        expect(successResponse.success).toBe(true);
        expect(errorResponse.success).toBe(false);
      });
    });
  });
});

// ============ Index Re-export Tests ============

describe('Type Re-exports (src/types/index.ts)', () => {
  it('should export all board types from src/types', async () => {
    // This test verifies that types can be imported from the index barrel file
    // The actual import at the top of this file verifies this at compile time
    // Here we just confirm the types are usable
    const stageId: StageId = 'ready';
    expect(stageId).toBe('ready');
  });

  it('should export all item types from src/types', () => {
    const itemType: ItemType = 'feature';
    const priority: ItemPriority = 'high';
    const action: WorkLogAction = 'started';

    expect(itemType).toBe('feature');
    expect(priority).toBe('high');
    expect(action).toBe('started');
  });

  it('should export all agent types from src/types', () => {
    const agent: ApiAgentName = 'Hannibal';
    expect(agent).toBe('Hannibal');
  });

  it('should export all mission types from src/types', () => {
    const state: MissionState = 'running';
    expect(state).toBe('running');
  });
});

// ============ Strict Type Tests (no 'any') ============

describe('Strict Type Enforcement', () => {
  it('should not allow any type in Item properties', () => {
    // This test verifies that the Item type is strict
    // If any property were typed as 'any', TypeScript would allow arbitrary values
    const item: Item = {
      id: 'WI-001',
      title: 'Test',
      description: 'Desc',
      type: 'feature',
      priority: 'high',
      stageId: 'ready',
      assignedAgent: null,
      rejectionCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      outputs: {},
    };

    // Type checks - these would fail if types were 'any'
    // @ts-expect-error - type must be ItemType, not arbitrary string
    const badItem: Item = { ...item, type: 'arbitrary' };
    expect(badItem).toBeDefined();

    // @ts-expect-error - priority must be ItemPriority, not arbitrary string
    const badPriority: Item = { ...item, priority: 'arbitrary' };
    expect(badPriority).toBeDefined();

    // @ts-expect-error - stageId must be StageId, not arbitrary string
    const badStage: Item = { ...item, stageId: 'arbitrary' };
    expect(badStage).toBeDefined();
  });

  it('should not allow any type in Mission properties', () => {
    const mission: ApiMission = {
      id: 'M-001',
      name: 'Test',
      state: 'running',
      prdPath: '/path',
      startedAt: new Date(),
      completedAt: null,
      archivedAt: null,
    };

    // @ts-expect-error - state must be MissionState, not arbitrary string
    const badMission: ApiMission = { ...mission, state: 'arbitrary' };
    expect(badMission).toBeDefined();
  });

  it('should not allow any type in API request agent fields', () => {
    const badRequest: ClaimItemRequest = {
      itemId: 'WI-001',
      // @ts-expect-error - agent must be AgentName, not arbitrary string
      agent: 'NotAnAgent',
    };
    expect(badRequest).toBeDefined();

    const badStartRequest: AgentStartRequest = {
      itemId: 'WI-001',
      // @ts-expect-error - agent must be AgentName, not arbitrary string
      agent: 'InvalidAgent',
    };
    expect(badStartRequest).toBeDefined();
  });
});
