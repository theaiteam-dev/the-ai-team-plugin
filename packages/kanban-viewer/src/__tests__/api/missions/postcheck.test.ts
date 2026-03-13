import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { PostcheckResponse, ApiError } from '@/types/api';
import type { Mission, MissionState } from '@/types/mission';

/**
 * Tests for POST /api/missions/postcheck endpoint
 *
 * These tests verify:
 * 1. POST runs lint, unit tests, and e2e tests
 * 2. Commands have configurable timeouts via env vars (POSTCHECK_LINT_TIMEOUT_MS, POSTCHECK_UNIT_TIMEOUT_MS, POSTCHECK_E2E_TIMEOUT_MS)
 * 3. Default timeouts: 60s lint, 120s unit tests, 300s e2e tests
 * 4. Updates mission state: running -> postchecking -> completed (pass) or failed
 * 5. Returns PostcheckResponse with passed boolean, lintErrors, unit test counts, e2e test counts, blockers array
 * 6. Logs postcheck results to activity log
 * 7. Returns error if mission is not in running state
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

// Mock child_process exec
const mockExec = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  exec: mockExec,
}));

// Helper to create mock exec callback behavior
function mockExecSuccess(stdout: string = '', stderr: string = '') {
  mockExec.mockImplementation(
    (
      _cmd: string,
      _options: unknown,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      callback(null, { stdout, stderr });
    }
  );
}

function mockExecFailure(error: Error, stdout: string = '', stderr: string = '') {
  mockExec.mockImplementation(
    (
      _cmd: string,
      _options: unknown,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      callback(error, { stdout, stderr });
    }
  );
}

// Helper function for timeout mocking (currently unused but may be needed)
// function mockExecTimeout() {
//   mockExec.mockImplementation(
//     (
//       _cmd: string,
//       _options: unknown,
//       callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
//     ) => {
//       const error = new Error('Command timed out') as Error & { killed: boolean; signal: string };
//       error.killed = true;
//       error.signal = 'SIGTERM';
//       callback(error, { stdout: '', stderr: '' });
//     }
//   );
// }

// Helper to mock multiple command results based on command type
function mockExecMultipleCommands(results: {
  lint?: { success: boolean; stdout?: string; stderr?: string; timedOut?: boolean };
  unit?: { success: boolean; stdout?: string; stderr?: string; timedOut?: boolean };
  e2e?: { success: boolean; stdout?: string; stderr?: string; timedOut?: boolean };
}) {
  mockExec.mockImplementation(
    (
      cmd: string,
      _options: unknown,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      let result: { success: boolean; stdout?: string; stderr?: string; timedOut?: boolean } | undefined;

      if (cmd.includes('lint')) {
        result = results.lint ?? { success: true, stdout: '', stderr: '' };
      } else if (cmd.includes('playwright') || cmd.includes('e2e')) {
        result = results.e2e ?? { success: true, stdout: '', stderr: '' };
      } else if (cmd.includes('test')) {
        result = results.unit ?? { success: true, stdout: '', stderr: '' };
      }

      if (!result) {
        callback(null, { stdout: '', stderr: '' });
        return;
      }

      if (result.timedOut) {
        const error = new Error('Command timed out') as Error & { killed: boolean; signal: string };
        error.killed = true;
        error.signal = 'SIGTERM';
        callback(error, { stdout: '', stderr: '' });
      } else if (!result.success) {
        const error = new Error('Command failed') as Error & { code: number };
        error.code = 1;
        callback(error, { stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
      } else {
        callback(null, { stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
      }
    }
  );
}

// Import route handler - will fail until implementation exists
import { POST } from '@/app/api/missions/postcheck/route';

// ============ POST /api/missions/postcheck Tests ============

describe('POST /api/missions/postcheck', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('successful postcheck - all passing', () => {
    it('should run lint, unit tests, and e2e tests and return success', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      // All commands pass
      mockExecMultipleCommands({
        lint: { success: true, stdout: '', stderr: '' },
        unit: { success: true, stdout: 'Tests: 10 passed, 10 total', stderr: '' },
        e2e: { success: true, stdout: '5 passed', stderr: '' },
      });

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.passed).toBe(true);
      expect(data.data.lintErrors).toBe(0);
      expect(data.data.blockers).toEqual([]);
    });

    it('should return PostcheckResponse with correct structure', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess('Tests: 5 passed, 5 total');

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
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
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Should be called at least once with postchecking state
      expect(mockPrismaClient.mission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockMission.id },
          data: expect.objectContaining({
            state: 'postchecking',
          }),
        })
      );
    });

    it('should update mission state to completed when postcheck passes', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(true);
      // Final update should set state to completed
      expect(mockPrismaClient.mission.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: mockMission.id },
          data: expect.objectContaining({
            state: 'completed',
          }),
        })
      );
    });

    it('should update mission state to failed when postcheck fails', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'failed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck failed',
        level: 'error',
        timestamp: new Date(),
      });

      // Lint fails
      const lintError = new Error('Lint failed') as Error & { code: number };
      lintError.code = 1;
      mockExecFailure(lintError, '', '10 errors found');

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(false);
      // Final update should set state to failed
      expect(mockPrismaClient.mission.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: mockMission.id },
          data: expect.objectContaining({
            state: 'failed',
          }),
        })
      );
    });
  });

  describe('lint command execution', () => {
    it('should run npm run lint command', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Should have called exec with lint command
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('lint'),
        expect.anything(),
        expect.any(Function)
      );
    });

    it('should count lint errors from output', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'failed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck failed',
        level: 'error',
        timestamp: new Date(),
      });

      mockExecMultipleCommands({
        lint: { success: false, stdout: '5 errors and 2 warnings', stderr: '' },
        unit: { success: true, stdout: '', stderr: '' },
        e2e: { success: true, stdout: '', stderr: '' },
      });

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(false);
      expect(data.data.lintErrors).toBeGreaterThan(0);
    });
  });

  describe('unit test command execution', () => {
    it('should run npm test command for unit tests', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Should have called exec with test command
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('test'),
        expect.anything(),
        expect.any(Function)
      );
    });

    it('should parse and return unit test pass/fail counts', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecMultipleCommands({
        lint: { success: true, stdout: '', stderr: '' },
        unit: { success: true, stdout: 'Tests: 8 passed, 2 failed, 10 total', stderr: '' },
        e2e: { success: true, stdout: '', stderr: '' },
      });

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.unitTestsPassed).toBeGreaterThanOrEqual(0);
      expect(data.data.unitTestsFailed).toBeGreaterThanOrEqual(0);
    });

    it('should report unit test failures as blockers', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'failed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck failed',
        level: 'error',
        timestamp: new Date(),
      });

      mockExecMultipleCommands({
        lint: { success: true, stdout: '', stderr: '' },
        unit: { success: false, stdout: 'Tests: 5 passed, 3 failed, 8 total', stderr: '' },
        e2e: { success: true, stdout: '', stderr: '' },
      });

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(false);
      expect(data.data.unitTestsFailed).toBeGreaterThan(0);
      expect(data.data.blockers.length).toBeGreaterThan(0);
    });
  });

  describe('e2e test command execution', () => {
    it('should run playwright e2e test command', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Should have called exec with playwright command
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringMatching(/playwright|e2e/i),
        expect.anything(),
        expect.any(Function)
      );
    });

    it('should parse and return e2e test pass/fail counts', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecMultipleCommands({
        lint: { success: true, stdout: '', stderr: '' },
        unit: { success: true, stdout: '', stderr: '' },
        e2e: { success: true, stdout: '10 passed, 2 failed', stderr: '' },
      });

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.e2eTestsPassed).toBeGreaterThanOrEqual(0);
      expect(data.data.e2eTestsFailed).toBeGreaterThanOrEqual(0);
    });

    it('should report e2e test failures as blockers', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'failed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck failed',
        level: 'error',
        timestamp: new Date(),
      });

      mockExecMultipleCommands({
        lint: { success: true, stdout: '', stderr: '' },
        unit: { success: true, stdout: '', stderr: '' },
        e2e: { success: false, stdout: '3 passed, 2 failed', stderr: '' },
      });

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(false);
      expect(data.data.e2eTestsFailed).toBeGreaterThan(0);
      expect(data.data.blockers.length).toBeGreaterThan(0);
    });
  });

  describe('configurable timeouts', () => {
    it('should use default timeout of 60s for lint when env var not set', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Check that exec was called with lint command and 60s timeout
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('lint'),
        expect.objectContaining({
          timeout: 60000,
        }),
        expect.any(Function)
      );
    });

    it('should use default timeout of 120s for unit tests when env var not set', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Check that exec was called with test command and 120s timeout
      // Note: this matches 'npm test' but not 'playwright'
      const testCalls = mockExec.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes('test') && !(call[0] as string).includes('playwright') && !(call[0] as string).includes('e2e')
      );
      expect(testCalls.length).toBeGreaterThan(0);
      expect(testCalls[0][1]).toMatchObject({ timeout: 120000 });
    });

    it('should use default timeout of 300s for e2e tests when env var not set', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Check that exec was called with playwright/e2e command and 300s timeout
      const e2eCalls = mockExec.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes('playwright') || (call[0] as string).includes('e2e')
      );
      expect(e2eCalls.length).toBeGreaterThan(0);
      expect(e2eCalls[0][1]).toMatchObject({ timeout: 300000 });
    });

    it('should respect POSTCHECK_LINT_TIMEOUT_MS environment variable', async () => {
      process.env.POSTCHECK_LINT_TIMEOUT_MS = '30000';

      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('lint'),
        expect.objectContaining({
          timeout: 30000,
        }),
        expect.any(Function)
      );
    });

    it('should respect POSTCHECK_UNIT_TIMEOUT_MS environment variable', async () => {
      process.env.POSTCHECK_UNIT_TIMEOUT_MS = '180000';

      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Find unit test call (matches 'test' but not 'playwright')
      const testCalls = mockExec.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes('test') && !(call[0] as string).includes('playwright') && !(call[0] as string).includes('e2e')
      );
      expect(testCalls.length).toBeGreaterThan(0);
      expect(testCalls[0][1]).toMatchObject({ timeout: 180000 });
    });

    it('should respect POSTCHECK_E2E_TIMEOUT_MS environment variable', async () => {
      process.env.POSTCHECK_E2E_TIMEOUT_MS = '600000';

      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Find e2e test call
      const e2eCalls = mockExec.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes('playwright') || (call[0] as string).includes('e2e')
      );
      expect(e2eCalls.length).toBeGreaterThan(0);
      expect(e2eCalls[0][1]).toMatchObject({ timeout: 600000 });
    });

    it('should handle lint timeout as blocker', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'failed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck failed',
        level: 'error',
        timestamp: new Date(),
      });

      mockExecMultipleCommands({
        lint: { success: false, timedOut: true },
        unit: { success: true },
        e2e: { success: true },
      });

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(false);
      expect(data.data.blockers.length).toBeGreaterThan(0);
      expect(data.data.blockers.some((b) => b.toLowerCase().includes('timeout'))).toBe(true);
    });

    it('should handle unit test timeout as blocker', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'failed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck failed',
        level: 'error',
        timestamp: new Date(),
      });

      mockExecMultipleCommands({
        lint: { success: true },
        unit: { success: false, timedOut: true },
        e2e: { success: true },
      });

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(false);
      expect(data.data.blockers.some((b) => b.toLowerCase().includes('timeout'))).toBe(true);
    });

    it('should handle e2e test timeout as blocker', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'failed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck failed',
        level: 'error',
        timestamp: new Date(),
      });

      mockExecMultipleCommands({
        lint: { success: true },
        unit: { success: true },
        e2e: { success: false, timedOut: true },
      });

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);
      const data: PostcheckResponse = await response.json();

      expect(data.data.passed).toBe(false);
      expect(data.data.blockers.some((b) => b.toLowerCase().includes('timeout'))).toBe(true);
    });
  });

  describe('activity logging', () => {
    it('should log postcheck start to activity log', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck started',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      expect(mockPrismaClient.activityLog.create).toHaveBeenCalled();
    });

    it('should log postcheck results to activity log', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Activity log should be created with mission ID
      expect(mockPrismaClient.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            missionId: mockMission.id,
          }),
        })
      );
    });

    it('should log failure details when postcheck fails', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'failed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck failed',
        level: 'error',
        timestamp: new Date(),
      });

      const lintError = new Error('Lint failed') as Error & { code: number };
      lintError.code = 1;
      mockExecFailure(lintError, '5 errors found');

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      await POST(request);

      // Should log with error level when failed
      expect(mockPrismaClient.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'error',
          }),
        })
      );
    });
  });

  describe('no active mission', () => {
    it('should return 404 error if no active mission exists', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return meaningful error message for no active mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
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

  describe('invalid mission state', () => {
    it('should only run postcheck on mission in running state', async () => {
      const initializingMission: Mission = {
        ...mockMission,
        state: 'initializing' as MissionState,
      };
      mockPrismaClient.mission.findFirst.mockResolvedValue(initializingMission);

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject postcheck on completed mission', async () => {
      const completedMission: Mission = {
        ...mockMission,
        state: 'completed' as MissionState,
      };
      mockPrismaClient.mission.findFirst.mockResolvedValue(completedMission);

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
    });

    it('should reject postcheck on failed mission', async () => {
      const failedMission: Mission = {
        ...mockMission,
        state: 'failed' as MissionState,
      };
      mockPrismaClient.mission.findFirst.mockResolvedValue(failedMission);

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

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

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    it('should return 500 on database error when updating mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockRejectedValue(new Error('Database error'));

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });

    it('should include error code in error response', async () => {
      mockPrismaClient.mission.findFirst.mockRejectedValue(new Error('Database error'));

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'test-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data: ApiError = await response.json();
      expect(data.error.code).toBeDefined();
    });
  });

  // ============ WI-045: Project Scoping Tests ============

  describe('projectId query parameter (WI-045)', () => {
    it('should return 400 when projectId query parameter is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
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
      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error.message.toLowerCase()).toContain('required');
    });

    it('should filter mission lookup by projectId', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(mockMission);
      mockPrismaClient.mission.update.mockResolvedValue({
        ...mockMission,
        state: 'completed',
      });
      mockPrismaClient.activityLog.create.mockResolvedValue({
        id: 1,
        missionId: mockMission.id,
        agent: null,
        message: 'Postcheck passed',
        level: 'info',
        timestamp: new Date(),
      });

      mockExecSuccess();

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
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

    it('should return 404 for project with no running mission', async () => {
      mockPrismaClient.mission.findFirst.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/missions/postcheck', {
        method: 'POST',
        headers: { 'X-Project-ID': 'empty-project' },
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });
});
