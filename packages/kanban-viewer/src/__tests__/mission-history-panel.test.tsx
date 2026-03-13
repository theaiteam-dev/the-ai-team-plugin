import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * Tests for MissionHistoryPanel slide-out drawer (WI-456)
 *
 * Triggered from a History icon button in HeaderBar.
 * Fetches from GET /api/missions, displays missions sorted by startedAt desc.
 * Master-detail: list on left, detail pane on right when row selected.
 * precheckBlockers/precheckOutput are pre-parsed by the API — used directly.
 */

// API mission shape returned by GET /api/missions
interface ApiMission {
  id: string;
  name: string;
  state: string;
  prdPath: string;
  startedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  precheckBlockers?: string[] | null;
  precheckOutput?: Record<string, unknown> | null;
}

function createApiMission(overrides: Partial<ApiMission> = {}): ApiMission {
  return {
    id: 'M-20260121-001',
    name: 'Test Mission',
    state: 'completed',
    prdPath: '/prd/test.md',
    startedAt: '2026-01-21T10:00:00Z',
    completedAt: '2026-01-21T12:00:00Z',
    archivedAt: null,
    precheckBlockers: null,
    precheckOutput: null,
    ...overrides,
  };
}

// Mock fetch for /api/missions
function createMockFetchWithMissions(missions: ApiMission[]) {
  return vi.fn((url: string) => {
    if (url.startsWith('/api/missions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: missions }),
      });
    }
    return Promise.reject(new Error(`Unmocked URL: ${url}`));
  }) as unknown as typeof global.fetch;
}

// Import components — will fail until B.A. creates them
import { MissionHistoryPanel } from '@/components/MissionHistoryPanel';
import { HeaderBar } from '@/components/header-bar';

// ============ HeaderBar History Icon ============

describe('HeaderBar history icon button', () => {
  function createHeaderBarProps(overrides = {}): React.ComponentProps<typeof HeaderBar> {
    return {
      mission: {
        name: 'Test Mission',
        started_at: '2026-01-21T10:00:00Z',
        status: 'active' as const,
      },
      stats: {
        total_items: 10,
        completed: 5,
        in_progress: 2,
        blocked: 0,
      },
      wipCurrent: 2,
      wipLimit: 5,
      projects: [{ id: 'proj-1', name: 'Project 1', createdAt: new Date(), updatedAt: new Date() }],
      selectedProjectId: 'proj-1',
      onProjectChange: vi.fn(),
      projectsLoading: false,
      ...overrides,
    };
  }

  it('should render a history icon button in the header bar', () => {
    render(<HeaderBar {...createHeaderBarProps()} />);
    expect(screen.getByTestId('history-button')).toBeInTheDocument();
  });

  it('should have an accessible label on the history button', () => {
    render(<HeaderBar {...createHeaderBarProps()} />);
    const btn = screen.getByTestId('history-button');
    expect(btn).toHaveAttribute('aria-label');
  });
});

// ============ Drawer Open/Close ============

describe('MissionHistoryPanel open/close', () => {
  beforeEach(() => {
    global.fetch = createMockFetchWithMissions([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not be visible when isOpen=false', () => {
    render(
      <MissionHistoryPanel
        isOpen={false}
        onClose={vi.fn()}
        projectId="proj-1"
      />
    );
    expect(screen.queryByTestId('mission-history-panel')).not.toBeInTheDocument();
  });

  it('should be visible when isOpen=true', async () => {
    render(
      <MissionHistoryPanel
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-1"
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-panel')).toBeInTheDocument();
    });
  });

  it('should call onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(
      <MissionHistoryPanel
        isOpen={true}
        onClose={onClose}
        projectId="proj-1"
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-panel')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('history-panel-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ============ Mission List ============

describe('MissionHistoryPanel mission list', () => {
  const missions = [
    createApiMission({
      id: 'M-20260121-001',
      name: 'Oldest Mission',
      state: 'completed',
      startedAt: '2026-01-21T08:00:00Z',
      completedAt: '2026-01-21T10:00:00Z',
    }),
    createApiMission({
      id: 'M-20260123-001',
      name: 'Newest Mission',
      state: 'running',
      startedAt: '2026-01-23T08:00:00Z',
      completedAt: null,
    }),
    createApiMission({
      id: 'M-20260122-001',
      name: 'Middle Mission',
      state: 'failed',
      startedAt: '2026-01-22T08:00:00Z',
      completedAt: '2026-01-22T12:00:00Z',
    }),
  ];

  beforeEach(() => {
    global.fetch = createMockFetchWithMissions(missions);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should display all missions in the list', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByText('Oldest Mission')).toBeInTheDocument();
      expect(screen.getByText('Newest Mission')).toBeInTheDocument();
      expect(screen.getByText('Middle Mission')).toBeInTheDocument();
    });
  });

  it('should display missions sorted by startedAt descending (newest first)', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByText('Newest Mission')).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId('mission-history-row');
    expect(rows[0]).toHaveTextContent('Newest Mission');
    expect(rows[1]).toHaveTextContent('Middle Mission');
    expect(rows[2]).toHaveTextContent('Oldest Mission');
  });

  it('should fetch from /api/missions with project header', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/missions'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Project-ID': 'proj-1' }),
        })
      );
    });
  });

  it('should show empty state when no missions exist', async () => {
    global.fetch = createMockFetchWithMissions([]);
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-empty')).toBeInTheDocument();
    });
  });
});

// ============ State Badge Colors ============

describe('MissionHistoryPanel state badge colors', () => {
  const stateTestCases: Array<{ state: string; expectedClass: string }> = [
    { state: 'completed', expectedClass: 'bg-green' },
    { state: 'failed', expectedClass: 'bg-red' },
    { state: 'precheck_failure', expectedClass: 'bg-amber' },
    { state: 'archived', expectedClass: 'bg-gray' },
    { state: 'running', expectedClass: 'bg-blue' },
  ];

  stateTestCases.forEach(({ state, expectedClass }) => {
    it(`should use ${expectedClass} badge for ${state} state`, async () => {
      global.fetch = createMockFetchWithMissions([
        createApiMission({ id: `M-001`, name: `${state} mission`, state }),
      ]);

      render(
        <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
      );

      await waitFor(() => {
        const badge = screen.getByTestId(`state-badge-M-001`);
        expect(badge.className).toContain(expectedClass);
      });
    });
  });
});

// ============ Master-Detail: Row Selection ============

describe('MissionHistoryPanel detail pane', () => {
  const targetMission = createApiMission({
    id: 'M-20260121-001',
    name: 'Detailed Mission',
    state: 'completed',
    prdPath: '/prd/feature-auth.md',
    startedAt: '2026-01-21T10:00:00Z',
    completedAt: '2026-01-21T14:00:00Z',
  });

  beforeEach(() => {
    global.fetch = createMockFetchWithMissions([targetMission]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not show detail pane before a row is selected', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByText('Detailed Mission')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('mission-detail-pane')).not.toBeInTheDocument();
  });

  it('should show detail pane when a mission row is clicked', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mission-history-row'));

    expect(screen.getByTestId('mission-detail-pane')).toBeInTheDocument();
  });

  it('should show mission name in detail pane', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mission-history-row'));

    const detail = screen.getByTestId('mission-detail-pane');
    expect(detail).toHaveTextContent('Detailed Mission');
  });

  it('should show PRD path in detail pane', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mission-history-row'));

    const detail = screen.getByTestId('mission-detail-pane');
    expect(detail).toHaveTextContent('/prd/feature-auth.md');
  });

  it('should show state badge in detail pane', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mission-history-row'));

    expect(screen.getByTestId('detail-state-badge')).toBeInTheDocument();
    expect(screen.getByTestId('detail-state-badge')).toHaveTextContent('completed');
  });

  it('should show startedAt date in detail pane', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mission-history-row'));

    const detail = screen.getByTestId('mission-detail-pane');
    // Date should be visible in some human-readable form
    expect(detail.textContent).toMatch(/2026/);
  });

  it('should show duration when mission is completed', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mission-history-row'));

    expect(screen.getByTestId('detail-duration')).toBeInTheDocument();
  });
});

// ============ precheck_failure detail ============

describe('MissionHistoryPanel precheck_failure detail pane', () => {
  const precheckMission = createApiMission({
    id: 'M-20260122-001',
    name: 'Failed Precheck Mission',
    state: 'precheck_failure',
    precheckBlockers: ['lint: 3 errors', 'tests: 2 failing'],
    precheckOutput: {
      lint: { stdout: 'error output', stderr: '', timedOut: false },
    },
  });

  beforeEach(() => {
    global.fetch = createMockFetchWithMissions([precheckMission]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should display parsed precheckBlockers in detail pane', async () => {
    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mission-history-row'));

    const detail = screen.getByTestId('mission-detail-pane');
    expect(detail).toHaveTextContent('lint: 3 errors');
    expect(detail).toHaveTextContent('tests: 2 failing');
  });

  it('should handle null precheckBlockers gracefully in detail pane', async () => {
    global.fetch = createMockFetchWithMissions([
      createApiMission({
        id: 'M-20260122-002',
        name: 'Null Blockers Mission',
        state: 'precheck_failure',
        precheckBlockers: null,
        precheckOutput: null,
      }),
    ]);

    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });
    // Should not crash
    fireEvent.click(screen.getByTestId('mission-history-row'));
    expect(screen.getByTestId('mission-detail-pane')).toBeInTheDocument();
  });

  it('should show [TIMED OUT] marker in detail pane when timedOut is true and stdout/stderr are empty', async () => {
    global.fetch = createMockFetchWithMissions([
      createApiMission({
        id: 'M-20260122-003',
        name: 'Timed Out Mission',
        state: 'precheck_failure',
        precheckBlockers: ['lint timed out after 5 minutes'],
        precheckOutput: {
          lint: { stdout: '', stderr: '', timedOut: true },
        },
      }),
    ]);

    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mission-history-row'));

    const output = screen.getByTestId('detail-precheck-output');
    expect(output.textContent).toContain('[TIMED OUT]');
  });

  it('should show [TIMED OUT] marker alongside captured output in detail pane', async () => {
    global.fetch = createMockFetchWithMissions([
      createApiMission({
        id: 'M-20260122-004',
        name: 'Partial Timeout Mission',
        state: 'precheck_failure',
        precheckBlockers: ['tests timed out after 5 minutes'],
        precheckOutput: {
          tests: { stdout: 'partial test output', stderr: '', timedOut: true },
        },
      }),
    ]);

    render(
      <MissionHistoryPanel isOpen={true} onClose={vi.fn()} projectId="proj-1" />
    );
    await waitFor(() => {
      expect(screen.getByTestId('mission-history-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mission-history-row'));

    const output = screen.getByTestId('detail-precheck-output');
    expect(output.textContent).toContain('[TIMED OUT]');
    expect(output.textContent).toContain('partial test output');
  });
});
