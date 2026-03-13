import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for GET /api/board endpoint
 *
 * This endpoint returns the full board state including:
 * - All stages with configuration
 * - All items with dependencies and work logs (ItemWithRelations)
 * - Agent claims
 * - Current mission
 *
 * Acceptance criteria tested:
 * - [x] GET /api/board returns BoardState with stages, items, claims, and currentMission
 * - [x] Query param includeCompleted (default false) controls inclusion of done items
 * - [x] Archived items (archivedAt IS NOT NULL) are excluded from results by default
 * - [x] Items include their dependencies and work logs (ItemWithRelations)
 * - [x] Response follows GetBoardResponse type from api.ts
 * - [x] Returns proper error response on database failure
 *
 * WI-043 - Project scoping acceptance criteria:
 * - [x] GET /api/board requires projectId query parameter
 * - [x] Missing projectId returns 400 with clear error message
 * - [x] Data is filtered by projectId
 */

// Mock data
const mockStages = [
  { id: 'briefings', name: 'Backlog', order: 0, wipLimit: null },
  { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
  { id: 'testing', name: 'In Progress', order: 2, wipLimit: 5 },
  { id: 'review', name: 'Review', order: 3, wipLimit: 3 },
  { id: 'done', name: 'Done', order: 4, wipLimit: null },
  { id: 'blocked', name: 'Blocked', order: 5, wipLimit: null },
];

const mockItems = [
  {
    id: 'WI-001',
    title: 'Feature A',
    description: 'Description A',
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
    title: 'Feature B',
    description: 'Description B',
    type: 'feature',
    priority: 'medium',
    stageId: 'testing',
    assignedAgent: 'Murdock',
    rejectionCount: 0,
    createdAt: new Date('2026-01-21T09:00:00Z'),
    updatedAt: new Date('2026-01-21T11:00:00Z'),
    completedAt: null,
    archivedAt: null,
    dependsOn: [{ dependsOnId: 'WI-001' }],
    workLogs: [
      {
        id: 1,
        agent: 'Murdock',
        action: 'started',
        summary: 'Started testing',
        timestamp: new Date('2026-01-21T11:00:00Z'),
      },
    ],
  },
  {
    id: 'WI-003',
    title: 'Completed Feature',
    description: 'Done',
    type: 'feature',
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
        agent: 'B.A.',
        action: 'completed',
        summary: 'Implementation complete',
        timestamp: new Date('2026-01-20T18:00:00Z'),
      },
    ],
  },
  {
    id: 'WI-004',
    title: 'Archived Item',
    description: 'Archived',
    type: 'chore',
    priority: 'low',
    stageId: 'done',
    assignedAgent: null,
    rejectionCount: 0,
    createdAt: new Date('2026-01-19T10:00:00Z'),
    updatedAt: new Date('2026-01-19T18:00:00Z'),
    completedAt: new Date('2026-01-19T18:00:00Z'),
    archivedAt: new Date('2026-01-20T10:00:00Z'),
    dependsOn: [],
    workLogs: [],
  },
];

const mockClaims = [
  {
    agentName: 'Murdock',
    itemId: 'WI-002',
    claimedAt: new Date('2026-01-21T11:00:00Z'),
  },
];

const mockMission = {
  id: 'M-20260121-001',
  name: 'API Layer Implementation',
  state: 'running',
  prdPath: '/prd/013-mcp-interface.md',
  startedAt: new Date('2026-01-21T09:00:00Z'),
  completedAt: null,
  archivedAt: null,
};

// Create mock Prisma client
const mockPrisma = {
  stage: {
    findMany: vi.fn(),
  },
  item: {
    findMany: vi.fn(),
  },
  agentClaim: {
    findMany: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
};

// Mock the db module
vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

describe('GET /api/board', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockPrisma.stage.findMany.mockResolvedValue(mockStages);
    mockPrisma.agentClaim.findMany.mockResolvedValue(mockClaims);
    mockPrisma.mission.findFirst.mockResolvedValue(mockMission);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful requests', () => {
    it('should return BoardState with stages, items, claims, and currentMission', async () => {
      // Filter to non-archived, non-done items by default
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('stages');
      expect(data.data).toHaveProperty('items');
      expect(data.data).toHaveProperty('claims');
      expect(data.data).toHaveProperty('currentMission');
    });

    it('should return all stages ordered correctly', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.stages).toHaveLength(6);
      expect(data.data.stages[0].id).toBe('briefings');
      expect(data.data.stages[0].order).toBe(0);
    });

    it('should return agent claims', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.claims).toHaveLength(1);
      expect(data.data.claims[0].agentName).toBe('Murdock');
      expect(data.data.claims[0].itemId).toBe('WI-002');
    });

    it('should return current mission when one exists', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.currentMission).not.toBeNull();
      expect(data.data.currentMission.name).toBe('API Layer Implementation');
      expect(data.data.currentMission.state).toBe('running');
    });

    it('should return null for currentMission when no mission is running', async () => {
      mockPrisma.mission.findFirst.mockResolvedValue(null);
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.currentMission).toBeNull();
    });
  });

  describe('item filtering', () => {
    it('should exclude done items by default (includeCompleted=false)', async () => {
      // Non-archived items only (includes done by default at DB level but filtered)
      const nonArchivedItems = mockItems.filter((item) => item.archivedAt === null);
      mockPrisma.item.findMany.mockResolvedValue(nonArchivedItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      await response.json();

      // Verify prisma was called with correct filter
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            archivedAt: null,
            stageId: expect.objectContaining({ not: 'done' }),
          }),
        })
      );
    });

    it('should include done items when includeCompleted=true', async () => {
      const nonArchivedItems = mockItems.filter((item) => item.archivedAt === null);
      mockPrisma.item.findMany.mockResolvedValue(nonArchivedItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board?includeCompleted=true', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      await response.json();

      // Verify prisma was called without the done filter
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            archivedAt: null,
          }),
        })
      );
      // Verify the call does NOT exclude done items
      const callArg = mockPrisma.item.findMany.mock.calls[0][0];
      expect(callArg.where.stageId).toBeUndefined();
    });

    it('should always exclude archived items (archivedAt IS NOT NULL)', async () => {
      const nonArchivedItems = mockItems.filter((item) => item.archivedAt === null);
      mockPrisma.item.findMany.mockResolvedValue(nonArchivedItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      // Verify prisma was called with archivedAt: null filter
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            archivedAt: null,
          }),
        })
      );

      // Verify no archived items in response
      const archivedItems = data.data.items.filter(
        (item: { id: string }) => item.id === 'WI-004'
      );
      expect(archivedItems).toHaveLength(0);
    });
  });

  describe('item relations (ItemWithRelations)', () => {
    it('should include dependencies array for each item', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      // Find WI-002 which has a dependency on WI-001
      const itemWithDeps = data.data.items.find(
        (item: { id: string }) => item.id === 'WI-002'
      );
      expect(itemWithDeps).toBeDefined();
      expect(itemWithDeps.dependencies).toContain('WI-001');
    });

    it('should include workLogs array for each item', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      // Find WI-002 which has work logs
      const itemWithLogs = data.data.items.find(
        (item: { id: string }) => item.id === 'WI-002'
      );
      expect(itemWithLogs).toBeDefined();
      expect(itemWithLogs.workLogs).toHaveLength(1);
      expect(itemWithLogs.workLogs[0].agent).toBe('Murdock');
      expect(itemWithLogs.workLogs[0].action).toBe('started');
    });

    it('should request includes for dependencies and workLogs from Prisma', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      await GET(request);

      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            dependsOn: true,
            workLogs: true,
          }),
        })
      );
    });
  });

  describe('response format (GetBoardResponse)', () => {
    it('should return success: true on successful response', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);
    });

    it('should return data property containing BoardState', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data.data).toBeDefined();
      expect(typeof data.data).toBe('object');
      expect(Array.isArray(data.data.stages)).toBe(true);
      expect(Array.isArray(data.data.items)).toBe(true);
      expect(Array.isArray(data.data.claims)).toBe(true);
    });

    it('should return HTTP 200 status', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe('error handling', () => {
    it('should return 500 with ApiError on database failure', async () => {
      mockPrisma.stage.findMany.mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('DATABASE_ERROR');
      expect(data.error.message).toContain('database');
    });

    it('should return error response when item query fails', async () => {
      mockPrisma.item.findMany.mockRejectedValue(new Error('Query timeout'));

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should return error response when claims query fails', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);
      mockPrisma.agentClaim.findMany.mockRejectedValue(new Error('Claims error'));

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should return error response when mission query fails', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);
      mockPrisma.mission.findFirst.mockRejectedValue(new Error('Mission error'));

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('query parameter validation', () => {
    it('should treat includeCompleted=false explicitly the same as default', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board?includeCompleted=false', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      await response.json();

      expect(response.status).toBe(200);
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stageId: expect.objectContaining({ not: 'done' }),
          }),
        })
      );
    });

    it('should ignore invalid includeCompleted values and use default', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board?includeCompleted=invalid', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      // Should use default behavior (exclude done)
      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            stageId: expect.objectContaining({ not: 'done' }),
          }),
        })
      );
    });
  });

  // ============ WI-043: Project Scoping Tests ============

  describe('projectId query parameter (WI-043)', () => {
    it('should return 400 when X-Project-ID header is missing', async () => {
      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('X-Project-ID');
    });

    it('should return 400 with clear error message for missing X-Project-ID header', async () => {
      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board?includeCompleted=true');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message.toLowerCase()).toContain('required');
    });

    it('should accept valid X-Project-ID header and return data', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('stages');
      expect(data.data).toHaveProperty('items');
    });

    it('should filter items by projectId from header', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });
      await GET(request);

      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'kanban-viewer',
          }),
        })
      );
    });

    it('should filter mission by projectId from header', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });
      await GET(request);

      expect(mockPrisma.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'kanban-viewer',
          }),
        })
      );
    });

    it('should filter claims by items belonging to projectId from header', async () => {
      const filteredItems = mockItems.filter(
        (item) => item.archivedAt === null && item.stageId !== 'done'
      );
      mockPrisma.item.findMany.mockResolvedValue(filteredItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });
      await GET(request);

      // Claims should be filtered to only items in the project
      expect(mockPrisma.agentClaim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            item: expect.objectContaining({
              projectId: 'kanban-viewer',
            }),
          }),
        })
      );
    });

    it('should work with both X-Project-ID header and includeCompleted parameter', async () => {
      const nonArchivedItems = mockItems.filter((item) => item.archivedAt === null);
      mockPrisma.item.findMany.mockResolvedValue(nonArchivedItems);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest(
        'http://localhost:3000/api/board?includeCompleted=true',
        {
          headers: { 'X-Project-ID': 'my-app' },
        }
      );
      await GET(request);

      expect(mockPrisma.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'my-app',
            archivedAt: null,
          }),
        })
      );
      // Should NOT have the stageId: { not: 'done' } filter
      const callArg = mockPrisma.item.findMany.mock.calls[0][0];
      expect(callArg.where.stageId).toBeUndefined();
    });

    it('should return empty items array for project with no items', async () => {
      mockPrisma.item.findMany.mockResolvedValue([]);
      mockPrisma.agentClaim.findMany.mockResolvedValue([]);
      mockPrisma.mission.findFirst.mockResolvedValue(null);

      const { GET } = await import('@/app/api/board/route');
      const request = new NextRequest('http://localhost:3000/api/board', {
        headers: { 'X-Project-ID': 'empty-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.items).toEqual([]);
      expect(data.data.claims).toEqual([]);
      expect(data.data.currentMission).toBeNull();
    });
  });
});
