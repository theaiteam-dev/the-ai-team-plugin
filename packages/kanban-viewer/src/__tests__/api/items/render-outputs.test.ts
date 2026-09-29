import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Issue #68 follow-up (coderabbitai review, render/route.ts line 91).
 *
 * GET /api/items/[id]/render persists outputs.test: "" as a legitimate
 * NO_TEST_NEEDED marker, but the markdown renderer filtered outputs with a
 * truthiness check (`v =>  v`), which drops an empty string the same way it
 * drops null/undefined. That can omit the entire Outputs section for an item
 * whose only output is an empty test path. The renderer must filter on
 * `v != null` instead, and must render an empty value as `` `""` `` (a bare
 * empty code span is broken markdown).
 */

const mockPrisma = vi.hoisted(() => ({
  item: {
    findFirst: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const baseDbItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'WI-001',
  title: 'Update the README',
  description: 'Refresh the install section.',
  objective: 'Readers see current install steps',
  acceptance: '["README install section matches the current CLI flags"]',
  context: 'Docs only; no runtime surface touched.',
  type: 'task',
  priority: 'medium',
  stageId: 'briefings',
  dependsOn: [],
  outputTest: null,
  outputImpl: null,
  outputTypes: null,
  archivedAt: null,
  workLogs: [],
  ...overrides,
});

const makeGetRequest = (id: string) =>
  new NextRequest(`http://localhost:3000/api/items/${id}/render`, {
    headers: { 'X-Project-ID': 'test-project' },
  });

const makeContext = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/items/[id]/render — empty-string outputs (issue #68)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('keeps an empty-string test output alongside a populated impl output', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(
      baseDbItem({ outputTest: '', outputImpl: 'README.md' })
    );

    const { GET } = await import('@/app/api/items/[id]/render/route');
    const response = await GET(makeGetRequest('WI-001'), makeContext('WI-001'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.markdown).toContain('## Outputs');
    expect(body.data.markdown).toContain('- **test:** `""`');
    expect(body.data.markdown).toContain('- **impl:** `README.md`');
  });

  it('still renders an Outputs section for an item whose only output is an empty-string test', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseDbItem({ outputTest: '' }));

    const { GET } = await import('@/app/api/items/[id]/render/route');
    const response = await GET(makeGetRequest('WI-001'), makeContext('WI-001'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.markdown).toContain('## Outputs');
    expect(body.data.markdown).toContain('- **test:** `""`');
  });

  it('omits the Outputs section entirely when every output is null', async () => {
    mockPrisma.item.findFirst.mockResolvedValue(baseDbItem());

    const { GET } = await import('@/app/api/items/[id]/render/route');
    const response = await GET(makeGetRequest('WI-001'), makeContext('WI-001'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.markdown).not.toContain('## Outputs');
  });
});
