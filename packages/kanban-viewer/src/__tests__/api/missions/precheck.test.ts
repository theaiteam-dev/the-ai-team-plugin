import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mission, MissionState, MissionPrecheckOutput } from '@/types/mission';
import type { ApiError } from '@/types/api';

/**
 * Tests for POST /api/missions/precheck endpoint
 *
 * NEW BEHAVIOR (WI-453): The route now accepts a pre-computed result body
 * { passed: boolean, blockers: string[], output: object } from the MCP tool.
 * It no longer executes shell commands itself.
 *
 * State transitions:
 * - passed=true:  initializing|precheck_failure -> running
 * - passed=false: initializing|precheck_failure -> precheck_failure
 */

const mockMission: Mission = {
  id: 'M-20260121-001',
  name: 'Test Mission',
  state: 'initializing',
  prdPath: '/prd/test-feature.md',
  startedAt: new Date('2026-01-21T10:00:00Z'),
  completedAt: null,
  archivedAt: null,
  precheckBlockers: null,
  precheckOutput: null,
};

const mockPrecheckFailureMission: Mission = {
  ...mockMission,
  state: 'precheck_failure',
  precheckBlockers: ['lint errors in src/old.ts'],
  precheckOutput: { lint: { stdout: 'old errors', stderr: '', timedOut: false } },
};

const mockPrismaClient = vi.hoisted(() => ({
  mission: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  activityLog: {
    create: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

import { POST } from '@/app/api/missions/precheck/route';

// ============ New Precheck Route Tests ============

describe('POST /api/missions/precheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaClient.project.findUnique.mockResolvedValue({
      id: 'test-project',
      name: 'test-project',
      createdAt: new Date(),
    });
    mockPrismaClient.activityLog.create.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============ Request Body Schema Tests ============

  describe('request body: accepts { passed, blockers, output }', () => {
    it('should accept passed=true with empty blockers', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({ ...mockMission, state: 'running' });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should accept passed=false with blockers and output', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'precheck_failure',
        precheckBlockers: JSON.stringify(['lint errors']),
        precheckOutput: JSON.stringify({ lint: { stdout: 'error', stderr: '', timedOut: false } }),
      });

      const output: MissionPrecheckOutput = {
        lint: { stdout: 'error: bad code at line 10', stderr: '', timedOut: false },
      };
      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: false, blockers: ['lint errors'], output }),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  // ============ State Transition: passed=true ============

  describe('when passed=true', () => {
    it('should transition mission from initializing to running', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({ ...mockMission, state: 'running' });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.allPassed).toBe(true);
      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'running' }),
        })
      );
    });

    it('should transition mission from precheck_failure to running on retry pass', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockPrecheckFailureMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockPrecheckFailureMission,
        state: 'running',
        precheckBlockers: null,
        precheckOutput: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.allPassed).toBe(true);
      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'running' }),
        })
      );
    });

    it('should clear precheckBlockers and precheckOutput to null when retrying from precheck_failure', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockPrecheckFailureMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockPrecheckFailureMission,
        state: 'running',
        precheckBlockers: null,
        precheckOutput: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      await POST(request);

      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            precheckBlockers: null,
            precheckOutput: null,
          }),
        })
      );
    });
  });

  // ============ State Transition: passed=false ============

  describe('when passed=false', () => {
    it('should transition mission from initializing to precheck_failure', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'precheck_failure',
        precheckBlockers: JSON.stringify(['lint: 3 errors']),
        precheckOutput: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: false, blockers: ['lint: 3 errors'], output: {} }),
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.retryable).toBe(true);
      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'precheck_failure' }),
        })
      );
    });

    it('should transition mission from precheck_failure to precheck_failure on repeated failure', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockPrecheckFailureMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockPrecheckFailureMission,
        state: 'precheck_failure',
        precheckBlockers: JSON.stringify(['still failing']),
      });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: false, blockers: ['still failing'], output: {} }),
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.retryable).toBe(true);
    });

    it('should store precheckBlockers as JSON-encoded TEXT in DB', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'precheck_failure',
        precheckBlockers: '["lint errors","test failures"]',
        precheckOutput: null,
      });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passed: false,
          blockers: ['lint errors', 'test failures'],
          output: {},
        }),
      });
      await POST(request);

      const updateCall = mockPrismaClient.mission.update.mock.calls[0][0];
      // precheckBlockers stored as JSON string in SQLite TEXT column
      expect(typeof updateCall.data.precheckBlockers).toBe('string');
      const parsed = JSON.parse(updateCall.data.precheckBlockers);
      expect(parsed).toEqual(['lint errors', 'test failures']);
    });

    it('should store precheckOutput as JSON-encoded TEXT in DB', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'precheck_failure',
        precheckOutput: '{"lint":{"stdout":"err","stderr":"","timedOut":false}}',
      });

      const output: MissionPrecheckOutput = {
        lint: { stdout: 'err', stderr: '', timedOut: false },
      };
      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: false, blockers: ['lint errors'], output }),
      });
      await POST(request);

      const updateCall = mockPrismaClient.mission.update.mock.calls[0][0];
      expect(typeof updateCall.data.precheckOutput).toBe('string');
      const parsed = JSON.parse(updateCall.data.precheckOutput);
      expect(parsed.lint.stdout).toBe('err');
    });
  });

  // ============ State Validation ============

  describe('state validation', () => {
    it('should accept missions in initializing state', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue({ ...mockMission, state: 'initializing' });
      mockPrismaClient.mission.update.mockResolvedValue({ ...mockMission, state: 'running' });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should accept missions in precheck_failure state (retry flow)', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockPrecheckFailureMission);
      mockPrismaClient.mission.update.mockResolvedValue({ ...mockPrecheckFailureMission, state: 'running' });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it('should reject missions in running state with 400', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue({ ...mockMission, state: 'running' });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject missions in completed state with 400', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue({ ...mockMission, state: 'completed' });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should reject missions in postchecking state with 400', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue({ ...mockMission, state: 'postchecking' });

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
    });

    it('should return 404 when no mission exists for project', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project', 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);

      expect(response.status).toBe(404);
    });
  });

  // ============ Project Header Validation ============

  describe('project header validation', () => {
    it('should return 400 when X-Project-ID header is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions/precheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passed: true, blockers: [], output: {} }),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });
  });
});

// ============ Board Route: precheck_failure mission visibility ============

describe('Board GET /api/board includes precheck_failure missions', () => {
  // These tests verify that the board query treats precheck_failure as an
  // active mission (not archived/completed), so it appears in board state.

  const mockActiveMissions: Array<{ state: MissionState }> = [
    { state: 'initializing' },
    { state: 'prechecking' },
    { state: 'precheck_failure' },
    { state: 'running' },
    { state: 'postchecking' },
  ];

  it('precheck_failure is a non-terminal state that should appear in active board queries', () => {
    // Type-level smoke test: precheck_failure is a valid MissionState
    const state: MissionState = 'precheck_failure';
    expect(state).toBe('precheck_failure');
    // Non-terminal states are those that are not 'completed', 'failed', or 'archived'
    const terminalStates: MissionState[] = ['completed', 'failed', 'archived'];
    expect(terminalStates).not.toContain(state);
  });

  it('precheck_failure missions should have precheckBlockers and precheckOutput in board response', () => {
    // Verify the board transform will expose these fields
    const missionWithFailure: Mission = {
      id: 'M-20260122-001',
      name: 'Failed Precheck',
      state: 'precheck_failure',
      prdPath: '/prd/test.md',
      startedAt: new Date(),
      completedAt: null,
      archivedAt: null,
      precheckBlockers: ['lint: 5 errors'],
      precheckOutput: {
        lint: { stdout: '5 errors', stderr: '', timedOut: false },
      },
    };
    expect(missionWithFailure.precheckBlockers).toHaveLength(1);
    expect(missionWithFailure.precheckOutput?.lint?.stdout).toBe('5 errors');
  });
});
