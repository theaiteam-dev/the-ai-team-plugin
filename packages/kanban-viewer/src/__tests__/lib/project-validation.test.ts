import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for project validation utilities (src/lib/project-utils.ts)
 *
 * These tests verify:
 * 1. PROJECT_ID_REGEX - Pattern for valid project IDs (alphanumeric, hyphens, underscores)
 * 2. validateProjectId(projectId) - Returns error response for null/invalid format
 * 3. ensureProject(projectId) - Gets or creates project record
 *
 * Validation rules:
 * - projectId is required (return 400 if missing)
 * - Must match pattern: ^[a-zA-Z0-9_-]+$ (URL-safe)
 * - Maximum length: 100 characters
 * - Project IDs are case-insensitive (always stored/compared as lowercase)
 */

// Mock Prisma client - use vi.hoisted to ensure mock is available before vi.mock is hoisted
const { mockProject, mockPrismaClient } = vi.hoisted(() => {
  const mockProject = {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  };
  const mockPrismaClient = {
    project: mockProject,
  };
  return { mockProject, mockPrismaClient };
});

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

// Import after mocking
import {
  PROJECT_ID_REGEX,
  validateProjectId,
  ensureProject,
} from '@/lib/project-utils';

describe('PROJECT_ID_REGEX', () => {
  describe('valid project IDs', () => {
    it('should match alphanumeric IDs', () => {
      expect(PROJECT_ID_REGEX.test('myproject123')).toBe(true);
    });

    it('should match IDs with hyphens', () => {
      expect(PROJECT_ID_REGEX.test('my-project')).toBe(true);
    });

    it('should match IDs with underscores', () => {
      expect(PROJECT_ID_REGEX.test('my_project')).toBe(true);
    });

    it('should match IDs with mixed characters', () => {
      expect(PROJECT_ID_REGEX.test('My-Project_123')).toBe(true);
    });

    it('should match single character ID', () => {
      expect(PROJECT_ID_REGEX.test('a')).toBe(true);
    });

    it('should match ID at maximum length (100 chars)', () => {
      const maxLengthId = 'a'.repeat(100);
      expect(PROJECT_ID_REGEX.test(maxLengthId)).toBe(true);
    });
  });

  describe('invalid project IDs', () => {
    it('should reject IDs with spaces', () => {
      expect(PROJECT_ID_REGEX.test('my project')).toBe(false);
    });

    it('should reject IDs with special characters', () => {
      expect(PROJECT_ID_REGEX.test('my@project')).toBe(false);
      expect(PROJECT_ID_REGEX.test('my!project')).toBe(false);
      expect(PROJECT_ID_REGEX.test('my#project')).toBe(false);
      expect(PROJECT_ID_REGEX.test('my$project')).toBe(false);
    });

    it('should reject IDs with dots', () => {
      expect(PROJECT_ID_REGEX.test('my.project')).toBe(false);
    });

    it('should reject IDs with slashes', () => {
      expect(PROJECT_ID_REGEX.test('my/project')).toBe(false);
      expect(PROJECT_ID_REGEX.test('my\\project')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(PROJECT_ID_REGEX.test('')).toBe(false);
    });
  });
});

describe('validateProjectId', () => {
  describe('missing projectId', () => {
    it('should return error for null projectId', () => {
      const result = validateProjectId(null);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('VALIDATION_ERROR');
      expect(result?.message).toContain('X-Project-ID');
    });

    it('should return error for undefined projectId', () => {
      const result = validateProjectId(undefined as unknown as string | null);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('VALIDATION_ERROR');
    });

    it('should return error for empty string projectId', () => {
      const result = validateProjectId('');

      expect(result).not.toBeNull();
      expect(result?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('invalid format', () => {
    it('should return error for projectId with spaces', () => {
      const result = validateProjectId('my project');

      expect(result).not.toBeNull();
      expect(result?.code).toBe('VALIDATION_ERROR');
      expect(result?.message).toContain('format');
    });

    it('should return error for projectId with special characters', () => {
      const result = validateProjectId('my@project!');

      expect(result).not.toBeNull();
      expect(result?.code).toBe('VALIDATION_ERROR');
    });

    it('should return error for projectId exceeding max length', () => {
      const tooLongId = 'a'.repeat(101);
      const result = validateProjectId(tooLongId);

      expect(result).not.toBeNull();
      expect(result?.code).toBe('VALIDATION_ERROR');
      expect(result?.message).toContain('100');
    });
  });

  describe('valid projectId', () => {
    it('should return null for valid alphanumeric projectId', () => {
      const result = validateProjectId('myproject123');

      expect(result).toBeNull();
    });

    it('should return null for valid projectId with hyphens', () => {
      const result = validateProjectId('my-project');

      expect(result).toBeNull();
    });

    it('should return null for valid projectId with underscores', () => {
      const result = validateProjectId('my_project');

      expect(result).toBeNull();
    });

    it('should return null for projectId at max length', () => {
      const maxLengthId = 'a'.repeat(100);
      const result = validateProjectId(maxLengthId);

      expect(result).toBeNull();
    });
  });

  describe('case normalization', () => {
    it('should validate uppercase IDs (will be normalized to lowercase)', () => {
      const result = validateProjectId('MYPROJECT');

      expect(result).toBeNull();
    });

    it('should validate mixed case IDs', () => {
      const result = validateProjectId('MyProject');

      expect(result).toBeNull();
    });
  });
});

describe('ensureProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('existing project', () => {
    it('should return existing project if found', async () => {
      const existingProject = {
        id: 'my-project',
        name: 'my-project',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      mockProject.findUnique.mockResolvedValue(existingProject);

      const result = await ensureProject('my-project');

      expect(result).toEqual(existingProject);
      expect(mockProject.findUnique).toHaveBeenCalledWith({
        where: { id: 'my-project' },
      });
    });

    it('should normalize projectId to lowercase when finding', async () => {
      const existingProject = {
        id: 'my-project',
        name: 'my-project',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      mockProject.findUnique.mockResolvedValue(existingProject);

      await ensureProject('MY-PROJECT');

      expect(mockProject.findUnique).toHaveBeenCalledWith({
        where: { id: 'my-project' },
      });
    });
  });

  describe('new project creation', () => {
    it('should create new project if not found', async () => {
      const newProject = {
        id: 'new-project',
        name: 'new-project',
        createdAt: new Date('2026-01-25'),
        updatedAt: new Date('2026-01-25'),
      };
      mockProject.findUnique.mockResolvedValue(null);
      mockProject.create.mockResolvedValue(newProject);

      const result = await ensureProject('new-project');

      expect(result).toEqual(newProject);
      expect(mockProject.create).toHaveBeenCalledWith({
        data: {
          id: 'new-project',
          name: 'new-project',
        },
      });
    });

    it('should normalize projectId to lowercase when creating', async () => {
      const newProject = {
        id: 'new-project',
        name: 'new-project',
        createdAt: new Date('2026-01-25'),
        updatedAt: new Date('2026-01-25'),
      };
      mockProject.findUnique.mockResolvedValue(null);
      mockProject.create.mockResolvedValue(newProject);

      await ensureProject('NEW-PROJECT');

      expect(mockProject.findUnique).toHaveBeenCalledWith({
        where: { id: 'new-project' },
      });
      expect(mockProject.create).toHaveBeenCalledWith({
        data: {
          id: 'new-project',
          name: 'new-project',
        },
      });
    });

    it('should use projectId as name when creating new project', async () => {
      const newProject = {
        id: 'my-new-project',
        name: 'my-new-project',
        createdAt: new Date('2026-01-25'),
        updatedAt: new Date('2026-01-25'),
      };
      mockProject.findUnique.mockResolvedValue(null);
      mockProject.create.mockResolvedValue(newProject);

      await ensureProject('my-new-project');

      expect(mockProject.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'my-new-project',
        }),
      });
    });
  });

  describe('idempotency', () => {
    it('should return same project on repeated calls', async () => {
      const existingProject = {
        id: 'my-project',
        name: 'my-project',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      mockProject.findUnique.mockResolvedValue(existingProject);

      const result1 = await ensureProject('my-project');
      const result2 = await ensureProject('my-project');

      expect(result1).toEqual(result2);
      expect(mockProject.findUnique).toHaveBeenCalledTimes(2);
      expect(mockProject.create).not.toHaveBeenCalled();
    });

    it('should handle case-insensitive repeated calls', async () => {
      const existingProject = {
        id: 'my-project',
        name: 'my-project',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };
      mockProject.findUnique.mockResolvedValue(existingProject);

      const result1 = await ensureProject('my-project');
      const result2 = await ensureProject('MY-PROJECT');
      const result3 = await ensureProject('My-Project');

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);

      // All calls should normalize to lowercase
      expect(mockProject.findUnique).toHaveBeenNthCalledWith(1, { where: { id: 'my-project' } });
      expect(mockProject.findUnique).toHaveBeenNthCalledWith(2, { where: { id: 'my-project' } });
      expect(mockProject.findUnique).toHaveBeenNthCalledWith(3, { where: { id: 'my-project' } });
    });
  });

  describe('error handling', () => {
    it('should propagate database errors', async () => {
      const dbError = new Error('Database connection failed');
      mockProject.findUnique.mockRejectedValue(dbError);

      await expect(ensureProject('my-project')).rejects.toThrow('Database connection failed');
    });

    it('should propagate creation errors', async () => {
      mockProject.findUnique.mockResolvedValue(null);
      const createError = new Error('Unique constraint violation');
      mockProject.create.mockRejectedValue(createError);

      await expect(ensureProject('my-project')).rejects.toThrow('Unique constraint violation');
    });
  });
});

describe('Type Safety', () => {
  it('should have PROJECT_ID_REGEX as a RegExp', () => {
    expect(PROJECT_ID_REGEX).toBeInstanceOf(RegExp);
  });

  it('should have validateProjectId return ValidationError | null', () => {
    const validResult = validateProjectId('valid-id');
    expect(validResult === null || typeof validResult === 'object').toBe(true);

    const invalidResult = validateProjectId(null);
    expect(invalidResult).not.toBeNull();
    expect(typeof invalidResult?.code).toBe('string');
    expect(typeof invalidResult?.message).toBe('string');
  });

  it('should have ensureProject return a Promise<Project>', async () => {
    const mockResult = {
      id: 'test',
      name: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockProject.findUnique.mockResolvedValue(mockResult);

    const result = await ensureProject('test');

    expect(typeof result.id).toBe('string');
    expect(typeof result.name).toBe('string');
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });
});
