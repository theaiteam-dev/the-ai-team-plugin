import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import type { UseBoardEventsOptions } from '@/hooks/use-board-events';
import type { WorkItem, Stage, CardAnimationDirection } from '@/types';

// Mock Next.js navigation hooks
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => ({
    get: vi.fn(() => 'kanban-viewer'),
    toString: vi.fn(() => 'projectId=kanban-viewer'),
  })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

// Mock the useBoardEvents hook
let capturedCallbacks: UseBoardEventsOptions | null = null;

vi.mock('@/hooks/use-board-events', () => ({
  useBoardEvents: vi.fn((options: UseBoardEventsOptions) => {
    capturedCallbacks = options;
    return { isConnected: true, connectionState: 'connected', connectionError: null };
  }),
}));

// Factory for creating test work items
function createTestItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: '001',
    title: 'Test Work Item',
    type: 'feature',
    status: 'pending',
    rejection_count: 0,
    dependencies: [],
    outputs: {},
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    stage: 'briefings',
    content: 'Test content',
    ...overrides,
  };
}

// Mock fetch for initial data loading - now using the new API endpoints
function setupFetchMock() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    // Projects API endpoint
    if (url === '/api/projects' || url.startsWith('/api/projects?')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: [{ id: 'kanban-viewer', name: 'Kanban Viewer', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
        }),
      });
    }
    // New unified board API endpoint
    if (url.startsWith('/api/board')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              stages: [
                { id: 'briefings', name: 'Backlog', order: 0, wipLimit: null },
                { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
                { id: 'testing', name: 'In Progress', order: 2, wipLimit: 5 },
                { id: 'review', name: 'Review', order: 3, wipLimit: 3 },
                { id: 'done', name: 'Done', order: 4, wipLimit: null },
                { id: 'blocked', name: 'Blocked', order: 5, wipLimit: null },
              ],
              items: [
                {
                  id: '001',
                  title: 'Test Work Item',
                  description: 'Test content',
                  type: 'feature',
                  priority: 'medium',
                  stageId: 'briefings',
                  assignedAgent: null,
                  rejectionCount: 0,
                  createdAt: '2026-01-15T10:00:00Z',
                  updatedAt: '2026-01-15T10:00:00Z',
                  completedAt: null,
                  dependencies: [],
                  workLogs: [],
                },
                {
                  id: '002',
                  title: 'Ready Item',
                  description: 'Test content',
                  type: 'feature',
                  priority: 'medium',
                  stageId: 'ready',
                  assignedAgent: null,
                  rejectionCount: 0,
                  createdAt: '2026-01-15T10:00:00Z',
                  updatedAt: '2026-01-15T10:00:00Z',
                  completedAt: null,
                  dependencies: [],
                  workLogs: [],
                },
                {
                  id: '003',
                  title: 'Implementing Item',
                  description: 'Test content',
                  type: 'feature',
                  priority: 'medium',
                  stageId: 'testing',
                  assignedAgent: null,
                  rejectionCount: 0,
                  createdAt: '2026-01-15T10:00:00Z',
                  updatedAt: '2026-01-15T10:00:00Z',
                  completedAt: null,
                  dependencies: [],
                  workLogs: [],
                },
              ],
              claims: [],
              currentMission: {
                id: 'M-001',
                name: 'Test Mission',
                state: 'running',
                prdPath: '/test/prd.md',
                startedAt: '2026-01-15T10:00:00Z',
                completedAt: null,
                archivedAt: null,
              },
            },
          }),
      });
    }
    // New activity API endpoint
    if (url === '/api/activity' || url.startsWith('/api/activity?')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { entries: [] } }),
      });
    }
    return Promise.resolve({ ok: false });
  });
}

describe('Page Animation Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedCallbacks = null;
    setupFetchMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function renderPage() {
    // Reset module cache to get fresh component
    vi.resetModules();

    // Re-setup mocks after reset
    vi.mock('@/hooks/use-board-events', () => ({
      useBoardEvents: vi.fn((options: UseBoardEventsOptions) => {
        capturedCallbacks = options;
        return { isConnected: true, connectionState: 'connected', connectionError: null };
      }),
    }));

    setupFetchMock();

    const { default: Home } = await import('../app/page');

    let result;
    await act(async () => {
      result = render(<Home />);
    });

    // Resolve all pending promises for initial fetch
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    return result;
  }

  describe('animation state tracking', () => {
    it('should render board columns', async () => {
      await renderPage();

      // Verify columns are rendered (loading should be gone after fetches complete)
      const columns = screen.queryAllByTestId('board-column');
      expect(columns.length).toBeGreaterThan(0);
    });

    // WI-792 AC: 9 columns including Staged between Probing and Done.
    // board-column.tsx renders {stage.toUpperCase()} directly as the heading
    // (no separate label map on this path) — once 'staged' is in ALL_STAGES
    // and itemsByStage, the "STAGED" heading is automatic.
    it('renders exactly 9 board columns, including a Staged column, once staged is wired into ALL_STAGES', async () => {
      vi.resetModules();
      vi.mock('@/hooks/use-board-events', () => ({
        useBoardEvents: vi.fn((options: UseBoardEventsOptions) => {
          capturedCallbacks = options;
          return { isConnected: true, connectionState: 'connected', connectionError: null };
        }),
      }));
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/projects' || url.startsWith('/api/projects?')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: [{ id: 'kanban-viewer', name: 'Kanban Viewer', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
              }),
          });
        }
        if (url.startsWith('/api/board')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  stages: [
                    { id: 'briefings', name: 'Briefings', order: 0, wipLimit: null },
                    { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
                    { id: 'testing', name: 'Testing', order: 2, wipLimit: 3 },
                    { id: 'implementing', name: 'Implementing', order: 3, wipLimit: 3 },
                    { id: 'review', name: 'Review', order: 4, wipLimit: 3 },
                    { id: 'probing', name: 'Probing', order: 5, wipLimit: 3 },
                    { id: 'staged', name: 'Staged', order: 6, wipLimit: null },
                    { id: 'done', name: 'Done', order: 7, wipLimit: null },
                    { id: 'blocked', name: 'Blocked', order: 8, wipLimit: null },
                  ],
                  items: [
                    {
                      id: 'WI-STG', title: 'Staged Item', description: 'x', type: 'feature',
                      priority: 'medium', stageId: 'staged', assignedAgent: null, rejectionCount: 0,
                      createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-01-15T10:00:00Z',
                      completedAt: null, dependencies: [], workLogs: [],
                    },
                  ],
                  claims: [],
                  currentMission: {
                    id: 'M-001', name: 'Test Mission', state: 'running', prdPath: '/test/prd.md',
                    startedAt: '2026-01-15T10:00:00Z', completedAt: null, archivedAt: null,
                  },
                },
              }),
          });
        }
        if (url === '/api/activity' || url.startsWith('/api/activity?')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: { entries: [] } }) });
        }
        return Promise.resolve({ ok: false });
      });

      const { default: Home } = await import('../app/page');
      await act(async () => {
        render(<Home />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const columns = screen.queryAllByTestId('board-column');
      expect(columns).toHaveLength(9);

      const headers = screen.queryAllByTestId('column-header');
      const headingTexts = headers.map((h) => h.textContent ?? '');
      expect(headingTexts.some((t) => /STAGED/.test(t))).toBe(true);

      // The staged item renders as a card...
      expect(screen.getByText('Staged Item')).toBeInTheDocument();

      // ...and the Staged column's WIP display shows unlimited (∞), not a
      // limit of 0, matching its null wipLimit (AC).
      const stagedHeader = headers.find((h) => /STAGED/.test(h.textContent ?? ''));
      expect(stagedHeader).toBeDefined();
      expect(stagedHeader?.textContent).toMatch(/1\/∞/);
    });

    it('should start exit animation when onItemMoved is called', async () => {
      await renderPage();

      // Trigger item move event
      act(() => {
        capturedCallbacks?.onItemMoved?.('001', 'briefings', 'ready');
      });

      // The card should have exit animation class
      const cards = screen.getAllByTestId('work-item-card');
      const hasExiting = cards.some(card => card.classList.contains('card-exiting'));
      expect(hasExiting).toBe(true);
    });
  });

  // WI-792 rework (Lynch rejection): Amy's CRITICAL FLAG found that page.tsx
  // — the real, live-rendered surface — never rendered any mobile UI at any
  // viewport, despite 242 passing tests, because responsive-board.tsx's
  // mobile-tab implementation had zero production imports. B.A.'s fix wires
  // useIsMobileViewport() into page.tsx's render branch, but shipped with
  // only a throwaway matchMedia-mocked smoke test that was deleted before
  // handoff. This is the permanent regression test for that exact gap: it
  // mocks window.matchMedia to report mobile, renders the REAL Home
  // component (not ResponsiveBoard in isolation), and asserts the mobile
  // stage tabs — including a Staged tab — actually render. This is the
  // AC3/AC6/AC7 assertion that would have caught the bug before Amy had to
  // catch it live.
  describe('mobile viewport rendering (WI-792 rework)', () => {
    afterEach(() => {
      // jsdom does not implement matchMedia by default (the hook's own
      // fail-safe default depends on that) — explicitly remove the stub so
      // it cannot leak into other tests in this file that assume desktop.
      // @ts-expect-error -- deliberately deleting to restore the jsdom default.
      delete window.matchMedia;
    });

    function installMobileMatchMedia() {
      const mql = {
        matches: true,
        media: '(max-width: 767px)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn().mockReturnValue(mql),
      });
    }

    it('renders the mobile stage tabs (with a Staged tab) instead of the desktop grid when the viewport is mobile', async () => {
      installMobileMatchMedia();
      vi.resetModules();
      vi.mock('@/hooks/use-board-events', () => ({
        useBoardEvents: vi.fn((options: UseBoardEventsOptions) => {
          capturedCallbacks = options;
          return { isConnected: true, connectionState: 'connected', connectionError: null };
        }),
      }));
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/projects' || url.startsWith('/api/projects?')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: [{ id: 'kanban-viewer', name: 'Kanban Viewer', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
              }),
          });
        }
        if (url.startsWith('/api/board')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  stages: [
                    { id: 'briefings', name: 'Briefings', order: 0, wipLimit: null },
                    { id: 'ready', name: 'Ready', order: 1, wipLimit: 10 },
                    { id: 'testing', name: 'Testing', order: 2, wipLimit: 3 },
                    { id: 'implementing', name: 'Implementing', order: 3, wipLimit: 3 },
                    { id: 'review', name: 'Review', order: 4, wipLimit: 3 },
                    { id: 'probing', name: 'Probing', order: 5, wipLimit: 3 },
                    { id: 'staged', name: 'Staged', order: 6, wipLimit: null },
                    { id: 'done', name: 'Done', order: 7, wipLimit: null },
                    { id: 'blocked', name: 'Blocked', order: 8, wipLimit: null },
                  ],
                  items: [
                    {
                      id: 'WI-STG', title: 'Staged Item', description: 'x', type: 'feature',
                      priority: 'medium', stageId: 'staged', assignedAgent: null, rejectionCount: 0,
                      createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-01-15T10:00:00Z',
                      completedAt: null, dependencies: [], workLogs: [],
                    },
                  ],
                  claims: [],
                  currentMission: {
                    id: 'M-001', name: 'Test Mission', state: 'running', prdPath: '/test/prd.md',
                    startedAt: '2026-01-15T10:00:00Z', completedAt: null, archivedAt: null,
                  },
                },
              }),
          });
        }
        if (url === '/api/activity' || url.startsWith('/api/activity?')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: { entries: [] } }) });
        }
        return Promise.resolve({ ok: false });
      });

      const { default: Home } = await import('../app/page');
      await act(async () => {
        render(<Home />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // page.tsx's isMobileViewport branch renders <ResponsiveBoard> (its
      // own wrapper testid) instead of the plain, untestid'd ALL_STAGES.map
      // desktop grid used in the false branch — a structural signal, not a
      // CSS-visibility one. (ResponsiveBoard itself always mounts both its
      // mobile and "hidden md:flex" desktop subtrees in JSX regardless of
      // viewport — jsdom never evaluates the Tailwind classes that hide one
      // of them in a real browser — so presence/absence of its internal
      // desktop-board node is not a valid mobile-vs-desktop signal here.)
      expect(screen.getByTestId('responsive-board')).toBeInTheDocument();

      // The mobile tab list rendered at all — this is the exact assertion
      // that was missing: with the pre-rework code, page.tsx always
      // rendered the desktop grid regardless of matchMedia, so this would
      // fail (mobile-stage-tabs never present, because the plain desktop
      // branch never mounts ResponsiveBoard at all).
      expect(screen.getByTestId('mobile-stage-tabs')).toBeInTheDocument();
      expect(screen.getByTestId('stage-tab-staged')).toBeInTheDocument();

      // Selecting the Staged tab shows that column's items (AC3's second
      // half: "selecting it shows that column's items").
      // Matches the proven-reliable selection pattern from
      // responsive-board.test.tsx: Radix's TabsTrigger activates via
      // keyboard on this primitive more reliably under jsdom's simulated
      // event dispatch than a bare pointer click, and this also directly
      // exercises AC6 (Enter activates a tab).
      const stagedTab = screen.getByTestId('stage-tab-staged');
      await act(async () => {
        fireEvent.keyDown(stagedTab, { key: 'Enter' });
      });
      expect(screen.getByTestId('stage-content-staged')).toHaveTextContent('Staged Item');
    });
  });

  describe('animation direction calculation', () => {
    it('should use right direction when moving to a later stage', async () => {
      await renderPage();

      // Move from briefings to ready (right)
      act(() => {
        capturedCallbacks?.onItemMoved?.('001', 'briefings', 'ready');
      });

      const cards = screen.getAllByTestId('work-item-card');
      const hasRightExiting = cards.some(card =>
        card.classList.contains('card-exiting-right')
      );
      expect(hasRightExiting).toBe(true);
    });

    it('should use left direction when moving to an earlier stage', async () => {
      await renderPage();

      // Move from ready to briefings (left)
      act(() => {
        capturedCallbacks?.onItemMoved?.('002', 'ready', 'briefings');
      });

      const cards = screen.getAllByTestId('work-item-card');
      const hasLeftExiting = cards.some(card =>
        card.classList.contains('card-exiting-left')
      );
      expect(hasLeftExiting).toBe(true);
    });

    // WI-792: the new probing <-> staged boundary, exercised through the
    // real rendered onItemMoved path (not just the isolated helper above).
    it('should use right direction (forward) when moving from probing to staged', async () => {
      await renderPage();

      act(() => {
        capturedCallbacks?.onItemMoved?.('001', 'probing', 'staged');
      });

      const cards = screen.getAllByTestId('work-item-card');
      const hasRightExiting = cards.some(card => card.classList.contains('card-exiting-right'));
      expect(hasRightExiting).toBe(true);
    });

    it('should use left direction (backward) when moving from staged to implementing', async () => {
      await renderPage();

      act(() => {
        capturedCallbacks?.onItemMoved?.('002', 'staged', 'implementing');
      });

      const cards = screen.getAllByTestId('work-item-card');
      const hasLeftExiting = cards.some(card => card.classList.contains('card-exiting-left'));
      expect(hasLeftExiting).toBe(true);
    });
  });

  describe('animation sequence', () => {
    it('should transition from exiting to entering after duration', async () => {
      await renderPage();

      // Start move animation
      act(() => {
        capturedCallbacks?.onItemMoved?.('001', 'briefings', 'ready');
      });

      // Verify exit animation started
      let cards = screen.getAllByTestId('work-item-card');
      expect(cards.some(c => c.classList.contains('card-exiting'))).toBe(true);

      // Advance timer past exit animation duration (300ms)
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Should now show enter animation
      cards = screen.getAllByTestId('work-item-card');
      const hasEntering = cards.some(c => c.classList.contains('card-entering'));
      expect(hasEntering).toBe(true);
    });

    it('should clear animation after both phases complete', async () => {
      await renderPage();

      // Start move animation
      act(() => {
        capturedCallbacks?.onItemMoved?.('001', 'briefings', 'ready');
      });

      // Advance through exit (300ms) + enter (300ms)
      act(() => {
        vi.advanceTimersByTime(600);
      });

      // Animation should be complete
      const cards = screen.getAllByTestId('work-item-card');
      const hasAnimating = cards.some(
        c => c.classList.contains('card-exiting') || c.classList.contains('card-entering')
      );
      expect(hasAnimating).toBe(false);
    });
  });

  describe('rapid moves handling', () => {
    it('should handle new move during pending animation', async () => {
      await renderPage();

      // Start first move
      act(() => {
        capturedCallbacks?.onItemMoved?.('001', 'briefings', 'ready');
      });

      // Immediately trigger another move
      act(() => {
        capturedCallbacks?.onItemMoved?.('001', 'ready', 'testing');
      });

      // Advance through all timers
      act(() => {
        vi.advanceTimersByTime(1200);
      });

      // Item should exist and not be stuck animating
      const cards = screen.getAllByTestId('work-item-card');
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  describe('state updates not blocked', () => {
    it('should allow updates to other items during animation', async () => {
      await renderPage();

      // Start animating item 001
      act(() => {
        capturedCallbacks?.onItemMoved?.('001', 'briefings', 'ready');
      });

      // Update a different item
      act(() => {
        capturedCallbacks?.onItemUpdated?.({
          ...createTestItem({ id: '002', stage: 'ready' }),
          title: 'Updated Ready Item',
        });
      });

      // The update should be reflected
      expect(screen.getByText('Updated Ready Item')).toBeInTheDocument();
    });

    it('should allow adding new items during animation', async () => {
      await renderPage();

      // Start animating item 001
      act(() => {
        capturedCallbacks?.onItemMoved?.('001', 'briefings', 'ready');
      });

      // Add a new item
      act(() => {
        capturedCallbacks?.onItemAdded?.(
          createTestItem({ id: '004', title: 'Brand New Item', stage: 'briefings' })
        );
      });

      // New item should be present
      expect(screen.getByText('Brand New Item')).toBeInTheDocument();
    });
  });
});

// WI-792: previously this describe block locally reimplemented
// getAnimationDirection with its own hardcoded, DRIFTED stage list (missing
// 'probing' entirely, and now also missing 'staged') — exactly the banned
// "local reimplementation" pattern (test-writing skill Ban #5): a copy that
// can silently drift from the real function. page.tsx now exports both
// ALL_STAGES and getAnimationDirection (named exports alongside the default)
// specifically so this suite can test the REAL function instead of a copy —
// WI-792 requires the new probing<->staged boundary to have correct
// direction, which a stale local copy would have gotten wrong (indexOf
// returns -1 for a stage the copy doesn't know about, silently returning
// 'none' instead of a real direction).
import { ALL_STAGES, getAnimationDirection } from '../app/page';

describe('getAnimationDirection helper (real function, not a local copy)', () => {
  it('should return right for briefings to ready', () => {
    expect(getAnimationDirection('briefings', 'ready')).toBe('right');
  });

  it('should return right for ready to testing', () => {
    expect(getAnimationDirection('ready', 'testing')).toBe('right');
  });

  it('should return left for testing to ready', () => {
    expect(getAnimationDirection('testing', 'ready')).toBe('left');
  });

  it('should return left for done to briefings', () => {
    expect(getAnimationDirection('done', 'briefings')).toBe('left');
  });

  it('should return right for briefings to done', () => {
    expect(getAnimationDirection('briefings', 'done')).toBe('right');
  });

  // WI-792 AC: the new probing <-> staged boundary.
  it('should return right (forward) for probing to staged', () => {
    expect(getAnimationDirection('probing', 'staged')).toBe('right');
  });

  it('should return left (backward) for staged to implementing', () => {
    expect(getAnimationDirection('staged', 'implementing')).toBe('left');
  });

  it('should return right (forward) for staged to done', () => {
    expect(getAnimationDirection('staged', 'done')).toBe('right');
  });

  it('positions staged between probing and done in ALL_STAGES, matching the shared source of truth', () => {
    const probingIndex = ALL_STAGES.indexOf('probing');
    const stagedIndex = ALL_STAGES.indexOf('staged');
    const doneIndex = ALL_STAGES.indexOf('done');
    expect(stagedIndex).toBe(probingIndex + 1);
    expect(doneIndex).toBe(stagedIndex + 1);
  });

  it('ALL_STAGES has exactly 9 stages', () => {
    expect(ALL_STAGES).toHaveLength(9);
  });
});
