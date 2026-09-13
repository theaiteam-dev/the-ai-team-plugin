import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests for WI-968: work item outputs fields are lost on write.
 *
 * Two observable behaviors, both drawn from the item's acceptance criteria
 * (not from the item's SUSPECTED CAUSE line numbers — that section is a
 * hypothesis for B.A., not a spec for these tests):
 *
 *   1. Empty-string persistence: outputs.test = "" must store and read back
 *      as "", not vanish. Exercised on both the create path (POST
 *      /api/items) and the update path (PATCH /api/items/:id).
 *   2. Sibling survival: updating one outputs.* field must merge into the
 *      existing outputs, not wholesale-replace them. Exercised on the
 *      update path for both an empty-string target value (AC1, where the
 *      merge and the falsy-coercion bugs compound in the same request) and
 *      a non-empty target value (AC2, isolating the merge behavior alone).
 *
 * Test conventions: vitest, hand-rolled mockPrisma via vi.mock, real
 * NextRequest — mirrors item-learning-fields.test.ts and
 * dependency-validation.test.ts. Only the Prisma client (the outermost I/O
 * boundary) is mocked; the real route handlers and the real
 * transformItemWithRelationsToResponse / buildOutputs transform run
 * unmodified. Each mocked create/update call is a stateful "fake row":
 * it returns exactly what the route computed as the write payload merged
 * onto the prior row, so these tests observe the actual round trip through
 * the route's coercion logic and the transform's read-side filter — not a
 * hand-asserted expectation about what the call arguments "should" be.
 */

// ============ Mock Setup ============

const mockPrisma = vi.hoisted(() => ({
  item: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  itemDependency: {
    findMany: vi.fn(),
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

// ============ Fixtures ============

const BASE_VALID_ITEM_BODY = {
  title: 'Test item',
  type: 'feature',
  priority: 'medium',
  description: 'A test item',
  objective: 'Users can do the thing',
  acceptance: ['It works'],
  context: 'Integrates with existing service',
};

function baseDbItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'WI-001',
    title: 'Existing item',
    description: 'desc',
    type: 'feature',
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
    createdAt: new Date('2026-04-01T09:00:00Z'),
    updatedAt: new Date('2026-04-01T09:00:00Z'),
    completedAt: null,
    dependsOn: [] as Array<{ dependsOnId: string }>,
    workLogs: [] as unknown[],
    ...overrides,
  };
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000/api/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Project-ID': 'test-project' },
    body: JSON.stringify(body),
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ============ AC3 — create path: empty-string outputs.test persists ============

describe('POST /api/items — outputs.test empty-string persistence (WI-968 AC3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Serves both generateItemId's MAX(id) scan and the output-collision
    // existing-items query — an empty project for both purposes.
    mockPrisma.item.findMany.mockResolvedValue([]);
    mockPrisma.mission.findFirst.mockResolvedValue(null);
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'test-project', name: 'test-project' });
  });

  it('stores and reads back outputs.test as an empty string when created alongside a non-empty outputs.impl', async () => {
    // Fake row: reflects exactly what the route computed for the create
    // payload, so this observes the real write-side coercion, not a
    // hand-asserted call-argument expectation.
    mockPrisma.item.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      baseDbItem({ ...data })
    );

    const { POST } = await import('@/app/api/items/route');
    const response = await POST(
      makePostRequest({
        ...BASE_VALID_ITEM_BODY,
        outputs: { impl: 'README.md', test: '' },
      })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.outputs.impl).toBe('README.md');
    // The bug drops the key entirely (buildOutputs' truthy check hides a
    // stored ""), so presence must be asserted explicitly — not just value.
    expect('test' in body.data.outputs).toBe(true);
    expect(body.data.outputs.test).toBe('');
  });
});

// ============ AC1 — update path: empty-string outputs.test persists, sibling survives ============

describe('PATCH /api/items/:id — outputs.test empty-string persistence merges instead of replacing (WI-968 AC1)', () => {
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

  it('setting outputs.test to "" on an item that already has outputs.impl reads back {impl, test: ""} — the empty test persists and the pre-existing impl survives', async () => {
    const existing = baseDbItem({ outputImpl: 'README.md', outputTest: null, outputTypes: null });
    mockPrisma.item.findFirst.mockResolvedValue(existing);
    // Fake row: merges the route's computed update payload onto the prior
    // row — exposes a wholesale-replace bug (impl going missing) exactly as
    // a real UPDATE ... SET would if the route passed null for impl.
    mockPrisma.item.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existing,
      ...data,
    }));

    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { outputs: { test: '' } }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.outputs.impl).toBe('README.md');
    expect('test' in body.data.outputs).toBe(true);
    expect(body.data.outputs.test).toBe('');
  });
});

// ============ AC2 — update path: non-empty partial update merges, siblings intact ============

describe('PATCH /api/items/:id — non-empty partial outputs update leaves siblings intact (WI-968 AC2)', () => {
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

  it('updating only outputs.test with a new non-empty path leaves pre-existing outputs.impl and outputs.types untouched', async () => {
    const existing = baseDbItem({
      outputImpl: 'src/service.ts',
      outputTest: 'src/__tests__/old.test.ts',
      outputTypes: 'src/types/service.ts',
    });
    mockPrisma.item.findFirst.mockResolvedValue(existing);
    mockPrisma.item.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existing,
      ...data,
    }));

    const { PATCH } = await import('@/app/api/items/[id]/route');
    const response = await PATCH(
      makePatchRequest('WI-001', { outputs: { test: 'src/__tests__/new.test.ts' } }),
      makeContext('WI-001')
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.outputs.test).toBe('src/__tests__/new.test.ts');
    expect(body.data.outputs.impl).toBe('src/service.ts');
    expect(body.data.outputs.types).toBe('src/types/service.ts');
  });
});
