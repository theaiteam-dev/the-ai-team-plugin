import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { UseBoardEventsReturn } from '@/hooks/use-board-events';
import type { BoardMetadata } from '@/types';

// Mock state
let mockConnectionState: 'connecting' | 'connected' | 'disconnected' | 'error' = 'connecting';
let mockIsConnected = false;
let mockConnectionError: Error | null = null;

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

// Mock useBoardEvents hook to return granular connectionState
vi.mock('@/hooks/use-board-events', () => ({
  useBoardEvents: vi.fn((): UseBoardEventsReturn => {
    return {
      isConnected: mockIsConnected,
      connectionState: mockConnectionState,
      connectionError: mockConnectionError,
    };
  }),
}));

// Mock board metadata for fetch (unused but kept for documentation)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _mockMetadata: BoardMetadata = {
  mission: {
    name: 'Test Mission',
    started_at: '2026-01-17T00:00:00Z',
    status: 'active',
  },
  wip_limits: { testing: 2, implementing: 3, review: 2 },
  phases: {},
  assignments: {},
  agents: {},
  stats: { total_items: 3, completed: 1, in_progress: 1, blocked: 1, backlog: 0 },
  last_updated: '2026-01-17T12:00:00Z',
};

// Import the page component after mocks are set up
import Home from '../app/page';

describe('Page Connection Status', () => {
  beforeEach(() => {
    mockConnectionState = 'connecting';
    mockIsConnected = false;
    mockConnectionError = null;

    // Mock fetch for initial data - now using the new API endpoints
    global.fetch = vi.fn((url: string) => {
      // Projects API endpoint
      if (url === '/api/projects' || url.startsWith('/api/projects?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: [{ id: 'kanban-viewer', name: 'Kanban Viewer', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
          }),
        } as Response);
      }
      // New unified board API endpoint
      if (url.startsWith('/api/board')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
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
              items: [],
              claims: [],
              currentMission: {
                id: 'M-001',
                name: 'Test Mission',
                state: 'running',
                prdPath: '/test/prd.md',
                startedAt: '2026-01-17T00:00:00Z',
                completedAt: null,
                archivedAt: null,
              },
            },
          }),
        } as Response);
      }
      // New activity API endpoint
      if (url === '/api/activity' || url.startsWith('/api/activity?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { entries: [] },
          }),
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('connectionState passed to ConnectionStatusIndicator', () => {
    it('should pass connectionState from useBoardEvents to ConnectionStatusIndicator', async () => {
      mockConnectionState = 'connected';
      mockIsConnected = true;

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'connected');
    });
  });

  describe('initial page load shows connecting state', () => {
    it('should show connecting status during initial load before SSE opens', async () => {
      mockConnectionState = 'connecting';
      mockIsConnected = false;
      mockConnectionError = null;

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'connecting');
      expect(screen.getByText('Connecting...')).toBeInTheDocument();
    });
  });

  describe('connected state after SSE opens', () => {
    it('should show connected status after SSE connection opens', async () => {
      mockConnectionState = 'connected';
      mockIsConnected = true;
      mockConnectionError = null;

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'connected');
      expect(screen.getByText('Live')).toBeInTheDocument();
    });
  });

  describe('connecting state during reconnection', () => {
    it('should show connecting status during reconnection attempts', async () => {
      // Simulate reconnection state - still connecting but no error yet
      mockConnectionState = 'connecting';
      mockIsConnected = false;
      mockConnectionError = null;

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'connecting');
      expect(screen.getByText('Connecting...')).toBeInTheDocument();
    });
  });

  describe('error state with error message', () => {
    it('should show error status when connection fails', async () => {
      mockConnectionState = 'error';
      mockIsConnected = false;
      mockConnectionError = new Error('SSE connection failed');

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'error');
    });

    it('should display error message when connection fails', async () => {
      mockConnectionState = 'error';
      mockIsConnected = false;
      mockConnectionError = new Error('Network timeout');

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      // Error message should be displayed
      expect(screen.getByText('Network timeout')).toBeInTheDocument();
    });
  });

  describe('disconnected state after max retries', () => {
    it('should show error status with error message after max retries exceeded', async () => {
      // After max retries, the hook sets both rawConnectionState='disconnected' and connectionError
      // The derived connectionState becomes 'error' because error takes precedence
      mockConnectionState = 'error';
      mockIsConnected = false;
      mockConnectionError = new Error('Failed to connect to SSE endpoint after maximum retries');

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'error');
      expect(screen.getByText('Failed to connect to SSE endpoint after maximum retries')).toBeInTheDocument();
    });

    it('should show disconnected status when hook is disabled', async () => {
      // When hook is disabled, rawConnectionState is 'disconnected' with no error
      mockConnectionState = 'disconnected';
      mockIsConnected = false;
      mockConnectionError = null;

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const indicator = screen.getByTestId('connection-status-indicator');
      expect(indicator).toHaveAttribute('data-status', 'disconnected');
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });
  });

  describe('connection state transitions', () => {
    it('should render indicator with amber dot for connecting state', async () => {
      mockConnectionState = 'connecting';
      mockIsConnected = false;

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const dot = screen.getByTestId('connection-status-dot');
      expect(dot).toHaveClass('bg-amber-500');
    });

    it('should render indicator with green dot for connected state', async () => {
      mockConnectionState = 'connected';
      mockIsConnected = true;

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const dot = screen.getByTestId('connection-status-dot');
      expect(dot).toHaveClass('bg-green-500');
    });

    it('should render indicator with red dot for error state', async () => {
      mockConnectionState = 'error';
      mockIsConnected = false;
      mockConnectionError = new Error('Connection error');

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const dot = screen.getByTestId('connection-status-dot');
      expect(dot).toHaveClass('bg-red-500');
    });

    it('should render indicator with red dot for disconnected state', async () => {
      mockConnectionState = 'disconnected';
      mockIsConnected = false;

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Mission')).toBeInTheDocument();
      });

      const dot = screen.getByTestId('connection-status-dot');
      expect(dot).toHaveClass('bg-red-500');
    });
  });
});
