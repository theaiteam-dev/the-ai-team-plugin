import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the HTTP client
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();

vi.mock('../../client/index.js', () => ({
  createClient: () => ({
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
  }),
}));

describe('Item Tools', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('item_create', () => {
    describe('happy path', () => {
      it('should create work item with valid input', async () => {
        const mockResponse = {
          data: {
            id: 'WI-001',
            title: 'Add user authentication',
            description: 'Implement JWT-based auth',
            type: 'feature',
            priority: 'high',
            status: 'pending',
            stage: 'briefings',
            dependencies: [],
            rejection_count: 0,
          },
          status: 201,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { itemCreate } = await import('../../tools/items.js');

        const result = await itemCreate({
          title: 'Add user authentication',
          description: 'Implement JWT-based auth',
          type: 'feature',
          priority: 'high',
        });

        expect(mockPost).toHaveBeenCalledWith('/api/items', {
          title: 'Add user authentication',
          description: 'Implement JWT-based auth',
          type: 'feature',
          priority: 'high',
          status: 'pending',
          dependencies: [],
        });
        expect(result.content[0].text).toContain('WI-001');
        expect(result.content[0].text).toContain('Add user authentication');
      });

      it('should create item with optional fields', async () => {
        const mockResponse = {
          data: {
            id: 'WI-002',
            title: 'Fix login bug',
            description: 'Users cannot login with email',
            type: 'bug',
            priority: 'critical',
            status: 'pending',
            stage: 'briefings',
            dependencies: ['WI-001'],
            parallel_group: 'auth-group',
            outputs: {
              test: 'src/__tests__/login.test.ts',
              impl: 'src/auth/login.ts',
            },
            rejection_count: 0,
          },
          status: 201,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { itemCreate } = await import('../../tools/items.js');

        const result = await itemCreate({
          title: 'Fix login bug',
          description: 'Users cannot login with email',
          type: 'bug',
          priority: 'critical',
          dependencies: ['WI-001'],
          parallel_group: 'auth-group',
          outputs: {
            test: 'src/__tests__/login.test.ts',
            impl: 'src/auth/login.ts',
          },
        });

        expect(mockPost).toHaveBeenCalledWith('/api/items', expect.objectContaining({
          dependencies: ['WI-001'],
          parallel_group: 'auth-group',
          outputs: expect.objectContaining({
            test: 'src/__tests__/login.test.ts',
            impl: 'src/auth/login.ts',
          }),
        }));
        expect(result.content[0].text).toContain('WI-002');
      });
    });

    describe('validation', () => {
      it('should reject missing title', async () => {
        const { itemCreate } = await import('../../tools/items.js');

        const result = await itemCreate({
          description: 'Test description',
          type: 'feature',
          priority: 'high',
        } as any);

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('Required');
      });

      it('should reject invalid dependency ID format', async () => {
        const { itemCreate } = await import('../../tools/items.js');

        const result = await itemCreate({
          title: 'Test item',
          description: 'Test description',
          type: 'feature',
          priority: 'high',
          dependencies: ['001'], // Invalid format - should be WI-001
        });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('Invalid dependency ID');
        expect((result as any).message).toContain('WI-XXX');
      });

      it('should accept valid dependency ID format WI-001', async () => {
        const mockResponse = {
          data: {
            id: 'WI-002',
            title: 'Test',
            description: 'Test',
            type: 'feature',
            priority: 'high',
            status: 'pending',
            dependencies: ['WI-001'],
            rejection_count: 0,
          },
          status: 201,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { itemCreate } = await import('../../tools/items.js');

        const result = await itemCreate({
          title: 'Test',
          description: 'Test',
          type: 'feature',
          priority: 'high',
          dependencies: ['WI-001'],
        });

        expect(mockPost).toHaveBeenCalled();
        expect(result.isError).not.toBe(true);
      });
    });

    describe('error handling', () => {
      it('should handle API errors', async () => {
        const error = {
          status: 400,
          message: 'Invalid work item data',
          code: 'VALIDATION_ERROR',
        };
        mockPost.mockRejectedValueOnce(error);

        const { itemCreate } = await import('../../tools/items.js');

        const result = await itemCreate({
          title: 'Test',
          description: 'Test',
          type: 'feature',
          priority: 'high',
        });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('Invalid');
      });
    });
  });

  describe('item_update', () => {
    describe('happy path', () => {
      it('should update work item with partial data', async () => {
        const mockResponse = {
          data: {
            id: 'WI-001',
            title: 'Updated title',
            description: 'Original description',
            type: 'feature',
            priority: 'high',
            status: 'pending',
            rejection_count: 0,
          },
          status: 200,
          headers: {},
        };
        mockPatch.mockResolvedValueOnce(mockResponse);

        const { itemUpdate } = await import('../../tools/items.js');

        const result = await itemUpdate({
          id: 'WI-001',
          title: 'Updated title',
        });

        expect(mockPatch).toHaveBeenCalledWith('/api/items/WI-001', {
          title: 'Updated title',
        });
        expect(result.content[0].text).toContain('Updated title');
      });

      it('should update multiple fields at once', async () => {
        const mockResponse = {
          data: {
            id: 'WI-001',
            title: 'Updated title',
            description: 'Updated description',
            priority: 'critical',
            status: 'pending',
            type: 'feature',
            rejection_count: 0,
          },
          status: 200,
          headers: {},
        };
        mockPatch.mockResolvedValueOnce(mockResponse);

        const { itemUpdate } = await import('../../tools/items.js');

        const result = await itemUpdate({
          id: 'WI-001',
          title: 'Updated title',
          description: 'Updated description',
          priority: 'critical',
        });

        expect(mockPatch).toHaveBeenCalledWith('/api/items/WI-001', {
          title: 'Updated title',
          description: 'Updated description',
          priority: 'critical',
        });
        expect(result.content[0].text).toContain('Updated title');
      });
    });

    describe('validation', () => {
      it('should reject missing id', async () => {
        const { itemUpdate } = await import('../../tools/items.js');

        const result = await itemUpdate({
          title: 'Test',
        } as any);

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('Required');
      });

      it('should reject invalid dependency ID format in update', async () => {
        const { itemUpdate } = await import('../../tools/items.js');

        const result = await itemUpdate({
          id: 'WI-001',
          dependencies: ['002'], // Invalid format
        });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('Invalid dependency ID');
      });
    });

    describe('error handling', () => {
      it('should handle item not found', async () => {
        const error = {
          status: 404,
          message: 'Item not found: WI-999',
          code: 'ITEM_NOT_FOUND',
        };
        mockPatch.mockRejectedValueOnce(error);

        const { itemUpdate } = await import('../../tools/items.js');

        const result = await itemUpdate({
          id: 'WI-999',
          title: 'Updated title',
        });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('not found');
      });
    });
  });

  describe('item_get', () => {
    describe('happy path', () => {
      it('should retrieve work item by ID', async () => {
        const mockResponse = {
          data: {
            id: 'WI-001',
            title: 'Add user authentication',
            description: 'Implement JWT-based auth',
            type: 'feature',
            priority: 'high',
            status: 'pending',
            stage: 'briefings',
            rejection_count: 0,
          },
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { itemGet } = await import('../../tools/items.js');

        const result = await itemGet({ id: 'WI-001' });

        expect(mockGet).toHaveBeenCalledWith('/api/items/WI-001');
        expect(result.content[0].text).toContain('WI-001');
        expect(result.content[0].text).toContain('Add user authentication');
      });
    });

    describe('error handling', () => {
      it('should handle item not found', async () => {
        const error = {
          status: 404,
          message: 'Item not found: WI-999',
          code: 'ITEM_NOT_FOUND',
        };
        mockGet.mockRejectedValueOnce(error);

        const { itemGet } = await import('../../tools/items.js');

        const result = await itemGet({ id: 'WI-999' });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('not found');
      });
    });
  });

  describe('item_list', () => {
    describe('happy path', () => {
      it('should list all items without filters', async () => {
        const mockResponse = {
          data: [
            {
              id: 'WI-001',
              title: 'Item 1',
              description: 'First item',
              type: 'feature',
              priority: 'high',
              status: 'pending',
              rejection_count: 0,
            },
            {
              id: 'WI-002',
              title: 'Item 2',
              description: 'Second item',
              type: 'bug',
              priority: 'critical',
              status: 'pending',
              rejection_count: 0,
            },
          ],
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { itemList } = await import('../../tools/items.js');

        const result = await itemList({});

        expect(mockGet).toHaveBeenCalledWith('/api/items');
        expect(result.content[0].text).toContain('WI-001');
        expect(result.content[0].text).toContain('WI-002');
      });

      it('should list items filtered by status', async () => {
        const mockResponse = {
          data: [
            {
              id: 'WI-001',
              title: 'Item 1',
              description: 'First item',
              type: 'feature',
              priority: 'high',
              status: 'active',
              rejection_count: 0,
            },
          ],
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { itemList } = await import('../../tools/items.js');

        const result = await itemList({ status: 'active' });

        expect(mockGet).toHaveBeenCalledWith('/api/items?status=active');
        expect(result.content[0].text).toContain('WI-001');
      });

      it('should list items with multiple filters', async () => {
        const mockResponse = {
          data: [],
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { itemList } = await import('../../tools/items.js');

        const result = await itemList({
          status: 'active',
          stage: 'testing',
          agent: 'murdock',
        });

        expect(mockGet).toHaveBeenCalledWith('/api/items?status=active&stage=testing&agent=murdock');
        expect(result.content[0].text).toContain('[]');
      });
    });

    describe('error handling', () => {
      it('should handle API errors', async () => {
        const error = {
          status: 500,
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        };
        mockGet.mockRejectedValueOnce(error);

        const { itemList } = await import('../../tools/items.js');

        const result = await itemList({});

        expect(result.isError).toBe(true);
      });
    });
  });

  describe('item_reject', () => {
    describe('happy path', () => {
      it('should record rejection with reason', async () => {
        const mockResponse = {
          data: {
            item: {
              id: 'WI-001',
              title: 'Test item',
              description: 'Test',
              type: 'feature',
              priority: 'high',
              status: 'pending',
              rejection_count: 1,
            },
            escalated: false,
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { itemReject } = await import('../../tools/items.js');

        const result = await itemReject({
          id: 'WI-001',
          reason: 'Tests do not cover edge cases',
        });

        expect(mockPost).toHaveBeenCalledWith('/api/items/WI-001/reject', {
          reason: 'Tests do not cover edge cases',
        });
        expect(result.content[0].text).toContain('escalated');
      });

      it('should include agent in rejection', async () => {
        const mockResponse = {
          data: {
            item: {
              id: 'WI-001',
              title: 'Test item',
              description: 'Test',
              type: 'feature',
              priority: 'high',
              status: 'pending',
              rejection_count: 1,
            },
            escalated: false,
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { itemReject } = await import('../../tools/items.js');

        const result = await itemReject({
          id: 'WI-001',
          reason: 'Implementation incomplete',
          agent: 'lynch',
        });

        expect(mockPost).toHaveBeenCalledWith('/api/items/WI-001/reject', {
          reason: 'Implementation incomplete',
          agent: 'lynch',
        });
      });

      it('should handle escalation after max rejections', async () => {
        const mockResponse = {
          data: {
            item: {
              id: 'WI-001',
              title: 'Test item',
              description: 'Test',
              type: 'feature',
              priority: 'high',
              status: 'blocked',
              stage: 'blocked',
              rejection_count: 3,
            },
            escalated: true,
          },
          status: 200,
          headers: {},
        };
        mockPost.mockResolvedValueOnce(mockResponse);

        const { itemReject } = await import('../../tools/items.js');

        const result = await itemReject({
          id: 'WI-001',
          reason: 'Third rejection',
        });

        expect(result.content[0].text).toContain('escalated');
        expect(result.content[0].text).toContain('true');
      });
    });

    describe('error handling', () => {
      it('should handle item not found', async () => {
        const error = {
          status: 404,
          message: 'Item not found: WI-999',
          code: 'ITEM_NOT_FOUND',
        };
        mockPost.mockRejectedValueOnce(error);

        const { itemReject } = await import('../../tools/items.js');

        const result = await itemReject({
          id: 'WI-999',
          reason: 'Test rejection',
        });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('not found');
      });
    });
  });

  describe('item_render', () => {
    describe('happy path', () => {
      it('should return markdown representation of item', async () => {
        const mockResponse = {
          data: {
            markdown: `---
id: WI-001
title: Add user authentication
type: feature
priority: high
status: pending
---

# Add user authentication

Implement JWT-based authentication for the API.`,
          },
          status: 200,
          headers: {},
        };
        mockGet.mockResolvedValueOnce(mockResponse);

        const { itemRender } = await import('../../tools/items.js');

        const result = await itemRender({ id: 'WI-001' });

        expect(mockGet).toHaveBeenCalledWith('/api/items/WI-001/render');
        expect(result.content[0].text).toContain('markdown');
        expect(result.content[0].text).toContain('Add user authentication');
      });
    });

    describe('error handling', () => {
      it('should handle item not found', async () => {
        const error = {
          status: 404,
          message: 'Item not found: WI-999',
          code: 'ITEM_NOT_FOUND',
        };
        mockGet.mockRejectedValueOnce(error);

        const { itemRender } = await import('../../tools/items.js');

        const result = await itemRender({ id: 'WI-999' });

        expect(result.isError).toBe(true);
        expect(result).toHaveProperty('message');
        expect((result as any).message).toContain('not found');
      });
    });
  });
});
