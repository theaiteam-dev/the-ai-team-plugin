import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Regression tests for item ID generation in POST /api/items.
 *
 * Item IDs are strings, so ordering them in the database sorts "WI-999"
 * above "WI-1000". Picking the next ID from that ordering returned WI-1000
 * again once the sequence passed 999, and every create collided with the
 * existing WI-1000 (500). The next ID must follow the largest numeric part.
 */

const mockPrisma = vi.hoisted(() => ({
  item: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
  },
  itemDependency: { findMany: vi.fn() },
  mission: { findFirst: vi.fn() },
  project: { findUnique: vi.fn(), create: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

function dbItem(id: string) {
  return {
    id,
    title: 'Test Item',
    description: 'Test description',
    type: 'feature',
    priority: 'medium',
    stageId: 'briefings',
    assignedAgent: null,
    rejectionCount: 0,
    projectId: 'kanban-viewer',
    createdAt: new Date('2026-01-21T10:00:00Z'),
    updatedAt: new Date('2026-01-21T10:00:00Z'),
    completedAt: null,
    archivedAt: null,
    dependsOn: [],
    workLogs: [],
  };
}

function postRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'kanban-viewer' },
    body: JSON.stringify({
      title: 'New Item',
      description: 'Test description',
      type: 'feature',
      priority: 'medium',
      objective: 'Test objective',
      acceptance: ['Test criterion'],
      context: 'Test context',
    }),
  });
}

/** Stores `existing` as the item table and returns the id POST creates. */
async function createdIdGiven(existing: string[]): Promise<string> {
  // Serve findMany the way SQLite would for the old query: string order, desc,
  // honoring take. A numeric-aware implementation must not rely on this order.
  mockPrisma.item.findMany.mockImplementation(async (args: { take?: number } = {}) => {
    const sorted = [...existing].sort().reverse().map((id) => ({ id }));
    return args.take ? sorted.slice(0, args.take) : sorted;
  });
  mockPrisma.item.create.mockImplementation(async ({ data }: { data: { id: string } }) => dbItem(data.id));

  const { POST } = await import('@/app/api/items/route');
  const response = await POST(postRequest());
  expect(response.status).toBe(201);
  return mockPrisma.item.create.mock.calls[0][0].data.id;
}

describe('POST /api/items - item ID generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.item.count.mockResolvedValue(0);
    mockPrisma.itemDependency.findMany.mockResolvedValue([]);
    mockPrisma.mission.findFirst.mockResolvedValue(null);
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'kanban-viewer', name: 'kanban-viewer', createdAt: new Date() });
  });

  it('follows WI-1000 with WI-1001 even though WI-999 sorts higher as a string', async () => {
    expect(await createdIdGiven(['WI-998', 'WI-999', 'WI-1000'])).toBe('WI-1001');
  });

  it('crosses the 999 boundary to WI-1000', async () => {
    expect(await createdIdGiven(['WI-997', 'WI-999'])).toBe('WI-1000');
  });

  it('starts at WI-001 on an empty table', async () => {
    expect(await createdIdGiven([])).toBe('WI-001');
  });
});
