import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { ArchiveMissionResponse, ApiError } from '@/types/api';
import type { Mission } from '@/types/mission';

/**
 * Tests for POST /api/missions/archive endpoint
 *
 * These tests verify:
 * 1. POST sets mission state to archived
 * 2. Sets archivedAt timestamp to current time
 * 3. Returns ArchiveMissionResponse with mission and count of archived items
 * 4. Returns error if no active mission exists
 * 5. Archived missions are excluded from /api/missions/current
 *
 * WI-045 - Project scoping acceptance criteria:
 * - [x] POST /api/missions/archive requires projectId query parameter
 * - [x] Missing projectId returns 400 with clear error message
 * - [x] Archives mission in specified project only
 */

// Mock data
const mockActiveMission: Mission = {
  id: 'M-20260121-001',
  name: 'Active Mission',
  state: 'running',
  prdPath: '/prd/feature-x.md',
  startedAt: new Date('2026-01-21T10:00:00Z'),
  completedAt: null,
  archivedAt: null,
};

const mockCompletedMission: Mission = {
  id: 'M-20260121-002',
  name: 'Completed Mission',
  state: 'completed',
  prdPath: '/prd/feature-y.md',
  startedAt: new Date('2026-01-21T08:00:00Z'),
  completedAt: new Date('2026-01-21T09:00:00Z'),
  archivedAt: null,
};

const mockArchivedMission: Mission = {
  id: 'M-20260121-001',
  name: 'Active Mission',
  state: 'archived',
  prdPath: '/prd/feature-x.md',
  startedAt: new Date('2026-01-21T10:00:00Z'),
  completedAt: null,
  archivedAt: new Date('2026-01-21T15:00:00Z'),
};

// Mock Prisma client - use vi.hoisted() to ensure mock is available during vi.mock hoisting
const mockPrismaClient = vi.hoisted(() => ({
  mission: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  missionItem: {
    findMany: vi.fn(),
  },
  item: {
    count: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

// Import route handler - will fail until implementation exists
import { POST } from '@/app/api/missions/archive/route';

// ============ POST /api/missions/archive Tests ============

describe('POST /api/missions/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-21T15:00:00Z'));
    // Setup default mocks
    mockPrismaClient.missionItem.findMany.mockResolvedValue([]);
    // Setup $transaction to execute the array of operations and return results
    mockPrismaClient.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => {
      return Promise.all(operations);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('successful archiving', () => {
    it('should archive the current active mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.item.count.mockResolvedValue(5);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: ArchiveMissionResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.mission.state).toBe('archived');
    });

    it('should set archivedAt timestamp to current time', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.item.count.mockResolvedValue(3);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      // Verify update was called with current timestamp
      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: 'archived',
            archivedAt: new Date('2026-01-21T15:00:00Z'),
          }),
        })
      );
    });

    it('should return ArchiveMissionResponse with mission and archivedItems count', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      // Mock 7 items linked to this mission
      mockPrismaClient.missionItem.findMany.mockResolvedValue([
        { itemId: 'WI-001' },
        { itemId: 'WI-002' },
        { itemId: 'WI-003' },
        { itemId: 'WI-004' },
        { itemId: 'WI-005' },
        { itemId: 'WI-006' },
        { itemId: 'WI-007' },
      ]);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: ArchiveMissionResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('mission');
      expect(data.data).toHaveProperty('archivedItems');
      expect(data.data.archivedItems).toBe(7);
    });

    it('should archive a completed mission', async () => {
      const archivedCompletedMission: Mission = {
        ...mockCompletedMission,
        state: 'archived',
        archivedAt: new Date('2026-01-21T15:00:00Z'),
      };

      mockPrismaClient.mission.findFirst.mockResolvedValue(mockCompletedMission);
      mockPrismaClient.mission.update.mockResolvedValue(archivedCompletedMission);
      mockPrismaClient.item.count.mockResolvedValue(10);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: ArchiveMissionResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.mission.state).toBe('archived');
    });

    it('should return zero for archivedItems when mission has no items', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.item.count.mockResolvedValue(0);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: ArchiveMissionResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.archivedItems).toBe(0);
    });
  });

  describe('no active mission', () => {
    it('should return error if no active mission exists', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should include descriptive error message when no active mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data: ApiError = await response.json();
      expect(data.error.message).toBeDefined();
      expect(typeof data.error.message).toBe('string');
    });
  });

  describe('query behavior', () => {
    it('should query for mission where archivedAt is null', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.item.count.mockResolvedValue(0);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      expect(mockPrismaClient.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            archivedAt: null,
          }),
        })
      );
    });

    it('should update the mission by ID', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.item.count.mockResolvedValue(0);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'M-20260121-001' },
        })
      );
    });

    it('should find mission items for the archived mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.missionItem.findMany.mockResolvedValue([
        { itemId: 'WI-001' },
        { itemId: 'WI-002' },
      ]);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      expect(mockPrismaClient.missionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            missionId: 'M-20260121-001',
          }),
        })
      );
    });
  });

  describe('response format', () => {
    it('should return mission with all required fields', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.item.count.mockResolvedValue(0);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: ArchiveMissionResponse = await response.json();

      expect(response.status).toBe(200);
      const mission = data.data.mission;
      expect(mission).toHaveProperty('id');
      expect(mission).toHaveProperty('name');
      expect(mission).toHaveProperty('state');
      expect(mission).toHaveProperty('prdPath');
      expect(mission).toHaveProperty('startedAt');
      expect(mission).toHaveProperty('completedAt');
      expect(mission).toHaveProperty('archivedAt');
    });

    it('should have archivedAt not null in response', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.item.count.mockResolvedValue(0);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: ArchiveMissionResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.mission.archivedAt).not.toBeNull();
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error during find', async () => {
      mockPrismaClient.mission.findFirst.mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 500 on database error during update', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockRejectedValue(
        new Error('Update failed')
      );

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should include error message in error response', async () => {
      mockPrismaClient.mission.findFirst.mockRejectedValue(
        new Error('Connection timeout')
      );

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.error.message).toBeDefined();
      expect(typeof data.error.message).toBe('string');
    });
  });

  // ============ WI-045: Project Scoping Tests ============

  describe('projectId query parameter (WI-045)', () => {
    it('should return 400 when projectId query parameter is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('X-Project-ID');
    });

    it('should return 400 with clear error message for missing projectId', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message.toLowerCase()).toContain('required');
    });

    it('should filter mission lookup by projectId', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.item.count.mockResolvedValue(0);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'my-project' },
      });

      await POST(request);

      // Verify findFirst filters by projectId
      expect(mockPrismaClient.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'my-project',
          }),
        })
      );
    });

    it('should return 404 for project with no active mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'empty-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should accept valid projectId and archive mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);
      mockPrismaClient.mission.update.mockResolvedValue(mockArchivedMission);
      mockPrismaClient.item.count.mockResolvedValue(0);

      const request = new NextRequest('http://localhost:3000/api/missions/archive', {
        method: 'POST',
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.mission.state).toBe('archived');
    });
  });
});
