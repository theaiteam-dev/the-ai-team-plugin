import { describe, it, expect, beforeEach, vi } from 'vitest';
import { boardMove, boardClaim, boardRelease } from '../../tools/board.js';
import type { KanbanApiClient, ApiResponse, BoardState } from '../../client/types.js';
import { ApiRequestError } from '../../client/types.js';
import type { MoveResult, ClaimResult, ReleaseResult } from '../../tools/board.js';

/**
 * Mock client factory for dependency injection.
 * Uses board.ts handlers' optional client parameter.
 */
function createMockClient(): KanbanApiClient {
  return {
    get: async () => {
      throw new Error('Mock get not implemented');
    },
    post: async () => {
      throw new Error('Mock post not implemented');
    },
    put: async () => {
      throw new Error('Mock put not implemented');
    },
    patch: async () => {
      throw new Error('Mock patch not implemented');
    },
    delete: async () => {
      throw new Error('Mock delete not implemented');
    },
    request: async () => {
      throw new Error('Mock request not implemented');
    },
  };
}

describe('Board Tools', () => {
  describe('board_read', () => {
    it('should return full board state as structured JSON', async () => {
      const mockBoardState: BoardState = {
        mission: 'PRD-001',
        phases: ['briefings', 'ready', 'testing', 'implementing', 'review', 'done'],
        items: [
          {
            id: 'WI-001',
            title: 'Feature A',
            status: 'pending',
            type: 'feature',
          },
        ],
        wip_limit: 3,
      };

      // boardRead uses getDefaultClient() internally (no DI parameter),
      // so we mock the client module for this test
      vi.resetModules();
      vi.doMock('../../client/index.js', () => ({
        createClient: () => ({
          get: async () => ({ data: mockBoardState }),
        }),
        ApiRequestError: ApiRequestError,
      }));

      const { boardRead } = await import('../../tools/board.js');
      const result = await boardRead({});

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.data).toEqual(mockBoardState);
    });
  });

  describe('board_move', () => {
    let mockClient: KanbanApiClient;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    it('should move item to target stage on valid transition', async () => {
      const mockResponse: ApiResponse<MoveResult> = {
        data: {
          success: true,
          itemId: 'WI-001',
          from: 'ready',
          to: 'testing',
        },
        status: 200,
        headers: {},
      };

      mockClient.post = async () => mockResponse;

      const result = await boardMove(
        { itemId: 'WI-001', to: 'testing' },
        mockClient
      );

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.data).toEqual({
        success: true,
        itemId: 'WI-001',
        from: 'ready',
        to: 'testing',
      });
    });

    it('should reject invalid transition with actionable guidance', async () => {
      const apiError = new ApiRequestError({
        status: 400,
        code: 'INVALID_TRANSITION',
        message: "Cannot move from 'testing' to 'done'",
        details: { from: 'testing', to: 'done' },
      });

      mockClient.post = async () => {
        throw apiError;
      };

      const result = await boardMove(
        { itemId: 'WI-001', to: 'done' },
        mockClient
      );

      expect(result.isError).toBe(true);
      if ('isError' in result && result.isError) {
        expect(result.code).toBe('INVALID_TRANSITION');
        expect(result.message).toContain("Cannot move directly from 'testing' to 'done'");
        expect(result.message).toContain("pipeline requires moving to 'implementing' next");
        expect(result.message).toContain("Dispatch B.A.");
        expect(result.message).toContain("No stage in the pipeline may be skipped");
      }
    });

    it('should reject WIP limit errors', async () => {
      const apiError = new ApiRequestError({
        status: 400,
        code: 'WIP_LIMIT_EXCEEDED',
        message: 'WIP limit (3) exceeded for stage testing',
      });

      mockClient.post = async () => {
        throw apiError;
      };

      const result = await boardMove(
        { itemId: 'WI-004', to: 'testing' },
        mockClient
      );

      expect(result.isError).toBe(true);
      if ('isError' in result && result.isError) {
        expect(result.code).toBe('WIP_LIMIT_EXCEEDED');
        expect(result.message).toContain('WIP limit');
      }
    });

    it('should validate required fields', async () => {
      const result = await boardMove(
        { itemId: '', to: 'testing' },
        mockClient
      );

      expect(result.isError).toBe(true);
      if ('isError' in result && result.isError) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should handle item not found error', async () => {
      const apiError = new ApiRequestError({
        status: 404,
        code: 'ITEM_NOT_FOUND',
        message: 'Item not found: WI-999',
      });

      mockClient.post = async () => {
        throw apiError;
      };

      const result = await boardMove(
        { itemId: 'WI-999', to: 'testing' },
        mockClient
      );

      expect(result.isError).toBe(true);
      if ('isError' in result && result.isError) {
        expect(result.code).toBe('ITEM_NOT_FOUND');
      }
    });
  });

  describe('board_claim', () => {
    let mockClient: KanbanApiClient;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    it('should claim item for agent successfully', async () => {
      const mockResponse: ApiResponse<ClaimResult> = {
        data: {
          success: true,
          itemId: 'WI-007',
          agent: 'Murdock',
        },
        status: 200,
        headers: {},
      };

      mockClient.post = async () => mockResponse;

      const result = await boardClaim(
        { itemId: 'WI-007', agent: 'murdock' },
        mockClient
      );

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.data).toEqual({
        success: true,
        itemId: 'WI-007',
        agent: 'Murdock',
      });
    });

    it('should detect conflicts when item already claimed', async () => {
      const apiError = new ApiRequestError({
        status: 409,
        code: 'ALREADY_CLAIMED',
        message: 'Item WI-007 is already claimed by B.A.',
      });

      mockClient.post = async () => {
        throw apiError;
      };

      // boardClaim doesn't catch errors - it lets them propagate
      await expect(
        boardClaim({ itemId: 'WI-007', agent: 'murdock' }, mockClient)
      ).rejects.toThrow('Item WI-007 is already claimed by B.A.');
    });

    it('should validate required fields', async () => {
      const result = await boardClaim(
        { itemId: '', agent: 'murdock' },
        mockClient
      );

      expect(result.isError).toBe(true);
      if ('isError' in result && result.isError) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should handle item not found error', async () => {
      const apiError = new ApiRequestError({
        status: 404,
        code: 'ITEM_NOT_FOUND',
        message: 'Item not found: WI-999',
      });

      mockClient.post = async () => {
        throw apiError;
      };

      // boardClaim doesn't catch errors - it lets them propagate
      await expect(
        boardClaim({ itemId: 'WI-999', agent: 'murdock' }, mockClient)
      ).rejects.toThrow('Item not found: WI-999');
    });
  });

  describe('board_release', () => {
    let mockClient: KanbanApiClient;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    it('should release agent assignment successfully', async () => {
      const mockResponse: ApiResponse<ReleaseResult> = {
        data: {
          success: true,
          itemId: 'WI-007',
        },
        status: 200,
        headers: {},
      };

      mockClient.post = async () => mockResponse;

      const result = await boardRelease(
        { itemId: 'WI-007' },
        mockClient
      );

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.data).toEqual({
        success: true,
        itemId: 'WI-007',
      });
    });

    it('should handle unclaimed items gracefully (idempotent)', async () => {
      const mockResponse: ApiResponse<ReleaseResult> = {
        data: {
          success: true,
          itemId: 'WI-008',
        },
        status: 200,
        headers: {},
      };

      mockClient.post = async () => mockResponse;

      const result = await boardRelease(
        { itemId: 'WI-008' },
        mockClient
      );

      expect(result.content).toBeDefined();
      expect(result.data?.success).toBe(true);
    });

    it('should validate required fields', async () => {
      const result = await boardRelease(
        { itemId: '' },
        mockClient
      );

      expect(result.isError).toBe(true);
      if ('isError' in result && result.isError) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should handle item not found error', async () => {
      const apiError = new ApiRequestError({
        status: 404,
        code: 'ITEM_NOT_FOUND',
        message: 'Item not found: WI-999',
      });

      mockClient.post = async () => {
        throw apiError;
      };

      // boardRelease doesn't catch errors - it lets them propagate
      await expect(
        boardRelease({ itemId: 'WI-999' }, mockClient)
      ).rejects.toThrow('Item not found: WI-999');
    });
  });
});
