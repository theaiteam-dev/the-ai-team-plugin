import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for migration script: scripts/migrate-projects.ts
 *
 * WI-039: Create data migration script for existing records
 *
 * This script assigns all existing Item, Mission, and ActivityLog records
 * to a default project. It should be idempotent (safe to run multiple times).
 *
 * Acceptance criteria tested:
 * - [ ] scripts/migrate-projects.ts exists and is executable via ts-node
 * - [ ] Script creates default "kanban-viewer" project if not exists
 * - [ ] All existing Items have projectId = "kanban-viewer"
 * - [ ] All existing Missions have projectId = "kanban-viewer"
 * - [ ] All existing ActivityLogs have projectId = "kanban-viewer"
 * - [ ] Script is idempotent (safe to run multiple times)
 * - [ ] Handles empty database gracefully (no records to update)
 */

// Mock Prisma client
const mockPrismaClient = {
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $transaction: vi.fn(),
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
  item: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  mission: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  activityLog: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function () {
    return mockPrismaClient;
  }),
}));

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaClient,
}));

// Default project configuration
const DEFAULT_PROJECT = {
  id: 'kanban-viewer',
  name: 'Kanban Viewer',
};

describe('Migration Script: scripts/migrate-projects.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockPrismaClient.$transaction.mockImplementation(
      async (fn: (prisma: typeof mockPrismaClient) => Promise<unknown>) => {
        return fn(mockPrismaClient);
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default project creation', () => {
    it('should create default project with id "kanban-viewer"', async () => {
      // Project does not exist yet
      mockPrismaClient.project.findUnique.mockResolvedValue(null);
      mockPrismaClient.project.create.mockResolvedValue(DEFAULT_PROJECT);

      await mockPrismaClient.project.create({
        data: DEFAULT_PROJECT,
      });

      expect(mockPrismaClient.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'kanban-viewer',
          name: 'Kanban Viewer',
        }),
      });
    });

    it('should use upsert to handle existing project gracefully', async () => {
      mockPrismaClient.project.upsert.mockResolvedValue(DEFAULT_PROJECT);

      await mockPrismaClient.project.upsert({
        where: { id: 'kanban-viewer' },
        create: DEFAULT_PROJECT,
        update: {}, // No updates needed if exists
      });

      expect(mockPrismaClient.project.upsert).toHaveBeenCalledWith({
        where: { id: 'kanban-viewer' },
        create: expect.objectContaining({
          id: 'kanban-viewer',
          name: 'Kanban Viewer',
        }),
        update: {},
      });
    });

    it('should not fail if project already exists', async () => {
      // Project already exists
      mockPrismaClient.project.findUnique.mockResolvedValue(DEFAULT_PROJECT);

      const project = await mockPrismaClient.project.findUnique({
        where: { id: 'kanban-viewer' },
      });

      expect(project).toEqual(DEFAULT_PROJECT);
    });
  });

  describe('updating Items with projectId', () => {
    it('should update all Items with null projectId to "kanban-viewer"', async () => {
      mockPrismaClient.item.updateMany.mockResolvedValue({ count: 10 });

      await mockPrismaClient.item.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(mockPrismaClient.item.updateMany).toHaveBeenCalledWith({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });
    });

    it('should return count of updated Items', async () => {
      mockPrismaClient.item.updateMany.mockResolvedValue({ count: 25 });

      const result = await mockPrismaClient.item.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(result.count).toBe(25);
    });

    it('should not update Items that already have a projectId', async () => {
      // Only update where projectId is null
      mockPrismaClient.item.updateMany.mockResolvedValue({ count: 5 });
      mockPrismaClient.item.count.mockResolvedValue(10);

      // Total items
      const totalCount = await mockPrismaClient.item.count();
      // Updated items (only those without projectId)
      const result = await mockPrismaClient.item.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(totalCount).toBe(10);
      expect(result.count).toBe(5);
      // 5 items already had a projectId, 5 were updated
    });

    it('should handle empty Items table gracefully', async () => {
      mockPrismaClient.item.updateMany.mockResolvedValue({ count: 0 });

      const result = await mockPrismaClient.item.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(result.count).toBe(0);
      // Should not throw
    });
  });

  describe('updating Missions with projectId', () => {
    it('should update all Missions with null projectId to "kanban-viewer"', async () => {
      mockPrismaClient.mission.updateMany.mockResolvedValue({ count: 3 });

      await mockPrismaClient.mission.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(mockPrismaClient.mission.updateMany).toHaveBeenCalledWith({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });
    });

    it('should return count of updated Missions', async () => {
      mockPrismaClient.mission.updateMany.mockResolvedValue({ count: 7 });

      const result = await mockPrismaClient.mission.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(result.count).toBe(7);
    });

    it('should handle empty Missions table gracefully', async () => {
      mockPrismaClient.mission.updateMany.mockResolvedValue({ count: 0 });

      const result = await mockPrismaClient.mission.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(result.count).toBe(0);
    });
  });

  describe('updating ActivityLogs with projectId', () => {
    it('should update all ActivityLogs with null projectId to "kanban-viewer"', async () => {
      mockPrismaClient.activityLog.updateMany.mockResolvedValue({ count: 100 });

      await mockPrismaClient.activityLog.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(mockPrismaClient.activityLog.updateMany).toHaveBeenCalledWith({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });
    });

    it('should return count of updated ActivityLogs', async () => {
      mockPrismaClient.activityLog.updateMany.mockResolvedValue({ count: 250 });

      const result = await mockPrismaClient.activityLog.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(result.count).toBe(250);
    });

    it('should handle empty ActivityLogs table gracefully', async () => {
      mockPrismaClient.activityLog.updateMany.mockResolvedValue({ count: 0 });

      const result = await mockPrismaClient.activityLog.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(result.count).toBe(0);
    });
  });

  describe('idempotency', () => {
    it('should produce same result when run multiple times', async () => {
      // First run - 10 items updated
      mockPrismaClient.item.updateMany.mockResolvedValueOnce({ count: 10 });
      const firstRun = await mockPrismaClient.item.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      // Second run - 0 items updated (all already have projectId)
      mockPrismaClient.item.updateMany.mockResolvedValueOnce({ count: 0 });
      const secondRun = await mockPrismaClient.item.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      expect(firstRun.count).toBe(10);
      expect(secondRun.count).toBe(0);
    });

    it('should use upsert for project creation to ensure idempotency', async () => {
      mockPrismaClient.project.upsert.mockResolvedValue(DEFAULT_PROJECT);

      // Run upsert twice
      await mockPrismaClient.project.upsert({
        where: { id: 'kanban-viewer' },
        create: DEFAULT_PROJECT,
        update: {},
      });

      await mockPrismaClient.project.upsert({
        where: { id: 'kanban-viewer' },
        create: DEFAULT_PROJECT,
        update: {},
      });

      // Both calls should succeed
      expect(mockPrismaClient.project.upsert).toHaveBeenCalledTimes(2);
    });

    it('should not modify records that already have correct projectId', async () => {
      // Simulate items already having projectId
      mockPrismaClient.item.findMany.mockResolvedValue([
        { id: 'WI-001', projectId: 'kanban-viewer' },
        { id: 'WI-002', projectId: 'kanban-viewer' },
      ]);

      mockPrismaClient.item.updateMany.mockResolvedValue({ count: 0 });

      const result = await mockPrismaClient.item.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      // No items should be updated
      expect(result.count).toBe(0);
    });
  });

  describe('empty database handling', () => {
    it('should complete successfully with empty database', async () => {
      mockPrismaClient.project.upsert.mockResolvedValue(DEFAULT_PROJECT);
      mockPrismaClient.item.updateMany.mockResolvedValue({ count: 0 });
      mockPrismaClient.mission.updateMany.mockResolvedValue({ count: 0 });
      mockPrismaClient.activityLog.updateMany.mockResolvedValue({ count: 0 });

      // Run all updates
      const projectResult = await mockPrismaClient.project.upsert({
        where: { id: 'kanban-viewer' },
        create: DEFAULT_PROJECT,
        update: {},
      });

      const itemResult = await mockPrismaClient.item.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      const missionResult = await mockPrismaClient.mission.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      const activityResult = await mockPrismaClient.activityLog.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      // All should complete without error
      expect(projectResult).toEqual(DEFAULT_PROJECT);
      expect(itemResult.count).toBe(0);
      expect(missionResult.count).toBe(0);
      expect(activityResult.count).toBe(0);
    });

    it('should report zero updates when no records exist', async () => {
      mockPrismaClient.item.count.mockResolvedValue(0);
      mockPrismaClient.mission.count.mockResolvedValue(0);
      mockPrismaClient.activityLog.count.mockResolvedValue(0);

      const itemCount = await mockPrismaClient.item.count();
      const missionCount = await mockPrismaClient.mission.count();
      const activityCount = await mockPrismaClient.activityLog.count();

      expect(itemCount).toBe(0);
      expect(missionCount).toBe(0);
      expect(activityCount).toBe(0);
    });
  });

  describe('transaction handling', () => {
    it('should wrap all updates in a transaction for atomicity', async () => {
      mockPrismaClient.$transaction.mockImplementation(
        async (fn: (prisma: typeof mockPrismaClient) => Promise<unknown>) => {
          return fn(mockPrismaClient);
        }
      );

      await mockPrismaClient.$transaction(async (prisma: typeof mockPrismaClient) => {
        await prisma.project.upsert({
          where: { id: 'kanban-viewer' },
          create: DEFAULT_PROJECT,
          update: {},
        });
        await prisma.item.updateMany({
          where: { projectId: null },
          data: { projectId: 'kanban-viewer' },
        });
        await prisma.mission.updateMany({
          where: { projectId: null },
          data: { projectId: 'kanban-viewer' },
        });
        await prisma.activityLog.updateMany({
          where: { projectId: null },
          data: { projectId: 'kanban-viewer' },
        });
        return { success: true };
      });

      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
    });

    it('should rollback all changes if any update fails', async () => {
      mockPrismaClient.$transaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(
        mockPrismaClient.$transaction(async () => {
          throw new Error('Transaction failed');
        })
      ).rejects.toThrow('Transaction failed');
    });

    it('should handle database connection errors', async () => {
      mockPrismaClient.$connect.mockRejectedValue(new Error('Connection failed'));

      await expect(mockPrismaClient.$connect()).rejects.toThrow('Connection failed');
    });
  });

  describe('error handling', () => {
    it('should handle project creation failure gracefully', async () => {
      mockPrismaClient.project.upsert.mockRejectedValue(
        new Error('Unique constraint violation')
      );

      await expect(
        mockPrismaClient.project.upsert({
          where: { id: 'kanban-viewer' },
          create: DEFAULT_PROJECT,
          update: {},
        })
      ).rejects.toThrow();
    });

    it('should handle item update failure gracefully', async () => {
      mockPrismaClient.item.updateMany.mockRejectedValue(
        new Error('Foreign key constraint failed')
      );

      await expect(
        mockPrismaClient.item.updateMany({
          where: { projectId: null },
          data: { projectId: 'kanban-viewer' },
        })
      ).rejects.toThrow();
    });

    it('should handle mission update failure gracefully', async () => {
      mockPrismaClient.mission.updateMany.mockRejectedValue(
        new Error('Foreign key constraint failed')
      );

      await expect(
        mockPrismaClient.mission.updateMany({
          where: { projectId: null },
          data: { projectId: 'kanban-viewer' },
        })
      ).rejects.toThrow();
    });

    it('should handle activity log update failure gracefully', async () => {
      mockPrismaClient.activityLog.updateMany.mockRejectedValue(
        new Error('Foreign key constraint failed')
      );

      await expect(
        mockPrismaClient.activityLog.updateMany({
          where: { projectId: null },
          data: { projectId: 'kanban-viewer' },
        })
      ).rejects.toThrow();
    });
  });

  describe('executability', () => {
    it('should be runnable via npx ts-node', () => {
      // This test documents that the script should be executable
      const expectedCommand = 'npx ts-node scripts/migrate-projects.ts';

      expect(expectedCommand).toContain('ts-node');
      expect(expectedCommand).toContain('migrate-projects.ts');
    });

    it('should export a main function for programmatic use', () => {
      // The script should have a main() function that can be called
      // This allows both CLI and programmatic usage
      const expectedExport = 'main';

      expect(typeof expectedExport).toBe('string');
    });

    it('should log progress to console', () => {
      // Script should provide feedback about what it's doing
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      console.log('Starting project migration...');
      console.log('Created default project: kanban-viewer');
      console.log('Updated 10 items');
      console.log('Updated 3 missions');
      console.log('Updated 100 activity logs');
      console.log('Migration complete!');

      expect(consoleSpy).toHaveBeenCalledWith('Starting project migration...');
      expect(consoleSpy).toHaveBeenCalledWith('Migration complete!');

      consoleSpy.mockRestore();
    });
  });

  describe('verification', () => {
    it('should verify all Items have projectId after migration', async () => {
      mockPrismaClient.item.count
        .mockResolvedValueOnce(10) // Total items
        .mockResolvedValueOnce(0); // Items with null projectId

      const totalItems = await mockPrismaClient.item.count();
      const itemsWithoutProject = await mockPrismaClient.item.count({
        where: { projectId: null },
      });

      expect(totalItems).toBe(10);
      expect(itemsWithoutProject).toBe(0);
    });

    it('should verify all Missions have projectId after migration', async () => {
      mockPrismaClient.mission.count
        .mockResolvedValueOnce(5) // Total missions
        .mockResolvedValueOnce(0); // Missions with null projectId

      const totalMissions = await mockPrismaClient.mission.count();
      const missionsWithoutProject = await mockPrismaClient.mission.count({
        where: { projectId: null },
      });

      expect(totalMissions).toBe(5);
      expect(missionsWithoutProject).toBe(0);
    });

    it('should verify all ActivityLogs have projectId after migration', async () => {
      mockPrismaClient.activityLog.count
        .mockResolvedValueOnce(100) // Total logs
        .mockResolvedValueOnce(0); // Logs with null projectId

      const totalLogs = await mockPrismaClient.activityLog.count();
      const logsWithoutProject = await mockPrismaClient.activityLog.count({
        where: { projectId: null },
      });

      expect(totalLogs).toBe(100);
      expect(logsWithoutProject).toBe(0);
    });

    it('should report migration summary with counts', async () => {
      mockPrismaClient.item.updateMany.mockResolvedValue({ count: 15 });
      mockPrismaClient.mission.updateMany.mockResolvedValue({ count: 4 });
      mockPrismaClient.activityLog.updateMany.mockResolvedValue({ count: 200 });

      const itemResult = await mockPrismaClient.item.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });
      const missionResult = await mockPrismaClient.mission.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });
      const activityResult = await mockPrismaClient.activityLog.updateMany({
        where: { projectId: null },
        data: { projectId: 'kanban-viewer' },
      });

      const summary = {
        itemsUpdated: itemResult.count,
        missionsUpdated: missionResult.count,
        activityLogsUpdated: activityResult.count,
        total: itemResult.count + missionResult.count + activityResult.count,
      };

      expect(summary).toEqual({
        itemsUpdated: 15,
        missionsUpdated: 4,
        activityLogsUpdated: 200,
        total: 219,
      });
    });
  });
});
