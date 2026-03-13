"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  WorkItem,
  BoardMetadata,
  BoardEvent,
  LogEntry,
  ConnectionStatus,
  FinalReviewStartedEvent,
  FinalReviewCompleteEvent,
  PostChecksStartedEvent,
  PostCheckUpdateEvent,
  PostChecksCompleteEvent,
  DocumentationStartedEvent,
  DocumentationCompleteEvent,
  HookEventSummary,
  MissionTokenUsageData,
} from "@/types";

/**
 * Configuration options for the useBoardEvents hook
 */
export interface UseBoardEventsOptions {
  /** Project ID to subscribe to events for */
  projectId?: string;
  /** Callback when an item is added to the board */
  onItemAdded?: (item: WorkItem) => void;
  /** Callback when an item moves between stages */
  onItemMoved?: (itemId: string, fromStage: string, toStage: string, item?: WorkItem) => void;
  /** Callback when an item is updated */
  onItemUpdated?: (item: WorkItem) => void;
  /** Callback when an item is deleted */
  onItemDeleted?: (itemId: string) => void;
  /** Callback when board metadata is updated */
  onBoardUpdated?: (board: BoardMetadata) => void;
  /** Callback when an activity entry is added */
  onActivityEntry?: (entry: LogEntry) => void;
  /** Callback when hook events are emitted (single or batch) */
  onHookEvent?: (event: HookEventSummary | HookEventSummary[]) => void;
  /** Callback when mission is completed */
  onMissionCompleted?: (data: {
    completed_at?: string;
    duration_ms?: number;
    stats?: BoardMetadata['stats'];
  }) => void;
  /** Callback when final review starts */
  onFinalReviewStarted?: (data: FinalReviewStartedEvent['data']) => void;
  /** Callback when final review completes */
  onFinalReviewComplete?: (data: FinalReviewCompleteEvent['data']) => void;
  /** Callback when post-checks start */
  onPostChecksStarted?: (data: PostChecksStartedEvent['data']) => void;
  /** Callback when a post-check updates */
  onPostCheckUpdate?: (data: PostCheckUpdateEvent['data']) => void;
  /** Callback when all post-checks complete */
  onPostChecksComplete?: (data: PostChecksCompleteEvent['data']) => void;
  /** Callback when documentation starts */
  onDocumentationStarted?: (data: DocumentationStartedEvent['data']) => void;
  /** Callback when documentation completes */
  onDocumentationComplete?: (data: DocumentationCompleteEvent['data']) => void;
  /** Callback when mission token usage summary is available */
  onMissionTokenUsage?: (data: {
    missionId: string;
    agents: MissionTokenUsageData[];
    totals: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      estimatedCostUsd: number;
    };
  }) => void;
  /** Whether to enable the SSE connection (defaults to true) */
  enabled?: boolean;
}

/**
 * Return value from the useBoardEvents hook
 */
export interface UseBoardEventsReturn {
  /** Whether the EventSource is currently connected */
  isConnected: boolean;
  /** Granular connection state for UI feedback */
  connectionState: ConnectionStatus;
  /** Error if the connection failed */
  connectionError: Error | null;
}

/** Default endpoint for SSE events */
const SSE_ENDPOINT = "/api/board/events";

/** Base delay for reconnection backoff in milliseconds */
const BASE_RECONNECT_DELAY = 1000;

/** Maximum reconnection delay in milliseconds */
const MAX_RECONNECT_DELAY = 30000;

/** Maximum number of reconnection attempts before giving up */
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Custom hook for subscribing to real-time board events via Server-Sent Events.
 *
 * Establishes an EventSource connection to the SSE endpoint and invokes
 * callbacks when board events occur. Automatically reconnects with
 * exponential backoff if the connection drops.
 *
 * @param options - Configuration options including event callbacks
 * @returns Connection status and error information
 *
 * @example
 * ```tsx
 * const { isConnected, connectionError } = useBoardEvents({
 *   onItemMoved: (itemId, from, to) => {
 *     setItemsByStage(prev => moveItem(prev, itemId, from, to));
 *   },
 *   onBoardUpdated: (board) => {
 *     setBoard(board);
 *   }
 * });
 * ```
 */
export function useBoardEvents(
  options: UseBoardEventsOptions
): UseBoardEventsReturn {
  const {
    projectId,
    onItemAdded,
    onItemMoved,
    onItemUpdated,
    onItemDeleted,
    onBoardUpdated,
    onActivityEntry,
    onHookEvent,
    onMissionCompleted,
    onMissionTokenUsage,
    onFinalReviewStarted,
    onFinalReviewComplete,
    onPostChecksStarted,
    onPostCheckUpdate,
    onPostChecksComplete,
    onDocumentationStarted,
    onDocumentationComplete,
    enabled = true,
  } = options;

  // Track raw connection state (without error consideration)
  const [rawConnectionState, setRawConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>(
    enabled ? 'connecting' : 'disconnected'
  );
  const [connectionError, setConnectionError] = useState<Error | null>(null);

  // Derive connectionState: error takes precedence when connectionError is set
  const connectionState: ConnectionStatus = connectionError ? 'error' : rawConnectionState;

  // Derive isConnected for backward compatibility
  const isConnected = connectionState === 'connected';

  // Use refs to store callbacks so we don't need to reconnect when they change
  const callbacksRef = useRef({
    onItemAdded,
    onItemMoved,
    onItemUpdated,
    onItemDeleted,
    onBoardUpdated,
    onActivityEntry,
    onHookEvent,
    onMissionCompleted,
    onMissionTokenUsage,
    onFinalReviewStarted,
    onFinalReviewComplete,
    onPostChecksStarted,
    onPostCheckUpdate,
    onPostChecksComplete,
    onDocumentationStarted,
    onDocumentationComplete,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      onItemAdded,
      onItemMoved,
      onItemUpdated,
      onItemDeleted,
      onBoardUpdated,
      onActivityEntry,
      onHookEvent,
      onMissionCompleted,
      onMissionTokenUsage,
      onFinalReviewStarted,
      onFinalReviewComplete,
      onPostChecksStarted,
      onPostCheckUpdate,
      onPostChecksComplete,
      onDocumentationStarted,
      onDocumentationComplete,
    };
  }, [onItemAdded, onItemMoved, onItemUpdated, onItemDeleted, onBoardUpdated, onActivityEntry, onHookEvent, onMissionCompleted, onMissionTokenUsage, onFinalReviewStarted, onFinalReviewComplete, onPostChecksStarted, onPostCheckUpdate, onPostChecksComplete, onDocumentationStarted, onDocumentationComplete]);

  // Ref to track EventSource and reconnection state
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ref to store the connect function for recursive calls
  const connectRef = useRef<(() => void) | null>(null);

  const handleEvent = useCallback((event: MessageEvent) => {
    try {
      const boardEvent = JSON.parse(event.data) as BoardEvent;

      switch (boardEvent.type) {
        case "item-added":
          if (boardEvent.data.item && callbacksRef.current.onItemAdded) {
            callbacksRef.current.onItemAdded(boardEvent.data.item);
          }
          break;

        case "item-moved":
          if (
            boardEvent.data.itemId &&
            boardEvent.data.fromStage &&
            boardEvent.data.toStage &&
            callbacksRef.current.onItemMoved
          ) {
            callbacksRef.current.onItemMoved(
              boardEvent.data.itemId,
              boardEvent.data.fromStage,
              boardEvent.data.toStage,
              boardEvent.data.item // Pass full item data if available
            );
          }
          break;

        case "item-updated":
          if (boardEvent.data.item && callbacksRef.current.onItemUpdated) {
            callbacksRef.current.onItemUpdated(boardEvent.data.item);
          }
          break;

        case "item-deleted":
          if (boardEvent.data.itemId && callbacksRef.current.onItemDeleted) {
            callbacksRef.current.onItemDeleted(boardEvent.data.itemId);
          }
          break;

        case "board-updated":
          if (boardEvent.data.board && callbacksRef.current.onBoardUpdated) {
            callbacksRef.current.onBoardUpdated(boardEvent.data.board);
          }
          break;

        case "activity-entry-added":
          if (boardEvent.data.logEntry && callbacksRef.current.onActivityEntry) {
            callbacksRef.current.onActivityEntry(boardEvent.data.logEntry);
          }
          break;

        case "mission-completed":
          if (callbacksRef.current.onMissionCompleted) {
            callbacksRef.current.onMissionCompleted({
              completed_at: boardEvent.data.completed_at,
              duration_ms: boardEvent.data.duration_ms,
              stats: boardEvent.data.stats,
            });
          }
          break;

        case "mission-token-usage":
          if (callbacksRef.current.onMissionTokenUsage) {
            callbacksRef.current.onMissionTokenUsage(boardEvent.data);
          }
          break;

        case "final-review-started":
          if (callbacksRef.current.onFinalReviewStarted) {
            callbacksRef.current.onFinalReviewStarted(boardEvent.data);
          }
          break;

        case "final-review-complete":
          if (callbacksRef.current.onFinalReviewComplete) {
            callbacksRef.current.onFinalReviewComplete(boardEvent.data);
          }
          break;

        case "post-checks-started":
          if (callbacksRef.current.onPostChecksStarted) {
            callbacksRef.current.onPostChecksStarted(boardEvent.data);
          }
          break;

        case "post-check-update":
          if (callbacksRef.current.onPostCheckUpdate) {
            callbacksRef.current.onPostCheckUpdate(boardEvent.data);
          }
          break;

        case "post-checks-complete":
          if (callbacksRef.current.onPostChecksComplete) {
            callbacksRef.current.onPostChecksComplete(boardEvent.data);
          }
          break;

        case "documentation-started":
          if (callbacksRef.current.onDocumentationStarted) {
            callbacksRef.current.onDocumentationStarted(boardEvent.data);
          }
          break;

        case "documentation-complete":
          if (callbacksRef.current.onDocumentationComplete) {
            callbacksRef.current.onDocumentationComplete(boardEvent.data);
          }
          break;

        case "hook-event":
          if (callbacksRef.current.onHookEvent) {
            // Revive timestamp strings to Date objects from JSON.parse
            const reviveTimestamp = (evt: unknown) => {
              const obj = evt as Record<string, unknown>;
              return { ...obj, timestamp: new Date(obj.timestamp as string) };
            };
            const hookData = boardEvent.data;
            const revivedData = Array.isArray(hookData)
              ? hookData.map(reviveTimestamp)
              : reviveTimestamp(hookData);
            callbacksRef.current.onHookEvent(revivedData as HookEventSummary | HookEventSummary[]);
          }
          break;
      }
    } catch (error) {
      console.error("Failed to parse SSE event:", error);
    }
  }, []);

  const connect = useCallback(() => {
    // Short-circuit if projectId is absent to prevent connecting with an empty ID
    // (the SSE route rejects empty projectId with a permanent 400)
    if (!projectId) {
      setRawConnectionState('disconnected');
      return;
    }

    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Set state to connecting when starting connection
    setRawConnectionState('connecting');

    try {
      const url = `${SSE_ENDPOINT}?projectId=${encodeURIComponent(projectId)}`;
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setRawConnectionState('connected');
        setConnectionError(null);
        reconnectAttemptRef.current = 0;
      };

      eventSource.onmessage = handleEvent;

      eventSource.onerror = () => {
        // Close the current connection
        eventSource.close();
        eventSourceRef.current = null;

        // Attempt to reconnect with exponential backoff
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          // Stay in 'connecting' state while retries remain
          setRawConnectionState('connecting');

          const delay = Math.min(
            BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current),
            MAX_RECONNECT_DELAY
          );
          reconnectAttemptRef.current += 1;

          reconnectTimeoutRef.current = setTimeout(() => {
            connectRef.current?.();
          }, delay);
        } else {
          // Max retries exceeded - set disconnected state and error
          setRawConnectionState('disconnected');
          setConnectionError(
            new Error("Failed to connect to SSE endpoint after maximum retries")
          );
        }
      };
    } catch (error) {
      const connectionErr = error instanceof Error ? error : new Error("Failed to create EventSource");
      setConnectionError(connectionErr);
      // rawConnectionState stays at 'connecting', but connectionState will be 'error' due to connectionError
    }
  }, [handleEvent, projectId]);

  // Keep connectRef in sync with the latest connect function
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!enabled) {
      // Clean up if disabled
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Intentionally setting state when enabled changes to false - this is a
      // legitimate response to prop change, not cascading render
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRawConnectionState('disconnected');
       
      setConnectionError(null);
      return;
    }

    connect();

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [enabled, connect]);

  return {
    isConnected,
    connectionState,
    connectionError,
  };
}
