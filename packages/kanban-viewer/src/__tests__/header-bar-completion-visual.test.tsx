import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeaderBar } from '../components/header-bar';

// Mock props factory
function createProps(overrides = {}): React.ComponentProps<typeof HeaderBar> {
  return {
    mission: {
      name: 'Test Mission',
      started_at: '2026-01-15T10:00:00Z',
      status: 'active' as const,
    },
    stats: {
      total_items: 10,
      completed: 5,
      in_progress: 2,
      blocked: 1,
    },
    wipCurrent: 3,
    wipLimit: 5,
    projects: [
      { id: 'kanban-viewer', name: 'Kanban Viewer', createdAt: new Date(), updatedAt: new Date() }
    ],
    selectedProjectId: 'kanban-viewer',
    onProjectChange: vi.fn(),
    projectsLoading: false,
    ...overrides,
  };
}

function createCompletedMissionProps(overrides = {}): React.ComponentProps<typeof HeaderBar> {
  return createProps({
    mission: {
      name: 'Completed Mission',
      started_at: '2026-01-15T10:00:00Z',
      completed_at: '2026-01-15T12:30:00Z',
      duration_ms: 9000000, // 2.5 hours
      status: 'completed' as const,
    },
    ...overrides,
  });
}

describe('HeaderBar - Mission Completion Visual Indicators', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T13:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('status text when mission is complete', () => {
    it('should show MISSION COMPLETED text when completed_at is present', () => {
      render(<HeaderBar {...createCompletedMissionProps()} />);

      expect(screen.getByText(/MISSION COMPLETED/i)).toBeInTheDocument();
    });

    it('should show MISSION COMPLETED text when status is completed', () => {
      render(<HeaderBar {...createProps({
        mission: {
          name: 'Done Mission',
          started_at: '2026-01-15T10:00:00Z',
          status: 'completed',
        }
      })} />);

      expect(screen.getByText(/MISSION COMPLETED/i)).toBeInTheDocument();
    });

    it('should show MISSION ACTIVE text when mission is active', () => {
      render(<HeaderBar {...createProps()} />);

      expect(screen.getByText(/MISSION ACTIVE/i)).toBeInTheDocument();
    });
  });

  describe('status indicator color when mission is complete', () => {
    it('should have red background (bg-red-500) when mission is complete', () => {
      render(<HeaderBar {...createCompletedMissionProps()} />);

      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveClass('bg-red-500');
    });

    it('should have green background when mission is active', () => {
      render(<HeaderBar {...createProps()} />);

      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveClass('bg-green-500');
    });
  });

  describe('timer checkmark icon when mission is complete', () => {
    it('should display checkmark icon in timer area when mission is complete', () => {
      render(<HeaderBar {...createCompletedMissionProps()} />);

      // Look for checkmark icon by data-testid
      const checkIcon = screen.getByTestId('timer-complete-icon');
      expect(checkIcon).toBeInTheDocument();
    });

    it('should NOT display checkmark icon when mission is active', () => {
      render(<HeaderBar {...createProps()} />);

      // Checkmark should not be present for active missions
      const checkIcon = screen.queryByTestId('timer-complete-icon');
      expect(checkIcon).not.toBeInTheDocument();
    });

    it('should NOT display checkmark icon when mission is paused', () => {
      render(<HeaderBar {...createProps({
        mission: {
          name: 'Paused Mission',
          started_at: '2026-01-15T10:00:00Z',
          status: 'paused',
        }
      })} />);

      const checkIcon = screen.queryByTestId('timer-complete-icon');
      expect(checkIcon).not.toBeInTheDocument();
    });
  });

  describe('timer text styling when frozen', () => {
    it('should have muted styling (text-muted-foreground) on timer text when mission is complete', () => {
      render(<HeaderBar {...createCompletedMissionProps()} />);

      const timerDisplay = screen.getByTestId('timer-display');
      expect(timerDisplay).toHaveClass('text-muted-foreground');
    });

    it('should have normal foreground styling on timer text when mission is active', () => {
      render(<HeaderBar {...createProps()} />);

      const timerDisplay = screen.getByTestId('timer-display');
      expect(timerDisplay).toHaveClass('text-foreground');
    });
  });

  describe('visual distinction between running and frozen timer states', () => {
    it('should have clear visual difference between active and completed timer areas', () => {
      const { rerender } = render(<HeaderBar {...createProps()} />);

      // Active state - no checkmark, normal text color
      let timerDisplay = screen.getByTestId('timer-display');
      expect(timerDisplay).toHaveClass('text-foreground');
      expect(screen.queryByTestId('timer-complete-icon')).not.toBeInTheDocument();

      // Rerender with completed mission
      rerender(<HeaderBar {...createCompletedMissionProps()} />);

      // Completed state - has checkmark, muted text color
      timerDisplay = screen.getByTestId('timer-display');
      expect(timerDisplay).toHaveClass('text-muted-foreground');
      expect(screen.getByTestId('timer-complete-icon')).toBeInTheDocument();
    });
  });
});
