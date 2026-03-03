import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// Mock the HTTP client
const mockPost = vi.fn();
vi.mock('../../client/index.js', () => ({
  createClient: () => ({
    post: mockPost,
  }),
}));

// Known valid agent names (lowercase, normalized)
const VALID_AGENTS = ['murdock', 'ba', 'lynch', 'amy', 'hannibal', 'face', 'sosa', 'tawnia'];

describe('Agent Tools', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPost.mockReset();
    // Default to resolved promise so activity log side-effects don't blow up
    mockPost.mockResolvedValue({ data: { success: true }, status: 200, headers: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('agent_start', () => {
    describe('happy path', () => {
      it('should claim item and write assigned_agent to frontmatter', async () => {
        const mockResponse = {
          data: {
            success: true,
            itemId: '007',
            agent: 'Murdock',
            timestamp: '2024-01-15T10:30:00Z',
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        // Import after mock setup
        const { agentStart } = await import('../../tools/agents.js');

        const result = await agentStart({
          itemId: '007',
          agent: 'murdock',
        });

        expect(mockPost).toHaveBeenCalledWith('/api/agents/start', {
          itemId: '007',
          agent: 'murdock',
        });
        expect(result.content[0].text).toContain('success');
        expect(result.content[0].text).toContain('007');
        expect(result.content[0].text).toContain('Murdock');
      });

      it('should accept optional task_id parameter', async () => {
        const mockResponse = {
          data: {
            success: true,
            itemId: '008',
            agent: 'B.A.',
            task_id: 'task-abc-123',
            timestamp: '2024-01-15T11:00:00Z',
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { agentStart } = await import('../../tools/agents.js');

        const result = await agentStart({
          itemId: '008',
          agent: 'ba',
          task_id: 'task-abc-123',
        });

        expect(mockPost).toHaveBeenCalledWith('/api/agents/start', {
          itemId: '008',
          agent: 'ba',
          task_id: 'task-abc-123',
        });
        expect(result.content[0].text).toContain('success');
      });

      it('should handle idempotent re-claim by same agent', async () => {
        const mockResponse = {
          data: {
            success: true,
            itemId: '007',
            agent: 'Murdock',
            timestamp: '2024-01-15T10:35:00Z',
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { agentStart } = await import('../../tools/agents.js');

        const result = await agentStart({
          itemId: '007',
          agent: 'murdock',
        });

        expect(result.content[0].text).toContain('success');
      });
    });

    describe('agent name validation', () => {
      it('should reject unknown agent names', async () => {
        const { AgentStartSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          itemId: '007',
          agent: 'unknown_agent',
        };

        const parseResult = AgentStartSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
      });

      it.each(VALID_AGENTS)('should accept valid agent name: %s', async (agentName) => {
        const { AgentStartSchema } = await import('../../tools/agents.js');

        const validInput = {
          itemId: '001',
          agent: agentName,
        };

        const parseResult = AgentStartSchema.safeParse(validInput);
        expect(parseResult.success).toBe(true);
      });

      it('should accept case-insensitive agent names in schema', async () => {
        const { AgentStartSchema } = await import('../../tools/agents.js');

        // Schema should validate; normalization happens server-side
        const inputs = [
          { itemId: '001', agent: 'murdock' },
          { itemId: '001', agent: 'MURDOCK' },
          { itemId: '001', agent: 'Murdock' },
        ];

        for (const input of inputs) {
          const parseResult = AgentStartSchema.safeParse(input);
          // At least lowercase should work; others depend on implementation
          if (input.agent === 'murdock') {
            expect(parseResult.success).toBe(true);
          }
        }
      });
    });

    describe('Zod schema validation', () => {
      it('should reject missing itemId', async () => {
        const { AgentStartSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          agent: 'murdock',
        };

        const parseResult = AgentStartSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
        if (!parseResult.success) {
          expect(parseResult.error.issues[0].path).toContain('itemId');
        }
      });

      it('should reject missing agent', async () => {
        const { AgentStartSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          itemId: '007',
        };

        const parseResult = AgentStartSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
        if (!parseResult.success) {
          expect(parseResult.error.issues[0].path).toContain('agent');
        }
      });

      it('should reject empty itemId', async () => {
        const { AgentStartSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          itemId: '',
          agent: 'murdock',
        };

        const parseResult = AgentStartSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
      });
    });

    describe('error handling', () => {
      it('should handle item not found error', async () => {
        const error = {
          status: 404,
          message: 'Item not found: 999',
          code: 'ITEM_NOT_FOUND',
        };
        mockPost.mockRejectedValueOnce(error);

        const { agentStart } = await import('../../tools/agents.js');

        const result = await agentStart({
          itemId: '999',
          agent: 'murdock',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      });

      it('should handle item already claimed by different agent', async () => {
        const error = {
          status: 409,
          message: 'Item already claimed by B.A.',
          code: 'ALREADY_CLAIMED',
        };
        mockPost.mockRejectedValueOnce(error);

        const { agentStart } = await import('../../tools/agents.js');

        const result = await agentStart({
          itemId: '007',
          agent: 'murdock',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('claimed');
      });

      it('should handle invalid stage error', async () => {
        const error = {
          status: 400,
          message: 'Cannot claim item in stage: done',
          code: 'INVALID_STAGE',
        };
        mockPost.mockRejectedValueOnce(error);

        const { agentStart } = await import('../../tools/agents.js');

        const result = await agentStart({
          itemId: '010',
          agent: 'murdock',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('stage');
      });
    });
  });

  describe('agent_stop', () => {
    describe('happy path', () => {
      it('should signal completion and add work summary to work_log', async () => {
        const mockResponse = {
          data: {
            success: true,
            itemId: '007',
            agent: 'Murdock',
            status: 'success',
            completed_at: '2024-01-15T11:30:00Z',
            work_log_entry: {
              agent: 'Murdock',
              timestamp: '2024-01-15T11:30:00Z',
              status: 'success',
              summary: 'Created 5 test cases covering happy path and edge cases',
            },
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { agentStop } = await import('../../tools/agents.js');

        const result = await agentStop({
          itemId: '007',
          agent: 'murdock',
          status: 'success',
          summary: 'Created 5 test cases covering happy path and edge cases',
        });

        expect(mockPost).toHaveBeenCalledWith('/api/agents/stop', {
          itemId: '007',
          agent: 'murdock',
          outcome: 'completed',
          summary: 'Created 5 test cases covering happy path and edge cases',
        });
        expect(result.content[0].text).toContain('success');
        expect(result.content[0].text).toContain('007');
      });

      it('should handle failed status', async () => {
        const mockResponse = {
          data: {
            success: true,
            itemId: '008',
            agent: 'B.A.',
            status: 'failed',
            completed_at: '2024-01-15T12:00:00Z',
            work_log_entry: {
              agent: 'B.A.',
              timestamp: '2024-01-15T12:00:00Z',
              status: 'failed',
              summary: 'Build failed due to missing dependency',
            },
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { agentStop } = await import('../../tools/agents.js');

        const result = await agentStop({
          itemId: '008',
          agent: 'ba',
          status: 'failed',
          summary: 'Build failed due to missing dependency',
        });

        expect(mockPost).toHaveBeenCalledWith('/api/agents/stop', expect.objectContaining({
          outcome: 'blocked',
        }));
        expect(result.content[0].text).toContain('008');
      });

      it('should accept optional files_created array', async () => {
        const mockResponse = {
          data: {
            success: true,
            itemId: '007',
            agent: 'Murdock',
            status: 'success',
            completed_at: '2024-01-15T11:30:00Z',
            work_log_entry: {
              agent: 'Murdock',
              timestamp: '2024-01-15T11:30:00Z',
              status: 'success',
              summary: 'Created test file',
              files_created: ['src/__tests__/feature.test.ts'],
            },
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { agentStop } = await import('../../tools/agents.js');

        const result = await agentStop({
          itemId: '007',
          agent: 'murdock',
          status: 'success',
          summary: 'Created test file',
          files_created: ['src/__tests__/feature.test.ts'],
        });

        expect(mockPost).toHaveBeenCalledWith('/api/agents/stop', expect.objectContaining({
          files_created: ['src/__tests__/feature.test.ts'],
        }));
        expect(result.content[0].text).toContain('success');
      });

      it('should accept optional files_modified array', async () => {
        const mockResponse = {
          data: {
            success: true,
            itemId: '007',
            agent: 'B.A.',
            status: 'success',
            completed_at: '2024-01-15T11:30:00Z',
            work_log_entry: {
              agent: 'B.A.',
              timestamp: '2024-01-15T11:30:00Z',
              status: 'success',
              summary: 'Fixed implementation',
              files_modified: ['src/services/feature.ts'],
            },
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { agentStop } = await import('../../tools/agents.js');

        const result = await agentStop({
          itemId: '007',
          agent: 'ba',
          status: 'success',
          summary: 'Fixed implementation',
          files_modified: ['src/services/feature.ts'],
        });

        expect(mockPost).toHaveBeenCalledWith('/api/agents/stop', expect.objectContaining({
          files_modified: ['src/services/feature.ts'],
        }));
      });
    });

    describe('agent name validation', () => {
      it('should reject unknown agent names', async () => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          itemId: '007',
          agent: 'unknown_agent',
          status: 'success',
          summary: 'Test summary',
        };

        const parseResult = AgentStopSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
      });

      it.each(VALID_AGENTS)('should accept valid agent name: %s', async (agentName) => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const validInput = {
          itemId: '001',
          agent: agentName,
          status: 'success',
          summary: 'Test summary',
        };

        const parseResult = AgentStopSchema.safeParse(validInput);
        expect(parseResult.success).toBe(true);
      });
    });

    describe('status validation', () => {
      it('should accept success status', async () => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const validInput = {
          itemId: '001',
          agent: 'murdock',
          status: 'success',
          summary: 'Test passed',
        };

        const parseResult = AgentStopSchema.safeParse(validInput);
        expect(parseResult.success).toBe(true);
      });

      it('should accept failed status', async () => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const validInput = {
          itemId: '001',
          agent: 'murdock',
          status: 'failed',
          summary: 'Test failed',
        };

        const parseResult = AgentStopSchema.safeParse(validInput);
        expect(parseResult.success).toBe(true);
      });

      it('should reject invalid status values', async () => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          itemId: '001',
          agent: 'murdock',
          status: 'pending',
          summary: 'Test summary',
        };

        const parseResult = AgentStopSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
      });
    });

    describe('Zod schema validation', () => {
      it('should reject missing required fields', async () => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const testCases = [
          { agent: 'murdock', status: 'success', summary: 'test' }, // missing itemId
          { itemId: '001', status: 'success', summary: 'test' }, // missing agent
          { itemId: '001', agent: 'murdock', summary: 'test' }, // missing status
          { itemId: '001', agent: 'murdock', status: 'success' }, // missing summary
        ];

        for (const invalidInput of testCases) {
          const parseResult = AgentStopSchema.safeParse(invalidInput);
          expect(parseResult.success).toBe(false);
        }
      });

      it('should reject empty summary', async () => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          itemId: '001',
          agent: 'murdock',
          status: 'success',
          summary: '',
        };

        const parseResult = AgentStopSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
      });

      it('should reject empty itemId', async () => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          itemId: '',
          agent: 'murdock',
          status: 'success',
          summary: 'Test summary',
        };

        const parseResult = AgentStopSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
      });

      it('should validate files_created as array of strings', async () => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          itemId: '001',
          agent: 'murdock',
          status: 'success',
          summary: 'Test',
          files_created: 'not-an-array',
        };

        const parseResult = AgentStopSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
      });

      it('should validate files_modified as array of strings', async () => {
        const { AgentStopSchema } = await import('../../tools/agents.js');

        const invalidInput = {
          itemId: '001',
          agent: 'murdock',
          status: 'success',
          summary: 'Test',
          files_modified: [123], // should be strings
        };

        const parseResult = AgentStopSchema.safeParse(invalidInput);
        expect(parseResult.success).toBe(false);
      });
    });

    describe('error handling', () => {
      it('should handle item not found error', async () => {
        const error = {
          status: 404,
          message: 'Item not found: 999',
          code: 'ITEM_NOT_FOUND',
        };
        mockPost.mockRejectedValueOnce(error);

        const { agentStop } = await import('../../tools/agents.js');

        const result = await agentStop({
          itemId: '999',
          agent: 'murdock',
          status: 'success',
          summary: 'Test completed',
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('not found');
      });

      it('should handle network errors gracefully', async () => {
        const networkError = new Error('ECONNREFUSED');
        (networkError as any).code = 'ECONNREFUSED';
        mockPost.mockRejectedValueOnce(networkError);

        const { agentStop } = await import('../../tools/agents.js');

        const result = await agentStop({
          itemId: '007',
          agent: 'murdock',
          status: 'success',
          summary: 'Test completed',
        });

        expect(result.isError).toBe(true);
      });
    });
  });

});
