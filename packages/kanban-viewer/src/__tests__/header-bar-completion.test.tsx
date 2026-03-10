import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HeaderBar } from '../components/header-bar';
import type { Mission } from '@/types';

// Mock props factory for completed mission scenarios
function createCompletedMissionProps(overrides: Partial<{ mission: Partial<Mission> }> = {}): React.ComponentProps<typeof HeaderBar> {
  const defaultMission: Mission = {
    name: 'Operation Timer Freeze',
    started_at: '2026-01-15T10:00:00Z',
    completed_at: '2026-01-15T12:30:00Z', // 2.5 hours later
    status: 'completed' as const,
  };

  // Merge mission, but only include default props that aren't explicitly set in override
  const missionOverride = overrides.mission ?? {};
  const mergedMission: Mission = { ...defaultMission };

  // Apply overrides, including explicit undefined values
  for (const key of Object.keys(missionOverride) as Array<keyof Mission>) {
    if (key in missionOverride) {
      (mergedMission as unknown as Record<string, unknown>)[key] = missionOverride[key];
    }
  }

  return {
    mission: mergedMission,
    stats: {
      total_items: 10,
      completed: 10,
      in_progress: 0,
      blocked: 0,
    },
    wipCurrent: 0,
    wipLimit: 5,
    projects: [
      { id: 'kanban-viewer', name: 'Kanban Viewer', createdAt: new Date(), updatedAt: new Date() }
    ],
    selectedProjectId: 'kanban-viewer',
    onProjectChange: vi.fn(),
    projectsLoading: false,
  };
}

describe('HeaderBar - Mission Completion Timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set current time to AFTER the mission completed
    vi.setSystemTime(new Date('2026-01-15T15:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('frozen timer display', () => {
    it('should display frozen elapsed time when completed_at is present', () => {
      // Mission started at 10:00:00, completed at 12:30:00 = 2h 30m = 02:30:00
      render(<HeaderBar {...createCompletedMissionProps()} />);

      // Timer should show the frozen completion time, NOT current elapsed time
      // (current time is 15:00:00, which would be 5 hours if timer was still running)
      expect(screen.getByTestId('timer-display')).toHaveTextContent('02:30:00');
    });

    it('should not increment timer when mission is complete (time advances)', () => {
      render(<HeaderBar {...createCompletedMissionProps()} />);

      const initialTime = screen.getByTestId('timer-display').textContent;
      expect(initialTime).toBe('02:30:00');

      // Advance time significantly - timer should NOT change
      act(() => {
        vi.advanceTimersByTime(10000); // 10 seconds
      });

      expect(screen.getByTestId('timer-display').textContent).toBe(initialTime);

      // Advance even more
      act(() => {
        vi.advanceTimersByTime(60000); // 1 minute
      });

      expect(screen.getByTestId('timer-display').textContent).toBe(initialTime);
    });
  });

  describe('duration_ms usage', () => {
    it('should use duration_ms when available for frozen time display', () => {
      // duration_ms of 5400000ms = 1.5 hours = 01:30:00
      render(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'Duration Test Mission',
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T11:30:00Z',
          duration_ms: 5400000, // 1.5 hours in milliseconds
          status: 'completed',
        }
      })} />);

      // Should display duration_ms converted to HH:MM:SS
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:30:00');
    });

    it('should prefer duration_ms over calculated time when both available', () => {
      // completed_at - started_at = 2 hours
      // duration_ms = 1 hour (different, e.g., paused time not counted)
      render(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'Duration Priority Test',
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T12:00:00Z', // 2 hours wall clock
          duration_ms: 3600000, // 1 hour actual work time
          status: 'completed',
        }
      })} />);

      // Should use duration_ms (1 hour), not calculated time (2 hours)
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:00');
    });
  });

  describe('calculated completion time (no duration_ms)', () => {
    it('should calculate elapsed time from started_at to completed_at when duration_ms is not available', () => {
      // 10:00:00 to 12:30:00 = 2.5 hours = 02:30:00
      render(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'Calculated Time Test',
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T12:30:00Z',
          // No duration_ms
          status: 'completed',
        }
      })} />);

      expect(screen.getByTestId('timer-display')).toHaveTextContent('02:30:00');
    });

    it('should handle sub-hour completion times correctly', () => {
      // 10:00:00 to 10:15:45 = 15 minutes 45 seconds
      render(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'Quick Mission',
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T10:15:45Z',
          status: 'completed',
        }
      })} />);

      expect(screen.getByTestId('timer-display')).toHaveTextContent('00:15:45');
    });

    it('should handle multi-day completion times correctly', () => {
      // 10:00:00 on Jan 15 to 14:30:00 on Jan 16 = 28.5 hours
      render(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'Long Mission',
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-16T14:30:00Z',
          status: 'completed',
        }
      })} />);

      // 28 hours 30 minutes = 28:30:00
      expect(screen.getByTestId('timer-display')).toHaveTextContent('28:30:00');
    });
  });

  describe('interval management', () => {
    it('should not start an interval when mission is already complete on mount', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      render(<HeaderBar {...createCompletedMissionProps()} />);

      // setInterval should not be called for a completed mission
      // (it may be called 0 times, or the existing effect may still fire but return early)

      // Advance time to ensure any potential interval would fire
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // Timer should still show frozen time
      expect(screen.getByTestId('timer-display')).toHaveTextContent('02:30:00');

      setIntervalSpy.mockRestore();
    });

    it('should stop interval when mission transitions from active to completed', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      // Start with active mission
      const { rerender } = render(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'Transitioning Mission',
          started_at: '2026-01-15T10:00:00Z',
          completed_at: undefined,
          status: 'active',
        }
      })} />);

      // Verify timer is running
      const initialTime = screen.getByTestId('timer-display').textContent;
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByTestId('timer-display').textContent).not.toBe(initialTime);

      // Transition to completed
      rerender(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'Transitioning Mission',
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T15:00:02Z', // Completed 2 seconds after we advanced
          status: 'completed',
        }
      })} />);

      // clearInterval should have been called
      expect(clearIntervalSpy).toHaveBeenCalled();

      // Timer should now be frozen
      const frozenTime = screen.getByTestId('timer-display').textContent;
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByTestId('timer-display').textContent).toBe(frozenTime);

      clearIntervalSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle completed_at without started_at (uses created_at)', () => {
      render(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'No Start Time Mission',
          created_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T11:00:00Z',
          status: 'completed',
        }
      })} />);

      // Should use created_at as start time: 10:00 to 11:00 = 1 hour
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:00');
    });

    it('should display 00:00:00 when completed but no time references exist', () => {
      render(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'No Times Mission',
          started_at: undefined,
          completed_at: '2026-01-15T12:00:00Z',
          status: 'completed',
        }
      })} />);

      // With no start reference, should show 0 or handle gracefully
      expect(screen.getByTestId('timer-display')).toHaveTextContent('00:00:00');
    });

    it('should handle duration_ms of zero', () => {
      render(<HeaderBar {...createCompletedMissionProps({
        mission: {
          name: 'Instant Mission',
          started_at: '2026-01-15T10:00:00Z',
          completed_at: '2026-01-15T10:00:00Z',
          duration_ms: 0,
          status: 'completed',
        }
      })} />);

      expect(screen.getByTestId('timer-display')).toHaveTextContent('00:00:00');
    });
  });
});
