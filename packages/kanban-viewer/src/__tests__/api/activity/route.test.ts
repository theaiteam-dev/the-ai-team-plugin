import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type {
  GetActivityResponse,
  LogActivityRequest,
  LogActivityResponse,
  ActivityLogEntry,
  ApiError,
} from '@/types/api';

/**
 * Tests for GET and POST /api/activity endpoints
 *
 * These tests verify:
 * 1. GET /api/activity returns GetActivityResponse with entries array
 * 2. GET supports query params: limit (default 100), missionId (default current)
 * 3. Entries are sorted by timestamp descending (newest first)
 * 4. POST /api/activity accepts LogActivityRequest with message, optional agent and level
 * 5. POST creates ActivityLog record linked to current mission if exists
 * 6. POST returns LogActivityResponse with logged=true and timestamp
 */

// Mock activity log entries
const mockActivityEntries: ActivityLogEntry[] = [
  {
    id: 3,
    missionId: 'M-20260121-001',
    agent: 'Hannibal',
    message: 'Mission started',
    level: 'info',
    timestamp: new Date('2026-01-21T16:00:00Z'),
  },
  {
    id: 2,
    missionId: 'M-20260121-001',
    agent: 'B.A.',
    message: 'Implementing feature',
    level: 'info',
    timestamp: new Date('2026-01-21T15:30:00Z'),
  },
  {
    id: 1,
    missionId: 'M-20260121-001',
    agent: 'Murdock',
    message: 'Tests written',
    level: 'info',
    timestamp: new Date('2026-01-21T15:00:00Z'),
  },
];

// Mock Prisma client - use vi.hoisted() to ensure mock is available during vi.mock hoisting
const mockPrismaClient = vi.hoisted(() => ({
  activityLog: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

// Mock project utils - returns projectId from header or error
vi.mock('@/lib/project-utils', () => ({
  getAndValidateProjectId: vi.fn((headers: Headers) => {
    const projectId = headers.get('X-Project-ID');
    if (!projectId || projectId === '') {
      return {
        valid: false,
        error: { code: 'VALIDATION_ERROR', message: 'X-Project-ID header is required' },
      };
    }
    return { valid: true, projectId: projectId.toLowerCase() };
  }),
}));

// Import route handlers - will fail until implementation exists
import { GET, POST } from '@/app/api/activity/route';

// ============ GET /api/activity Tests ============

describe('GET /api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful requests', () => {
    it('should return GetActivityResponse with entries array', async () => {
      mockPrismaClient.activityLog.findMany.mockResolvedValue(mockActivityEntries);

      const request = new NextRequest('http://localhost:3000/api/activity', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data: GetActivityResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('entries');
      expect(Array.isArray(data.data.entries)).toBe(true);
    });

    it('should return empty entries array when no activity exists', async () => {
      mockPrismaClient.activityLog.findMany.mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/activity', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);
      const data: GetActivityResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.entries).toEqual([]);
    });

  });

  describe('query parameters', () => {
    it('should filter by projectId and not filter by missionId when no current mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.activityLog.findMany.mockResolvedValue(mockActivityEntries);

      const request = new NextRequest('http://localhost:3000/api/activity', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data: GetActivityResponse = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.entries).toHaveLength(3);
    });

    it('should return 400 when projectId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/activity', {
        headers: {}
      });
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error', async () => {
      mockPrismaClient.activityLog.findMany.mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = new NextRequest('http://localhost:3000/api/activity', {
        headers: { 'X-Project-ID': 'test-project' }
      });
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });
});

// ============ POST /api/activity Tests ============

describe('POST /api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-21T17:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('successful creation', () => {
    it('should create activity log with message only', async () => {
      const createdEntry = {
        id: 10,
        missionId: null,
        agent: null,
        message: 'Test message',
        level: 'info',
        timestamp: new Date('2026-01-21T17:00:00Z'),
      };
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.activityLog.create.mockResolvedValue(createdEntry);

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Test message',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);
      const data: LogActivityResponse = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.logged).toBe(true);
      expect(data.data.timestamp).toBeDefined();
    });

    it('should create activity log with message and agent', async () => {
      const createdEntry = {
        id: 11,
        missionId: null,
        agent: 'B.A.',
        message: 'Working on implementation',
        level: 'info',
        timestamp: new Date('2026-01-21T17:00:00Z'),
      };
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.activityLog.create.mockResolvedValue(createdEntry);

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Working on implementation',
          agent: 'B.A.',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);
      const data: LogActivityResponse = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.logged).toBe(true);
    });

    it('should create activity log with message and level', async () => {
      const createdEntry = {
        id: 12,
        missionId: null,
        agent: null,
        message: 'Something went wrong',
        level: 'error',
        timestamp: new Date('2026-01-21T17:00:00Z'),
      };
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.activityLog.create.mockResolvedValue(createdEntry);

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Something went wrong',
          level: 'error',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);
      const data: LogActivityResponse = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.logged).toBe(true);
    });

    it('should create activity log with all optional fields', async () => {
      const createdEntry = {
        id: 13,
        missionId: 'M-20260121-001',
        agent: 'Murdock',
        message: 'Warning about tests',
        level: 'warn',
        timestamp: new Date('2026-01-21T17:00:00Z'),
      };
      mockPrismaClient.mission.findFirst.mockResolvedValue({
        id: 'M-20260121-001',
        name: 'Current Mission',
        state: 'running',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue(createdEntry);

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Warning about tests',
          agent: 'Murdock',
          level: 'warn',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      const data: LogActivityResponse = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.logged).toBe(true);
    });

    it('should use default level of info when not specified', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 14,
        missionId: null,
        agent: null,
        message: 'Info message',
        level: 'info',
        timestamp: new Date('2026-01-21T17:00:00Z'),
      });

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Info message',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);
      const data: LogActivityResponse = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.logged).toBe(true);
    });
  });

  describe('response format', () => {
    it('should return LogActivityResponse with logged=true and timestamp', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 15,
        missionId: null,
        agent: null,
        message: 'Test',
        level: 'info',
        timestamp: new Date('2026-01-21T17:00:00Z'),
      });

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Test',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);
      const data: LogActivityResponse = await response.json();

      expect(response.status).toBe(201);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('logged', true);
      expect(data.data).toHaveProperty('timestamp');
    });
  });

  describe('mission linking', () => {
    it('should link activity log to current mission if exists', async () => {
      const currentMission = {
        id: 'M-20260121-001',
        name: 'Active Mission',
        state: 'running',
        prdPath: '/prd/active.md',
        startedAt: new Date('2026-01-21T14:00:00Z'),
        completedAt: null,
        archivedAt: null,
      };
      mockPrismaClient.mission.findFirst.mockResolvedValue(currentMission);
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 16,
        missionId: 'M-20260121-001',
        agent: null,
        message: 'Linked to mission',
        level: 'info',
        timestamp: new Date('2026-01-21T17:00:00Z'),
      });

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Linked to mission',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);
      const data: LogActivityResponse = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.logged).toBe(true);
    });

    it('should create activity log with null missionId when no current mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 17,
        missionId: null,
        agent: null,
        message: 'No mission',
        level: 'info',
        timestamp: new Date('2026-01-21T17:00:00Z'),
      });

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'No mission',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);
      const data: LogActivityResponse = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.logged).toBe(true);
    });
  });

  describe('validation errors', () => {
    it('should return 400 when message is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          agent: 'B.A.',
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 400 when message is empty string', async () => {
      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: '',
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should return 400 when body is empty', async () => {
      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({}),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 when body is invalid JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: 'invalid json',
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 when level is invalid', async () => {
      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Test',
          level: 'invalid',
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should return 400 when projectId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Test message',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error during creation', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);
      mockPrismaClient.activityLog.create.mockRejectedValue(
        new Error('Database error')
      );

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Test message',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 500 on database error when finding current mission', async () => {
      mockPrismaClient.mission.findFirst.mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = new NextRequest('http://localhost:3000/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-ID': 'test-project'
        },
        body: JSON.stringify({
          message: 'Test message',
        } satisfies LogActivityRequest),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });
});
