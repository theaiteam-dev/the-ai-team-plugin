import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
      blocked: 0,
    },
    wipCurrent: 2,
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

describe('HeaderBar - Mission Reopening', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a fixed "now" for consistent timer calculations
    vi.setSystemTime(new Date('2026-01-15T11:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('timer resumes when completed_at is cleared', () => {
    it('should resume timer when completed_at is cleared via rerender', () => {
      // Start with a completed mission (frozen at 30 minutes)
      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T10:30:00Z',
        status: 'completed' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: completedMission })} />);

      // Timer should show frozen time of 30 minutes
      expect(screen.getByTestId('timer-display')).toHaveTextContent('00:30:00');

      // Advance time - timer should NOT update while completed
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByTestId('timer-display')).toHaveTextContent('00:30:00');

      // Reopen mission by clearing completed_at and setting status to active
      const reopenedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: reopenedMission })} />);

      // Timer should now show elapsed time (1 hour + 5 seconds that we advanced)
      // Note: The 5 seconds we advanced while completed now count towards current time
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:05');

      // Timer should resume counting
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:06');
    });

    it('should recalculate elapsed time based on current time when reopened', () => {
      // Mission completed at 10:30, but now it is 11:00
      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T10:30:00Z',
        status: 'completed' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: completedMission })} />);

      // Shows frozen time
      expect(screen.getByTestId('timer-display')).toHaveTextContent('00:30:00');

      // Reopen - should calculate from started_at to NOW (11:00)
      const reopenedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: reopenedMission })} />);

      // Should show 1 hour elapsed (10:00 to 11:00)
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:00');
    });
  });

  describe('timer resumes when status changes from completed to active', () => {
    it('should resume timer when status changes from completed to active', () => {
      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T10:45:00Z',
        status: 'completed' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: completedMission })} />);

      // Timer frozen at 45 minutes
      expect(screen.getByTestId('timer-display')).toHaveTextContent('00:45:00');

      // Change status to active and clear completed_at
      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: activeMission })} />);

      // Timer should resume and tick
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:02');
    });

    it('should handle transition from paused to active', () => {
      const pausedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'paused' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: pausedMission })} />);

      // Initial time should be 1 hour (10:00 to 11:00)
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:00');

      // Timer should not have an interval running when paused (no ticking)
      // but advancing system time will still affect the calculated elapsed time
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      // Time calculation uses Date.now() which advances with fake timers
      // The display still shows 01:00:00 because there is no interval to update it
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:00');

      // Resume to active
      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: activeMission })} />);

      // After rerender, the elapsed time is recalculated (1 hour + 3 seconds)
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:03');

      // Timer should now tick
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:04');
    });
  });

  describe('timer correctly transitions from frozen to running', () => {
    it('should start interval after transitioning from completed to active', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T10:30:00Z',
        status: 'completed' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: completedMission })} />);

      // Clear spy calls from initial render
      setIntervalSpy.mockClear();

      // Reopen mission
      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: activeMission })} />);

      // setInterval should have been called for the active mission
      expect(setIntervalSpy).toHaveBeenCalled();

      setIntervalSpy.mockRestore();
    });

    it('should update timer display every second after reopening', () => {
      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T10:30:00Z',
        status: 'completed' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: completedMission })} />);

      // Reopen
      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: activeMission })} />);

      // Verify it ticks multiple times
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:00');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:01');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:02');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:03');
    });
  });

  describe('status text reverts when mission is reopened', () => {
    it('should display MISSION ACTIVE when reopened from completed', () => {
      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T10:30:00Z',
        status: 'completed' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: completedMission })} />);

      expect(screen.getByText(/MISSION COMPLETED/i)).toBeInTheDocument();

      // Reopen mission
      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: activeMission })} />);

      expect(screen.getByText(/MISSION ACTIVE/i)).toBeInTheDocument();
      expect(screen.queryByText(/MISSION COMPLETED/i)).not.toBeInTheDocument();
    });

    it('should show green indicator when reopened from completed', () => {
      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T10:30:00Z',
        status: 'completed' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: completedMission })} />);

      expect(screen.getByTestId('status-indicator')).toHaveClass('bg-red-500');

      // Reopen
      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: activeMission })} />);

      expect(screen.getByTestId('status-indicator')).toHaveClass('bg-green-500');
    });
  });

  describe('no memory leaks from interval cleanup during state transitions', () => {
    it('should call clearInterval when transitioning from active to completed', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: activeMission })} />);

      // Clear any initial calls
      clearIntervalSpy.mockClear();

      // Transition to completed
      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T11:00:00Z',
        status: 'completed' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: completedMission })} />);

      // clearInterval should have been called during cleanup
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });

    it('should properly cleanup and restart interval on multiple reopen cycles', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T10:30:00Z',
        status: 'completed' as const,
      };

      const { rerender, unmount } = render(<HeaderBar {...createProps({ mission: activeMission })} />);

      // Cycle 1: active -> completed -> active
      rerender(<HeaderBar {...createProps({ mission: completedMission })} />);
      rerender(<HeaderBar {...createProps({ mission: activeMission })} />);

      // Cycle 2: active -> completed -> active
      rerender(<HeaderBar {...createProps({ mission: completedMission })} />);
      rerender(<HeaderBar {...createProps({ mission: activeMission })} />);

      // Timer should still work after multiple cycles
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      const timerText = screen.getByTestId('timer-display').textContent;
      expect(timerText).toMatch(/01:00:0[12]/); // Should be incrementing

      // Unmount should cleanup
      unmount();

      // Verify cleanup was called
      expect(clearIntervalSpy).toHaveBeenCalled();

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('should not leak intervals when rapidly toggling status', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      const pausedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'paused' as const,
      };

      const { rerender, unmount } = render(<HeaderBar {...createProps({ mission: activeMission })} />);

      // Rapidly toggle between states
      for (let i = 0; i < 5; i++) {
        rerender(<HeaderBar {...createProps({ mission: pausedMission })} />);
        rerender(<HeaderBar {...createProps({ mission: activeMission })} />);
      }

      // Final unmount
      unmount();

      // Every interval created should have been cleaned up
      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThan(0);

      clearIntervalSpy.mockRestore();
    });
  });

  describe('duration_ms handling during reopen', () => {
    it('should ignore duration_ms when mission is reopened', () => {
      // Completed mission with explicit duration_ms
      const completedMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        completed_at: '2026-01-15T10:30:00Z',
        duration_ms: 1800000, // 30 minutes in ms
        status: 'completed' as const,
      };

      const { rerender } = render(<HeaderBar {...createProps({ mission: completedMission })} />);

      // Should display duration_ms (30 minutes)
      expect(screen.getByTestId('timer-display')).toHaveTextContent('00:30:00');

      // Reopen - duration_ms and completed_at cleared
      const activeMission = {
        name: 'Test Mission',
        started_at: '2026-01-15T10:00:00Z',
        status: 'active' as const,
      };

      rerender(<HeaderBar {...createProps({ mission: activeMission })} />);

      // Should now calculate from started_at to now (1 hour)
      expect(screen.getByTestId('timer-display')).toHaveTextContent('01:00:00');
    });
  });
});
