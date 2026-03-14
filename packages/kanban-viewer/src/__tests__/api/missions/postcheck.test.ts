import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { PostcheckResponse, ApiError } from '@/types/api';
import type { Mission, MissionState } from '@/types/mission';

/**
 * Tests for POST /api/missions/postcheck endpoint
 *
 * These tests verify:
 * 1. POST accepts pre-computed { passed, blockers, output } from caller
 * 2. Parses lintErrors, unitTestsPassed/Failed, e2eTestsPassed/Failed from output
 * 3. Updates mission state: running -> postchecking -> completed (pass) or failed
 * 4. Returns PostcheckResponse with passed boolean, lintErrors, unit/e2e counts, blockers
 * 5. Logs postcheck results to activity log
 * 6. Returns error if mission is not in running state
 *
 * WI-045 - Project scoping acceptance criteria:
 * - [x] POST /api/missions/postcheck requires projectId query parameter
 * - [x] Missing projectId returns 400 with clear error message
 * - [x] Runs postcheck on mission in specified project only
 */

// Mock data
const mockMission: Mission = {
  id: 'M-20260121-001',
  name: 'Test Mission',
  state: 'running',
  prdPath: '/prd/test-feature.md',
  startedAt: new Date('2026-01-21T10:00:00Z'),
  completedAt: null,
  archivedAt: null,
};

// Mock Prisma client - use vi.hoisted() to ensure mock is available during vi.mock hoisting
const mockPrismaClient = vi.hoisted(() => ({
  mission: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  activityLog: {
    create: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

// Import route handler
import { POST } from '@/app/api/missions/postcheck/route';

// Helper to build a POST request with pre-computed results
function makeRequest(
  body: Record<string, unknown> | null,
  projectId: string = 'test-project'
): NextRequest {
  const headers: Record<string, string> = {};
  if (projectId) {
    headers['X-Project-ID'] = projectId;
  }
  return new NextRequest('http://localhost:3000/api/missions/postcheck', {
    method: 'POST',
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
}

// Standard passing body
const passingBody = {
  passed: true,
  blockers: [],
  output: {
    lint: { stdout: '', stderr: '', timedOut: false },
    unit: { stdout: 'Tests: 10 passed, 10 total', stderr: '', timedOut: false },
  },
};

// ============ POST /api/missions/postcheck Tests ============

describe('POST /api/missions/postcheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaClient.mission.update.mockResolvedValue({ ...mockMission, state: 'completed' });
    mockPrismaClient.activityLog.create.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful postcheck - all passing', () => {
    it('should accept pre-computed results and return success', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const response = await POST(makeRequest(passingBody));
      const data: PostcheckResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.passed).toBe(true);
      expect(data.data.lintErrors).toBe(0);
      expect(data.data.blockers).toEqual([]);
    });

    it('should return PostcheckResponse with correct structure', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const response = await POST(makeRequest(passingBody));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('passed');
      expect(data.data).toHaveProperty('lintErrors');
      expect(data.data).toHaveProperty('unitTestsPassed');
      expect(data.data).toHaveProperty('unitTestsFailed');
      expect(data.data).toHaveProperty('e2eTestsPassed');
      expect(data.data).toHaveProperty('e2eTestsFailed');
      expect(data.data).toHaveProperty('blockers');
    });
  });

  describe('state transitions', () => {
    it('should update mission state to postchecking when starting', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      await POST(makeRequest(passingBody));

      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockMission.id },
          data: expect.objectContaining({ state: 'postchecking' }),
        })
      );
    });

    it('should update mission state to completed when postcheck passes', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const response = await POST(makeRequest(passingBody));
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(true);
      expect(mockPrismaClient.mission.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: mockMission.id },
          data: expect.objectContaining({ state: 'completed' }),
        })
      );
    });

    it('should update mission state to failed when postcheck fails', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({ ...mockMission, state: 'failed' });

      const failingBody = {
        passed: false,
        blockers: ['lint failed: 10 errors'],
        output: {
          lint: { stdout: '10 errors and 2 warnings', stderr: '', timedOut: false },
        },
      };

      const response = await POST(makeRequest(failingBody));
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(false);
      expect(mockPrismaClient.mission.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: mockMission.id },
          data: expect.objectContaining({ state: 'failed' }),
        })
      );
    });
  });

  describe('result parsing from output', () => {
    it('should parse lintErrors from output.lint stdout', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({ ...mockMission, state: 'failed' });

      const body = {
        passed: false,
        blockers: ['lint failed'],
        output: {
          lint: { stdout: '5 errors and 2 warnings', stderr: '', timedOut: false },
          unit: { stdout: '', stderr: '', timedOut: false },
        },
      };

      const response = await POST(makeRequest(body));
      const data: PostcheckResponse = await response.json();

      expect(data.data.lintErrors).toBe(5);
    });

    it('should parse lintErrors from output.lint stderr', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({ ...mockMission, state: 'failed' });

      const body = {
        passed: false,
        blockers: ['lint failed'],
        output: {
          lint: { stdout: '', stderr: '3 errors found', timedOut: false },
        },
      };

      const response = await POST(makeRequest(body));
      const data: PostcheckResponse = await response.json();

      expect(data.data.lintErrors).toBe(3);
    });

    it('should parse unitTestsPassed and unitTestsFailed from output.unit', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const body = {
        passed: true,
        blockers: [],
        output: {
          lint: { stdout: '', stderr: '', timedOut: false },
          unit: { stdout: 'Tests: 8 passed, 2 failed, 10 total', stderr: '', timedOut: false },
        },
      };

      const response = await POST(makeRequest(body));
      const data: PostcheckResponse = await response.json();

      expect(data.data.unitTestsPassed).toBe(8);
      expect(data.data.unitTestsFailed).toBe(2);
    });

    it('should parse e2eTestsPassed and e2eTestsFailed from output.e2e', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const body = {
        passed: true,
        blockers: [],
        output: {
          lint: { stdout: '', stderr: '', timedOut: false },
          unit: { stdout: '', stderr: '', timedOut: false },
          e2e: { stdout: '5 passed, 1 failed', stderr: '', timedOut: false },
        },
      };

      const response = await POST(makeRequest(body));
      const data: PostcheckResponse = await response.json();

      expect(data.data.e2eTestsPassed).toBe(5);
      expect(data.data.e2eTestsFailed).toBe(1);
    });

    it('should handle missing output keys gracefully with zero counts', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const body = { passed: true, blockers: [], output: {} };

      const response = await POST(makeRequest(body));
      const data: PostcheckResponse = await response.json();

      expect(data.data.lintErrors).toBe(0);
      expect(data.data.unitTestsPassed).toBe(0);
      expect(data.data.unitTestsFailed).toBe(0);
      expect(data.data.e2eTestsPassed).toBe(0);
      expect(data.data.e2eTestsFailed).toBe(0);
    });

    it('should handle custom check names dynamically (not hardcoded lint/unit/e2e)', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      // "linting" contains "lint" → lintErrors; "tests" → unitTests; "playwright" → e2e
      const body = {
        passed: true,
        blockers: [],
        output: {
          linting: { stdout: '2 errors found', stderr: '', timedOut: false },
          tests: { stdout: 'Tests: 7 passed, 1 failed', stderr: '', timedOut: false },
          playwright: { stdout: '3 passed', stderr: '', timedOut: false },
        },
      };

      const response = await POST(makeRequest(body));
      const data: PostcheckResponse = await response.json();

      expect(data.data.lintErrors).toBe(2);
      expect(data.data.unitTestsPassed).toBe(7);
      expect(data.data.unitTestsFailed).toBe(1);
      expect(data.data.e2eTestsPassed).toBe(3);
    });

    it('should forward blockers from the request body', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({ ...mockMission, state: 'failed' });

      const body = {
        passed: false,
        blockers: ['lint timed out after 5 minutes', 'unit failed: 3 test(s) failed'],
        output: {},
      };

      const response = await POST(makeRequest(body));
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(false);
      expect(data.data.blockers).toEqual(body.blockers);
    });
  });

  describe('input validation', () => {
    it('should return 400 for malformed JSON body', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: 'not-valid-json{{{',
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INVALID_JSON');
      // mission must NOT have been moved to postchecking
      expect(mockPrismaClient.mission.update).not.toHaveBeenCalled();
    });

    it('should return 400 if passed is missing from body', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const body = { blockers: [], output: {} };
      const response = await POST(makeRequest(body));

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      // mission must NOT have been moved to postchecking
      expect(mockPrismaClient.mission.update).not.toHaveBeenCalled();
    });

    it('should return 400 if blockers is not an array', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const body = { passed: true, blockers: 'not-an-array', output: {} };
      const response = await POST(makeRequest(body));

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should return 400 if output is not an object', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const body = { passed: true, blockers: [], output: 'bad' };
      const response = await POST(makeRequest(body));

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      // mission must NOT have been moved to postchecking
      expect(mockPrismaClient.mission.update).not.toHaveBeenCalled();
    });

    it('should return 400 if an output entry value is null', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const body = { passed: true, blockers: [], output: { lint: null } };
      const response = await POST(makeRequest(body as unknown as Record<string, unknown>));

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_ERROR');
      // mission must NOT have been moved to postchecking
      expect(mockPrismaClient.mission.update).not.toHaveBeenCalled();
    });

    it('should use empty defaults when blockers and output are omitted', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      const body = { passed: true };
      const response = await POST(makeRequest(body));

      expect(response.status).toBe(200);
      const data: PostcheckResponse = await response.json();
      expect(data.data.passed).toBe(true);
      expect(data.data.blockers).toEqual([]);
    });
  });

  describe('activity logging', () => {
    it('should log postcheck start to activity log', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      await POST(makeRequest(passingBody));

      expect(mockPrismaClient.activityLog.create).toHaveBeenCalled();
    });

    it('should log postcheck results with mission ID', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      await POST(makeRequest(passingBody));

      expect(mockPrismaClient.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ missionId: mockMission.id }),
        })
      );
    });

    it('should log with error level when postcheck fails', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({ ...mockMission, state: 'failed' });

      const failingBody = {
        passed: false,
        blockers: ['lint failed: 5 errors'],
        output: { lint: { stdout: '5 errors', stderr: '', timedOut: false } },
      };

      await POST(makeRequest(failingBody));

      expect(mockPrismaClient.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ level: 'error' }),
        })
      );
    });
  });

  describe('no active mission', () => {
    it('should return 404 if no active mission exists', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const response = await POST(makeRequest(passingBody));

      expect(response.status).toBe(404);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return meaningful error message for no active mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const response = await POST(makeRequest(passingBody));

      expect(response.status).toBe(404);
      const data: ApiError = await response.json();
      expect(typeof data.error.message).toBe('string');
    });
  });

  describe('invalid mission state', () => {
    it('should only run postcheck on mission in running state', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue({
        ...mockMission,
        state: 'initializing' as MissionState,
      });

      const response = await POST(makeRequest(passingBody));

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject postcheck on completed mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue({
        ...mockMission,
        state: 'completed' as MissionState,
      });

      const response = await POST(makeRequest(passingBody));

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject postcheck on failed mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue({
        ...mockMission,
        state: 'failed' as MissionState,
      });

      const response = await POST(makeRequest(passingBody));

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should return 500 on database error when finding mission', async () => {
      mockPrismaClient.mission.findFirst.mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await POST(makeRequest(passingBody));

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 500 on database error when updating mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockRejectedValue(new Error('Database error'));

      const response = await POST(makeRequest(passingBody));

      expect(response.status).toBe(500);
    });

    it('should include error code in error response', async () => {
      mockPrismaClient.mission.findFirst.mockRejectedValue(new Error('Database error'));

      const response = await POST(makeRequest(passingBody));

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.error.code).toBeDefined();
    });
  });

  // ============ WI-045: Project Scoping Tests ============

  describe('projectId query parameter (WI-045)', () => {
    it('should return 400 when X-Project-ID header is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        body: JSON.stringify(passingBody),
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
      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        body: JSON.stringify(passingBody),
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.message.toLowerCase()).toContain('required');
    });

    it('should filter mission lookup by projectId', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);

      await POST(makeRequest(passingBody, 'my-project'));

      expect(mockPrismaClient.mission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: 'my-project' }),
        })
      );
    });

    it('should return 404 for project with no running mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const response = await POST(makeRequest(passingBody, 'empty-project'));

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });
});
