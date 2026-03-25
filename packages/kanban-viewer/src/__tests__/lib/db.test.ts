import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for Prisma database singleton (src/lib/db.ts)
 *
 * These tests verify:
 * 1. The db.ts module exports a working Prisma client singleton
 * 2. The singleton pattern prevents multiple client instances in development
 * 3. The client can connect and perform basic operations
 */

// Mock PrismaClient before importing db module
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

const mockPrismaClient = {
  $connect: mockConnect,
  $disconnect: mockDisconnect,
  stage: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  item: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  itemDependency: {
    findMany: vi.fn(),
  },
  workLog: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  agentClaim: {
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  mission: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  missionItem: {
    findMany: vi.fn(),
  },
  activityLog: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function() { return mockPrismaClient; }),
}));

describe('Prisma Database Singleton (db.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the module cache to test fresh imports
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('singleton export', () => {
    it('should export a prisma client instance', async () => {
      const { prisma } = await import('@/lib/db');

      expect(prisma).toBeDefined();
      expect(typeof prisma).toBe('object');
    });

    it('should return the same instance on multiple imports', async () => {
      const { prisma: instance1 } = await import('@/lib/db');
      const { prisma: instance2 } = await import('@/lib/db');

      expect(instance1).toBe(instance2);
    });

    it('should have Stage model accessor', async () => {
      const { prisma } = await import('@/lib/db');

      expect(prisma.stage).toBeDefined();
      expect(typeof prisma.stage.findMany).toBe('function');
      expect(typeof prisma.stage.findUnique).toBe('function');
    });

    it('should have Item model accessor', async () => {
      const { prisma } = await import('@/lib/db');

      expect(prisma.item).toBeDefined();
      expect(typeof prisma.item.findMany).toBe('function');
      expect(typeof prisma.item.findUnique).toBe('function');
      expect(typeof prisma.item.create).toBe('function');
    });

    it('should have ItemDependency model accessor', async () => {
      const { prisma } = await import('@/lib/db');

      expect(prisma.itemDependency).toBeDefined();
      expect(typeof prisma.itemDependency.findMany).toBe('function');
    });

    it('should have WorkLog model accessor', async () => {
      const { prisma } = await import('@/lib/db');

      expect(prisma.workLog).toBeDefined();
      expect(typeof prisma.workLog.findMany).toBe('function');
      expect(typeof prisma.workLog.create).toBe('function');
    });

    it('should have AgentClaim model accessor', async () => {
      const { prisma } = await import('@/lib/db');

      expect(prisma.agentClaim).toBeDefined();
      expect(typeof prisma.agentClaim.findUnique).toBe('function');
      expect(typeof prisma.agentClaim.create).toBe('function');
      expect(typeof prisma.agentClaim.delete).toBe('function');
    });

    it('should have Mission model accessor', async () => {
      const { prisma } = await import('@/lib/db');

      expect(prisma.mission).toBeDefined();
      expect(typeof prisma.mission.findMany).toBe('function');
      expect(typeof prisma.mission.findFirst).toBe('function');
      expect(typeof prisma.mission.create).toBe('function');
    });

    it('should have MissionItem model accessor', async () => {
      const { prisma } = await import('@/lib/db');

      expect(prisma.missionItem).toBeDefined();
      expect(typeof prisma.missionItem.findMany).toBe('function');
    });

    it('should have ActivityLog model accessor', async () => {
      const { prisma } = await import('@/lib/db');

      expect(prisma.activityLog).toBeDefined();
      expect(typeof prisma.activityLog.findMany).toBe('function');
      expect(typeof prisma.activityLog.create).toBe('function');
    });
  });

  describe('client connection', () => {
    it('should have $connect method', async () => {
      const { prisma } = await import('@/lib/db');

      expect(typeof prisma.$connect).toBe('function');
    });

    it('should have $disconnect method', async () => {
      const { prisma } = await import('@/lib/db');

      expect(typeof prisma.$disconnect).toBe('function');
    });

    it('should connect successfully', async () => {
      const { prisma } = await import('@/lib/db');

      await expect(prisma.$connect()).resolves.not.toThrow();
      expect(mockConnect).toHaveBeenCalled();
    });

    it('should disconnect successfully', async () => {
      const { prisma } = await import('@/lib/db');

      await expect(prisma.$disconnect()).resolves.not.toThrow();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe('basic query operations', () => {
    it('should query stages', async () => {
      const mockStages = [
        { id: 'briefings', name: 'Backlog', order: 0, wipLimit: null },
        { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
      ];
      mockPrismaClient.stage.findMany.mockResolvedValue(mockStages);

      const { prisma } = await import('@/lib/db');
      const stages = await prisma.stage.findMany();

      expect(stages).toEqual(mockStages);
      expect(mockPrismaClient.stage.findMany).toHaveBeenCalled();
    });

    it('should query items', async () => {
      const mockItems = [
        {
          id: 'WI-001',
          title: 'Test Item',
          description: 'Description',
          type: 'feature',
          priority: 'medium',
          stageId: 'ready',
          assignedAgent: null,
          rejectionCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
        },
      ];
      mockPrismaClient.item.findMany.mockResolvedValue(mockItems);

      const { prisma } = await import('@/lib/db');
      const items = await prisma.item.findMany();

      expect(items).toEqual(mockItems);
      expect(mockPrismaClient.item.findMany).toHaveBeenCalled();
    });

    it('should create activity log entry', async () => {
      const mockEntry = {
        id: 1,
        missionId: null,
        agent: 'Hannibal',
        message: 'Started mission',
        level: 'info',
        timestamp: new Date(),
      };
      mockPrismaClient.activityLog.create.mockResolvedValue(mockEntry);

      const { prisma } = await import('@/lib/db');
      const entry = await prisma.activityLog.create({
        data: {
          agent: 'Hannibal',
          message: 'Started mission',
        } as unknown as Parameters<typeof prisma.activityLog.create>[0]['data'],
      });

      expect(entry).toEqual(mockEntry);
      expect(mockPrismaClient.activityLog.create).toHaveBeenCalled();
    });
  });
});

