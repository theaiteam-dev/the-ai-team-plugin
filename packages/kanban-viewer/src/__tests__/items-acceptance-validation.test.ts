import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for structured field validation in items API.
 *
 * Fix 1 (POST /api/items): acceptance array must contain only non-empty strings.
 *   Invalid elements (objects, numbers, empty strings) must be rejected with 400.
 *   Persisted values must be trimmed.
 *
 * Fix 2 (PATCH /api/items/[id]): objective, context, and acceptance must be
 *   validated before persisting. Wrong types must be rejected with 400.
 */

// ============ Mock Setup ============

const mockPrisma = {
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
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// ============ Fixtures ============

const BASE_VALID_BODY = {
  title: 'Test item',
  type: 'feature',
  priority: 'medium',
  description: 'A test item',
  objective: 'Users can do the thing',
  acceptance: ['It works', 'It fails gracefully'],
  context: 'Integrates with existing service',
};

const makePostRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost:3000/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
    body: JSON.stringify(body),
  });

const makePatchRequest = (id: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost:3000/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
    body: JSON.stringify(body),
  });

const makeContext = (id: string) => ({
  params: Promise.resolve({ id }),
});

const existingItem = {
  id: 'WI-001',
  title: 'Existing item',
  description: 'desc',
  type: 'feature',
  priority: 'medium',
  stageId: 'briefings',
  projectId: 'test-project',
  objective: 'Some objective',
  acceptance: '["criterion 1"]',
  context: 'Some context',
  outputTest: null,
  outputImpl: null,
  outputTypes: null,
  rejectionCount: 0,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  dependsOn: [],
  workLogs: [],
};

// ============ Fix 1: POST acceptance validation ============

describe('POST /api/items - acceptance array element validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'test-project', name: 'test-project', createdAt: new Date() });
    mockPrisma.project.upsert.mockResolvedValue({ id: 'test-project' });
    mockPrisma.item.findMany.mockResolvedValue([]);
    mockPrisma.mission.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (arg) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(mockPrisma);
    });
  });

  it('rejects acceptance array containing object elements', async () => {
    const { POST } = await import('@/app/api/items/route');
    const response = await POST(
      makePostRequest({ ...BASE_VALID_BODY, acceptance: [{ criterion: 'object element' }] })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body.error)).toMatch(/acceptance/i);
  });

  it('rejects acceptance array containing numeric elements', async () => {
    const { POST } = await import('@/app/api/items/route');
    const response = await POST(
      makePostRequest({ ...BASE_VALID_BODY, acceptance: [42, 'valid criterion'] })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body.error)).toMatch(/acceptance/i);
  });

  it('rejects acceptance array containing only empty strings', async () => {
    const { POST } = await import('@/app/api/items/route');
    const response = await POST(
      makePostRequest({ ...BASE_VALID_BODY, acceptance: ['', '   '] })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body.error)).toMatch(/acceptance/i);
  });

  it('rejects acceptance array containing null elements', async () => {
    const { POST } = await import('@/app/api/items/route');
    const response = await POST(
      makePostRequest({ ...BASE_VALID_BODY, acceptance: ['valid criterion', null] })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('accepts and persists trimmed values for valid string acceptance criteria', async () => {
    mockPrisma.item.create.mockResolvedValue({
      ...existingItem,
      id: 'WI-002',
      acceptance: JSON.stringify(['criterion with whitespace', 'another']),
      dependsOn: [],
      workLogs: [],
    });

    const { POST } = await import('@/app/api/items/route');
    const response = await POST(
      makePostRequest({ ...BASE_VALID_BODY, acceptance: ['  criterion with whitespace  ', 'another'] })
    );

    expect(response.status).toBe(201);
    const createCall = mockPrisma.item.create.mock.calls[0]?.[0];
    expect(createCall).toBeDefined();
    const storedAcceptance = JSON.parse(createCall.data.acceptance);
    expect(storedAcceptance).toEqual(['criterion with whitespace', 'another']);
  });
});

// ============ Fix 2: PATCH structured field validation ============

describe('PATCH /api/items/[id] - structured field validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.item.findFirst.mockResolvedValue(existingItem);
    mockPrisma.itemDependency.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(async (arg) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(mockPrisma);
    });
  });

  it('rejects non-string objective', async () => {
    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { objective: 123 }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body.error)).toMatch(/objective/i);
  });

  it('rejects array as objective', async () => {
    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { objective: ['not a string'] }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('rejects non-string context', async () => {
    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { context: { nested: 'object' } }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body.error)).toMatch(/context/i);
  });

  it('rejects acceptance array containing object elements in PATCH', async () => {
    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { acceptance: [{ criterion: 'bad' }] }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body.error)).toMatch(/acceptance/i);
  });

  it('rejects acceptance array containing only empty strings in PATCH', async () => {
    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { acceptance: ['', '   '] }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('rejects non-array acceptance in PATCH', async () => {
    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { acceptance: 'not an array' }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('accepts and trims valid string acceptance criteria in PATCH', async () => {
    mockPrisma.item.update.mockResolvedValue({
      ...existingItem,
      acceptance: JSON.stringify(['trimmed criterion']),
      dependsOn: [],
      workLogs: [],
    });
    mockPrisma.itemDependency.deleteMany.mockResolvedValue({ count: 0 });

    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { acceptance: ['  trimmed criterion  '] }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(200);
    const updateCall = mockPrisma.item.update.mock.calls[0]?.[0];
    expect(updateCall).toBeDefined();
    const storedAcceptance = JSON.parse(updateCall.data.acceptance);
    expect(storedAcceptance).toEqual(['trimmed criterion']);
  });

  it('accepts valid string objective and context in PATCH', async () => {
    mockPrisma.item.update.mockResolvedValue({
      ...existingItem,
      objective: 'Updated objective',
      context: 'Updated context',
      dependsOn: [],
      workLogs: [],
    });
    mockPrisma.itemDependency.deleteMany.mockResolvedValue({ count: 0 });

    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { objective: 'Updated objective', context: 'Updated context' }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(200);
  });
});
