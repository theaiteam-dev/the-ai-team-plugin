import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mission, MissionState } from '@/types/mission';
import type { ApiError } from '@/types/api';

/**
 * Tests for GET /api/missions/:missionId and GET /api/missions?state= filter
 *
 * WI-452 - New endpoints:
 * 1. GET /api/missions/:missionId — returns full mission details (including archived)
 * 2. GET /api/missions?state=<state> — filters missions by state
 */

// Raw Prisma model type — precheckBlockers/precheckOutput are stored as TEXT (JSON strings)
type RawMission = Omit<Mission, 'precheckBlockers' | 'precheckOutput'> & {
  precheckBlockers: string | null;
  precheckOutput: string | null;
};

const mockMissions: RawMission[] = [
  {
    id: 'M-20260121-001',
    name: 'Completed Mission',
    state: 'completed',
    prdPath: '/prd/feature-1.md',
    startedAt: new Date('2026-01-21T10:00:00Z'),
    completedAt: new Date('2026-01-21T12:00:00Z'),
    archivedAt: null,
    precheckBlockers: null,
    precheckOutput: null,
  },
  {
    id: 'M-20260122-001',
    name: 'Precheck Failed Mission',
    state: 'precheck_failure',
    prdPath: '/prd/feature-2.md',
    startedAt: new Date('2026-01-22T10:00:00Z'),
    completedAt: null,
    archivedAt: null,
    precheckBlockers: JSON.stringify(['lint errors in src/foo.ts']),
    precheckOutput: JSON.stringify({ lint: { stdout: 'error', stderr: '', timedOut: false } }),
  },
  {
    id: 'M-20260123-001',
    name: 'Archived Mission',
    state: 'archived',
    prdPath: '/prd/feature-3.md',
    startedAt: new Date('2026-01-23T10:00:00Z'),
    completedAt: new Date('2026-01-23T18:00:00Z'),
    archivedAt: new Date('2026-01-24T08:00:00Z'),
    precheckBlockers: null,
    precheckOutput: null,
  },
];

const mockPrismaClient = vi.hoisted(() => ({
  mission: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

// Import route handlers — will fail until B.A. creates the file
import { GET as getById } from '@/app/api/missions/[missionId]/route';
import { GET } from '@/app/api/missions/route';

// ============ GET /api/missions/:missionId Tests ============

describe('GET /api/missions/:missionId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaClient.project.findUnique.mockResolvedValue({
      id: 'test-project',
      name: 'test-project',
      createdAt: new Date(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('happy path', () => {
    it('should return full mission details by ID', async () => {
      mockPrismaClient.mission.findUnique.mockResolvedValue(mockMissions[0]);

      const request = new NextRequest('http://localhost:3000/api/missions/M-20260121-001', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await getById(request, { params: Promise.resolve({ missionId: 'M-20260121-001' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('M-20260121-001');
      expect(data.data.name).toBe('Completed Mission');
      expect(data.data.state).toBe('completed');
    });

    it('should return archived missions (not just active ones)', async () => {
      mockPrismaClient.mission.findUnique.mockResolvedValue(mockMissions[2]);

      const request = new NextRequest('http://localhost:3000/api/missions/M-20260123-001', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await getById(request, { params: Promise.resolve({ missionId: 'M-20260123-001' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.state).toBe('archived');
      expect(data.data.archivedAt).not.toBeNull();
    });

    it('should return mission with precheckBlockers and precheckOutput', async () => {
      mockPrismaClient.mission.findUnique.mockResolvedValue(mockMissions[1]);

      const request = new NextRequest('http://localhost:3000/api/missions/M-20260122-001', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await getById(request, { params: Promise.resolve({ missionId: 'M-20260122-001' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.state).toBe('precheck_failure');
      expect(data.data.precheckBlockers).toHaveLength(1);
      expect(data.data.precheckOutput).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should return 404 when mission does not exist', async () => {
      mockPrismaClient.mission.findUnique.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/M-NONEXISTENT', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await getById(request, { params: Promise.resolve({ missionId: 'M-NONEXISTENT' }) });

      expect(response.status).toBe(404);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should return 400 when X-Project-ID header is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions/M-20260121-001');
      const response = await getById(request, { params: Promise.resolve({ missionId: 'M-20260121-001' }) });

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should return 500 on database error', async () => {
      mockPrismaClient.mission.findUnique.mockRejectedValue(new Error('DB error'));

      const request = new NextRequest('http://localhost:3000/api/missions/M-20260121-001', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await getById(request, { params: Promise.resolve({ missionId: 'M-20260121-001' }) });

      expect(response.status).toBe(500);
    });
  });
});

// ============ GET /api/missions?state= Filter Tests ============

describe('GET /api/missions with ?state= filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaClient.project.findUnique.mockResolvedValue({
      id: 'test-project',
      name: 'test-project',
      createdAt: new Date(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('state filter', () => {
    it('should return only precheck_failure missions when state=precheck_failure', async () => {
      const precheckFailureMissions = [mockMissions[1]];
      mockPrismaClient.mission.findMany.mockResolvedValue(precheckFailureMissions);

      const request = new NextRequest(
        'http://localhost:3000/api/missions?state=precheck_failure',
        { headers: { 'X-Project-ID': 'test-project' } }
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].state).toBe('precheck_failure');
    });

    it('should return only completed missions when state=completed', async () => {
      const completedMissions = [mockMissions[0]];
      mockPrismaClient.mission.findMany.mockResolvedValue(completedMissions);

      const request = new NextRequest(
        'http://localhost:3000/api/missions?state=completed',
        { headers: { 'X-Project-ID': 'test-project' } }
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].state).toBe('completed');
    });

    it('should pass state filter to database query', async () => {
      mockPrismaClient.mission.findMany.mockResolvedValue([]);

      const request = new NextRequest(
        'http://localhost:3000/api/missions?state=archived',
        { headers: { 'X-Project-ID': 'test-project' } }
      );
      await GET(request);

      // The DB query should include a state filter
      expect(mockPrismaClient.mission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            state: 'archived',
          }),
        })
      );
    });
  });

  describe('backward compatibility (no filter)', () => {
    it('should return all missions when no state filter is provided', async () => {
      mockPrismaClient.mission.findMany.mockResolvedValue(mockMissions);

      const request = new NextRequest('http://localhost:3000/api/missions', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(3);
    });

    it('should not apply state filter in DB query when no ?state= param', async () => {
      mockPrismaClient.mission.findMany.mockResolvedValue(mockMissions);

      const request = new NextRequest('http://localhost:3000/api/missions', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      await GET(request);

      const call = mockPrismaClient.mission.findMany.mock.calls[0][0];
      // where clause should not have a state property, or state should be undefined
      expect(call?.where?.state).toBeUndefined();
    });
  });
});
