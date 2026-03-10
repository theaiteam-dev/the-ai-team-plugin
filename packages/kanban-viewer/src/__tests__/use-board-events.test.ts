import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBoardEvents } from "../hooks/use-board-events";
import type { WorkItem, BoardMetadata, BoardEvent } from "../types";

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState: number = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.readyState = 2;
  }

  // Helper to simulate open event
  simulateOpen() {
    this.readyState = 1;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  // Helper to simulate message event
  simulateMessage(data: BoardEvent) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }

  // Helper to simulate error event
  simulateError() {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }
}

// Replace global EventSource
const originalEventSource = global.EventSource;
beforeEach(() => {
  MockEventSource.instances = [];
  (global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;
  vi.useFakeTimers();
});

afterEach(() => {
  (global as unknown as { EventSource: typeof EventSource }).EventSource = originalEventSource;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const mockWorkItem: WorkItem = {
  id: "001",
  title: "Test Item",
  type: "feature",
  status: "ready",
  rejection_count: 0,
  dependencies: [],
  outputs: {},
  created_at: "2026-01-15T10:00:00Z",
  updated_at: "2026-01-15T10:00:00Z",
  stage: "ready",
  content: "Test content",
};

const mockBoardMetadata: BoardMetadata = {
  mission: {
    name: "Test Mission",
    started_at: "2026-01-15T10:00:00Z",
    status: "active",
  },
  wip_limits: { testing: 2, implementing: 3, review: 2 },
  phases: {},
  assignments: {},
  agents: {},
  stats: { total_items: 10, completed: 5, in_progress: 3, blocked: 1, backlog: 1 },
  last_updated: "2026-01-15T12:00:00Z",
};

describe("useBoardEvents", () => {
  describe("connection establishment", () => {
    it("should establish EventSource connection to /api/board/events", () => {
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).toBe("/api/board/events?projectId=kanban-viewer");
    });

    it("should set isConnected to true when connection opens", async () => {
      const { result } = renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      expect(result.current.isConnected).toBe(false);

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);
    });

    it("should clear connectionError when connection opens", async () => {
      const { result } = renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      // Simulate error then reconnect
      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      // Fast-forward through reconnection delay
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // New connection opens successfully
      act(() => {
        MockEventSource.instances[1].simulateOpen();
      });

      expect(result.current.connectionError).toBe(null);
    });

    it("should not establish connection when enabled is false", () => {
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', enabled: false }));

      expect(MockEventSource.instances).toHaveLength(0);
    });
  });

  describe("event handling", () => {
    it("should call onItemAdded when item-added event is received", async () => {
      const onItemAdded = vi.fn();
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onItemAdded }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const event: BoardEvent = {
        type: "item-added",
        timestamp: "2026-01-15T10:00:00Z",
        data: {
          itemId: "001",
          item: mockWorkItem,
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onItemAdded).toHaveBeenCalledWith(mockWorkItem);
    });

    it("should call onItemMoved when item-moved event is received", async () => {
      const onItemMoved = vi.fn();
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onItemMoved }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const event: BoardEvent = {
        type: "item-moved",
        timestamp: "2026-01-15T10:00:00Z",
        data: {
          itemId: "001",
          fromStage: "ready",
          toStage: "testing",
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onItemMoved).toHaveBeenCalledWith("001", "ready", "testing", undefined);
    });

    it("should call onItemUpdated when item-updated event is received", async () => {
      const onItemUpdated = vi.fn();
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onItemUpdated }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const updatedItem = { ...mockWorkItem, title: "Updated Title" };
      const event: BoardEvent = {
        type: "item-updated",
        timestamp: "2026-01-15T10:00:00Z",
        data: {
          itemId: "001",
          item: updatedItem,
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onItemUpdated).toHaveBeenCalledWith(updatedItem);
    });

    it("should call onItemDeleted when item-deleted event is received", async () => {
      const onItemDeleted = vi.fn();
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onItemDeleted }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const event: BoardEvent = {
        type: "item-deleted",
        timestamp: "2026-01-15T10:00:00Z",
        data: {
          itemId: "001",
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onItemDeleted).toHaveBeenCalledWith("001");
    });

    it("should call onBoardUpdated when board-updated event is received", async () => {
      const onBoardUpdated = vi.fn();
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onBoardUpdated }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const event: BoardEvent = {
        type: "board-updated",
        timestamp: "2026-01-15T10:00:00Z",
        data: {
          board: mockBoardMetadata,
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onBoardUpdated).toHaveBeenCalledWith(mockBoardMetadata);
    });

    it("should handle all event types correctly", async () => {
      const onItemAdded = vi.fn();
      const onItemMoved = vi.fn();
      const onItemUpdated = vi.fn();
      const onItemDeleted = vi.fn();
      const onBoardUpdated = vi.fn();

      renderHook(() =>
        useBoardEvents({
          projectId: 'kanban-viewer',
          onItemAdded,
          onItemMoved,
          onItemUpdated,
          onItemDeleted,
          onBoardUpdated,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Send each event type
      const events: BoardEvent[] = [
        { type: "item-added", timestamp: "2026-01-15T10:00:00Z", data: { item: mockWorkItem } },
        { type: "item-moved", timestamp: "2026-01-15T10:01:00Z", data: { itemId: "001", fromStage: "ready", toStage: "testing" } },
        { type: "item-updated", timestamp: "2026-01-15T10:02:00Z", data: { item: mockWorkItem } },
        { type: "item-deleted", timestamp: "2026-01-15T10:03:00Z", data: { itemId: "001" } },
        { type: "board-updated", timestamp: "2026-01-15T10:04:00Z", data: { board: mockBoardMetadata } },
      ];

      for (const event of events) {
        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });
      }

      expect(onItemAdded).toHaveBeenCalledTimes(1);
      expect(onItemMoved).toHaveBeenCalledTimes(1);
      expect(onItemUpdated).toHaveBeenCalledTimes(1);
      expect(onItemDeleted).toHaveBeenCalledTimes(1);
      expect(onBoardUpdated).toHaveBeenCalledTimes(1);
    });

    it("should not call callback when event data is missing required fields", async () => {
      const onItemMoved = vi.fn();
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onItemMoved }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Missing toStage
      const event = {
        type: "item-moved",
        timestamp: "2026-01-15T10:00:00Z",
        data: {
          itemId: "001",
          fromStage: "ready",
        },
      } as unknown as BoardEvent;

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onItemMoved).not.toHaveBeenCalled();
    });

    it("should call onMissionCompleted when mission-completed event is received", async () => {
      const onMissionCompleted = vi.fn();
      renderHook(() => useBoardEvents({ onMissionCompleted }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const missionCompletedData = {
        completed_at: "2026-01-15T15:30:00Z",
        duration_ms: 19800000, // 5.5 hours
        stats: mockBoardMetadata.stats,
      };

      const event: BoardEvent = {
        type: "mission-completed",
        timestamp: "2026-01-15T15:30:00Z",
        data: missionCompletedData,
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onMissionCompleted).toHaveBeenCalledTimes(1);
      expect(onMissionCompleted).toHaveBeenCalledWith(missionCompletedData);
    });

    it("should receive correct payload fields in onMissionCompleted callback", async () => {
      const onMissionCompleted = vi.fn();
      renderHook(() => useBoardEvents({ onMissionCompleted }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const event: BoardEvent = {
        type: "mission-completed",
        timestamp: "2026-01-15T18:00:00Z",
        data: {
          completed_at: "2026-01-15T18:00:00Z",
          duration_ms: 28800000, // 8 hours
          stats: {
            total_items: 15,
            completed: 15,
            in_progress: 0,
            blocked: 0,
            backlog: 0,
          },
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      const receivedData = onMissionCompleted.mock.calls[0][0];
      expect(receivedData).toHaveProperty("completed_at", "2026-01-15T18:00:00Z");
      expect(receivedData).toHaveProperty("duration_ms", 28800000);
      expect(receivedData).toHaveProperty("stats");
      expect(receivedData.stats.total_items).toBe(15);
      expect(receivedData.stats.completed).toBe(15);
    });

    it("should not call onMissionCompleted when callback is not provided", async () => {
      // Render without onMissionCompleted callback
      const onItemAdded = vi.fn();
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onItemAdded }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const event: BoardEvent = {
        type: "mission-completed",
        timestamp: "2026-01-15T15:30:00Z",
        data: {
          completed_at: "2026-01-15T15:30:00Z",
          duration_ms: 19800000,
          stats: mockBoardMetadata.stats,
        },
      };

      // Should not throw when receiving mission-completed without callback
      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      // Other callbacks should not be affected
      expect(onItemAdded).not.toHaveBeenCalled();
    });
  });

  describe("auto-reconnection", () => {
    it("should set isConnected to false when connection drops", async () => {
      const { result } = renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);

      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      expect(result.current.isConnected).toBe(false);
    });

    it("should attempt to reconnect when connection drops", async () => {
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      expect(MockEventSource.instances).toHaveLength(1);

      // Fast-forward past reconnection delay
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(MockEventSource.instances).toHaveLength(2);
    });

    it("should use exponential backoff for reconnection", async () => {
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      // First connection error
      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      // First reconnect after 1s
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(MockEventSource.instances).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(MockEventSource.instances).toHaveLength(2);

      // Second connection error
      act(() => {
        MockEventSource.instances[1].simulateError();
      });

      // Second reconnect after 2s (exponential backoff)
      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(MockEventSource.instances).toHaveLength(2);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(MockEventSource.instances).toHaveLength(3);

      // Third connection error
      act(() => {
        MockEventSource.instances[2].simulateError();
      });

      // Third reconnect after 4s
      act(() => {
        vi.advanceTimersByTime(3999);
      });
      expect(MockEventSource.instances).toHaveLength(3);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(MockEventSource.instances).toHaveLength(4);
    });

    it("should reset reconnect attempts after successful connection", async () => {
      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      // First error, wait for first reconnect
      act(() => {
        MockEventSource.instances[0].simulateError();
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Second error, wait for second reconnect (2s delay)
      act(() => {
        MockEventSource.instances[1].simulateError();
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Successfully connect
      act(() => {
        MockEventSource.instances[2].simulateOpen();
      });

      // Error again - should start fresh with 1s delay
      act(() => {
        MockEventSource.instances[2].simulateError();
      });

      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(MockEventSource.instances).toHaveLength(3);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(MockEventSource.instances).toHaveLength(4);
    });

    it("should set connectionError after max retries", async () => {
      const { result } = renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      // We need 11 errors total to trigger connectionError:
      // - Errors 1-10 will schedule reconnects (ref goes from 0 to 10)
      // - Error 11: ref=10, check 10<10 is false, so connectionError is set
      // Delays for attempts 0-9: 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000
      const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000];

      // First instance is created immediately on mount
      expect(MockEventSource.instances).toHaveLength(1);

      // Simulate 11 failed connection attempts (need 11 to exhaust retries)
      for (let i = 0; i < 11; i++) {
        // Error on current instance
        act(() => {
          const currentInstance = MockEventSource.instances[MockEventSource.instances.length - 1];
          currentInstance.simulateError();
        });

        if (i < 10) {
          // Advance past the delay for next attempt
          act(() => {
            vi.advanceTimersByTime(delays[i]);
          });
        }
      }

      // After 11 failed attempts, we should have an error
      expect(MockEventSource.instances).toHaveLength(11);
      expect(result.current.connectionError).not.toBe(null);
      expect(result.current.connectionError?.message).toContain("maximum retries");
    });
  });

  describe("connection status", () => {
    it("should provide isConnected status", async () => {
      const { result } = renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      expect(result.current.isConnected).toBe(false);

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);
    });

    it("should provide connectionError when connection fails", async () => {
      const { result } = renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      // Delays for attempts 0-9: 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000
      const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000];

      // Exhaust all reconnection attempts (need 11 errors to hit max)
      for (let i = 0; i < 11; i++) {
        act(() => {
          const currentInstance = MockEventSource.instances[MockEventSource.instances.length - 1];
          currentInstance.simulateError();
        });

        if (i < 10) {
          act(() => {
            vi.advanceTimersByTime(delays[i]);
          });
        }
      }

      expect(result.current.connectionError).toBeInstanceOf(Error);
    });
  });

  describe("cleanup on unmount", () => {
    it("should close EventSource on unmount", async () => {
      const { unmount } = renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const eventSource = MockEventSource.instances[0];
      const closeSpy = vi.spyOn(eventSource, "close");

      unmount();

      expect(closeSpy).toHaveBeenCalled();
    });

    it("should clear reconnection timeout on unmount", async () => {
      const { unmount } = renderHook(() => useBoardEvents({ projectId: 'kanban-viewer' }));

      // Simulate error to start reconnection timer
      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      unmount();

      // Advance timers - should not create new connection after unmount
      const instanceCount = MockEventSource.instances.length;
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(MockEventSource.instances.length).toBe(instanceCount);
    });
  });

  describe("callback updates", () => {
    it("should use updated callbacks without reconnecting", async () => {
      const onItemAdded1 = vi.fn();
      const onItemAdded2 = vi.fn();

      const { rerender } = renderHook(
        ({ onItemAdded }) => useBoardEvents({ projectId: 'kanban-viewer', onItemAdded }),
        { initialProps: { onItemAdded: onItemAdded1 } }
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Update callback
      rerender({ onItemAdded: onItemAdded2 });

      // Should still only have one connection
      expect(MockEventSource.instances).toHaveLength(1);

      // Fire event
      const event: BoardEvent = {
        type: "item-added",
        timestamp: "2026-01-15T10:00:00Z",
        data: { item: mockWorkItem },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      // New callback should be called
      expect(onItemAdded1).not.toHaveBeenCalled();
      expect(onItemAdded2).toHaveBeenCalledWith(mockWorkItem);
    });
  });

  describe("enabled toggle", () => {
    it("should disconnect when enabled changes to false", async () => {
      const { result, rerender } = renderHook(
        ({ enabled }) => useBoardEvents({ projectId: 'kanban-viewer', enabled }),
        { initialProps: { enabled: true } }
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);

      const closeSpy = vi.spyOn(MockEventSource.instances[0], "close");

      rerender({ enabled: false });

      expect(closeSpy).toHaveBeenCalled();
      expect(result.current.isConnected).toBe(false);
    });

    it("should reconnect when enabled changes to true", async () => {
      const { rerender } = renderHook(
        ({ enabled }) => useBoardEvents({ projectId: 'kanban-viewer', enabled }),
        { initialProps: { enabled: false } }
      );

      expect(MockEventSource.instances).toHaveLength(0);

      rerender({ enabled: true });

      expect(MockEventSource.instances).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    it("should handle malformed JSON gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onItemAdded = vi.fn();

      renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onItemAdded }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Send malformed message
      act(() => {
        if (MockEventSource.instances[0].onmessage) {
          MockEventSource.instances[0].onmessage(
            new MessageEvent("message", { data: "not valid json" })
          );
        }
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to parse SSE event:",
        expect.any(Error)
      );
      expect(onItemAdded).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("mission completion flow events", () => {
    describe("final review events", () => {
      it("should call onFinalReviewStarted when final-review-started event is received", async () => {
        const onFinalReviewStarted = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onFinalReviewStarted }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const finalReviewData = {
          started_at: "2026-01-15T14:00:00Z",
          agent: "Lynch" as const,
          rejections: 0,
          passed: false,
        };

        const event: BoardEvent = {
          type: "final-review-started",
          timestamp: "2026-01-15T14:00:00Z",
          data: finalReviewData,
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        expect(onFinalReviewStarted).toHaveBeenCalledTimes(1);
        expect(onFinalReviewStarted).toHaveBeenCalledWith(finalReviewData);
      });

      it("should call onFinalReviewComplete when final-review-complete event is received", async () => {
        const onFinalReviewComplete = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onFinalReviewComplete }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const finalReviewData = {
          started_at: "2026-01-15T14:00:00Z",
          completed_at: "2026-01-15T14:30:00Z",
          agent: "Lynch" as const,
          passed: true,
          verdict: "All items meet acceptance criteria",
          rejections: 0,
        };

        const event: BoardEvent = {
          type: "final-review-complete",
          timestamp: "2026-01-15T14:30:00Z",
          data: finalReviewData,
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        expect(onFinalReviewComplete).toHaveBeenCalledTimes(1);
        expect(onFinalReviewComplete).toHaveBeenCalledWith(finalReviewData);
      });

      it("should receive correct payload fields in onFinalReviewComplete callback", async () => {
        const onFinalReviewComplete = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onFinalReviewComplete }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const event: BoardEvent = {
          type: "final-review-complete",
          timestamp: "2026-01-15T14:30:00Z",
          data: {
            started_at: "2026-01-15T14:00:00Z",
            completed_at: "2026-01-15T14:30:00Z",
            agent: "Lynch" as const,
            passed: true,
            verdict: "Approved",
            rejections: 2,
          },
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        const receivedData = onFinalReviewComplete.mock.calls[0][0];
        expect(receivedData).toHaveProperty("started_at", "2026-01-15T14:00:00Z");
        expect(receivedData).toHaveProperty("completed_at", "2026-01-15T14:30:00Z");
        expect(receivedData).toHaveProperty("agent", "Lynch");
        expect(receivedData).toHaveProperty("passed", true);
        expect(receivedData).toHaveProperty("verdict", "Approved");
        expect(receivedData).toHaveProperty("rejections", 2);
      });
    });

    describe("post-checks events", () => {
      it("should call onPostChecksStarted when post-checks-started event is received", async () => {
        const onPostChecksStarted = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onPostChecksStarted }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const postChecksData = {
          started_at: "2026-01-15T15:00:00Z",
          passed: false,
          results: {
            lint: { status: "pending" as const },
            typecheck: { status: "pending" as const },
            test: { status: "pending" as const },
            build: { status: "pending" as const },
          },
        };

        const event: BoardEvent = {
          type: "post-checks-started",
          timestamp: "2026-01-15T15:00:00Z",
          data: postChecksData,
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        expect(onPostChecksStarted).toHaveBeenCalledTimes(1);
        expect(onPostChecksStarted).toHaveBeenCalledWith(postChecksData);
      });

      it("should call onPostCheckUpdate when post-check-update event is received", async () => {
        const onPostCheckUpdate = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onPostCheckUpdate }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const checkUpdateData = {
          check: "lint" as const,
          status: "passed" as const,
          completed_at: "2026-01-15T15:05:00Z",
        };

        const event: BoardEvent = {
          type: "post-check-update",
          timestamp: "2026-01-15T15:05:00Z",
          data: checkUpdateData,
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        expect(onPostCheckUpdate).toHaveBeenCalledTimes(1);
        expect(onPostCheckUpdate).toHaveBeenCalledWith(checkUpdateData);
      });

      it("should handle all check types in post-check-update", async () => {
        const onPostCheckUpdate = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onPostCheckUpdate }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const checkTypes = ["lint", "typecheck", "test", "build"] as const;

        for (const check of checkTypes) {
          const event: BoardEvent = {
            type: "post-check-update",
            timestamp: "2026-01-15T15:05:00Z",
            data: {
              check,
              status: "passed" as const,
              completed_at: "2026-01-15T15:05:00Z",
            },
          };

          act(() => {
            MockEventSource.instances[0].simulateMessage(event);
          });
        }

        expect(onPostCheckUpdate).toHaveBeenCalledTimes(4);
        expect(onPostCheckUpdate.mock.calls[0][0].check).toBe("lint");
        expect(onPostCheckUpdate.mock.calls[1][0].check).toBe("typecheck");
        expect(onPostCheckUpdate.mock.calls[2][0].check).toBe("test");
        expect(onPostCheckUpdate.mock.calls[3][0].check).toBe("build");
      });

      it("should call onPostChecksComplete when post-checks-complete event is received", async () => {
        const onPostChecksComplete = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onPostChecksComplete }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const postChecksData = {
          started_at: "2026-01-15T15:00:00Z",
          completed_at: "2026-01-15T15:20:00Z",
          passed: true,
          results: {
            lint: { status: "passed" as const, completed_at: "2026-01-15T15:05:00Z" },
            typecheck: { status: "passed" as const, completed_at: "2026-01-15T15:10:00Z" },
            test: { status: "passed" as const, completed_at: "2026-01-15T15:15:00Z" },
            build: { status: "passed" as const, completed_at: "2026-01-15T15:20:00Z" },
          },
        };

        const event: BoardEvent = {
          type: "post-checks-complete",
          timestamp: "2026-01-15T15:20:00Z",
          data: postChecksData,
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        expect(onPostChecksComplete).toHaveBeenCalledTimes(1);
        expect(onPostChecksComplete).toHaveBeenCalledWith(postChecksData);
      });

      it("should receive correct payload when post-checks fail", async () => {
        const onPostChecksComplete = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onPostChecksComplete }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const postChecksData = {
          started_at: "2026-01-15T15:00:00Z",
          completed_at: "2026-01-15T15:15:00Z",
          passed: false,
          results: {
            lint: { status: "passed" as const, completed_at: "2026-01-15T15:05:00Z" },
            typecheck: { status: "passed" as const, completed_at: "2026-01-15T15:10:00Z" },
            test: { status: "failed" as const, completed_at: "2026-01-15T15:15:00Z" },
            build: { status: "pending" as const },
          },
        };

        const event: BoardEvent = {
          type: "post-checks-complete",
          timestamp: "2026-01-15T15:15:00Z",
          data: postChecksData,
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        const receivedData = onPostChecksComplete.mock.calls[0][0];
        expect(receivedData.passed).toBe(false);
        expect(receivedData.results.test.status).toBe("failed");
      });
    });

    describe("documentation events", () => {
      it("should call onDocumentationStarted when documentation-started event is received", async () => {
        const onDocumentationStarted = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onDocumentationStarted }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const documentationData = {
          started_at: "2026-01-15T16:00:00Z",
          agent: "Face" as const,
          completed: false,
          files_modified: [],
        };

        const event: BoardEvent = {
          type: "documentation-started",
          timestamp: "2026-01-15T16:00:00Z",
          data: documentationData,
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        expect(onDocumentationStarted).toHaveBeenCalledTimes(1);
        expect(onDocumentationStarted).toHaveBeenCalledWith(documentationData);
      });

      it("should call onDocumentationComplete when documentation-complete event is received", async () => {
        const onDocumentationComplete = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onDocumentationComplete }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const documentationData = {
          started_at: "2026-01-15T16:00:00Z",
          completed_at: "2026-01-15T16:30:00Z",
          agent: "Face" as const,
          completed: true,
          files_modified: ["README.md", "CHANGELOG.md"],
          commit: "abc123",
          summary: "Updated documentation for v1.0 release",
        };

        const event: BoardEvent = {
          type: "documentation-complete",
          timestamp: "2026-01-15T16:30:00Z",
          data: documentationData,
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        expect(onDocumentationComplete).toHaveBeenCalledTimes(1);
        expect(onDocumentationComplete).toHaveBeenCalledWith(documentationData);
      });

      it("should receive correct payload fields in onDocumentationComplete callback", async () => {
        const onDocumentationComplete = vi.fn();
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onDocumentationComplete }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        const event: BoardEvent = {
          type: "documentation-complete",
          timestamp: "2026-01-15T16:30:00Z",
          data: {
            started_at: "2026-01-15T16:00:00Z",
            completed_at: "2026-01-15T16:30:00Z",
            agent: "Face" as const,
            completed: true,
            files_modified: ["docs/API.md", "README.md", "CHANGELOG.md"],
            commit: "def456",
            summary: "Added API documentation",
          },
        };

        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });

        const receivedData = onDocumentationComplete.mock.calls[0][0];
        expect(receivedData).toHaveProperty("started_at");
        expect(receivedData).toHaveProperty("completed_at");
        expect(receivedData).toHaveProperty("agent", "Face");
        expect(receivedData).toHaveProperty("completed", true);
        expect(receivedData.files_modified).toHaveLength(3);
        expect(receivedData).toHaveProperty("commit", "def456");
        expect(receivedData).toHaveProperty("summary", "Added API documentation");
      });
    });

    describe("mission completion flow integration", () => {
      it("should handle complete mission flow sequence", async () => {
        const onFinalReviewStarted = vi.fn();
        const onFinalReviewComplete = vi.fn();
        const onPostChecksStarted = vi.fn();
        const onPostCheckUpdate = vi.fn();
        const onPostChecksComplete = vi.fn();
        const onDocumentationStarted = vi.fn();
        const onDocumentationComplete = vi.fn();
        const onMissionCompleted = vi.fn();

        renderHook(() =>
          useBoardEvents({
            projectId: 'kanban-viewer',
            onFinalReviewStarted,
            onFinalReviewComplete,
            onPostChecksStarted,
            onPostCheckUpdate,
            onPostChecksComplete,
            onDocumentationStarted,
            onDocumentationComplete,
            onMissionCompleted,
          })
        );

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        // Simulate full mission completion flow
        const events: BoardEvent[] = [
          {
            type: "final-review-started",
            timestamp: "2026-01-15T14:00:00Z",
            data: { started_at: "2026-01-15T14:00:00Z", agent: "Lynch" as const, rejections: 0, passed: false },
          },
          {
            type: "final-review-complete",
            timestamp: "2026-01-15T14:30:00Z",
            data: { started_at: "2026-01-15T14:00:00Z", completed_at: "2026-01-15T14:30:00Z", agent: "Lynch" as const, passed: true, verdict: "Approved", rejections: 0 },
          },
          {
            type: "post-checks-started",
            timestamp: "2026-01-15T15:00:00Z",
            data: { started_at: "2026-01-15T15:00:00Z", passed: false, results: { lint: { status: "pending" as const }, typecheck: { status: "pending" as const }, test: { status: "pending" as const }, build: { status: "pending" as const } } },
          },
          {
            type: "post-check-update",
            timestamp: "2026-01-15T15:05:00Z",
            data: { check: "lint" as const, status: "passed" as const, completed_at: "2026-01-15T15:05:00Z" },
          },
          {
            type: "post-checks-complete",
            timestamp: "2026-01-15T15:20:00Z",
            data: { started_at: "2026-01-15T15:00:00Z", completed_at: "2026-01-15T15:20:00Z", passed: true, results: { lint: { status: "passed" as const }, typecheck: { status: "passed" as const }, test: { status: "passed" as const }, build: { status: "passed" as const } } },
          },
          {
            type: "documentation-started",
            timestamp: "2026-01-15T16:00:00Z",
            data: { started_at: "2026-01-15T16:00:00Z", agent: "Face" as const, completed: false, files_modified: [] },
          },
          {
            type: "documentation-complete",
            timestamp: "2026-01-15T16:30:00Z",
            data: { started_at: "2026-01-15T16:00:00Z", completed_at: "2026-01-15T16:30:00Z", agent: "Face" as const, completed: true, files_modified: ["README.md"], commit: "abc123" },
          },
          {
            type: "mission-completed",
            timestamp: "2026-01-15T17:00:00Z",
            data: { completed_at: "2026-01-15T17:00:00Z", duration_ms: 25200000, stats: mockBoardMetadata.stats },
          },
        ];

        for (const event of events) {
          act(() => {
            MockEventSource.instances[0].simulateMessage(event);
          });
        }

        expect(onFinalReviewStarted).toHaveBeenCalledTimes(1);
        expect(onFinalReviewComplete).toHaveBeenCalledTimes(1);
        expect(onPostChecksStarted).toHaveBeenCalledTimes(1);
        expect(onPostCheckUpdate).toHaveBeenCalledTimes(1);
        expect(onPostChecksComplete).toHaveBeenCalledTimes(1);
        expect(onDocumentationStarted).toHaveBeenCalledTimes(1);
        expect(onDocumentationComplete).toHaveBeenCalledTimes(1);
        expect(onMissionCompleted).toHaveBeenCalledTimes(1);
      });

      it("should not call mission completion callbacks when callbacks are not provided", async () => {
        const onItemAdded = vi.fn();

        // Render with only onItemAdded, no completion flow callbacks
        renderHook(() => useBoardEvents({ projectId: 'kanban-viewer', onItemAdded }));

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        // Send mission completion events - should not throw
        const completionEvents: BoardEvent[] = [
          { type: "final-review-started", timestamp: "2026-01-15T14:00:00Z", data: { started_at: "2026-01-15T14:00:00Z", agent: "Lynch" as const, rejections: 0, passed: false } },
          { type: "final-review-complete", timestamp: "2026-01-15T14:30:00Z", data: { started_at: "2026-01-15T14:00:00Z", completed_at: "2026-01-15T14:30:00Z", agent: "Lynch" as const, passed: true, rejections: 0 } },
          { type: "post-checks-started", timestamp: "2026-01-15T15:00:00Z", data: { started_at: "2026-01-15T15:00:00Z", passed: false, results: { lint: { status: "pending" as const }, typecheck: { status: "pending" as const }, test: { status: "pending" as const }, build: { status: "pending" as const } } } },
          { type: "post-check-update", timestamp: "2026-01-15T15:05:00Z", data: { check: "lint" as const, status: "passed" as const } },
          { type: "post-checks-complete", timestamp: "2026-01-15T15:20:00Z", data: { started_at: "2026-01-15T15:00:00Z", completed_at: "2026-01-15T15:20:00Z", passed: true, results: { lint: { status: "passed" as const }, typecheck: { status: "passed" as const }, test: { status: "passed" as const }, build: { status: "passed" as const } } } },
          { type: "documentation-started", timestamp: "2026-01-15T16:00:00Z", data: { started_at: "2026-01-15T16:00:00Z", agent: "Face" as const, completed: false, files_modified: [] } },
          { type: "documentation-complete", timestamp: "2026-01-15T16:30:00Z", data: { started_at: "2026-01-15T16:00:00Z", completed_at: "2026-01-15T16:30:00Z", agent: "Face" as const, completed: true, files_modified: [] } },
        ];

        for (const event of completionEvents) {
          act(() => {
            MockEventSource.instances[0].simulateMessage(event);
          });
        }

        // onItemAdded should not have been called
        expect(onItemAdded).not.toHaveBeenCalled();
      });

      it("should continue receiving existing events alongside new mission completion events", async () => {
        const onItemAdded = vi.fn();
        const onItemMoved = vi.fn();
        const onFinalReviewStarted = vi.fn();
        const onMissionCompleted = vi.fn();

        renderHook(() =>
          useBoardEvents({
            projectId: 'kanban-viewer',
            onItemAdded,
            onItemMoved,
            onFinalReviewStarted,
            onMissionCompleted,
          })
        );

        act(() => {
          MockEventSource.instances[0].simulateOpen();
        });

        // Mix existing events with new completion events
        const events: BoardEvent[] = [
          { type: "item-added", timestamp: "2026-01-15T10:00:00Z", data: { item: mockWorkItem } },
          { type: "final-review-started", timestamp: "2026-01-15T14:00:00Z", data: { started_at: "2026-01-15T14:00:00Z", agent: "Lynch" as const, rejections: 0, passed: false } },
          { type: "item-moved", timestamp: "2026-01-15T14:15:00Z", data: { itemId: "001", fromStage: "review", toStage: "done" } },
          { type: "mission-completed", timestamp: "2026-01-15T17:00:00Z", data: { completed_at: "2026-01-15T17:00:00Z" } },
        ];

        for (const event of events) {
          act(() => {
            MockEventSource.instances[0].simulateMessage(event);
          });
        }

        expect(onItemAdded).toHaveBeenCalledTimes(1);
        expect(onItemMoved).toHaveBeenCalledTimes(1);
        expect(onFinalReviewStarted).toHaveBeenCalledTimes(1);
        expect(onMissionCompleted).toHaveBeenCalledTimes(1);
      });
    });
  });
});
