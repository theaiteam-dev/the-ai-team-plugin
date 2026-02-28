import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { UseBoardEventsOptions, UseBoardEventsReturn } from '@/hooks/use-board-events';
import type { MissionTokenUsageData } from '@/types';
import { createMockFetch, createWorkItem } from './helpers/mock-api-responses';

// Capture useBoardEvents options to simulate SSE callbacks
let capturedOptions: UseBoardEventsOptions | null = null;

vi.mock('@/hooks/use-board-events', () => ({
  useBoardEvents: vi.fn((options: UseBoardEventsOptions): UseBoardEventsReturn => {
    capturedOptions = options;
    return {
      isConnected: true,
      connectionState: 'connected' as const,
      connectionError: null,
    };
  }),
}));

// Import the page component after mocks are set up
import Home from '../app/page';

// Factory helpers for token usage test data
function createAgentUsage(overrides: Partial<MissionTokenUsageData> = {}): MissionTokenUsageData {
  return {
    agentName: 'Murdock',
    model: 'claude-sonnet-4-6',
    inputTokens: 10000,
    outputTokens: 2000,
    cacheCreationTokens: 500,
    cacheReadTokens: 300,
    estimatedCostUsd: 0.15,
    ...overrides,
  };
}

function createTokenUsagePayload(agents: MissionTokenUsageData[] = [createAgentUsage()]) {
  const totals = {
    inputTokens: agents.reduce((s, a) => s + a.inputTokens, 0),
    outputTokens: agents.reduce((s, a) => s + a.outputTokens, 0),
    cacheCreationTokens: agents.reduce((s, a) => s + a.cacheCreationTokens, 0),
    cacheReadTokens: agents.reduce((s, a) => s + a.cacheReadTokens, 0),
    estimatedCostUsd: agents.reduce((s, a) => s + a.estimatedCostUsd, 0),
  };
  return { missionId: 'M-001', agents, totals };
}

describe('TokenUsagePanel wiring in page.tsx', () => {
  beforeEach(() => {
    capturedOptions = null;
    global.fetch = createMockFetch({
      items: [createWorkItem({ id: '001', title: 'Test Item', stage: 'ready' })],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('SSE callback wiring', () => {
    it('should pass onMissionTokenUsage callback to useBoardEvents', async () => {
      render(<Home />);

      await waitFor(() => {
        expect(capturedOptions).not.toBeNull();
      });

      expect(typeof capturedOptions?.onMissionTokenUsage).toBe('function');
    });

    it('should render TokenUsagePanel when token data arrives via SSE', async () => {
      render(<Home />);

      await waitFor(() => {
        expect(capturedOptions).not.toBeNull();
      });

      // Token usage section should not exist yet
      expect(screen.queryByTestId('token-usage-section')).not.toBeInTheDocument();

      // Simulate SSE event with token usage data
      const payload = createTokenUsagePayload([
        createAgentUsage({ agentName: 'Murdock', estimatedCostUsd: 1.50 }),
        createAgentUsage({ agentName: 'B.A.', estimatedCostUsd: 2.25 }),
      ]);

      act(() => {
        capturedOptions?.onMissionTokenUsage?.(payload);
      });

      await waitFor(() => {
        expect(screen.getByTestId('token-usage-section')).toBeInTheDocument();
      });
    });
  });

  describe('conditional rendering', () => {
    it('should NOT render token-usage-section when no token data exists', async () => {
      render(<Home />);

      await waitFor(() => {
        expect(capturedOptions).not.toBeNull();
      });

      // Wait for board to finish loading
      await waitFor(() => {
        expect(screen.getByText('Test Item')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('token-usage-section')).not.toBeInTheDocument();
    });

    it('should render agent rows for each agent in the SSE data', async () => {
      render(<Home />);

      await waitFor(() => {
        expect(capturedOptions).not.toBeNull();
      });

      const payload = createTokenUsagePayload([
        createAgentUsage({ agentName: 'Murdock', estimatedCostUsd: 0.50 }),
        createAgentUsage({ agentName: 'B.A.', estimatedCostUsd: 1.00 }),
        createAgentUsage({ agentName: 'Lynch', estimatedCostUsd: 0.30 }),
      ]);

      act(() => {
        capturedOptions?.onMissionTokenUsage?.(payload);
      });

      await waitFor(() => {
        const rows = screen.getAllByTestId('token-usage-agent-row');
        expect(rows).toHaveLength(3);
      });
    });
  });

  describe('cost display accuracy', () => {
    it('should display the correct total cost from SSE data', async () => {
      render(<Home />);

      await waitFor(() => {
        expect(capturedOptions).not.toBeNull();
      });

      const payload = createTokenUsagePayload([
        createAgentUsage({ agentName: 'Murdock', estimatedCostUsd: 1.23 }),
        createAgentUsage({ agentName: 'B.A.', estimatedCostUsd: 4.56 }),
      ]);

      act(() => {
        capturedOptions?.onMissionTokenUsage?.(payload);
      });

      await waitFor(() => {
        // Total = 1.23 + 4.56 = 5.79
        expect(screen.getByTestId('token-usage-total-cost')).toHaveTextContent('$5.79');
      });
    });

    it('should update token usage when a new SSE event arrives', async () => {
      render(<Home />);

      await waitFor(() => {
        expect(capturedOptions).not.toBeNull();
      });

      // First event
      const firstPayload = createTokenUsagePayload([
        createAgentUsage({ agentName: 'Murdock', estimatedCostUsd: 1.00 }),
      ]);

      act(() => {
        capturedOptions?.onMissionTokenUsage?.(firstPayload);
      });

      await waitFor(() => {
        expect(screen.getByTestId('token-usage-total-cost')).toHaveTextContent('$1.00');
      });

      // Second event with updated data
      const secondPayload = createTokenUsagePayload([
        createAgentUsage({ agentName: 'Murdock', estimatedCostUsd: 3.50 }),
        createAgentUsage({ agentName: 'B.A.', estimatedCostUsd: 2.50 }),
      ]);

      act(() => {
        capturedOptions?.onMissionTokenUsage?.(secondPayload);
      });

      await waitFor(() => {
        expect(screen.getByTestId('token-usage-total-cost')).toHaveTextContent('$6.00');
      });
    });
  });

  describe('initial load for completed missions', () => {
    it('should fetch token usage on load when mission is completed', async () => {
      const tokenAgents = [
        createAgentUsage({ agentName: 'Murdock', estimatedCostUsd: 2.00 }),
      ];
      const tokenTotals = {
        inputTokens: 10000,
        outputTokens: 2000,
        cacheCreationTokens: 500,
        cacheReadTokens: 300,
        estimatedCostUsd: 2.00,
      };

      // Build a mock fetch that returns a completed mission and token usage data
      global.fetch = vi.fn((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();

        if (urlStr === '/api/projects' || urlStr.startsWith('/api/projects?')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, data: [] }),
          } as Response);
        }

        if (urlStr.startsWith('/api/board')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                stages: [
                  { id: 'briefings', name: 'Briefings', order: 0, wipLimit: null },
                  { id: 'ready', name: 'Ready', order: 1, wipLimit: null },
                  { id: 'testing', name: 'Testing', order: 2, wipLimit: 2 },
                  { id: 'implementing', name: 'Implementing', order: 3, wipLimit: 3 },
                  { id: 'review', name: 'Review', order: 4, wipLimit: 2 },
                  { id: 'done', name: 'Done', order: 5, wipLimit: null },
                ],
                items: [],
                claims: [],
                currentMission: {
                  id: 'M-completed',
                  name: 'Completed Mission',
                  state: 'completed',
                  prdPath: null,
                  startedAt: '2026-01-15T00:00:00Z',
                  completedAt: '2026-01-15T12:00:00Z',
                  archivedAt: null,
                },
              },
            }),
          } as Response);
        }

        if (urlStr === '/api/activity' || urlStr.startsWith('/api/activity?')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, data: { entries: [] } }),
          } as Response);
        }

        if (urlStr.includes('/api/missions/') && urlStr.includes('/token-usage')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                missionId: 'M-completed',
                agents: tokenAgents,
                totals: tokenTotals,
              },
            }),
          } as Response);
        }

        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      }) as typeof fetch;

      render(<Home />);

      // Token usage should be fetched and rendered
      await waitFor(() => {
        expect(screen.getByTestId('token-usage-section')).toBeInTheDocument();
        expect(screen.getByTestId('token-usage-total-cost')).toHaveTextContent('$2.00');
      });

      // Verify the token-usage endpoint was called
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/missions/M-completed/token-usage',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Project-ID': 'kanban-viewer',
          }),
        })
      );
    });

    it('should NOT fetch token usage when mission is still running', async () => {
      global.fetch = createMockFetch({
        items: [createWorkItem()],
      });

      render(<Home />);

      await waitFor(() => {
        expect(screen.getByText('Test Item')).toBeInTheDocument();
      });

      // Verify token-usage endpoint was NOT called
      const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const tokenUsageCalls = fetchCalls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('/token-usage')
      );
      expect(tokenUsageCalls).toHaveLength(0);
    });
  });
});
