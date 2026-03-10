import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBoardEvents } from "../hooks/use-board-events";
import type { BoardEvent, LogEntry } from "../types";

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

const mockLogEntry: LogEntry = {
  timestamp: "2026-01-15T10:42:15Z",
  agent: "B.A.",
  message: "Implementing JWT token refresh logic",
};

const mockApprovedLogEntry: LogEntry = {
  timestamp: "2026-01-15T11:00:00Z",
  agent: "Lynch",
  message: "APPROVED item 001",
  highlightType: "approved",
};

const mockRejectedLogEntry: LogEntry = {
  timestamp: "2026-01-15T11:15:00Z",
  agent: "Murdock",
  message: "REJECTED item 002 - tests failing",
  highlightType: "rejected",
};

describe("useBoardEvents - onActivityEntry callback", () => {
  describe("event handling", () => {
    it("should call onActivityEntry when activity-entry-added event is received", () => {
      const onActivityEntry = vi.fn();
      renderHook(() => useBoardEvents({ onActivityEntry }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const event: BoardEvent = {
        type: "activity-entry-added",
        timestamp: "2026-01-15T10:42:15Z",
        data: {
          logEntry: mockLogEntry,
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onActivityEntry).toHaveBeenCalledWith(mockLogEntry);
      expect(onActivityEntry).toHaveBeenCalledTimes(1);
    });

    it("should receive LogEntry with correct structure and fields", () => {
      const onActivityEntry = vi.fn();
      renderHook(() => useBoardEvents({ onActivityEntry }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const event: BoardEvent = {
        type: "activity-entry-added",
        timestamp: "2026-01-15T10:42:15Z",
        data: {
          logEntry: mockLogEntry,
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onActivityEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: "2026-01-15T10:42:15Z",
          agent: "B.A.",
          message: "Implementing JWT token refresh logic",
        })
      );
    });

    it("should handle LogEntry with highlightType field", () => {
      const onActivityEntry = vi.fn();
      renderHook(() => useBoardEvents({ onActivityEntry }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      const approvedEvent: BoardEvent = {
        type: "activity-entry-added",
        timestamp: "2026-01-15T11:00:00Z",
        data: {
          logEntry: mockApprovedLogEntry,
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(approvedEvent);
      });

      expect(onActivityEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          highlightType: "approved",
        })
      );

      const rejectedEvent: BoardEvent = {
        type: "activity-entry-added",
        timestamp: "2026-01-15T11:15:00Z",
        data: {
          logEntry: mockRejectedLogEntry,
        },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(rejectedEvent);
      });

      expect(onActivityEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          highlightType: "rejected",
        })
      );
    });

    it("should not call onActivityEntry for other event types", () => {
      const onActivityEntry = vi.fn();
      renderHook(() => useBoardEvents({ onActivityEntry }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Test all other event types
      const otherEvents: BoardEvent[] = [
        {
          type: "item-added",
          timestamp: "2026-01-15T10:00:00Z",
          data: { itemId: "001" },
        } as unknown as BoardEvent,
        {
          type: "item-moved",
          timestamp: "2026-01-15T10:01:00Z",
          data: { itemId: "001", fromStage: "ready", toStage: "testing" },
        } as unknown as BoardEvent,
        {
          type: "item-updated",
          timestamp: "2026-01-15T10:02:00Z",
          data: { itemId: "001" },
        } as unknown as BoardEvent,
        {
          type: "item-deleted",
          timestamp: "2026-01-15T10:03:00Z",
          data: { itemId: "001" },
        },
        {
          type: "board-updated",
          timestamp: "2026-01-15T10:04:00Z",
          data: {},
        },
      ];

      for (const event of otherEvents) {
        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });
      }

      expect(onActivityEntry).not.toHaveBeenCalled();
    });

    it("should not call onActivityEntry when logEntry data is missing", () => {
      const onActivityEntry = vi.fn();
      renderHook(() => useBoardEvents({ onActivityEntry }));

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Event with no logEntry in data
      const event = {
        type: "activity-entry-added",
        timestamp: "2026-01-15T10:42:15Z",
        data: {},
      } as unknown as BoardEvent;

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      expect(onActivityEntry).not.toHaveBeenCalled();
    });
  });

  describe("callback ref updates", () => {
    it("should use updated callback without reconnecting", () => {
      const onActivityEntry1 = vi.fn();
      const onActivityEntry2 = vi.fn();

      const { rerender } = renderHook(
        ({ onActivityEntry }) => useBoardEvents({ onActivityEntry }),
        { initialProps: { onActivityEntry: onActivityEntry1 } }
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Update callback
      rerender({ onActivityEntry: onActivityEntry2 });

      // Should still only have one connection
      expect(MockEventSource.instances).toHaveLength(1);

      // Fire event
      const event: BoardEvent = {
        type: "activity-entry-added",
        timestamp: "2026-01-15T10:42:15Z",
        data: { logEntry: mockLogEntry },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event);
      });

      // New callback should be called, not the old one
      expect(onActivityEntry1).not.toHaveBeenCalled();
      expect(onActivityEntry2).toHaveBeenCalledWith(mockLogEntry);
    });

    it("should handle multiple activity entries with updated callback", () => {
      const onActivityEntry1 = vi.fn();
      const onActivityEntry2 = vi.fn();

      const { rerender } = renderHook(
        ({ onActivityEntry }) => useBoardEvents({ onActivityEntry }),
        { initialProps: { onActivityEntry: onActivityEntry1 } }
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Send first entry with first callback
      const event1: BoardEvent = {
        type: "activity-entry-added",
        timestamp: "2026-01-15T10:42:15Z",
        data: { logEntry: mockLogEntry },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event1);
      });

      expect(onActivityEntry1).toHaveBeenCalledTimes(1);

      // Update callback
      rerender({ onActivityEntry: onActivityEntry2 });

      // Send second entry with new callback
      const event2: BoardEvent = {
        type: "activity-entry-added",
        timestamp: "2026-01-15T11:00:00Z",
        data: { logEntry: mockApprovedLogEntry },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(event2);
      });

      // First callback should only have been called once
      expect(onActivityEntry1).toHaveBeenCalledTimes(1);
      // Second callback should be called with the second event
      expect(onActivityEntry2).toHaveBeenCalledWith(mockApprovedLogEntry);
    });
  });

  describe("integration with other callbacks", () => {
    it("should work alongside other event callbacks", () => {
      const onActivityEntry = vi.fn();
      const onItemAdded = vi.fn();
      const onBoardUpdated = vi.fn();

      renderHook(() =>
        useBoardEvents({
          onActivityEntry,
          onItemAdded,
          onBoardUpdated,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Send activity entry event
      const activityEvent: BoardEvent = {
        type: "activity-entry-added",
        timestamp: "2026-01-15T10:42:15Z",
        data: { logEntry: mockLogEntry },
      };

      act(() => {
        MockEventSource.instances[0].simulateMessage(activityEvent);
      });

      expect(onActivityEntry).toHaveBeenCalledWith(mockLogEntry);
      expect(onItemAdded).not.toHaveBeenCalled();
      expect(onBoardUpdated).not.toHaveBeenCalled();
    });

    it("should handle rapid succession of mixed event types", () => {
      const onActivityEntry = vi.fn();
      const onItemMoved = vi.fn();

      renderHook(() =>
        useBoardEvents({
          onActivityEntry,
          onItemMoved,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      // Send multiple events in rapid succession
      const events: BoardEvent[] = [
        {
          type: "activity-entry-added",
          timestamp: "2026-01-15T10:42:15Z",
          data: { logEntry: mockLogEntry },
        },
        {
          type: "item-moved",
          timestamp: "2026-01-15T10:42:16Z",
          data: { itemId: "001", fromStage: "ready", toStage: "implementing" },
        },
        {
          type: "activity-entry-added",
          timestamp: "2026-01-15T10:42:17Z",
          data: { logEntry: mockApprovedLogEntry },
        },
      ];

      for (const event of events) {
        act(() => {
          MockEventSource.instances[0].simulateMessage(event);
        });
      }

      expect(onActivityEntry).toHaveBeenCalledTimes(2);
      expect(onItemMoved).toHaveBeenCalledTimes(1);
    });
  });
});
