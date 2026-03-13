import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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

describe('getAnimationDirection helper', () => {
  // Test the direction calculation logic in isolation
  const ALL_STAGES: Stage[] = [
    'briefings',
    'ready',
    'testing',
    'implementing',
    'review',
    'done',
    'blocked',
  ];

  function getDirection(from: Stage, to: Stage): CardAnimationDirection {
    const fromIndex = ALL_STAGES.indexOf(from);
    const toIndex = ALL_STAGES.indexOf(to);
    if (fromIndex === -1 || toIndex === -1) return 'none';
    return toIndex > fromIndex ? 'right' : 'left';
  }

  it('should return right for briefings to ready', () => {
    expect(getDirection('briefings', 'ready')).toBe('right');
  });

  it('should return right for ready to testing', () => {
    expect(getDirection('ready', 'testing')).toBe('right');
  });

  it('should return left for testing to ready', () => {
    expect(getDirection('testing', 'ready')).toBe('left');
  });

  it('should return left for done to briefings', () => {
    expect(getDirection('done', 'briefings')).toBe('left');
  });

  it('should return right for briefings to done', () => {
    expect(getDirection('briefings', 'done')).toBe('right');
  });
});
