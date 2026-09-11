import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Issue #68: `ateam items updateItem --outputs.test ""` lost the empty string
 * AND wiped sibling outputs fields.
 *
 * Two distinct defects in the PATCH handler's `body.outputs` block, both
 * covered here:
 *  1. `|| null` coerced a legitimate empty string to null, so `outputs.test`
 *     could never be stored as "" (the NO_TEST_NEEDED fast-track marker).
 *  2. All three columns were assigned unconditionally, so a request naming
 *     only one `outputs.*` key nulled the other two. That half is general to
 *     every value, not just the empty string.
 *
 * Assertions target the prisma update payload rather than the response body:
 * the response passes through the read-path outputs builder, which is fixed
 * separately.
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
  project: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const baseDbItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'WI-963',
  title: 'Existing item',
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
  outputImpl: 'README.md',
  outputTypes: null,
  severity: null,
  attributedAgent: null,
  fingerprint: null,
  archivedAt: null,
  createdAt: new Date('2026-09-01T09:00:00Z'),
  updatedAt: new Date('2026-09-01T09:00:00Z'),
  completedAt: null,
  dependsOn: [],
  workLogs: [],
  ...overrides,
});

const makePatchRequest = (id: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost:3000/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
    body: JSON.stringify(body),
  });

const makeContext = (id: string) => ({ params: Promise.resolve({ id }) });

/** The `data` payload the route handed to prisma.item.update. */
const updatePayload = () => mockPrisma.item.update.mock.calls[0][0].data;

describe('PATCH /api/items/:id — outputs partial update (issue #68)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
      }
      return arg;
    });
  });

  it('persists an empty-string outputs.test instead of coercing it to null', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseDbItem());
    mockPrisma.item.update.mockResolvedValue(baseDbItem({ outputTest: '' }));

    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-963', { outputs: { test: '' } }),
      makeContext('WI-963')
    );

    expect(response.status).toBe(200);
    expect(updatePayload().outputTest).toBe('');
  });

  it('leaves a sibling outputs field untouched when only outputs.test is sent', async () => {
    // The exact reproduction from issue #68: WI-963 already had
    // outputImpl "README.md", and setting test to "" erased it.
    mockPrisma.item.findFirst.mockResolvedValue(baseDbItem({ outputImpl: 'README.md' }));
    mockPrisma.item.update.mockResolvedValue(baseDbItem({ outputTest: '', outputImpl: 'README.md' }));

    const { PATCH } = await import('@/app/api/items/[id]/route');
    await PATCH(makePatchRequest('WI-963', { outputs: { test: '' } }), makeContext('WI-963'));

    const data = updatePayload();
    expect(data.outputTest).toBe('');
    // Absent from the payload entirely — prisma leaves the column alone.
    expect(data).not.toHaveProperty('outputImpl');
    expect(data).not.toHaveProperty('outputTypes');
  });

  it('leaves test and types untouched when only outputs.impl is sent', async () => {
    // The sibling-wipe half is not specific to empty strings.
    mockPrisma.item.findFirst.mockResolvedValue(
      baseDbItem({ outputTest: 'src/__tests__/a.test.ts', outputTypes: 'src/types/a.ts' })
    );
    mockPrisma.item.update.mockResolvedValue(baseDbItem({ outputImpl: 'src/a.ts' }));

    const { PATCH } = await import('@/app/api/items/[id]/route');
    await PATCH(
      makePatchRequest('WI-963', { outputs: { impl: 'src/a.ts' } }),
      makeContext('WI-963')
    );

    const data = updatePayload();
    expect(data.outputImpl).toBe('src/a.ts');
    expect(data).not.toHaveProperty('outputTest');
    expect(data).not.toHaveProperty('outputTypes');
  });

  it('still clears a field when outputs.test is explicitly null', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseDbItem({ outputTest: 'src/__tests__/a.test.ts' }));
    mockPrisma.item.update.mockResolvedValue(baseDbItem({ outputTest: null }));

    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-963', { outputs: { test: null } }),
      makeContext('WI-963')
    );

    expect(response.status).toBe(200);
    expect(updatePayload().outputTest).toBeNull();
  });

  it('sets all three columns when all three keys are sent', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseDbItem());
    mockPrisma.item.update.mockResolvedValue(baseDbItem());

    const { PATCH } = await import('@/app/api/items/[id]/route');
    await PATCH(
      makePatchRequest('WI-963', {
        outputs: { test: 'src/__tests__/a.test.ts', impl: 'src/a.ts', types: 'src/types/a.ts' },
      }),
      makeContext('WI-963')
    );

    expect(updatePayload()).toMatchObject({
      outputTest: 'src/__tests__/a.test.ts',
      outputImpl: 'src/a.ts',
      outputTypes: 'src/types/a.ts',
    });
  });
});
