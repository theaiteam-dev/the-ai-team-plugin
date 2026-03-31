import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Integration tests for multi-project isolation.
 *
 * These tests verify that project scoping works correctly:
 * 1. Items created in project A are not visible in project B
 * 2. Missions are scoped to their project
 * 3. Activity logs are scoped to their project
 *
 * Test approach:
 * - Mock Prisma client to simulate database behavior
 * - Use mock implementations that filter by projectId
 * - Verify API endpoints respect project boundaries
 */

// ============ Mock Setup ============

const mockPrisma = vi.hoisted(() => ({
  project: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  stage: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
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
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  agentClaim: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  mission: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  workLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  activityLog: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// ============ Test Fixtures ============

const PROJECT_A = {
  id: 'project-a',
  name: 'Project Alpha',
  createdAt: new Date('2026-01-20T10:00:00Z'),
  updatedAt: new Date('2026-01-20T10:00:00Z'),
};

const PROJECT_B = {
  id: 'project-b',
  name: 'Project Beta',
  createdAt: new Date('2026-01-21T10:00:00Z'),
  updatedAt: new Date('2026-01-21T10:00:00Z'),
};

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
  projectId: PROJECT_A.id,
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

const createMockMission = (overrides: Record<string, unknown> = {}) => ({
  id: 'M-20260121-001',
  name: 'Test Mission',
  state: 'running',
  prdPath: '/prd/test.md',
  projectId: PROJECT_A.id,
  startedAt: new Date('2026-01-21T09:00:00Z'),
  completedAt: null,
  archivedAt: null,
  ...overrides,
});

const createMockActivityLog = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  missionId: 'M-20260121-001',
  projectId: PROJECT_A.id,
  agent: 'Hannibal',
  message: 'Test activity',
  level: 'info',
  timestamp: new Date('2026-01-21T10:00:00Z'),
  ...overrides,
});

// ============ Item Isolation Tests ============

describe('Multi-Project Isolation - Items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Items created in project A not visible in project B', () => {
    it('should return only items for the specified project', async () => {
      // Project A has 2 items, Project B has 1 item
      const projectAItems = [
        createMockItem({ id: 'WI-001', projectId: PROJECT_A.id }),
        createMockItem({ id: 'WI-002', projectId: PROJECT_A.id }),
      ];
      const projectBItems = [
        createMockItem({ id: 'WI-003', projectId: PROJECT_B.id }),
      ];

      // Mock findMany to filter by projectId
      mockPrisma.item.findMany.mockImplementation(async ({ where }) => {
        if (where?.projectId === PROJECT_A.id) {
          return projectAItems;
        } else if (where?.projectId === PROJECT_B.id) {
          return projectBItems;
        }
        return [...projectAItems, ...projectBItems];
      });

      const { GET } = await import('@/app/api/items/route');

      // Request items for Project A
      const requestA = new NextRequest('http://localhost:3000/api/items', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      const responseA = await GET(requestA);
      expect(responseA.status).toBe(200);
      const dataA = await responseA.json();
      expect(dataA.success).toBe(true);
      expect(dataA.data).toHaveLength(2);
      // Verify the IDs returned match project A items
      const idsA = dataA.data.map((item: { id: string }) => item.id);
      expect(idsA).toContain('WI-001');
      expect(idsA).toContain('WI-002');

      // Request items for Project B
      const requestB = new NextRequest('http://localhost:3000/api/items', {
        headers: { 'X-Project-ID': PROJECT_B.id },
      });
      const responseB = await GET(requestB);
      expect(responseB.status).toBe(200);
      const dataB = await responseB.json();
      expect(dataB.success).toBe(true);
      expect(dataB.data).toHaveLength(1);
      expect(dataB.data[0].id).toBe('WI-003');
    });

    it('should filter items by projectId in database query', async () => {
      mockPrisma.item.findMany.mockResolvedValue([]);

      const { GET } = await import('@/app/api/items/route');
      const request = new NextRequest('http://localhost:3000/api/items', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      await GET(request);

      // Verify Prisma was called with projectId filter
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: PROJECT_A.id,
          }),
        })
      );
    });

    it('should create item with the specified projectId', async () => {
      const createdItem = createMockItem({
        id: 'WI-004',
        title: 'New Feature',
        projectId: PROJECT_A.id,
        stageId: 'briefings',
      });

      mockPrisma.item.count.mockResolvedValue(3);
      mockPrisma.item.create.mockResolvedValue(createdItem);

      const { POST } = await import('@/app/api/items/route');
      const request = new NextRequest('http://localhost:3000/api/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': PROJECT_A.id,
        },
        body: JSON.stringify({
          title: 'New Feature',
          description: 'Feature description',
          type: 'feature',
          priority: 'high',
          objective: 'Test objective',
          acceptance: ['criterion 1'],
          context: 'Test context',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);

      // Verify item was created with projectId
      expect(mockPrisma.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: PROJECT_A.id,
          }),
        })
      );
    });

    it('should not allow item from project B to be visible when querying project A', async () => {
      // Only return items for the requested project
      mockPrisma.item.findMany.mockImplementation(async ({ where }) => {
        if (where?.projectId === PROJECT_A.id) {
          return [createMockItem({ id: 'WI-001', projectId: PROJECT_A.id })];
        }
        return [];
      });

      const { GET } = await import('@/app/api/items/route');
      const request = new NextRequest('http://localhost:3000/api/items', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      const response = await GET(request);

      const data = await response.json();
      expect(data.success).toBe(true);

      // Ensure only project A item is returned (WI-001), no WI-003 from project B
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe('WI-001');
    });

    it('should reject requests without projectId parameter', async () => {
      const { GET } = await import('@/app/api/items/route');
      const request = new NextRequest('http://localhost:3000/api/items');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message.toLowerCase()).toContain('x-project-id');
    });
  });
});

// ============ Mission Isolation Tests ============

describe('Multi-Project Isolation - Missions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Missions scoped to project', () => {
    it('should return only missions for the specified project', async () => {
      const projectAMissions = [
        createMockMission({ id: 'M-20260121-001', projectId: PROJECT_A.id, name: 'Mission Alpha 1' }),
        createMockMission({ id: 'M-20260121-002', projectId: PROJECT_A.id, name: 'Mission Alpha 2' }),
      ];
      const projectBMissions = [
        createMockMission({ id: 'M-20260122-001', projectId: PROJECT_B.id, name: 'Mission Beta 1' }),
      ];

      // Mock findMany to filter by projectId
      mockPrisma.mission.findMany.mockImplementation(async ({ where }) => {
        if (where?.projectId === PROJECT_A.id) {
          return projectAMissions;
        } else if (where?.projectId === PROJECT_B.id) {
          return projectBMissions;
        }
        return [...projectAMissions, ...projectBMissions];
      });

      const { GET } = await import('@/app/api/missions/route');

      // Request missions for Project A
      const requestA = new NextRequest('http://localhost:3000/api/missions', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      const responseA = await GET(requestA);
      expect(responseA.status).toBe(200);
      const dataA = await responseA.json();
      expect(dataA.success).toBe(true);
      expect(dataA.data).toHaveLength(2);
      // Verify the IDs returned match project A missions
      const idsA = dataA.data.map((m: { id: string }) => m.id);
      expect(idsA).toContain('M-20260121-001');
      expect(idsA).toContain('M-20260121-002');

      // Request missions for Project B
      const requestB = new NextRequest('http://localhost:3000/api/missions', {
        headers: { 'X-Project-ID': PROJECT_B.id },
      });
      const responseB = await GET(requestB);
      expect(responseB.status).toBe(200);
      const dataB = await responseB.json();
      expect(dataB.success).toBe(true);
      expect(dataB.data).toHaveLength(1);
      expect(dataB.data[0].id).toBe('M-20260122-001');
    });

    it('should create mission with the specified projectId', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-25T10:00:00Z'));

      const createdMission = createMockMission({
        id: 'M-20260125-001',
        name: 'New Mission',
        projectId: PROJECT_A.id,
        state: 'initializing',
      });

      mockPrisma.mission.findFirst.mockResolvedValue(null);
      mockPrisma.mission.count.mockResolvedValue(0);
      mockPrisma.mission.create.mockResolvedValue(createdMission);

      const { POST } = await import('@/app/api/missions/route');
      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': PROJECT_A.id,
        },
        body: JSON.stringify({
          name: 'New Mission',
          prdPath: '/prd/new.md',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);

      // Verify mission was created with projectId
      expect(mockPrisma.mission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: PROJECT_A.id,
          }),
        })
      );

      vi.useRealTimers();
    });

    it('should return current mission for the specified project only', async () => {
      const projectAMission = createMockMission({
        id: 'M-20260121-001',
        projectId: PROJECT_A.id,
        state: 'running',
      });

      // Mock findFirst to filter by projectId and state
      mockPrisma.mission.findFirst.mockImplementation(async ({ where }) => {
        if (where?.projectId === PROJECT_A.id && where?.archivedAt === null) {
          return projectAMission;
        }
        return null;
      });

      const { GET } = await import('@/app/api/missions/current/route');

      // Request current mission for Project A
      const requestA = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      const responseA = await GET(requestA);
      expect(responseA.status).toBe(200);
      const dataA = await responseA.json();
      expect(dataA.success).toBe(true);
      expect(dataA.data.id).toBe('M-20260121-001');

      // Request current mission for Project B (should be null)
      const requestB = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': PROJECT_B.id },
      });
      const responseB = await GET(requestB);
      expect(responseB.status).toBe(200);
      const dataB = await responseB.json();
      expect(dataB.data).toBeNull();
    });

    it('should not allow mission from project B to be returned when querying project A', async () => {
      mockPrisma.mission.findMany.mockImplementation(async ({ where }) => {
        if (where?.projectId === PROJECT_A.id) {
          return [createMockMission({ id: 'M-20260121-001', projectId: PROJECT_A.id })];
        }
        return [];
      });

      const { GET } = await import('@/app/api/missions/route');
      const request = new NextRequest('http://localhost:3000/api/missions', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      const response = await GET(request);

      const data = await response.json();
      expect(data.success).toBe(true);

      // Ensure only project A mission is returned
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe('M-20260121-001');
    });
  });
});

// ============ Activity Log Isolation Tests ============

describe('Multi-Project Isolation - Activity Logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Activity logs scoped to project', () => {
    it('should return only activity logs for the specified project', async () => {
      const projectALogs = [
        createMockActivityLog({ id: 1, projectId: PROJECT_A.id, message: 'Activity A1' }),
        createMockActivityLog({ id: 2, projectId: PROJECT_A.id, message: 'Activity A2' }),
      ];
      const projectBLogs = [
        createMockActivityLog({ id: 3, projectId: PROJECT_B.id, message: 'Activity B1' }),
      ];

      // Mock findMany to filter by projectId
      mockPrisma.activityLog.findMany.mockImplementation(async ({ where }) => {
        if (where?.projectId === PROJECT_A.id) {
          return projectALogs;
        } else if (where?.projectId === PROJECT_B.id) {
          return projectBLogs;
        }
        return [...projectALogs, ...projectBLogs];
      });

      const { GET } = await import('@/app/api/activity/route');

      // Request activity logs for Project A
      const requestA = new NextRequest('http://localhost:3000/api/activity', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      const responseA = await GET(requestA);
      expect(responseA.status).toBe(200);
      const dataA = await responseA.json();
      expect(dataA.success).toBe(true);
      expect(dataA.data.entries).toHaveLength(2);
      // Verify the IDs returned match project A activity logs
      const idsA = dataA.data.entries.map((log: { id: number }) => log.id);
      expect(idsA).toContain(1);
      expect(idsA).toContain(2);

      // Request activity logs for Project B
      const requestB = new NextRequest('http://localhost:3000/api/activity', {
        headers: { 'X-Project-ID': PROJECT_B.id },
      });
      const responseB = await GET(requestB);
      expect(responseB.status).toBe(200);
      const dataB = await responseB.json();
      expect(dataB.success).toBe(true);
      expect(dataB.data.entries).toHaveLength(1);
      expect(dataB.data.entries[0].id).toBe(3);
    });

    it('should create activity log with the specified projectId', async () => {
      const createdLog = createMockActivityLog({
        id: 4,
        projectId: PROJECT_A.id,
        message: 'New activity',
      });

      mockPrisma.mission.findFirst.mockResolvedValue(createMockMission({ projectId: PROJECT_A.id }));
      mockPrisma.activityLog.create.mockResolvedValue(createdLog);

      const { POST } = await import('@/app/api/activity/route');
      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': PROJECT_A.id,
        },
        body: JSON.stringify({
          message: 'New activity',
          agent: 'Hannibal',
          level: 'info',
        }),
      });

      const response = await POST(request);
      expect([200, 201]).toContain(response.status);

      // Verify activity log was created with projectId
      expect(mockPrisma.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: PROJECT_A.id,
          }),
        })
      );
    });

    it('should filter activity logs by projectId in database query', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);

      const { GET } = await import('@/app/api/activity/route');
      const request = new NextRequest('http://localhost:3000/api/activity', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      await GET(request);

      // Verify Prisma was called with projectId filter
      expect(mockPrisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: PROJECT_A.id,
          }),
        })
      );
    });

    it('should not allow activity logs from project B to be visible when querying project A', async () => {
      mockPrisma.activityLog.findMany.mockImplementation(async ({ where }) => {
        if (where?.projectId === PROJECT_A.id) {
          return [createMockActivityLog({ id: 1, projectId: PROJECT_A.id })];
        }
        return [];
      });

      const { GET } = await import('@/app/api/activity/route');
      const request = new NextRequest('http://localhost:3000/api/activity', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      const response = await GET(request);

      const data = await response.json();
      expect(data.success).toBe(true);

      // Ensure only project A activity log is returned
      expect(data.data.entries).toHaveLength(1);
      expect(data.data.entries[0].id).toBe(1);
    });
  });
});

// ============ Cross-Entity Isolation Tests ============

describe('Multi-Project Isolation - Cross-Entity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Dependencies must be within same project', () => {
    it('should reject dependency creation when dependency item belongs to different project', async () => {
      // Item in project A trying to depend on item in project B
      const itemInProjectB = createMockItem({
        id: 'WI-999',
        projectId: PROJECT_B.id,
      });

      // The route uses findMany with where: { id: { in: dependencies } }
      mockPrisma.item.findMany.mockResolvedValue([itemInProjectB]);
      mockPrisma.item.count.mockResolvedValue(0);

      const { POST } = await import('@/app/api/items/route');
      const request = new NextRequest('http://localhost:3000/api/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': PROJECT_A.id,
        },
        body: JSON.stringify({
          title: 'New Item',
          description: 'Description',
          type: 'feature',
          priority: 'medium',
          objective: 'Test objective',
          acceptance: ['criterion 1'],
          context: 'Test context',
          dependencies: ['WI-999'], // This item is in project B
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      // Error message should mention project or dependency
      expect(data.error.message.toLowerCase()).toMatch(/project|dependency/);
    });

    it('should allow dependency creation when dependency item belongs to same project', async () => {
      const dependencyItem = createMockItem({
        id: 'WI-001',
        projectId: PROJECT_A.id,
        dependsOn: [],
      });
      const createdItem = createMockItem({
        id: 'WI-002',
        projectId: PROJECT_A.id,
        dependsOn: [{ dependsOnId: 'WI-001' }],
      });

      // The route uses findMany for dependency validation
      mockPrisma.item.findMany.mockResolvedValue([dependencyItem]);
      mockPrisma.itemDependency.findMany.mockResolvedValue([]);
      mockPrisma.item.count.mockResolvedValue(1);
      mockPrisma.mission.findFirst.mockResolvedValue(null);
      mockPrisma.item.create.mockResolvedValue(createdItem);

      const { POST } = await import('@/app/api/items/route');
      const request = new NextRequest('http://localhost:3000/api/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': PROJECT_A.id,
        },
        body: JSON.stringify({
          title: 'New Item',
          description: 'Description',
          type: 'feature',
          priority: 'medium',
          objective: 'Test objective',
          acceptance: ['criterion 1'],
          context: 'Test context',
          dependencies: ['WI-001'],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);
    });
  });

  describe('Board state isolation', () => {
    it('should return board state scoped to specified project', async () => {
      const projectAItems = [
        createMockItem({ id: 'WI-001', projectId: PROJECT_A.id, stageId: 'ready' }),
      ];

      mockPrisma.stage.findMany.mockResolvedValue(createMockStages());
      mockPrisma.item.findMany.mockImplementation(async ({ where }) => {
        if (where?.projectId === PROJECT_A.id) {
          return projectAItems;
        }
        return [];
      });
      mockPrisma.agentClaim.findMany.mockResolvedValue([]);
      mockPrisma.mission.findFirst.mockResolvedValue(null);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify items returned match expected project A items
      expect(data.data.items).toHaveLength(1);
      expect(data.data.items[0].id).toBe('WI-001');
    });

    it('should filter board items by projectId', async () => {
      mockPrisma.stage.findMany.mockResolvedValue(createMockStages());
      mockPrisma.item.findMany.mockResolvedValue([]);
      mockPrisma.agentClaim.findMany.mockResolvedValue([]);
      mockPrisma.mission.findFirst.mockResolvedValue(null);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': PROJECT_A.id },
      });
      await GET(request);

      // Verify Prisma was called with projectId filter
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: PROJECT_A.id,
          }),
        })
      );
    });
  });
});
