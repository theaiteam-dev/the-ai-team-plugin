import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the HTTP client
const mockPost = vi.fn();
const mockGet = vi.fn();
vi.mock('../../client/index.js', () => ({
  createClient: () => ({
    post: mockPost,
    get: mockGet,
  }),
}));

describe('Mission Tools', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPost.mockReset();
    mockGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mission_init', () => {
    describe('happy path', () => {
      it('should create a new mission with valid inputs', async () => {
        const mockResponse = {
          data: {
            success: true,
            initialized: true,
            missionName: 'test-mission',
            archived: false,
            directories: ['briefings', 'ready', 'testing', 'implementing', 'review', 'probing', 'done', 'blocked'],
          },
          status: 201,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionInit } = await import('../../tools/missions.js');

        const result = await missionInit({
          name: 'test-mission',
          prdPath: '/docs/prd.md',
        });

        expect(mockPost).toHaveBeenCalledWith('/api/missions', {
          name: 'test-mission',
          prdPath: '/docs/prd.md',
        });
        expect(result.content[0].text).toContain('success');
        expect(result.content[0].text).toContain('test-mission');
      });

      it('should archive existing mission when force flag is true', async () => {
        const mockResponse = {
          data: {
            success: true,
            initialized: true,
            missionName: 'new-mission',
            archived: true,
            previousMission: {
              name: 'old-mission',
              archiveDir: 'archive/old-mission-2024-01-15',
              itemCount: 10,
            },
            directories: ['briefings', 'ready', 'testing', 'implementing', 'review', 'probing', 'done', 'blocked'],
          },
          status: 201,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionInit } = await import('../../tools/missions.js');

        const result = await missionInit({
          name: 'new-mission',
          prdPath: '/docs/new-prd.md',
          force: true,
        });

        expect(mockPost).toHaveBeenCalledWith('/api/missions', {
          name: 'new-mission',
          prdPath: '/docs/new-prd.md',
          force: true,
        });
        expect(result.content[0].text).toContain('archived');
      });
    });

    describe('Zod schema validation', () => {
      it('should reject missing name', async () => {
        const { MissionInitInputSchema } = await import('../../tools/missions.js');

        const invalidInput = {
          prdPath: '/docs/prd.md',
        };

        const parseResult = MissionInitInputSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
        if (!parseResult.success) {
          expect(parseResult.error.issues[0].path).toContain('name');
        }
      });

      it('should reject missing prdPath', async () => {
        const { MissionInitInputSchema } = await import('../../tools/missions.js');

        const invalidInput = {
          name: 'test-mission',
        };

        const parseResult = MissionInitInputSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
        if (!parseResult.success) {
          expect(parseResult.error.issues[0].path).toContain('prdPath');
        }
      });

      it('should default force to false', async () => {
        const { MissionInitInputSchema } = await import('../../tools/missions.js');

        const validInput = {
          name: 'test-mission',
          prdPath: '/docs/prd.md',
        };

        const parseResult = MissionInitInputSchema.safeParse(validInput);
        expect(parseResult.success).toBe(true);
        if (parseResult.success) {
          expect(parseResult.data.force).toBe(false);
        }
      });
    });

    describe('error handling', () => {
      it('should handle active mission exists error', async () => {
        const error = {
          status: 409,
          message: 'Active mission already exists. Use force flag to archive it.',
          code: 'MISSION_EXISTS',
        };
        mockPost.mockRejectedValueOnce(error);

        const { missionInit } = await import('../../tools/missions.js');

        const result = await missionInit({
          name: 'test-mission',
          prdPath: '/docs/prd.md',
        });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('exists');
      });

      it('should handle invalid PRD path error', async () => {
        const error = {
          status: 400,
          message: 'PRD file not found: /invalid/path.md',
          code: 'INVALID_PRD_PATH',
        };
        mockPost.mockRejectedValueOnce(error);

        const { missionInit } = await import('../../tools/missions.js');

        const result = await missionInit({
          name: 'test-mission',
          prdPath: '/invalid/path.md',
        });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('not found');
      });
    });
  });

  describe('mission_current', () => {
    describe('happy path', () => {
      it('should return active mission metadata', async () => {
        const mockResponse = {
          data: {
            success: true,
            mission: {
              name: 'current-mission',
              status: 'active',
              created_at: '2024-01-15T10:00:00Z',
              postcheck: null,
            },
            progress: {
              done: 3,
              total: 10,
            },
            wip: {
              current: 2,
              limit: 3,
            },
            columns: {
              briefings: ['WI-001', 'WI-002'],
              ready: ['WI-003'],
              testing: ['WI-004'],
              implementing: ['WI-005'],
              review: [],
              probing: [],
              done: ['WI-006', 'WI-007', 'WI-008'],
              blocked: [],
            },
          },
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { missionCurrent } = await import('../../tools/missions.js');

        const result = await missionCurrent({});

        expect(mockGet).toHaveBeenCalledWith('/api/missions/current');
        expect(result.content[0].text).toContain('current-mission');
        expect(result.content[0].text).toContain('"done":3');
        expect(result.content[0].text).toContain('"total":10');
      });

      it('should include postcheck info when available', async () => {
        const mockResponse = {
          data: {
            success: true,
            mission: {
              name: 'current-mission',
              status: 'active',
              created_at: '2024-01-15T10:00:00Z',
              postcheck: {
                timestamp: '2024-01-15T12:00:00Z',
                passed: true,
                checks: [
                  { name: 'lint', passed: true },
                  { name: 'unit', passed: true },
                  { name: 'e2e', passed: true },
                ],
              },
            },
            progress: {
              done: 10,
              total: 10,
            },
            wip: {
              current: 0,
              limit: 3,
            },
            columns: {
              briefings: [],
              ready: [],
              testing: [],
              implementing: [],
              review: [],
              probing: [],
              done: ['WI-001', 'WI-002', 'WI-003', 'WI-004', 'WI-005', 'WI-006', 'WI-007', 'WI-008', 'WI-009', 'WI-010'],
              blocked: [],
            },
          },
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { missionCurrent } = await import('../../tools/missions.js');

        const result = await missionCurrent({});

        expect(result.content[0].text).toContain('postcheck');
        expect(result.content[0].text).toContain('"passed":true');
      });
    });

    describe('error handling', () => {
      it('should handle no active mission error', async () => {
        const error = {
          status: 404,
          message: 'No active mission found',
          code: 'NO_ACTIVE_MISSION',
        };
        mockGet.mockRejectedValueOnce(error);

        const { missionCurrent } = await import('../../tools/missions.js');

        const result = await missionCurrent({});

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('No active mission');
      });
    });
  });

  describe('mission_precheck', () => {
    describe('new schema: { passed, blockers, output }', () => {
      it('should send passed=true with empty blockers and output to the API', async () => {
        const mockResponse = {
          data: {
            success: true,
            allPassed: true,
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionPrecheck } = await import('../../tools/missions.js');

        const result = await missionPrecheck({
          passed: true,
          blockers: [],
          output: {},
        });

        expect(mockPost).toHaveBeenCalledWith('/api/missions/precheck', {
          passed: true,
          blockers: [],
          output: {},
        });
        expect(result.content[0].text).toContain('allPassed');
      });

      it('should send passed=false with blockers and output to the API', async () => {
        const mockResponse = {
          data: {
            success: true,
            allPassed: false,
            retryable: true,
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionPrecheck } = await import('../../tools/missions.js');

        const result = await missionPrecheck({
          passed: false,
          blockers: ['lint: 3 errors', 'test suite failing'],
          output: { lint: { stdout: 'errors...', stderr: '', timedOut: false } },
        });

        expect(mockPost).toHaveBeenCalledWith('/api/missions/precheck', {
          passed: false,
          blockers: ['lint: 3 errors', 'test suite failing'],
          output: { lint: { stdout: 'errors...', stderr: '', timedOut: false } },
        });
        expect(result.content[0].text).toContain('retryable');
      });

      it('should report failure result in response text', async () => {
        const mockResponse = {
          data: {
            success: true,
            allPassed: false,
            retryable: true,
            blockers: ['lint errors found'],
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionPrecheck } = await import('../../tools/missions.js');

        const result = await missionPrecheck({
          passed: false,
          blockers: ['lint errors found'],
          output: {},
        });

        expect(result.content[0].text).toContain('"allPassed":false');
      });
    });

    describe('Zod schema validation', () => {
      it('should reject call missing required passed field', async () => {
        const { MissionPrecheckInputSchema } = await import('../../tools/missions.js');

        const invalidInput = {
          blockers: [],
          output: {},
        };

        const parseResult = MissionPrecheckInputSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
        if (!parseResult.success) {
          const paths = parseResult.error.issues.flatMap((i) => i.path);
          expect(paths).toContain('passed');
        }
      });

      it('should accept valid input with passed, blockers, output', async () => {
        const { MissionPrecheckInputSchema } = await import('../../tools/missions.js');

        const validInput = {
          passed: true,
          blockers: [],
          output: {},
        };

        const parseResult = MissionPrecheckInputSchema.safeParse(validInput);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('error handling', () => {
      it('should handle no active mission error', async () => {
        const error = {
          status: 404,
          message: 'No active mission found',
          code: 'NO_ACTIVE_MISSION',
        };
        mockPost.mockRejectedValueOnce(error);

        const { missionPrecheck } = await import('../../tools/missions.js');

        const result = await missionPrecheck({
          passed: true,
          blockers: [],
          output: {},
        });

        expect(result.isError).toBe(true);
      });

      it('should handle invalid state error (mission not in initializing/precheck_failure)', async () => {
        const error = {
          status: 400,
          message: 'Mission is not in a valid state for precheck',
          code: 'INVALID_STATE',
        };
        mockPost.mockRejectedValueOnce(error);

        const { missionPrecheck } = await import('../../tools/missions.js');

        const result = await missionPrecheck({
          passed: true,
          blockers: [],
          output: {},
        });

        expect(result.isError).toBe(true);
      });
    });
  });

  describe('mission_postcheck', () => {
    describe('happy path', () => {
      it('should forward pre-computed passing results to API', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              passed: true,
              lintErrors: 0,
              unitTestsPassed: 10,
              unitTestsFailed: 0,
              e2eTestsPassed: 0,
              e2eTestsFailed: 0,
              blockers: [],
            },
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionPostcheck } = await import('../../tools/missions.js');

        const input = {
          passed: true,
          blockers: [],
          output: {
            lint: { stdout: '', stderr: '', timedOut: false },
            unit: { stdout: 'Tests: 10 passed', stderr: '', timedOut: false },
          },
        };
        const result = await missionPostcheck(input);

        expect(mockPost).toHaveBeenCalledWith('/api/missions/postcheck', {
          passed: true,
          blockers: [],
          output: input.output,
        });
        expect(result.content[0].text).toContain('"passed":true');
      });

      it('should forward pre-computed failing results to API', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              passed: false,
              lintErrors: 5,
              unitTestsPassed: 0,
              unitTestsFailed: 0,
              e2eTestsPassed: 0,
              e2eTestsFailed: 0,
              blockers: ['lint failed: 5 errors found'],
            },
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionPostcheck } = await import('../../tools/missions.js');

        const input = {
          passed: false,
          blockers: ['lint failed: 5 errors found'],
          output: {
            lint: { stdout: '5 errors and 2 warnings', stderr: '', timedOut: false },
          },
        };
        const result = await missionPostcheck(input);

        expect(mockPost).toHaveBeenCalledWith('/api/missions/postcheck', {
          passed: false,
          blockers: input.blockers,
          output: input.output,
        });
        expect(result.content[0].text).toContain('"passed":false');
      });

      it('should use empty defaults for blockers and output when omitted', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: {
              passed: true,
              lintErrors: 0,
              unitTestsPassed: 0,
              unitTestsFailed: 0,
              e2eTestsPassed: 0,
              e2eTestsFailed: 0,
              blockers: [],
            },
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionPostcheck } = await import('../../tools/missions.js');

        await missionPostcheck({ passed: true });

        expect(mockPost).toHaveBeenCalledWith('/api/missions/postcheck', {
          passed: true,
          blockers: [],
          output: {},
        });
      });
    });

    describe('error handling', () => {
      it('should handle no active mission error', async () => {
        const error = {
          status: 404,
          message: 'No active mission to postcheck',
          code: 'NO_ACTIVE_MISSION',
        };
        mockPost.mockRejectedValueOnce(error);

        const { missionPostcheck } = await import('../../tools/missions.js');

        const result = await missionPostcheck({ passed: true });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('No active mission');
      });
    });
  });

  describe('mission_archive', () => {
    describe('happy path', () => {
      it('should archive specific items', async () => {
        const mockResponse = {
          data: {
            success: true,
            archived: 3,
            destination: 'archive/test-mission-2024-01-15',
            items: ['WI-001', 'WI-002', 'WI-003'],
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionArchive } = await import('../../tools/missions.js');

        const result = await missionArchive({
          itemIds: ['WI-001', 'WI-002', 'WI-003'],
        });

        expect(mockPost).toHaveBeenCalledWith('/api/missions/archive', {
          itemIds: ['WI-001', 'WI-002', 'WI-003'],
        });
        expect(result.content[0].text).toContain('"archived":3');
      });

      it('should perform dry run when dryRun is true', async () => {
        const mockResponse = {
          data: {
            success: true,
            wouldArchive: 5,
            items: ['WI-001', 'WI-002', 'WI-003', 'WI-004', 'WI-005'],
            dryRun: true,
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionArchive } = await import('../../tools/missions.js');

        const result = await missionArchive({
          dryRun: true,
        });

        expect(mockPost).toHaveBeenCalledWith('/api/missions/archive', {
          dryRun: true,
        });
        expect(result.content[0].text).toContain('"wouldArchive":5');
        expect(result.content[0].text).toContain('"dryRun":true');
      });

      it('should archive entire mission when complete is true', async () => {
        const mockResponse = {
          data: {
            success: true,
            missionComplete: true,
            archived: 10,
            destination: 'archive/test-mission-2024-01-15',
            summary: 'Mission completed successfully',
            activityLogArchived: true,
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { missionArchive } = await import('../../tools/missions.js');

        const result = await missionArchive({
          complete: true,
        });

        expect(mockPost).toHaveBeenCalledWith('/api/missions/archive', {
          complete: true,
        });
        expect(result.content[0].text).toContain('missionComplete');
        expect(result.content[0].text).toContain('Mission completed successfully');
      });
    });

    describe('Zod schema validation', () => {
      it('should default complete to false', async () => {
        const { MissionArchiveInputSchema } = await import('../../tools/missions.js');

        const validInput = {};

        const parseResult = MissionArchiveInputSchema.safeParse(validInput);
        expect(parseResult.success).toBe(true);
        if (parseResult.success) {
          expect(parseResult.data.complete).toBe(false);
        }
      });

      it('should default dryRun to false', async () => {
        const { MissionArchiveInputSchema } = await import('../../tools/missions.js');

        const validInput = {};

        const parseResult = MissionArchiveInputSchema.safeParse(validInput);
        expect(parseResult.success).toBe(true);
        if (parseResult.success) {
          expect(parseResult.data.dryRun).toBe(false);
        }
      });
    });

    describe('error handling', () => {
      it('should handle no active mission error', async () => {
        const error = {
          status: 404,
          message: 'No active mission to archive',
          code: 'NO_ACTIVE_MISSION',
        };
        mockPost.mockRejectedValueOnce(error);

        const { missionArchive } = await import('../../tools/missions.js');

        const result = await missionArchive({});

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('No active mission');
      });

      it('should handle item not found error', async () => {
        const error = {
          status: 404,
          message: 'Items not found: WI-999',
          code: 'ITEM_NOT_FOUND',
        };
        mockPost.mockRejectedValueOnce(error);

        const { missionArchive } = await import('../../tools/missions.js');

        const result = await missionArchive({
          itemIds: ['WI-999'],
        });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('not found');
      });
    });
  });

  describe('mission_list', () => {
    describe('happy path', () => {
      it('should call GET /api/missions without params when no filter provided', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: [
              { id: 'M-20260121-001', name: 'Mission 1', state: 'completed' },
              { id: 'M-20260122-001', name: 'Mission 2', state: 'precheck_failure' },
            ],
          },
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { missionList } = await import('../../tools/missions.js');

        const result = await missionList({});

        expect(mockGet).toHaveBeenCalledWith('/api/missions');
        expect(result.content[0].text).toContain('Mission 1');
      });

      it('should call GET /api/missions?state=precheck_failure when state filter provided', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: [
              { id: 'M-20260122-001', name: 'Failed Precheck', state: 'precheck_failure' },
            ],
          },
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { missionList } = await import('../../tools/missions.js');

        const result = await missionList({ state: 'precheck_failure' });

        expect(mockGet).toHaveBeenCalledWith('/api/missions?state=precheck_failure');
        expect(result.content[0].text).toContain('precheck_failure');
      });

      it('should call GET /api/missions?state=completed when state=completed filter provided', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: [
              { id: 'M-20260121-001', name: 'Done Mission', state: 'completed' },
            ],
          },
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { missionList } = await import('../../tools/missions.js');

        await missionList({ state: 'completed' });

        expect(mockGet).toHaveBeenCalledWith('/api/missions?state=completed');
      });

      it('should return empty list when no missions match filter', async () => {
        const mockResponse = {
          data: {
            success: true,
            data: [],
          },
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { missionList } = await import('../../tools/missions.js');

        const result = await missionList({ state: 'archived' });

        expect(result.content[0].text).toBeDefined();
      });
    });

    describe('Zod schema validation', () => {
      it('should accept empty input (no filter)', async () => {
        const { MissionListInputSchema } = await import('../../tools/missions.js');

        const parseResult = MissionListInputSchema.safeParse({});
        expect(parseResult.success).toBe(true);
      });

      it('should accept valid state filter values', async () => {
        const { MissionListInputSchema } = await import('../../tools/missions.js');

        for (const state of ['initializing', 'prechecking', 'precheck_failure', 'running', 'postchecking', 'completed', 'failed', 'archived']) {
          const parseResult = MissionListInputSchema.safeParse({ state });
          expect(parseResult.success).toBe(true);
        }
      });
    });

    describe('error handling', () => {
      it('should handle database error gracefully', async () => {
        const error = {
          status: 500,
          message: 'Database error',
          code: 'DATABASE_ERROR',
        };
        mockGet.mockRejectedValueOnce(error);

        const { missionList } = await import('../../tools/missions.js');

        const result = await missionList({});

        expect(result.isError).toBe(true);
      });
    });
  });
});
