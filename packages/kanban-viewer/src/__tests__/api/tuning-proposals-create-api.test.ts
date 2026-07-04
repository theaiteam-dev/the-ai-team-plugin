import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for POST /api/tuning/proposals (WI-213).
 *
 * The tuning walk drafts one TuningProposal per target surface, clustering that
 * surface's LIVE learnings (status 'open' or 'recurred') into the proposal and
 * linking them by stamping their proposalId. Behavior under test:
 *
 * 1. A valid POST creates a draft TuningProposal (status='draft'), links every
 *    live learning for that surface, and returns 201 with { id, linkedLearningIds }.
 * 2. Only open/recurred learnings are linked — resolved and dismissed rows for
 *    the same surface are left unlinked (their proposalId stays null).
 * 3. proposalText is optional at draft time; omitting it persists ''
 *    (synthesis is deferred to accept/edit, FR-7).
 * 4. Missing targetSurface -> 400; an altitude outside
 *    skill-text|agent-prompt|hook -> 400; the three valid altitudes are accepted.
 * 5. A surface with no live learnings -> 400 with a 'no live learnings' message,
 *    and no proposal is created (no silent empty proposal).
 * 6. A second POST for a surface that already has an open draft resumes that
 *    draft (idempotent) instead of creating a second one.
 *
 * Approach: a stateful in-memory prisma mock backs the RetroLearning and
 * TuningProposal stores, so the tests assert on HTTP responses and the resulting
 * DB state rather than on the exact prisma calls the route makes — leaving the
 * implementation latitude in how it queries and links.
 */

// ── In-memory stores (reset per test) ────────────────────────────────────────

interface LearningRow {
  id: number;
  projectId: string;
  targetSurface: string;
  status: string;
  proposalId: number | null;
}

interface ProposalRow {
  id: number;
  projectId: string;
  targetSurface: string;
  altitude: string;
  status: string;
  proposalText: string;
  createdAt: Date;
  updatedAt: Date;
}

const store = vi.hoisted(() => ({
  learnings: [] as {
    id: number;
    projectId: string;
    targetSurface: string;
    status: string;
    proposalId: number | null;
  }[],
  proposals: [] as {
    id: number;
    projectId: string;
    targetSurface: string;
    altitude: string;
    status: string;
    proposalText: string;
    createdAt: Date;
    updatedAt: Date;
  }[],
  nextProposalId: 1,
}));

/** Minimal prisma `where` matcher: scalar equality plus { in }, { not }, { equals }. */
function matchWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('in' in c) return (c.in as unknown[]).includes(row[key]);
      if ('not' in c) return row[key] !== c.not;
      if ('equals' in c) return row[key] === c.equals;
      return false;
    }
    return row[key] === cond;
  });
}

const mockPrisma = vi.hoisted(() => {
  return {} as Record<string, unknown>;
});

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

// Wire the mock to the stores. Done once; each method reads current store state.
Object.assign(mockPrisma, {
  // The route wraps its check-then-act in prisma.$transaction to close a TOCTOU
  // race (AC6). The store ops are synchronous, so aliasing the transaction
  // client to mockPrisma itself preserves every assertion while letting the
  // callback run. Both the interactive (callback) and batch (array) forms are
  // supported so the test doesn't pin which the route uses.
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(mockPrisma);
    if (Array.isArray(arg)) return Promise.all(arg);
    return undefined;
  }),
  project: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      name: where.id,
    })),
    create: vi.fn(async ({ data }: { data: { id: string; name: string } }) => data),
  },
  retroLearning: {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      store.learnings.filter((r) => matchWhere(r, where)).map((r) => ({ ...r })),
    ),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      store.learnings.filter((r) => matchWhere(r, where)).length,
    ),
    updateMany: vi.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const r of store.learnings) {
          if (matchWhere(r as unknown as Record<string, unknown>, where)) {
            Object.assign(r, data);
            count += 1;
          }
        }
        return { count };
      },
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = store.learnings.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return { ...row };
      },
    ),
  },
  tuningProposal: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = store.proposals.find((p) => matchWhere(p as unknown as Record<string, unknown>, where));
      return row ? { ...row } : null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: ProposalRow = {
        id: store.nextProposalId++,
        projectId: data.projectId as string,
        targetSurface: data.targetSurface as string,
        altitude: data.altitude as string,
        status: (data.status as string) ?? 'draft',
        proposalText: (data.proposalText as string) ?? '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.proposals.push(row);
      return { ...row };
    }),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: Record<string, unknown>;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = store.proposals.find((p) =>
          matchWhere(p as unknown as Record<string, unknown>, where),
        );
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const row: ProposalRow = {
          id: store.nextProposalId++,
          projectId: create.projectId as string,
          targetSurface: create.targetSurface as string,
          altitude: create.altitude as string,
          status: (create.status as string) ?? 'draft',
          proposalText: (create.proposalText as string) ?? '',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.proposals.push(row);
        return { ...row };
      },
    ),
  },
});

import { POST } from '@/app/api/tuning/proposals/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT = 'project-a';

function buildRequest(projectId: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (projectId !== null) headers['X-Project-ID'] = projectId;
  return new Request('http://localhost:3000/api/tuning/proposals', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let seq = 0;
function seedLearning(overrides: Partial<LearningRow> = {}): LearningRow {
  const row: LearningRow = {
    id: ++seq,
    projectId: PROJECT,
    targetSurface: 'skill:defensive-coding',
    status: 'open',
    proposalId: null,
    ...overrides,
  };
  store.learnings.push(row);
  return row;
}

function seedProposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  const row: ProposalRow = {
    id: store.nextProposalId++,
    projectId: PROJECT,
    targetSurface: 'skill:defensive-coding',
    altitude: 'skill-text',
    status: 'draft',
    proposalText: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  store.proposals.push(row);
  return row;
}

beforeEach(() => {
  store.learnings.length = 0;
  store.proposals.length = 0;
  store.nextProposalId = 1;
  seq = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── AC1: draft + cluster + link ──────────────────────────────────────────────

describe('POST /api/tuning/proposals', () => {
  it('creates a draft proposal, links the surface\'s live learnings, and returns 201 with linkedLearningIds', async () => {
    const a = seedLearning({ status: 'open' });
    const b = seedLearning({ status: 'recurred' });

    const res = await POST(
      buildRequest(PROJECT, { targetSurface: 'skill:defensive-coding', altitude: 'skill-text' }),
    );

    expect(res.status).toBe(201);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(typeof data.id).toBe('number');
    expect([...data.linkedLearningIds].sort()).toEqual([a.id, b.id].sort());

    // A draft proposal now exists for the surface.
    const proposal = store.proposals.find((p) => p.id === data.id);
    expect(proposal).toBeDefined();
    expect(proposal!.status).toBe('draft');
    expect(proposal!.projectId).toBe(PROJECT);
    expect(proposal!.targetSurface).toBe('skill:defensive-coding');

    // Every linked learning was stamped with the new proposal id.
    expect(store.learnings.filter((l) => l.proposalId === data.id).map((l) => l.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });

  // ── AC2: only open/recurred are linked ────────────────────────────────────

  it('links only open/recurred learnings and leaves resolved/dismissed unlinked', async () => {
    const open1 = seedLearning({ status: 'open' });
    const open2 = seedLearning({ status: 'open' });
    const recurred = seedLearning({ status: 'recurred' });
    const resolved = seedLearning({ status: 'resolved' });
    const dismissed = seedLearning({ status: 'dismissed' });

    const res = await POST(
      buildRequest(PROJECT, { targetSurface: 'skill:defensive-coding', altitude: 'skill-text' }),
    );

    expect(res.status).toBe(201);
    const { data } = await res.json();

    expect([...data.linkedLearningIds].sort()).toEqual([open1.id, open2.id, recurred.id].sort());
    expect(data.linkedLearningIds).toHaveLength(3);

    // resolved + dismissed rows keep proposalId null.
    expect(store.learnings.find((l) => l.id === resolved.id)!.proposalId).toBeNull();
    expect(store.learnings.find((l) => l.id === dismissed.id)!.proposalId).toBeNull();
  });

  // ── AC3: proposalText optional at draft time ──────────────────────────────

  it('persists an empty proposalText when none is supplied', async () => {
    seedLearning({ status: 'open' });

    const res = await POST(
      buildRequest(PROJECT, { targetSurface: 'skill:defensive-coding', altitude: 'skill-text' }),
    );

    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(store.proposals.find((p) => p.id === data.id)!.proposalText).toBe('');
  });

  // ── AC4: validation ───────────────────────────────────────────────────────

  it('returns 400 when targetSurface is missing and creates no proposal', async () => {
    const res = await POST(buildRequest(PROJECT, { altitude: 'skill-text' }));

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(store.proposals).toHaveLength(0);
  });

  it.each(['file-text', 'skilltext', '', 'SKILL-TEXT', 'agent'])(
    'returns 400 when altitude "%s" is outside skill-text|agent-prompt|hook',
    async (altitude) => {
      seedLearning({ status: 'open' });

      const res = await POST(
        buildRequest(PROJECT, { targetSurface: 'skill:defensive-coding', altitude }),
      );

      expect(res.status).toBe(400);
      const { success, error } = await res.json();
      expect(success).toBe(false);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(store.proposals).toHaveLength(0);
    },
  );

  it.each(['skill-text', 'agent-prompt', 'hook'])(
    'accepts the valid altitude "%s"',
    async (altitude) => {
      seedLearning({ status: 'open', targetSurface: `surface-${altitude}` });

      const res = await POST(
        buildRequest(PROJECT, { targetSurface: `surface-${altitude}`, altitude }),
      );

      expect(res.status).toBe(201);
    },
  );

  // ── AC5: no live learnings -> 400, no silent empty proposal ────────────────

  it.each([
    ['the surface has no learnings at all', [] as string[]],
    ['the surface has only resolved/dismissed learnings', ['resolved', 'dismissed']],
  ])('returns 400 with a "no live learnings" message when %s', async (_label, statuses) => {
    for (const status of statuses) seedLearning({ status });

    const res = await POST(
      buildRequest(PROJECT, { targetSurface: 'skill:defensive-coding', altitude: 'skill-text' }),
    );

    expect(res.status).toBe(400);
    const { success, error } = await res.json();
    expect(success).toBe(false);
    expect(error.message.toLowerCase()).toContain('no live learnings');
    // No proposal was drafted.
    expect(store.proposals).toHaveLength(0);
  });

  // ── AC6: resumed round is idempotent ──────────────────────────────────────

  it('resumes an existing open draft instead of creating a second one for the same surface', async () => {
    const existing = seedProposal({ status: 'draft' });
    seedLearning({ status: 'open' });
    seedLearning({ status: 'open' });

    const res = await POST(
      buildRequest(PROJECT, { targetSurface: 'skill:defensive-coding', altitude: 'skill-text' }),
    );

    // Idempotent resume: not an error, references the pre-existing draft.
    expect([200, 201]).toContain(res.status);
    const { data } = await res.json();
    expect(data.id).toBe(existing.id);

    // Exactly one draft proposal exists for this (project, surface).
    const drafts = store.proposals.filter(
      (p) => p.projectId === PROJECT && p.targetSurface === 'skill:defensive-coding' && p.status === 'draft',
    );
    expect(drafts).toHaveLength(1);
  });
});
