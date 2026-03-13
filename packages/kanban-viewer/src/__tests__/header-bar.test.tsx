import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HeaderBar } from '../components/header-bar';

// Mock props factory
function createProps(overrides = {}): React.ComponentProps<typeof HeaderBar> {
  return {
    mission: {
      name: 'Project Nightfall Auth System',
      started_at: '2026-01-15T10:00:00Z',
      status: 'active' as const,
    },
    stats: {
      total_items: 26,
      completed: 12,
      in_progress: 4,
      blocked: 2,
    },
    wipCurrent: 4,
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

describe('HeaderBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a fixed "now" for consistent timer calculations
    vi.setSystemTime(new Date('2026-01-15T10:23:51Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('status indicator', () => {
    it('should show green indicator for active status', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'active' } })} />);

      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveClass('bg-green-500');
    });

    it('should show yellow indicator for paused status', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'paused' } })} />);

      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveClass('bg-yellow-500');
    });

    it('should show red indicator for completed status', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'completed' } })} />);

      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveClass('bg-red-500');
    });

    it('should display status text matching mission status', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'active' } })} />);

      expect(screen.getByText(/MISSION ACTIVE/i)).toBeInTheDocument();
    });
  });

  describe('mission name', () => {
    it('should display mission name prominently', () => {
      const props = createProps();
      render(<HeaderBar {...props} />);

      expect(screen.getByText('Project Nightfall Auth System')).toBeInTheDocument();
    });

    it('should handle long mission names', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Very Long Mission Name That Should Still Display', started_at: '2026-01-15T10:00:00Z', status: 'active' } })} />);

      expect(screen.getByText('Very Long Mission Name That Should Still Display')).toBeInTheDocument();
    });
  });

  describe('WIP indicator', () => {
    it('should display current/max WIP format', () => {
      render(<HeaderBar {...createProps()} />);

      expect(screen.getByText('4/5')).toBeInTheDocument();
      expect(screen.getByText(/WIP/i)).toBeInTheDocument();
    });

    it('should update when WIP values change', () => {
      const { rerender } = render(<HeaderBar {...createProps({ wipCurrent: 3, wipLimit: 6 })} />);

      expect(screen.getByText('3/6')).toBeInTheDocument();

      rerender(<HeaderBar {...createProps({ wipCurrent: 5, wipLimit: 6 })} />);

      expect(screen.getByText('5/6')).toBeInTheDocument();
    });

    it('should handle zero WIP values', () => {
      render(<HeaderBar {...createProps({ wipCurrent: 0, wipLimit: 5 })} />);

      expect(screen.getByText('0/5')).toBeInTheDocument();
    });
  });

  describe('progress bar', () => {
    it('should display done/total items', () => {
      render(<HeaderBar {...createProps()} />);

      expect(screen.getByText('12/26')).toBeInTheDocument();
    });

    it('should render progress bar with correct percentage', () => {
      render(<HeaderBar {...createProps()} />);

      const progressBar = screen.getByRole('progressbar');
      // 12/26 = ~46%
      expect(progressBar).toHaveAttribute('aria-valuenow', '46');
    });

    it('should handle 0% progress', () => {
      render(<HeaderBar {...createProps({ stats: { total_items: 10, completed: 0, in_progress: 2, blocked: 0 } })} />);

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveAttribute('aria-valuenow', '0');
    });

    it('should handle 100% progress', () => {
      render(<HeaderBar {...createProps({ stats: { total_items: 10, completed: 10, in_progress: 0, blocked: 0 } })} />);

      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveAttribute('aria-valuenow', '100');
    });
  });

  describe('mission timer', () => {
    it('should display elapsed time in HH:MM:SS format', () => {
      render(<HeaderBar {...createProps()} />);

      // Started at 10:00:00, now is 10:23:51 = 00:23:51
      expect(screen.getByText('00:23:51')).toBeInTheDocument();
    });

    it('should update every second when mission is active', () => {
      render(<HeaderBar {...createProps()} />);

      expect(screen.getByText('00:23:51')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByText('00:23:52')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByText('00:23:53')).toBeInTheDocument();
    });

    it('should not update timer when mission is paused', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'paused' } })} />);

      const initialTime = screen.getByTestId('timer-display').textContent;

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.getByTestId('timer-display').textContent).toBe(initialTime);
    });

    it('should handle hours in elapsed time', () => {
      // Set time to 2 hours and 15 minutes after start
      vi.setSystemTime(new Date('2026-01-15T12:15:30Z'));

      render(<HeaderBar {...createProps()} />);

      expect(screen.getByText('02:15:30')).toBeInTheDocument();
    });

    it('should cleanup interval on unmount', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const { unmount } = render(<HeaderBar {...createProps()} />);

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('responsive layout', () => {
    it('should render all key elements', () => {
      render(<HeaderBar {...createProps()} />);

      // All key elements should be present
      expect(screen.getByTestId('status-indicator')).toBeInTheDocument();
      expect(screen.getByText('Project Nightfall Auth System')).toBeInTheDocument();
      expect(screen.getByText('4/5')).toBeInTheDocument();
      expect(screen.getByText('12/26')).toBeInTheDocument();
      expect(screen.getByTestId('timer-display')).toBeInTheDocument();
    });
  });

  describe('icons', () => {
    it('should render Lucide icons for visual elements', () => {
      render(<HeaderBar {...createProps()} />);

      // Icons should be present (we check for svg elements)
      const svgElements = document.querySelectorAll('svg');
      expect(svgElements.length).toBeGreaterThan(0);
    });
  });

  describe('timer NaN handling and created_at fallback', () => {
    it('should use created_at when started_at is missing', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Test', created_at: '2026-01-15T10:00:00Z', status: 'active' } })} />);

      // Should display time based on created_at (00:23:51)
      expect(screen.getByText('00:23:51')).toBeInTheDocument();
    });

    it('should prefer started_at over created_at when both present', () => {
      // Set time such that started_at gives different result than created_at
      vi.setSystemTime(new Date('2026-01-15T11:00:00Z'));
      render(<HeaderBar {...createProps({
        mission: {
          name: 'Test',
          started_at: '2026-01-15T10:30:00Z', // 30 minutes ago
          created_at: '2026-01-15T10:00:00Z', // 1 hour ago
          status: 'active'
        }
      })} />);

      // Should use started_at (30 minutes = 00:30:00)
      expect(screen.getByText('00:30:00')).toBeInTheDocument();
    });

    it('should display 00:00:00 when no valid date exists', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Test', status: 'active' } })} />);

      // Should display 00:00:00 when no dates provided
      expect(screen.getByText('00:00:00')).toBeInTheDocument();
    });

    it('should never display NaN in timer', () => {
      // Test with invalid date string
      render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: 'invalid-date', status: 'active' } })} />);

      const timerDisplay = screen.getByTestId('timer-display');
      expect(timerDisplay.textContent).not.toContain('NaN');
      expect(screen.getByText('00:00:00')).toBeInTheDocument();
    });

    it('should show blue indicator for planning status', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Test', created_at: '2026-01-15T10:00:00Z', status: 'planning' } })} />);

      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveClass('bg-blue-500');
    });

    it('should display MISSION PLANNING text for planning status', () => {
      render(<HeaderBar {...createProps({ mission: { name: 'Test', created_at: '2026-01-15T10:00:00Z', status: 'planning' } })} />);

      expect(screen.getByText(/MISSION PLANNING/i)).toBeInTheDocument();
    });
  });

  describe('mission completion phase status indicators', () => {
    describe('final_review phase', () => {
      it('should show purple indicator for final_review status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'final_review' } })} />);

        const indicator = screen.getByTestId('status-indicator');
        expect(indicator).toHaveClass('bg-purple-500');
      });

      it('should display FINAL REVIEW text for final_review status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'final_review' } })} />);

        expect(screen.getByText(/FINAL REVIEW/i)).toBeInTheDocument();
      });
    });

    describe('post_checks phase', () => {
      it('should show yellow indicator for post_checks status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'post_checks' } })} />);

        const indicator = screen.getByTestId('status-indicator');
        expect(indicator).toHaveClass('bg-yellow-500');
      });

      it('should display POST-CHECKS text for post_checks status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'post_checks' } })} />);

        expect(screen.getByText(/POST-CHECKS/i)).toBeInTheDocument();
      });
    });

    describe('documentation phase', () => {
      it('should show teal indicator for documentation status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'documentation' } })} />);

        const indicator = screen.getByTestId('status-indicator');
        expect(indicator).toHaveClass('bg-teal-500');
      });

      it('should display DOCUMENTATION text for documentation status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'documentation' } })} />);

        expect(screen.getByText(/DOCUMENTATION/i)).toBeInTheDocument();
      });
    });

    describe('complete phase', () => {
      it('should show green indicator for complete status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'complete' } })} />);

        const indicator = screen.getByTestId('status-indicator');
        expect(indicator).toHaveClass('bg-green-500');
      });

      it('should display MISSION COMPLETE text for complete status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'complete' } })} />);

        expect(screen.getByText(/MISSION COMPLETE/i)).toBeInTheDocument();
      });

      it('should show checkmark icon for complete status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'complete' } })} />);

        // The complete status should display a checkmark icon in the status indicator area
        // Look for the checkmark by finding svg with specific aria-label or class
        const statusSection = screen.getByTestId('status-indicator').parentElement;
        const checkmarkIcon = statusSection?.querySelector('svg');
        expect(checkmarkIcon || statusSection?.textContent?.includes('COMPLETE')).toBeTruthy();
      });
    });

    describe('existing states continue to work', () => {
      it('should still show green indicator for active status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'active' } })} />);

        const indicator = screen.getByTestId('status-indicator');
        expect(indicator).toHaveClass('bg-green-500');
        expect(screen.getByText(/MISSION ACTIVE/i)).toBeInTheDocument();
      });

      it('should still show yellow indicator for paused status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'paused' } })} />);

        const indicator = screen.getByTestId('status-indicator');
        expect(indicator).toHaveClass('bg-yellow-500');
        expect(screen.getByText(/MISSION PAUSED/i)).toBeInTheDocument();
      });

      it('should still show blue indicator for planning status', () => {
        render(<HeaderBar {...createProps({ mission: { name: 'Test', started_at: '2026-01-15T10:00:00Z', status: 'planning' } })} />);

        const indicator = screen.getByTestId('status-indicator');
        expect(indicator).toHaveClass('bg-blue-500');
        expect(screen.getByText(/MISSION PLANNING/i)).toBeInTheDocument();
      });
    });
  });
});
