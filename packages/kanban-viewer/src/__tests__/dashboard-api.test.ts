import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for Dashboard Refactoring to use Prisma Directly
 *
 * These tests verify that:
 * 1. BoardService functions use Prisma client instead of filesystem reads
 * 2. Server Components can import BoardService functions directly (no fetch calls)
 * 3. All existing dashboard functionality continues to work with Prisma data source
 * 4. Error handling displays user-friendly messages on database failures
 * 5. Dashboard works correctly with migrated data from filesystem
 */

// Mock data matching existing BoardService interface
const mockStages = [
  { id: 'briefings', name: 'Briefings', order: 0, wipLimit: null },
  { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
  { id: 'testing', name: 'Testing', order: 2, wipLimit: 3 },
  { id: 'implementing', name: 'Implementing', order: 3, wipLimit: 3 },
  { id: 'review', name: 'Review', order: 4, wipLimit: 2 },
  { id: 'probing', name: 'Probing', order: 5, wipLimit: 2 },
  { id: 'done', name: 'Done', order: 6, wipLimit: null },
  { id: 'blocked', name: 'Blocked', order: 7, wipLimit: null },
];

const mockItems = [
  {
    id: 'WI-001',
    title: 'Test Feature A',
    description: '## Objective\nImplement feature A',
    type: 'feature',
    priority: 'high',
    stageId: 'ready',
    assignedAgent: null,
    rejectionCount: 0,
    createdAt: new Date('2026-01-21T10:00:00Z'),
    updatedAt: new Date('2026-01-21T10:00:00Z'),
    completedAt: null,
    archivedAt: null,
    dependsOn: [],
    workLogs: [],
  },
  {
    id: 'WI-002',
    title: 'Test Feature B',
    description: '## Objective\nImplement feature B with dependency on A',
    type: 'feature',
    priority: 'medium',
    stageId: 'implementing',
    assignedAgent: 'B.A.',
    rejectionCount: 1,
    createdAt: new Date('2026-01-21T09:00:00Z'),
    updatedAt: new Date('2026-01-21T11:00:00Z'),
    completedAt: null,
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-001' }],
    workLogs: [
      {
        id: 1,
        agent: 'B.A.',
        action: 'started',
        summary: 'Started implementation',
        timestamp: new Date('2026-01-21T11:00:00Z'),
      },
    ],
  },
  {
    id: 'WI-003',
    title: 'Completed Task',
    description: '## Objective\nA completed task',
    type: 'task',
    priority: 'low',
    stageId: 'done',
    assignedAgent: null,
    rejectionCount: 0,
    createdAt: new Date('2026-01-20T10:00:00Z'),
    updatedAt: new Date('2026-01-20T18:00:00Z'),
    completedAt: new Date('2026-01-20T18:00:00Z'),
    archivedAt: null,
    dependsOn: [],
    workLogs: [
      {
        id: 2,
        agent: 'Murdock',
        action: 'completed',
        summary: 'Tests passing',
        timestamp: new Date('2026-01-20T18:00:00Z'),
      },
    ],
  },
];

const mockClaims = [
  {
    agentName: 'B.A.',
    itemId: 'WI-002',
    claimedAt: new Date('2026-01-21T11:00:00Z'),
  },
];

const mockMission = {
  id: 'M-20260121-001',
  name: 'API Layer Integration',
  state: 'running',
  prdPath: '/prd/013-mcp-interface.md',
  startedAt: new Date('2026-01-21T09:00:00Z'),
  completedAt: null,
  archivedAt: null,
};

const mockActivityLogs = [
  {
    id: 1,
    missionId: 'M-20260121-001',
    agent: 'Hannibal',
    message: 'Mission started',
    level: 'info',
    timestamp: new Date('2026-01-21T09:00:00Z'),
  },
  {
    id: 2,
    missionId: 'M-20260121-001',
    agent: 'Murdock',
    message: 'Writing tests for feature A',
    level: 'info',
    timestamp: new Date('2026-01-21T09:30:00Z'),
  },
  {
    id: 3,
    missionId: 'M-20260121-001',
    agent: 'B.A.',
    message: 'Implementation started',
    level: 'info',
    timestamp: new Date('2026-01-21T11:00:00Z'),
  },
];

// Create mock Prisma client
const mockPrisma = {
  stage: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  item: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  agentClaim: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  activityLog: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
};

// Mock the db module
vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

describe('BoardService Prisma Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default mock implementations
    mockPrisma.stage.findMany.mockResolvedValue(mockStages);
    mockPrisma.item.findMany.mockResolvedValue(mockItems.filter((i) => i.archivedAt === null));
    mockPrisma.agentClaim.findMany.mockResolvedValue(mockClaims);
    mockPrisma.mission.findFirst.mockResolvedValue(mockMission);
    mockPrisma.activityLog.findMany.mockResolvedValue(mockActivityLogs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getBoardMetadata', () => {
    it('should return board metadata with mission name from Prisma', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const metadata = await service.getBoardMetadata();

      expect(metadata).not.toBeNull();
      expect(metadata?.mission.name).toBe('API Layer Integration');
    });

    it('should return board metadata with mission status derived from Prisma', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const metadata = await service.getBoardMetadata();

      expect(metadata?.mission.status).toBeDefined();
      expect(metadata?.stats).toBeDefined();
    });

    it('should return non-null metadata when no active mission exists', async () => {
      mockPrisma.mission.findFirst.mockResolvedValue(null);

      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const metadata = await service.getBoardMetadata();

      expect(metadata).not.toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.mission.findFirst.mockRejectedValue(new Error('Connection refused'));

      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      await expect(service.getBoardMetadata()).rejects.toThrow();
    });
  });

  describe('getAllWorkItems', () => {
    it('should return correct number of items from Prisma', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const items = await service.getAllWorkItems();

      expect(items).toHaveLength(3);
    });

    it('should return items with stage property mapped from stageId', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const items = await service.getAllWorkItems();

      expect(items[0].stage).toBeDefined();
      expect(items[0].stage).toBe('ready');
    });

    it('should include dependencies array for each item', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const items = await service.getAllWorkItems();
      const itemWithDeps = items.find((i) => i.id === 'WI-002');

      expect(itemWithDeps?.dependencies).toBeDefined();
      expect(Array.isArray(itemWithDeps?.dependencies)).toBe(true);
      expect(itemWithDeps?.dependencies).toContain('WI-001');
    });

    it('should handle database errors with appropriate error message', async () => {
      mockPrisma.item.findMany.mockRejectedValue(new Error('Database unavailable'));

      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      await expect(service.getAllWorkItems()).rejects.toThrow();
    });
  });

  describe('getWorkItemsByStage', () => {
    it('should return only items matching the requested stage', async () => {
      const readyItems = mockItems.filter((i) => i.stageId === 'ready');
      mockPrisma.item.findMany.mockResolvedValue(readyItems);

      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const items = await service.getWorkItemsByStage('ready');

      expect(items.every((i) => i.stage === 'ready')).toBe(true);
    });

    it('should return empty array for stage with no items', async () => {
      mockPrisma.item.findMany.mockResolvedValue([]);

      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const items = await service.getWorkItemsByStage('blocked');

      expect(items).toEqual([]);
    });
  });

  describe('getWorkItemById', () => {
    it('should return the correct item by ID', async () => {
      const targetItem = mockItems[0];
      mockPrisma.item.findUnique.mockResolvedValue(targetItem);

      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const item = await service.getWorkItemById('WI-001');

      expect(item?.id).toBe('WI-001');
    });

    it('should return null when item not found', async () => {
      mockPrisma.item.findUnique.mockResolvedValue(null);

      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const item = await service.getWorkItemById('WI-999');

      expect(item).toBeNull();
    });

    it('should include item dependencies and work logs', async () => {
      const itemWithRelations = {
        ...mockItems[1],
        dependsOn: [{ dependsOnId: 'WI-001' }],
        workLogs: [{ id: 1, agent: 'B.A.', action: 'started', summary: 'Started', timestamp: new Date() }],
      };
      mockPrisma.item.findUnique.mockResolvedValue(itemWithRelations);

      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const item = await service.getWorkItemById('WI-002');

      expect(item?.dependencies).toBeDefined();
    });
  });

  describe('getActivityLog', () => {
    it('should return activity logs from Prisma', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const logs = await service.getActivityLog();

      expect(logs).toHaveLength(3);
    });

    it('should return logs in expected LogEntry format', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const logs = await service.getActivityLog();

      expect(logs[0]).toHaveProperty('timestamp');
      expect(logs[0]).toHaveProperty('agent');
      expect(logs[0]).toHaveProperty('message');
    });

    it('should limit results when lastN parameter provided', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([mockActivityLogs[2]]);

      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const logs = await service.getActivityLog(1);

      expect(logs).toHaveLength(1);
    });
  });
});

describe('Dashboard Backward Compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockPrisma.stage.findMany.mockResolvedValue(mockStages);
    mockPrisma.item.findMany.mockResolvedValue(mockItems.filter((i) => i.archivedAt === null));
    mockPrisma.agentClaim.findMany.mockResolvedValue(mockClaims);
    mockPrisma.mission.findFirst.mockResolvedValue(mockMission);
    mockPrisma.activityLog.findMany.mockResolvedValue(mockActivityLogs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('WorkItem format compatibility', () => {
    it('should return WorkItem objects with all required fields', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const items = await service.getAllWorkItems();
      const item = items[0];

      // Verify all required WorkItem fields are present
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('type');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('rejection_count');
      expect(item).toHaveProperty('dependencies');
      expect(item).toHaveProperty('outputs');
      expect(item).toHaveProperty('created_at');
      expect(item).toHaveProperty('updated_at');
      expect(item).toHaveProperty('stage');
      expect(item).toHaveProperty('content');
    });

    it('should map Prisma item type to WorkItem type correctly', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const items = await service.getAllWorkItems();

      expect(['feature', 'bug', 'enhancement', 'task']).toContain(items[0].type);
    });

    it('should include assigned_agent when present', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const items = await service.getAllWorkItems();
      const assignedItem = items.find((i) => i.id === 'WI-002');

      expect(assignedItem?.assigned_agent).toBe('B.A.');
    });
  });

  describe('BoardMetadata format compatibility', () => {
    it('should return BoardMetadata with all required fields', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const metadata = await service.getBoardMetadata();

      expect(metadata).toHaveProperty('mission');
      expect(metadata).toHaveProperty('wip_limits');
      expect(metadata).toHaveProperty('phases');
      expect(metadata).toHaveProperty('assignments');
      expect(metadata).toHaveProperty('agents');
      expect(metadata).toHaveProperty('stats');
      expect(metadata).toHaveProperty('last_updated');
    });

    it('should compute stats correctly from Prisma data', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const metadata = await service.getBoardMetadata();

      expect(metadata?.stats.total_items).toBeGreaterThanOrEqual(0);
      expect(metadata?.stats.completed).toBeGreaterThanOrEqual(0);
      expect(metadata?.stats.in_progress).toBeGreaterThanOrEqual(0);
    });

    it('should derive wip_limits from stages', async () => {
      const { PrismaBoardService } = await import('@/services/prisma-board-service');
      const service = new PrismaBoardService();

      const metadata = await service.getBoardMetadata();

      expect(metadata?.wip_limits).toBeDefined();
      expect(typeof metadata?.wip_limits).toBe('object');
    });
  });
});

describe('Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw descriptive error when database connection fails', async () => {
    mockPrisma.item.findMany.mockRejectedValue(
      new Error('P1001: Can\'t reach database server')
    );

    const { PrismaBoardService } = await import('@/services/prisma-board-service');
    const service = new PrismaBoardService();

    await expect(service.getAllWorkItems()).rejects.toThrow();
  });

  it('should throw descriptive error when query times out', async () => {
    mockPrisma.item.findMany.mockRejectedValue(
      new Error('P1008: Operations timed out')
    );

    const { PrismaBoardService } = await import('@/services/prisma-board-service');
    const service = new PrismaBoardService();

    await expect(service.getAllWorkItems()).rejects.toThrow();
  });

  it('should handle missing table gracefully', async () => {
    mockPrisma.item.findMany.mockRejectedValue(
      new Error('P2021: Table does not exist')
    );

    const { PrismaBoardService } = await import('@/services/prisma-board-service');
    const service = new PrismaBoardService();

    await expect(service.getAllWorkItems()).rejects.toThrow();
  });

  it('should recover from transient database errors', async () => {
    // First call fails, subsequent calls succeed
    mockPrisma.item.findMany
      .mockRejectedValueOnce(new Error('Connection reset'))
      .mockResolvedValueOnce(mockItems.filter((i) => i.archivedAt === null));

    const { PrismaBoardService } = await import('@/services/prisma-board-service');
    const service = new PrismaBoardService();

    // First call should fail
    await expect(service.getAllWorkItems()).rejects.toThrow();

    // Second call should succeed
    const items = await service.getAllWorkItems();
    expect(items).toHaveLength(3);
  });
});

describe('Server Component Direct Import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockPrisma.stage.findMany.mockResolvedValue(mockStages);
    mockPrisma.item.findMany.mockResolvedValue(mockItems.filter((i) => i.archivedAt === null));
    mockPrisma.agentClaim.findMany.mockResolvedValue(mockClaims);
    mockPrisma.mission.findFirst.mockResolvedValue(mockMission);
    mockPrisma.activityLog.findMany.mockResolvedValue(mockActivityLogs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be importable directly by Server Components', async () => {
    const importedModule = await import('@/services/prisma-board-service');

    expect(importedModule.PrismaBoardService).toBeDefined();
    expect(typeof importedModule.PrismaBoardService).toBe('function');
  });

  it('should not require HTTP fetch for data access', async () => {
    // Mock global fetch to verify it's not called
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { PrismaBoardService } = await import('@/services/prisma-board-service');
    const service = new PrismaBoardService();

    await service.getAllWorkItems();
    await service.getBoardMetadata();
    await service.getActivityLog();

    // Fetch should never be called - we're using Prisma directly
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('should be usable in async Server Component context', async () => {
    const { PrismaBoardService } = await import('@/services/prisma-board-service');

    // Simulate Server Component usage pattern
    async function ServerComponentLoader() {
      const service = new PrismaBoardService();
      const [items, metadata, logs] = await Promise.all([
        service.getAllWorkItems(),
        service.getBoardMetadata(),
        service.getActivityLog(10),
      ]);
      return { items, metadata, logs };
    }

    const result = await ServerComponentLoader();

    expect(result.items).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.logs).toBeDefined();
  });
});

describe('Migration Compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockPrisma.stage.findMany.mockResolvedValue(mockStages);
    mockPrisma.item.findMany.mockResolvedValue(mockItems.filter((i) => i.archivedAt === null));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle items migrated from filesystem with consistent IDs', async () => {
    const migratedItems = [
      { ...mockItems[0], id: '001' },
      { ...mockItems[1], id: '002' },
    ];
    mockPrisma.item.findMany.mockResolvedValue(migratedItems);

    const { PrismaBoardService } = await import('@/services/prisma-board-service');
    const service = new PrismaBoardService();

    const items = await service.getAllWorkItems();

    expect(items[0].id).toBe('001');
    expect(items[1].id).toBe('002');
  });

  it('should map stageId to stage name correctly for all stages', async () => {
    const itemsAcrossStages = [
      { ...mockItems[0], stageId: 'briefings' },
      { ...mockItems[1], stageId: 'testing' },
      { ...mockItems[2], stageId: 'done' },
    ];
    mockPrisma.item.findMany.mockResolvedValue(itemsAcrossStages);

    const { PrismaBoardService } = await import('@/services/prisma-board-service');
    const service = new PrismaBoardService();

    const items = await service.getAllWorkItems();

    expect(items[0].stage).toBe('briefings');
    expect(items[1].stage).toBe('testing');
    expect(items[2].stage).toBe('done');
  });

  it('should preserve content/description from migrated items', async () => {
    const itemWithContent = {
      ...mockItems[0],
      description: '## Objective\n\nOriginal content from markdown file',
    };
    mockPrisma.item.findMany.mockResolvedValue([itemWithContent]);

    const { PrismaBoardService } = await import('@/services/prisma-board-service');
    const service = new PrismaBoardService();

    const items = await service.getAllWorkItems();

    expect(items[0].content).toContain('Original content from markdown file');
  });
});
