import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type {
  CreateMissionRequest,
  CreateMissionResponse,
  ApiError,
} from '@/types/api';
import type { Mission } from '@/types/mission';

/**
 * Tests for GET and POST /api/missions endpoints
 *
 * These tests verify:
 * 1. GET /api/missions returns array of all Mission objects
 * 2. POST /api/missions accepts CreateMissionRequest with name and prdPath
 * 3. POST archives current active mission if one exists
 * 4. POST generates mission ID in M-YYYYMMDD-NNN format
 * 5. POST creates new mission in initializing state
 * 6. POST returns CreateMissionResponse with the new mission
 *
 * WI-045 - Project scoping acceptance criteria:
 * - [x] GET /api/missions requires projectId query parameter
 * - [x] Missing projectId returns 400 with clear error message
 * - [x] GET /api/missions returns only missions for the specified project
 * - [x] POST /api/missions creates missions with correct projectId
 */

// Mock data
const mockMissions: Mission[] = [
  {
    id: 'M-20260121-001',
    name: 'Test Mission 1',
    state: 'completed',
    prdPath: '/prd/test-1.md',
    startedAt: new Date('2026-01-21T10:00:00Z'),
    completedAt: new Date('2026-01-21T12:00:00Z'),
    archivedAt: null,
  },
  {
    id: 'M-20260121-002',
    name: 'Test Mission 2',
    state: 'running',
    prdPath: '/prd/test-2.md',
    startedAt: new Date('2026-01-21T14:00:00Z'),
    completedAt: null,
    archivedAt: null,
  },
];

// Mock Prisma client - use vi.hoisted() to ensure mock is available during vi.mock hoisting
const mockPrismaClient = vi.hoisted(() => ({
  mission: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  missionItem: {
    findMany: vi.fn(),
  },
  item: {
    updateMany: vi.fn(),
  },
  $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

// Import route handlers - will fail until implementation exists
import { GET, POST } from '@/app/api/missions/route';

// ============ GET /api/missions Tests ============

describe('GET /api/missions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful requests', () => {
    it('should return array of all missions', async () => {
      mockPrismaClient.mission.findMany.mockResolvedValue(mockMissions);

      const request = new NextRequest('http://localhost:3000/api/missions', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toHaveLength(2);
    });

    it('should return empty array when no missions exist', async () => {
      mockPrismaClient.mission.findMany.mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/missions', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
    });

    it('should return missions with correct structure', async () => {
      mockPrismaClient.mission.findMany.mockResolvedValue([mockMissions[0]]);

      const request = new NextRequest('http://localhost:3000/api/missions', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const mission = data.data[0];
      expect(mission).toHaveProperty('id');
      expect(mission).toHaveProperty('name');
      expect(mission).toHaveProperty('state');
      expect(mission).toHaveProperty('prdPath');
      expect(mission).toHaveProperty('startedAt');
      expect(mission).toHaveProperty('completedAt');
      expect(mission).toHaveProperty('archivedAt');
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error', async () => {
      mockPrismaClient.mission.findMany.mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = new NextRequest('http://localhost:3000/api/missions', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 400 for invalid ?state= filter value', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/missions?state=bogus_state',
        { headers: { 'X-Project-ID': 'test-project' } }
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toBe('Invalid state filter');
    });
  });
});

// ============ POST /api/missions Tests ============

describe('POST /api/missions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock Date to control ID generation
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-21T15:00:00Z'));
    // Mock project lookup for ensureProject
    mockPrismaClient.project.findUnique.mockResolvedValue({ id: 'kanban-viewer', name: 'kanban-viewer', createdAt: new Date() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('successful creation', () => {
    it('should create a new mission with valid request', async () => {
      const newMission: Mission = {
        id: 'M-20260121-001',
        name: 'New Test Mission',
        state: 'initializing',
        prdPath: '/prd/new-feature.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      };

      mockPrismaClient.mission.findFirst.mockResolvedValue(null); // No active mission
      mockPrismaClient.mission.count.mockResolvedValue(0); // First mission of the day
      mockPrismaClient.mission.create.mockResolvedValue(newMission);

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Test Mission',
          prdPath: '/prd/new-feature.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);
      const data: CreateMissionResponse = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.name).toBe('New Test Mission');
      expect(data.data.state).toBe('initializing');
      expect(data.data.prdPath).toBe('/prd/new-feature.md');
    });

    it('should return mission with CreateMissionResponse structure', async () => {
      const newMission: Mission = {
        id: 'M-20260121-001',
        name: 'Test Mission',
        state: 'initializing',
        prdPath: '/prd/test.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      };

      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.mission.count.mockResolvedValue(0);
      mockPrismaClient.mission.create.mockResolvedValue(newMission);

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Mission',
          prdPath: '/prd/test.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data).toHaveProperty('name');
      expect(data.data).toHaveProperty('state');
      expect(data.data).toHaveProperty('prdPath');
      expect(data.data).toHaveProperty('startedAt');
    });
  });

  describe('mission ID generation', () => {
    it('should generate ID in M-YYYYMMDD-NNN format', async () => {
      const newMission: Mission = {
        id: 'M-20260121-001',
        name: 'Test',
        state: 'initializing',
        prdPath: '/prd/test.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      };

      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.mission.count.mockResolvedValue(0);
      mockPrismaClient.mission.create.mockResolvedValue(newMission);

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test',
          prdPath: '/prd/test.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      // ID should match M-YYYYMMDD-NNN pattern
      expect(data.data.id).toMatch(/^M-\d{8}-\d{3}$/);
    });

    it('should increment sequence number for multiple missions on same day', async () => {
      // Second mission of the day
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.mission.count.mockResolvedValue(1); // One mission already exists today
      mockPrismaClient.mission.create.mockImplementation(
        async (args: {
          data: {
            id: string;
            name: string;
            state: string;
            prdPath: string;
            startedAt: Date;
          };
        }) => ({
          ...args.data,
          completedAt: null,
          archivedAt: null,
        })
      );

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Second Mission',
          prdPath: '/prd/second.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      // Should be 002 since one mission already exists
      expect(data.data.id).toBe('M-20260121-002');
    });
  });

  describe('archiving active mission', () => {
    it('should archive current active mission before creating new one', async () => {
      const activeMission: Mission = {
        id: 'M-20260121-001',
        name: 'Active Mission',
        state: 'running',
        prdPath: '/prd/active.md',
        startedAt: new Date('2026-01-21T10:00:00Z'),
        completedAt: null,
        archivedAt: null,
      };

      mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...activeMission,
        state: 'archived',
        archivedAt: new Date('2026-01-21T15:00:00Z'),
      });
      mockPrismaClient.missionItem.findMany.mockResolvedValue([]);
      mockPrismaClient.mission.count.mockResolvedValue(1);
      mockPrismaClient.mission.create.mockResolvedValue({
        id: 'M-20260121-002',
        name: 'New Mission',
        state: 'initializing',
        prdPath: '/prd/new.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Mission',
          prdPath: '/prd/new.md',
          force: true,
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      // Verify the active mission was archived
      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'M-20260121-001' },
          data: expect.objectContaining({
            state: 'archived',
            archivedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should not attempt to archive when no active mission exists', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.mission.count.mockResolvedValue(0);
      mockPrismaClient.mission.create.mockResolvedValue({
        id: 'M-20260121-001',
        name: 'First Mission',
        state: 'initializing',
        prdPath: '/prd/first.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'First Mission',
          prdPath: '/prd/first.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      await POST(request);

      // Should not have called update since there was no active mission
      expect(mockPrismaClient.mission.update).not.toHaveBeenCalled();
    });

    it('should NOT archive failed mission without force flag', async () => {
      // Without force, findFirst excludes failed/completed/archived states
      // so it returns null even though a failed mission exists
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.mission.count.mockResolvedValue(1);
      mockPrismaClient.mission.create.mockResolvedValue({
        id: 'M-20260121-002',
        name: 'New Mission',
        state: 'initializing',
        prdPath: '/prd/new.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Mission',
          prdPath: '/prd/new.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      await POST(request);

      // Verify findFirst was called with state filter (excluding failed)
      expect(mockPrismaClient.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            state: { notIn: ['completed', 'failed', 'archived'] },
          }),
        })
      );
      // Should not archive since failed mission is excluded without force
      expect(mockPrismaClient.mission.update).not.toHaveBeenCalled();
    });

    it('should archive failed mission when force: true is passed', async () => {
      const failedMission: Mission = {
        id: 'M-20260121-001',
        name: 'Failed Mission',
        state: 'failed',
        prdPath: '/prd/failed.md',
        startedAt: new Date('2026-01-21T10:00:00Z'),
        completedAt: null,
        archivedAt: null,
      };

      // With force: true, findFirst finds any non-archived mission including failed
      mockPrismaClient.mission.findFirst.mockResolvedValue(failedMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...failedMission,
        state: 'archived',
        archivedAt: new Date('2026-01-21T15:00:00Z'),
      });
      mockPrismaClient.missionItem.findMany.mockResolvedValue([]);
      mockPrismaClient.mission.count.mockResolvedValue(1);
      mockPrismaClient.mission.create.mockResolvedValue({
        id: 'M-20260121-002',
        name: 'New Mission',
        state: 'initializing',
        prdPath: '/prd/new.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Mission',
          prdPath: '/prd/new.md',
          force: true,
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      // Verify findFirst was called WITHOUT state filter (force bypasses it)
      expect(mockPrismaClient.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'test-project',
            archivedAt: null,
          }),
        })
      );
      // Verify the where clause does NOT contain the state filter
      const findFirstCall = mockPrismaClient.mission.findFirst.mock.calls[0][0];
      expect(findFirstCall.where.state).toBeUndefined();

      // Verify the failed mission was archived
      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'M-20260121-001' },
          data: expect.objectContaining({
            state: 'archived',
            archivedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should archive completed mission when force: true is passed', async () => {
      const completedMission: Mission = {
        id: 'M-20260121-001',
        name: 'Completed Mission',
        state: 'completed',
        prdPath: '/prd/completed.md',
        startedAt: new Date('2026-01-21T10:00:00Z'),
        completedAt: new Date('2026-01-21T12:00:00Z'),
        archivedAt: null,
      };

      mockPrismaClient.mission.findFirst.mockResolvedValue(completedMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...completedMission,
        state: 'archived',
        archivedAt: new Date('2026-01-21T15:00:00Z'),
      });
      mockPrismaClient.missionItem.findMany.mockResolvedValue([]);
      mockPrismaClient.mission.count.mockResolvedValue(1);
      mockPrismaClient.mission.create.mockResolvedValue({
        id: 'M-20260121-002',
        name: 'New Mission',
        state: 'initializing',
        prdPath: '/prd/new.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Mission',
          prdPath: '/prd/new.md',
          force: true,
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      // Verify the completed mission was archived
      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'M-20260121-001' },
          data: expect.objectContaining({
            state: 'archived',
          }),
        })
      );
    });

    it('should archive all items associated with the mission when archiving', async () => {
      const activeMission: Mission = {
        id: 'M-20260121-001',
        name: 'Active Mission',
        state: 'running',
        prdPath: '/prd/active.md',
        startedAt: new Date('2026-01-21T10:00:00Z'),
        completedAt: null,
        archivedAt: null,
      };

      // Mock mission items associated with the mission
      const missionItems = [
        { missionId: 'M-20260121-001', itemId: 'WI-001' },
        { missionId: 'M-20260121-001', itemId: 'WI-002' },
        { missionId: 'M-20260121-001', itemId: 'WI-003' },
      ];

      mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...activeMission,
        state: 'archived',
        archivedAt: new Date('2026-01-21T15:00:00Z'),
      });
      mockPrismaClient.missionItem.findMany.mockResolvedValue(missionItems);
      mockPrismaClient.item.updateMany.mockResolvedValue({ count: 3 });
      mockPrismaClient.mission.count.mockResolvedValue(1);
      mockPrismaClient.mission.create.mockResolvedValue({
        id: 'M-20260121-002',
        name: 'New Mission',
        state: 'initializing',
        prdPath: '/prd/new.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Mission',
          prdPath: '/prd/new.md',
          force: true,
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      // Verify missionItem.findMany was called to get associated items
      expect(mockPrismaClient.missionItem.findMany).toHaveBeenCalledWith({
        where: { missionId: 'M-20260121-001' },
        select: { itemId: true },
      });

      // Verify item.updateMany was called to archive all associated items
      expect(mockPrismaClient.item.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['WI-001', 'WI-002', 'WI-003'] },
        },
        data: {
          archivedAt: expect.any(Date),
        },
      });
    });

    it('should not call item.updateMany when mission has no associated items', async () => {
      const activeMission: Mission = {
        id: 'M-20260121-001',
        name: 'Active Mission',
        state: 'running',
        prdPath: '/prd/active.md',
        startedAt: new Date('2026-01-21T10:00:00Z'),
        completedAt: null,
        archivedAt: null,
      };

      mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...activeMission,
        state: 'archived',
        archivedAt: new Date('2026-01-21T15:00:00Z'),
      });
      mockPrismaClient.missionItem.findMany.mockResolvedValue([]); // No items
      mockPrismaClient.mission.count.mockResolvedValue(1);
      mockPrismaClient.mission.create.mockResolvedValue({
        id: 'M-20260121-002',
        name: 'New Mission',
        state: 'initializing',
        prdPath: '/prd/new.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Mission',
          prdPath: '/prd/new.md',
          force: true,
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      // Verify missionItem.findMany was called
      expect(mockPrismaClient.missionItem.findMany).toHaveBeenCalled();

      // Verify item.updateMany was NOT called since there are no items
      expect(mockPrismaClient.item.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('initializing state', () => {
    it('should create mission in initializing state', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.mission.count.mockResolvedValue(0);
      mockPrismaClient.mission.create.mockResolvedValue({
        id: 'M-20260121-001',
        name: 'Test',
        state: 'initializing',
        prdPath: '/prd/test.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test',
          prdPath: '/prd/test.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.state).toBe('initializing');

      // Verify create was called with initializing state
      expect(mockPrismaClient.mission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: 'initializing',
          }),
        })
      );
    });
  });

  describe('validation errors', () => {
    it('should return 400 when name is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          prdPath: '/prd/test.md',
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 400 when prdPath is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Mission',
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 400 when body is empty', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 when body is invalid JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: 'invalid json',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error during creation', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.mission.count.mockResolvedValue(0);
      mockPrismaClient.mission.create.mockRejectedValue(
        new Error('Database error')
      );

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test',
          prdPath: '/prd/test.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 500 on database error during archive', async () => {
      const activeMission: Mission = {
        id: 'M-20260121-001',
        name: 'Active',
        state: 'running',
        prdPath: '/prd/active.md',
        startedAt: new Date(),
        completedAt: null,
        archivedAt: null,
      };

      mockPrismaClient.mission.findFirst.mockResolvedValue(activeMission);
      mockPrismaClient.mission.update.mockRejectedValue(
        new Error('Failed to archive')
      );

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New',
          prdPath: '/prd/new.md',
          force: true,
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  // ============ WI-045: Project Scoping Tests ============

  describe('projectId query parameter (WI-045)', () => {
    it('should return 400 when projectId query parameter is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test',
          prdPath: '/prd/test.md',
        } satisfies CreateMissionRequest),
        headers: { 'Content-Type': 'application/json' },
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
      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test',
          prdPath: '/prd/test.md',
        } satisfies CreateMissionRequest),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message.toLowerCase()).toContain('required');
    });

    it('should create mission with correct projectId', async () => {
      const newMission: Mission = {
        id: 'M-20260121-001',
        name: 'Test',
        state: 'initializing',
        prdPath: '/prd/test.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      };

      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.mission.count.mockResolvedValue(0);
      mockPrismaClient.mission.create.mockResolvedValue(newMission);

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test',
          prdPath: '/prd/test.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'my-project'
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      // Verify create was called with projectId
      expect(mockPrismaClient.mission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'my-project',
          }),
        })
      );
    });

    it('should filter active mission lookup by projectId when creating', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.mission.count.mockResolvedValue(0);
      mockPrismaClient.mission.create.mockResolvedValue({
        id: 'M-20260121-001',
        name: 'Test',
        state: 'initializing',
        prdPath: '/prd/test.md',
        startedAt: new Date('2026-01-21T15:00:00Z'),
        completedAt: null,
        archivedAt: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test',
          prdPath: '/prd/test.md',
        } satisfies CreateMissionRequest),
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'my-project'
        },
      });

      await POST(request);

      // Verify findFirst filters by projectId to find active mission
      expect(mockPrismaClient.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'my-project',
          }),
        })
      );
    });
  });
});

// ============ GET /api/missions - Project Scoping Tests ============

describe('GET /api/missions - projectId validation (WI-045)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 400 when projectId query parameter is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/missions');
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toContain('X-Project-ID');
  });

  it('should return 400 with clear error message for missing projectId', async () => {
    const request = new NextRequest('http://localhost:3000/api/missions');
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error.message.toLowerCase()).toContain('required');
  });

  it('should return only missions for the specified project', async () => {
    mockPrismaClient.mission.findMany.mockResolvedValue(mockMissions);

    const request = new NextRequest('http://localhost:3000/api/missions', {
      headers: { 'X-Project-ID': 'my-project' },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);

    // Verify findMany filters by projectId
    expect(mockPrismaClient.mission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'my-project',
        }),
      })
    );
  });

  it('should return empty array for project with no missions', async () => {
    mockPrismaClient.mission.findMany.mockResolvedValue([]);

    const request = new NextRequest('http://localhost:3000/api/missions', {
      headers: { 'X-Project-ID': 'empty-project' },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toEqual([]);
  });

  it('should accept valid projectId and return data', async () => {
    mockPrismaClient.mission.findMany.mockResolvedValue(mockMissions);

    const request = new NextRequest('http://localhost:3000/api/missions', {
      headers: { 'X-Project-ID': 'kanban-viewer' },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });
});
