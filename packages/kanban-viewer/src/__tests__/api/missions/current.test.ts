import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { GetCurrentMissionResponse, ApiError } from '@/types/api';
import type { Mission } from '@/types/mission';

/**
 * Tests for GET /api/missions/current endpoint
 *
 * These tests verify:
 * 1. GET /api/missions/current returns GetCurrentMissionResponse
 * 2. Returns the mission that is not archived (archivedAt IS NULL)
 * 3. Returns null data if no active mission exists
 * 4. Response includes mission with all fields: id, name, state, prdPath, startedAt, completedAt, archivedAt
 *
 * WI-045 - Project scoping acceptance criteria:
 * - [x] GET /api/missions/current requires projectId query parameter
 * - [x] Missing projectId returns 400 with clear error message
 * - [x] Returns current mission for the specified project only
 */

// Mock data
const mockActiveMission: Mission = {
  id: 'M-20260121-001',
  name: 'Current Active Mission',
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

// Archived mission (not used directly but kept for reference)
// const mockArchivedMission: Mission = {
//   id: 'M-20260120-001',
//   name: 'Archived Mission',
//   state: 'archived',
//   prdPath: '/prd/old-feature.md',
//   startedAt: new Date('2026-01-20T10:00:00Z'),
//   completedAt: new Date('2026-01-20T12:00:00Z'),
//   archivedAt: new Date('2026-01-21T00:00:00Z'),
// };

// Mock Prisma client - use vi.hoisted() to ensure mock is available during vi.mock hoisting
const mockPrismaClient = vi.hoisted(() => ({
  mission: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

// Import route handler - will fail until implementation exists
import { GET } from '@/app/api/missions/current/route';

// ============ GET /api/missions/current Tests ============

describe('GET /api/missions/current', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful requests', () => {
    it('should return current active mission (not archived)', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data: GetCurrentMissionResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).not.toBeNull();
      expect(data.data?.archivedAt).toBeNull();
    });

    it('should return mission with all required fields', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data: GetCurrentMissionResponse = await response.json();

      expect(response.status).toBe(200);
      const mission = data.data;
      expect(mission).toHaveProperty('id');
      expect(mission).toHaveProperty('name');
      expect(mission).toHaveProperty('state');
      expect(mission).toHaveProperty('prdPath');
      expect(mission).toHaveProperty('startedAt');
      expect(mission).toHaveProperty('completedAt');
      expect(mission).toHaveProperty('archivedAt');
    });

    it('should return mission values correctly', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data: GetCurrentMissionResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.data?.id).toBe('M-20260121-001');
      expect(data.data?.name).toBe('Current Active Mission');
      expect(data.data?.state).toBe('running');
      expect(data.data?.prdPath).toBe('/prd/feature-x.md');
    });

    it('should return null data when no active mission exists', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data: GetCurrentMissionResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeNull();
    });

    it('should return completed but not archived mission as current', async () => {
      // A completed mission that hasn't been archived yet is still the "current" mission
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockCompletedMission);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data: GetCurrentMissionResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).not.toBeNull();
      expect(data.data?.state).toBe('completed');
      expect(data.data?.archivedAt).toBeNull();
    });
  });

  describe('query behavior', () => {
    it('should query for mission where archivedAt is null', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      await GET(request);

      expect(mockPrismaClient.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            archivedAt: null,
          }),
        })
      );
    });

    it('should not return archived missions', async () => {
      // Even if findFirst somehow returned an archived mission, the query should filter it
      // This test verifies the query structure
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      await GET(request);

      // Verify the query was made with archivedAt: null constraint
      const callArgs = mockPrismaClient.mission.findFirst.mock.calls[0][0];
      expect(callArgs.where.archivedAt).toBe(null);
    });
  });

  describe('response format', () => {
    it('should return GetCurrentMissionResponse structure', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
    });

    it('should return GetCurrentMissionResponse with null data when no mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);
      const data = await response.json();

      expect(data).toEqual({
        success: true,
        data: null,
      });
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error', async () => {
      mockPrismaClient.mission.findFirst.mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should include error message in error response', async () => {
      mockPrismaClient.mission.findFirst.mockRejectedValue(
        new Error('Connection timeout')
      );

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'test-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.error.message).toBeDefined();
      expect(typeof data.error.message).toBe('string');
    });
  });

  // ============ WI-045: Project Scoping Tests ============

  describe('projectId query parameter (WI-045)', () => {
    it('should return 400 when projectId query parameter is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions/current');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('X-Project-ID');
    });

    it('should return 400 with clear error message for missing projectId', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions/current');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message.toLowerCase()).toContain('required');
    });

    it('should filter mission by projectId', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'my-project' },
      });
      await GET(request);

      // Verify findFirst filters by projectId
      expect(mockPrismaClient.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'my-project',
          }),
        })
      );
    });

    it('should return null for project with no current mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'empty-project' },
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeNull();
    });

    it('should accept valid projectId and return data', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockActiveMission);

      const request = new NextRequest('http://localhost:3000/api/missions/current', {
        headers: { 'X-Project-ID': 'kanban-viewer' },
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).not.toBeNull();
    });
  });
});
