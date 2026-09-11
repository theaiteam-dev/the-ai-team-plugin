import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Issue #68: `outputs.test: ""` must survive creation.
 *
 * A NO_TEST_NEEDED task item is created with an explicitly empty test path.
 * The create payload previously used `||`, which collapsed that empty string
 * to null and made the documented fast-track state unreachable through the API.
 */

const mockPrisma = vi.hoisted(() => ({
  item: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  itemDependency: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const BASE_VALID_ITEM_BODY = {
  title: 'Update the README',
  type: 'task',
  priority: 'medium',
  description: 'Refresh the install section.\nNO_TEST_NEEDED',
  objective: 'Readers see current install steps',
  acceptance: ['README install section matches the current CLI flags'],
  context: 'Docs only; no runtime surface touched.',
};

const baseDbItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'WI-001',
  title: 'Update the README',
  description: 'desc',
  type: 'task',
  priority: 'medium',
  stageId: 'briefings',
  projectId: 'test-project',
  assignedAgent: null,
  rejectionCount: 0,
  objective: 'Some objective',
  acceptance: '["criterion 1"]',
  context: 'Some context',
  outputTest: null,
  outputImpl: null,
  outputTypes: null,
  severity: null,
  attributedAgent: null,
  fingerprint: null,
  archivedAt: null,
  createdAt: new Date('2026-09-11T09:00:00Z'),
  updatedAt: new Date('2026-09-11T09:00:00Z'),
  completedAt: null,
  dependsOn: [],
  workLogs: [],
  ...overrides,
});

const makePostRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost:3000/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
    body: JSON.stringify(body),
  });

/**
 * `item.findMany` serves two different callers in POST: the collision scan and
 * generateItemId's MAX(id) lookup. generateItemId is the one using
 * `select: { id: true }`, so the shape of the args tells them apart.
 */
const withExistingItems = (existing: Array<Record<string, unknown>>) => {
  mockPrisma.item.findMany.mockImplementation(async (args: { select?: { id?: boolean } }) => {
    if (args?.select?.id) return [];
    return existing;
  });
};

const createdPayload = () => mockPrisma.item.create.mock.calls[0][0].data;

describe('POST /api/items — empty-string outputs (issue #68)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    withExistingItems([]);
    mockPrisma.mission.findFirst.mockResolvedValue(null);
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'test-project', name: 'test-project' });
  });

  it('persists an explicitly empty outputs.test as "" rather than collapsing it to null', async () => {
    mockPrisma.item.create.mockResolvedValue(baseDbItem({ outputTest: '', outputImpl: 'README.md' }));

    const { POST } = await import('@/app/api/items/route');
    const response = await POST(
      makePostRequest({ ...BASE_VALID_ITEM_BODY, outputs: { test: '', impl: 'README.md' } })
    );

    expect(response.status).toBe(201);
    const data = createdPayload();
    expect(data.outputTest).toBe('');
    expect(data.outputTest).not.toBeNull();
    expect(data.outputImpl).toBe('README.md');
  });

  it('still stores null for every output when outputs is omitted entirely', async () => {
    mockPrisma.item.create.mockResolvedValue(baseDbItem());

    const { POST } = await import('@/app/api/items/route');
    const response = await POST(makePostRequest(BASE_VALID_ITEM_BODY));

    expect(response.status).toBe(201);
    const data = createdPayload();
    expect(data.outputTest).toBeNull();
    expect(data.outputImpl).toBeNull();
    expect(data.outputTypes).toBeNull();
  });

  it('stores null for an output explicitly passed as null', async () => {
    mockPrisma.item.create.mockResolvedValue(baseDbItem({ outputImpl: 'README.md' }));

    const { POST } = await import('@/app/api/items/route');
    const response = await POST(
      makePostRequest({ ...BASE_VALID_ITEM_BODY, outputs: { test: null, impl: 'README.md' } })
    );

    expect(response.status).toBe(201);
    const data = createdPayload();
    expect(data.outputTest).toBeNull();
    expect(data.outputImpl).toBe('README.md');
  });

  it('does not treat two items sharing an empty test path as an output collision', async () => {
    // The collision detector normalizes "" to undefined precisely so that a
    // second NO_TEST_NEEDED item is not reported as colliding with the first.
    withExistingItems([
      {
        id: 'WI-001',
        outputImpl: 'CONTRIBUTING.md',
        outputTest: '',
        outputTypes: null,
        dependsOn: [],
      },
    ]);
    mockPrisma.item.create.mockResolvedValue(baseDbItem({ id: 'WI-002', outputTest: '', outputImpl: 'README.md' }));

    const { POST } = await import('@/app/api/items/route');
    const response = await POST(
      makePostRequest({ ...BASE_VALID_ITEM_BODY, outputs: { test: '', impl: 'README.md' } })
    );

    expect(response.status).toBe(201);
    expect(createdPayload().outputTest).toBe('');
  });
});
