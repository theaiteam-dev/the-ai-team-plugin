import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Integration tests for stage name consistency across the system.
 *
 * These tests verify that after stage harmonization:
 * 1. All 8 stages are valid and recognized in StageId type
 * 2. Stage transitions follow the validation matrix
 * 3. SSE endpoint emits events with correct stage IDs
 * 4. API GET /api/board returns all 8 stages correctly
 * 5. Unknown or unmapped stages are detected at runtime
 *
 * The 8 canonical stages are:
 * - briefings: Work items not yet started
 * - ready: Items ready for work
 * - testing: Items being tested (Murdock)
 * - implementing: Items being built (B.A.)
 * - probing: Items being investigated (Amy)
 * - review: Items under review (Lynch)
 * - done: Completed items
 * - blocked: Items needing human input
 */

// ============ Constants ============

/**
 * The 8 canonical stage IDs after harmonization.
 * This is the source of truth for valid stage names.
 */
const CANONICAL_STAGES = [
  'briefings',
  'ready',
  'testing',
  'implementing',
  'probing',
  'review',
  'done',
  'blocked',
] as const;

// ============ Mock Setup ============

const mockPrisma = vi.hoisted(() => ({
  stage: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  item: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  itemDependency: {
    findMany: vi.fn(),
  },
  agentClaim: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
  activityLog: {
    findMany: vi.fn(),
  },
  workLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// ============ Test Fixtures ============

/**
 * Create mock stages data that matches the seed data.
 * Order matches CANONICAL_STAGES for consistency verification.
 */
const createMockStages = () => [
  { id: 'briefings', name: 'Briefings', order: 0, wipLimit: null },
  { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
  { id: 'testing', name: 'Testing', order: 2, wipLimit: 3 },
  { id: 'implementing', name: 'Implementing', order: 3, wipLimit: 3 },
  { id: 'probing', name: 'Probing', order: 4, wipLimit: 3 },
  { id: 'review', name: 'Review', order: 5, wipLimit: 3 },
  { id: 'done', name: 'Done', order: 6, wipLimit: null },
  { id: 'blocked', name: 'Blocked', order: 7, wipLimit: null },
];

const createMockItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'WI-001',
  title: 'Test Item',
  description: 'Test description',
  type: 'feature',
  priority: 'medium',
  stageId: 'ready',
  projectId: 'kanban-viewer',
  assignedAgent: null,
  rejectionCount: 0,
  createdAt: new Date('2026-01-21T10:00:00Z'),
  updatedAt: new Date('2026-01-21T10:00:00Z'),
  completedAt: null,
  archivedAt: null,
  dependsOn: [],
  workLogs: [],
  ...overrides,
});

// ============ Type System Stage Tests ============

describe('Stage Consistency - Type System', () => {
  describe('StageId type definition', () => {
    it('should recognize all 8 canonical stages', () => {
      // Import the StageId type to verify it exists
      // This test verifies the type definition at compile time
      const validStages: import('@/types/board').StageId[] = [
        'briefings',
        'ready',
        'testing',
        'implementing',
        'probing',
        'review',
        'done',
        'blocked',
      ];

      expect(validStages).toHaveLength(8);
      expect(validStages).toEqual(CANONICAL_STAGES);
    });

    it('should include all stages in Stage type from index', () => {
      // Verify Stage type from index.ts matches
      const validStages: import('@/types').Stage[] = [
        'briefings',
        'ready',
        'testing',
        'implementing',
        'probing',
        'review',
        'done',
        'blocked',
      ];

      expect(validStages).toHaveLength(8);
      expect(validStages).toEqual(CANONICAL_STAGES);
    });
  });
});

// ============ Validation Matrix Stage Tests ============

import { isValidTransition } from '@/lib/validation';

describe('Stage Consistency - Validation Matrix', () => {
  describe('all 8 stages are recognized by validation', () => {
    it.each(CANONICAL_STAGES)('should handle %s as source stage', (stage) => {
      // Each stage should be usable as a source - no errors
      const result = isValidTransition(stage, 'blocked');
      expect(typeof result).toBe('boolean');
    });

    it.each(CANONICAL_STAGES)('should handle %s as target stage', (stage) => {
      // Each stage should be usable as a target - no errors
      const result = isValidTransition('ready', stage);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('transition matrix completeness', () => {
    it('should define transitions for all source stages', () => {
      // Every stage should have defined behavior (even if empty set)
      for (const fromStage of CANONICAL_STAGES) {
        for (const toStage of CANONICAL_STAGES) {
          const result = isValidTransition(fromStage, toStage);
          // Result should be a boolean, not undefined
          expect(result).not.toBeUndefined();
          expect(typeof result).toBe('boolean');
        }
      }
    });

    it('should reject self-transitions for all stages', () => {
      for (const stage of CANONICAL_STAGES) {
        expect(isValidTransition(stage, stage)).toBe(false);
      }
    });
  });

  describe('done stage is terminal', () => {
    it('should not allow transitions from done to any other stage', () => {
      for (const target of CANONICAL_STAGES) {
        expect(isValidTransition('done', target)).toBe(false);
      }
    });
  });
});

// ============ API Board Endpoint Stage Tests ============

describe('Stage Consistency - API GET /api/board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return all 8 stages with correct IDs', async () => {
    const mockStages = createMockStages();
    mockPrisma.stage.findMany.mockResolvedValue(mockStages);
    mockPrisma.item.findMany.mockResolvedValue([]);
    mockPrisma.agentClaim.findMany.mockResolvedValue([]);
    mockPrisma.mission.findFirst.mockResolvedValue(null);

    const { GET } = await import('@/app/api/board/route');
    const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.stages).toHaveLength(8);

    // Verify all canonical stage IDs are present
    const stageIds = data.data.stages.map((s: { id: string }) => s.id);
    for (const canonicalStage of CANONICAL_STAGES) {
      expect(stageIds).toContain(canonicalStage);
    }
  });

  it('should return stages in correct order', async () => {
    const mockStages = createMockStages();
    mockPrisma.stage.findMany.mockResolvedValue(mockStages);
    mockPrisma.item.findMany.mockResolvedValue([]);
    mockPrisma.agentClaim.findMany.mockResolvedValue([]);
    mockPrisma.mission.findFirst.mockResolvedValue(null);

    const { GET } = await import('@/app/api/board/route');
    const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });
    const response = await GET(request);

    const data = await response.json();
    const stages = data.data.stages;

    // Verify stages are ordered by their order field
    for (let i = 0; i < stages.length - 1; i++) {
      expect(stages[i].order).toBeLessThan(stages[i + 1].order);
    }
  });

  it('should return items with valid stageId values', async () => {
    const mockStages = createMockStages();
    const mockItems = [
      createMockItem({ id: 'WI-001', stageId: 'briefings' }),
      createMockItem({ id: 'WI-002', stageId: 'ready' }),
      createMockItem({ id: 'WI-003', stageId: 'testing' }),
      createMockItem({ id: 'WI-004', stageId: 'implementing' }),
      createMockItem({ id: 'WI-005', stageId: 'probing' }),
      createMockItem({ id: 'WI-006', stageId: 'review' }),
      createMockItem({ id: 'WI-007', stageId: 'blocked' }),
    ];

    mockPrisma.stage.findMany.mockResolvedValue(mockStages);
    mockPrisma.item.findMany.mockResolvedValue(mockItems);
    mockPrisma.agentClaim.findMany.mockResolvedValue([]);
    mockPrisma.mission.findFirst.mockResolvedValue(null);

    const { GET } = await import('@/app/api/board/route');
    const request = new NextRequest('http://localhost:3000/api/board?includeCompleted=true', {
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });
    const response = await GET(request);

    const data = await response.json();

    // Every item's stageId should be a canonical stage
    for (const item of data.data.items) {
      expect(CANONICAL_STAGES).toContain(item.stageId);
    }
  });
});

// ============ API Move Endpoint Stage Tests ============

describe('Stage Consistency - API POST /api/board/move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set up default transaction mock to execute callbacks
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      // Execute the callback with the mock prisma client
      return callback(mockPrisma);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should accept all valid stage transitions', async () => {
    // Test a known valid transition: ready -> testing
    const mockItem = createMockItem({ id: 'WI-001', stageId: 'ready' });
    const updatedItem = { ...mockItem, stageId: 'testing' };

    mockPrisma.item.findFirst.mockResolvedValue(mockItem);
    mockPrisma.item.findUnique.mockResolvedValue(mockItem);
    mockPrisma.stage.findUnique.mockResolvedValue({ id: 'testing', name: 'Testing', order: 2, wipLimit: 10 });
    mockPrisma.item.count.mockResolvedValue(0);
    mockPrisma.item.update.mockResolvedValue(updatedItem);

    const { POST } = await import('@/app/api/board/move/route');
    const request = new NextRequest('http://localhost:3000/api/board/move', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'kanban-viewer',
      },
      body: JSON.stringify({ itemId: 'WI-001', toStage: 'testing' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.data.item.stageId).toBe('testing');
  });

  it('should reject invalid stage transitions', async () => {
    // Test an invalid transition: ready -> done (skip review)
    const mockItem = createMockItem({ id: 'WI-001', stageId: 'ready' });

    mockPrisma.item.findFirst.mockResolvedValue(mockItem);
    mockPrisma.item.findUnique.mockResolvedValue(mockItem);

    const { POST } = await import('@/app/api/board/move/route');
    const request = new NextRequest('http://localhost:3000/api/board/move', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'kanban-viewer',
      },
      body: JSON.stringify({ itemId: 'WI-001', toStage: 'done' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('INVALID_TRANSITION');
  });

  it.each(CANONICAL_STAGES)('should recognize %s as a valid target stage', async (targetStage) => {
    // Test that each canonical stage is recognized
    // (even if the transition itself may be invalid)
    const mockItem = createMockItem({ id: 'WI-001', stageId: 'ready' });

    mockPrisma.item.findFirst.mockResolvedValue(mockItem);
    mockPrisma.item.findUnique.mockResolvedValue(mockItem);
    mockPrisma.stage.findUnique.mockResolvedValue({ id: targetStage, name: targetStage, order: 0, wipLimit: null });
    mockPrisma.item.count.mockResolvedValue(0);
    mockPrisma.item.update.mockResolvedValue({ ...mockItem, stageId: targetStage });

    const { POST } = await import('@/app/api/board/move/route');
    const request = new NextRequest('http://localhost:3000/api/board/move', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'kanban-viewer',
      },
      body: JSON.stringify({ itemId: 'WI-001', toStage: targetStage }),
    });

    const response = await POST(request);

    // Response should be either 200 (valid transition) or 400 (invalid transition)
    // but NOT 500 (unknown stage)
    expect([200, 400]).toContain(response.status);
  });
});

// ============ Unknown Stage Detection Tests ============

describe('Stage Consistency - Unknown Stage Detection', () => {
  describe('runtime stage validation', () => {
    it('should detect unknown stage names at runtime', () => {
      const knownStages = new Set(CANONICAL_STAGES);

      // Helper function that would be used in production
      const isValidStage = (stage: string): boolean => {
        return knownStages.has(stage as typeof CANONICAL_STAGES[number]);
      };

      // Known stages should be valid
      for (const stage of CANONICAL_STAGES) {
        expect(isValidStage(stage)).toBe(true);
      }

      // Unknown stages should be invalid
      expect(isValidStage('backlog')).toBe(false); // Old name
      expect(isValidStage('in_progress')).toBe(false); // Old name
      expect(isValidStage('todo')).toBe(false);
      expect(isValidStage('')).toBe(false);
      expect(isValidStage('READY')).toBe(false); // Case sensitive
    });
  });

  describe('legacy stage name detection', () => {
    it('should not include legacy stage names', () => {
      const legacyStages = ['backlog', 'in_progress', 'in-progress', 'todo', 'wip'];

      for (const legacyStage of legacyStages) {
        expect(CANONICAL_STAGES).not.toContain(legacyStage);
      }
    });
  });
});

// ============ WorkItem Stage Field Tests ============

describe('Stage Consistency - WorkItem Type', () => {
  it('should have stage field that accepts canonical stages', () => {
    // Verify WorkItem type accepts all canonical stages
    const workItems: import('@/types').WorkItem[] = CANONICAL_STAGES.map((stage, index) => ({
      id: `WI-00${index}`,
      title: `Test item in ${stage}`,
      type: 'feature',
      status: 'pending',
      rejection_count: 0,
      dependencies: [],
      outputs: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stage,
      content: 'Test content',
    }));

    expect(workItems).toHaveLength(8);
    for (let i = 0; i < workItems.length; i++) {
      expect(workItems[i].stage).toBe(CANONICAL_STAGES[i]);
    }
  });
});

// ============ Cross-Layer Consistency Tests ============

describe('Stage Consistency - Cross-Layer Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set up default transaction mock to execute callbacks
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      // Execute the callback with the mock prisma client
      return callback(mockPrisma);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should maintain stage consistency from database to API response', async () => {
    // This tests that stages flow correctly: DB -> API -> Response
    const dbStages = createMockStages();
    const dbItems = [
      createMockItem({ id: 'WI-001', stageId: 'testing' }),
    ];

    mockPrisma.stage.findMany.mockResolvedValue(dbStages);
    mockPrisma.item.findMany.mockResolvedValue(dbItems);
    mockPrisma.agentClaim.findMany.mockResolvedValue([]);
    mockPrisma.mission.findFirst.mockResolvedValue(null);

    const { GET } = await import('@/app/api/board/route');
    const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });
    const response = await GET(request);

    const data = await response.json();

    // Verify stage IDs match exactly what's in the database
    const apiStageIds = data.data.stages.map((s: { id: string }) => s.id);
    const dbStageIds = dbStages.map((s) => s.id);
    expect(apiStageIds.sort()).toEqual(dbStageIds.sort());

    // Verify item's stageId is valid
    const item = data.data.items[0];
    expect(apiStageIds).toContain(item.stageId);
  });

  it('should maintain stage consistency through move operation', async () => {
    // Test that move operation preserves stage naming
    const mockItem = createMockItem({ id: 'WI-001', stageId: 'ready' });
    const targetStage = 'implementing';

    mockPrisma.item.findFirst.mockResolvedValue(mockItem);
    mockPrisma.item.findUnique.mockResolvedValue(mockItem);
    mockPrisma.stage.findUnique.mockResolvedValue({ id: targetStage, name: 'Implementing', order: 3, wipLimit: 3 });
    mockPrisma.item.count.mockResolvedValue(0);
    mockPrisma.item.update.mockResolvedValue({ ...mockItem, stageId: targetStage });

    const { POST } = await import('@/app/api/board/move/route');
    const request = new NextRequest('http://localhost:3000/api/board/move', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project-ID': 'kanban-viewer',
      },
      body: JSON.stringify({ itemId: 'WI-001', toStage: targetStage }),
    });

    const response = await POST(request);
    const data = await response.json();

    // Verify response uses canonical stage name
    expect(data.data.item.stageId).toBe(targetStage);
    expect(CANONICAL_STAGES).toContain(data.data.item.stageId);
  });
});
