"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { HeaderBar } from "@/components/header-bar";
import { BoardColumn } from "@/components/board-column";
import { LiveFeedPanel, type TabId } from "@/components/live-feed-panel";
import { TokenUsagePanel } from "@/components/token-usage-panel";
import type { LogEntry, MissionTokenUsageData } from "@/types";
import type { Project } from "@/types/api";
import { AgentStatusBar } from "@/components/agent-status-bar";
import { ItemDetailModal } from "@/components/item-detail-modal";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { useBoardEvents } from "@/hooks/use-board-events";
import { useFilterState } from "@/hooks/use-filter-state";
import { filterWorkItems } from "@/lib/filter-utils";
import { deriveAgentStatusesFromWorkItems } from "@/lib/agent-status-utils";
import { FilterBar } from "@/components/filter-bar";
import { DashboardNav, type DashboardView } from "@/components/dashboard-nav";
import { RawAgentView } from "@/components/raw-agent-view";
import type { HookEventSummary } from "@/types/hook-event";
import { transformBoardStateToMetadata, transformApiItemsToWorkItems } from "@/lib/api-transform";
import type {
  WorkItem,
  Stage,
  BoardMetadata,
  CardAnimationState,
  CardAnimationDirection,
  FinalReviewStatus,
  PostChecksStatus,
  DocumentationStatus,
  FinalReviewStartedEvent,
  FinalReviewCompleteEvent,
  PostChecksStartedEvent,
  PostCheckUpdateEvent,
  PostChecksCompleteEvent,
  DocumentationStartedEvent,
  DocumentationCompleteEvent,
} from "@/types";
import "@/styles/animations.css";

const ALL_STAGES: Stage[] = [
  "briefings",
  "ready",
  "testing",
  "implementing",
  "review",
  "probing",
  "done",
  "blocked",
];

// Default empty board state
const defaultBoardMetadata: BoardMetadata = {
  mission: {
    name: "Loading...",
    started_at: new Date().toISOString(),
    status: "active",
  },
  wip_limits: { testing: 2, implementing: 3, review: 2 },
  phases: {},
  assignments: {},
  agents: {},
  stats: { total_items: 0, completed: 0, in_progress: 0, blocked: 0, backlog: 0 },
  last_updated: new Date().toISOString(),
};

// Animation configuration
const ANIMATION_DURATION = 300; // ms, matches CSS --card-animation-duration

// Type for tracking animating items
interface AnimationInfo {
  state: CardAnimationState;
  direction: CardAnimationDirection;
  toStage?: Stage;
}

// Helper to determine animation direction based on stage movement
function getAnimationDirection(fromStage: Stage, toStage: Stage): CardAnimationDirection {
  const fromIndex = ALL_STAGES.indexOf(fromStage);
  const toIndex = ALL_STAGES.indexOf(toStage);
  if (fromIndex === -1 || toIndex === -1) return "none";
  return toIndex > fromIndex ? "right" : "left";
}

// Default project ID when none is specified in URL
const DEFAULT_PROJECT_ID = "kanban-viewer";

function HomeContent() {
  // URL and routing
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get projectId from URL params, defaulting to "kanban-viewer"
  const projectId = searchParams.get("projectId") ?? DEFAULT_PROJECT_ID;

  // Projects list state
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // Handler to switch projects
  const handleProjectChange = useCallback((newProjectId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("projectId", newProjectId);
    router.push(`/?${params.toString()}`);
  }, [searchParams, router]);

  const [boardMetadata, setBoardMetadata] = useState<BoardMetadata>(defaultBoardMetadata);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [hookEvents, setHookEvents] = useState<HookEventSummary[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("live-feed");
  const [dashboardView, setDashboardView] = useState<DashboardView>("board");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  // Mission completion flow state
  const [finalReview, setFinalReview] = useState<FinalReviewStatus | undefined>(undefined);
  const [postChecks, setPostChecks] = useState<PostChecksStatus | undefined>(undefined);
  const [documentation, setDocumentation] = useState<DocumentationStatus | undefined>(undefined);

  // Token usage state (populated via SSE or initial fetch for completed missions)
  const [tokenUsage, setTokenUsage] = useState<{
    agents: MissionTokenUsageData[];
    totals: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      estimatedCostUsd: number;
    };
  } | null>(null);

  // Filter state management
  const {
    filterState,
    setTypeFilter,
    setAgentFilter,
    setStatusFilter,
    setSearchQuery,
    resetFilters,
  } = useFilterState();

  // Animation state management
  const [animatingItems, setAnimatingItems] = useState<Map<string, AnimationInfo>>(new Map());
  const pendingMoves = useRef<Map<string, { toStage: Stage; direction: CardAnimationDirection; item?: WorkItem }>>(new Map());
  const animationTimeouts = useRef<Map<string, NodeJS.Timeout[]>>(new Map());

  // SSE callbacks for real-time updates
  const onItemAdded = useCallback((item: WorkItem) => {
    setWorkItems((prev) => [...prev, item]);
  }, []);

  const onItemMoved = useCallback((itemId: string, fromStage: string, toStage: string, item?: WorkItem) => {
    const direction = getAnimationDirection(fromStage as Stage, toStage as Stage);

    // Clean up any existing timeouts for this item to prevent memory leaks
    const existingTimeouts = animationTimeouts.current.get(itemId) || [];
    existingTimeouts.forEach(timeout => clearTimeout(timeout));
    animationTimeouts.current.delete(itemId);

    // Cancel any pending animation for this item
    pendingMoves.current.delete(itemId);

    // Start exit animation
    setAnimatingItems((prev) => {
      const next = new Map(prev);
      next.set(itemId, { state: "exiting", direction, toStage: toStage as Stage });
      return next;
    });

    // Store pending move for when exit animation completes, including full item if available
    pendingMoves.current.set(itemId, { toStage: toStage as Stage, direction, item });

    const timeouts: NodeJS.Timeout[] = [];

    // Fallback: if onAnimationEnd doesn't fire, use timeout
    const fallbackTimeout = setTimeout(() => {
      const pending = pendingMoves.current.get(itemId);
      if (pending) {
        pendingMoves.current.delete(itemId);

        // Move item to new stage, using full item data if available (includes assigned_agent)
        setWorkItems((prev) =>
          prev.map((existingItem) =>
            existingItem.id === itemId
              ? pending.item
                ? { ...pending.item, stage: pending.toStage } // Use full item data
                : { ...existingItem, stage: pending.toStage } // Fallback to just updating stage
              : existingItem
          )
        );

        // Start enter animation
        setAnimatingItems((prev) => {
          const next = new Map(prev);
          next.set(itemId, { state: "entering", direction: pending.direction });
          return next;
        });

        // Clear animation after enter completes
        const clearAnimationTimeout = setTimeout(() => {
          setAnimatingItems((prev) => {
            const next = new Map(prev);
            next.delete(itemId);
            return next;
          });
          // Clean up this item's timeouts after animation completes
          animationTimeouts.current.delete(itemId);
        }, ANIMATION_DURATION);

        timeouts.push(clearAnimationTimeout);
      }
    }, ANIMATION_DURATION);

    timeouts.push(fallbackTimeout);
    animationTimeouts.current.set(itemId, timeouts);
  }, []);

  const onItemUpdated = useCallback((updatedItem: WorkItem) => {
    setWorkItems((prev) =>
      prev.map((item) => (item.id === updatedItem.id ? updatedItem : item))
    );
  }, []);

  const onItemDeleted = useCallback((itemId: string) => {
    setWorkItems((prev) => prev.filter((item) => item.id !== itemId));
  }, []);

  const onBoardUpdated = useCallback((board: BoardMetadata) => {
    if (!board) return;
    setBoardMetadata(board);
    // Clear work items when phases are empty (e.g., after archive)
    const phases = board.phases;
    const hasNoPhases = !phases || Object.keys(phases).length === 0;
    const allPhasesEmpty = !hasNoPhases && Object.values(phases).every(
      (items) => !Array.isArray(items) || items.length === 0
    );
    if (hasNoPhases || allPhasesEmpty) {
      setWorkItems([]);
    }
  }, []);

  const onActivityEntry = useCallback((entry: LogEntry) => {
    setLogEntries((prev) => {
      const isDuplicate = prev.some(
        (e) =>
          e.timestamp === entry.timestamp &&
          e.agent === entry.agent &&
          e.message === entry.message
      );
      if (isDuplicate) return prev;
      return [...prev, entry];
    });
  }, []);

  const onMissionCompleted = useCallback((data: {
    completed_at?: string;
    duration_ms?: number;
    stats?: BoardMetadata['stats'];
  }) => {
    setBoardMetadata((prev) => ({
      ...prev,
      mission: {
        ...prev.mission,
        status: 'completed' as const,
        completed_at: data.completed_at,
        duration_ms: data.duration_ms,
      },
      stats: data.stats ?? prev.stats ?? defaultBoardMetadata.stats,
    }));
  }, []);

  // Mission completion flow event handlers
  const onFinalReviewStarted = useCallback((data: FinalReviewStartedEvent['data']) => {
    setFinalReview({
      started_at: data.started_at,
      agent: data.agent,
      rejections: data.rejections,
      passed: data.passed,
    });
    // Auto-switch to completion tab when entering completion phase
    setActiveTab("completion");
  }, []);

  const onFinalReviewComplete = useCallback((data: FinalReviewCompleteEvent['data']) => {
    setFinalReview({
      started_at: data.started_at,
      completed_at: data.completed_at,
      agent: data.agent,
      passed: data.passed,
      verdict: data.verdict,
      rejections: data.rejections,
    });
  }, []);

  const onPostChecksStarted = useCallback((data: PostChecksStartedEvent['data']) => {
    setPostChecks({
      started_at: data.started_at,
      passed: data.passed,
      results: data.results,
    });
  }, []);

  const onPostCheckUpdate = useCallback((data: PostCheckUpdateEvent['data']) => {
    setPostChecks((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        results: {
          ...prev.results,
          [data.check]: {
            status: data.status,
            completed_at: data.completed_at,
          },
        },
      };
    });
  }, []);

  const onPostChecksComplete = useCallback((data: PostChecksCompleteEvent['data']) => {
    setPostChecks({
      started_at: data.started_at,
      completed_at: data.completed_at,
      passed: data.passed,
      results: data.results,
    });
  }, []);

  const onDocumentationStarted = useCallback((data: DocumentationStartedEvent['data']) => {
    setDocumentation({
      started_at: data.started_at,
      agent: data.agent,
      completed: data.completed,
      files_modified: data.files_modified,
    });
  }, []);

  const onHookEvent = useCallback((event: HookEventSummary | HookEventSummary[]) => {
    const newEvents = Array.isArray(event) ? event : [event];
    setHookEvents((prev) => {
      const existingIds = new Set(prev.map((e) => e.id));
      const deduped = newEvents.filter((e) => !existingIds.has(e.id));
      if (deduped.length === 0) return prev;
      return [...prev, ...deduped];
    });
  }, []);

  const onDocumentationComplete = useCallback((data: DocumentationCompleteEvent['data']) => {
    setDocumentation({
      started_at: data.started_at,
      completed_at: data.completed_at,
      agent: data.agent,
      completed: data.completed,
      files_modified: data.files_modified,
      commit: data.commit,
      summary: data.summary,
    });
  }, []);

  const onMissionTokenUsage = useCallback((data: {
    missionId: string;
    agents: MissionTokenUsageData[];
    totals: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      estimatedCostUsd: number;
    };
  }) => {
    setTokenUsage({ agents: data.agents, totals: data.totals });
  }, []);

  // Handler for WIP limit changes from BoardColumn
  const handleWipLimitChange = useCallback(async (stageId: string, newLimit: number | null) => {
    try {
      const response = await fetch(`/api/stages/${stageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wipLimit: newLimit }),
      });

      if (response.ok) {
        setBoardMetadata(prev => ({
          ...prev,
          wip_limits: { ...prev.wip_limits, [stageId]: newLimit }
        }));
      } else {
        console.error('Failed to update WIP limit');
      }
    } catch (error) {
      console.error('Error updating WIP limit:', error);
    }
  }, []);

  // Handle animation end - triggered by WorkItemCard onAnimationEnd
  const handleAnimationEnd = useCallback((itemId: string) => {
    const animationInfo = animatingItems.get(itemId);
    if (!animationInfo) return;

    if (animationInfo.state === "exiting") {
      const pending = pendingMoves.current.get(itemId);
      if (pending) {
        pendingMoves.current.delete(itemId);
        animationTimeouts.current.delete(itemId);

        // Move item to new stage, using full item data if available (includes assigned_agent)
        setWorkItems((prev) =>
          prev.map((existingItem) =>
            existingItem.id === itemId
              ? pending.item
                ? { ...pending.item, stage: pending.toStage } // Use full item data
                : { ...existingItem, stage: pending.toStage } // Fallback to just updating stage
              : existingItem
          )
        );

        // Start enter animation
        setAnimatingItems((prev) => {
          const next = new Map(prev);
          next.set(itemId, { state: "entering", direction: pending.direction });
          return next;
        });
      }
    } else if (animationInfo.state === "entering") {
      // Clear animation state after enter completes
      setAnimatingItems((prev) => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
    }
  }, [animatingItems]);

  // Clean up animation timeouts on unmount
  useEffect(() => {
    const timeoutsRef = animationTimeouts.current;
    return () => {
      timeoutsRef.forEach((timeouts) => {
        timeouts.forEach(timeout => clearTimeout(timeout));
      });
      timeoutsRef.clear();
    };
  }, []);

  // Subscribe to SSE board events
  const { connectionState, connectionError } = useBoardEvents({
    projectId,
    onItemAdded,
    onItemMoved,
    onItemUpdated,
    onItemDeleted,
    onBoardUpdated,
    onActivityEntry,
    onHookEvent,
    onMissionCompleted,
    onFinalReviewStarted,
    onFinalReviewComplete,
    onPostChecksStarted,
    onPostCheckUpdate,
    onPostChecksComplete,
    onDocumentationStarted,
    onDocumentationComplete,
    onMissionTokenUsage,
  });

  // Fetch projects list on mount
  useEffect(() => {
    async function fetchProjects() {
      setProjectsLoading(true);
      setProjectsError(null);
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) {
          setProjectsError(`Failed to load projects (${res.status})`);
          return;
        }
        const data = await res.json();
        if (data.success && data.data) {
          setProjects(data.data);
        }
      } catch (err) {
        setProjectsError("Network error loading projects");
        console.warn("Failed to fetch projects list:", err);
      } finally {
        setProjectsLoading(false);
      }
    }

    fetchProjects();
  }, []);

  // Fetch board data when projectId changes
  useEffect(() => {
    async function fetchBoardData() {
      setLoading(true);
      setError(null);
      setHookEvents([]);
      let boardRes: Response;
      let logRes: Response;

      // Fetch board data - this is required
      try {
        boardRes = await fetch('/api/board?includeCompleted=true', {
          headers: {
            'X-Project-ID': projectId,
          },
        });
      } catch (err) {
        // Network error - fetch threw
        console.error("Network error fetching board:", err);
        setError("Failed to load board data: Network error connecting to /api/board");
        setLoading(false);
        return;
      }

      // Check for non-ok response from board API
      if (!boardRes.ok) {
        if (boardRes.status === 404) {
          setError("No active mission found. Please start a mission first.");
        } else {
          setError(`Failed to load board from /api/board: ${boardRes.status} ${boardRes.statusText}`);
        }
        setLoading(false);
        return;
      }

      // Parse board JSON
      let boardData;
      try {
        boardData = await boardRes.json();
      } catch (err) {
        console.error("Failed to parse board JSON:", err);
        setError("Failed to load board data: Invalid JSON response from /api/board");
        setLoading(false);
        return;
      }

      // Check for success: false in response
      if (!boardData.success) {
        setError(`Failed to load board from /api/board: ${boardData.error || 'Invalid response'}`);
        setLoading(false);
        return;
      }

      // Board data is valid - set it
      if (boardData.data) {
        const metadata = transformBoardStateToMetadata(boardData.data);
        const items = transformApiItemsToWorkItems(boardData.data.items);
        setBoardMetadata(metadata);
        setWorkItems(items);
      }

      // Fetch activity log - this is optional, don't fail the page if it errors
      try {
        logRes = await fetch('/api/activity', {
          headers: {
            'X-Project-ID': projectId,
          },
        });

        if (logRes.ok) {
          const logData = await logRes.json();
          if (logData.success && logData.data?.entries) {
            // Transform activity log entries to LogEntry format
            // API returns entries in descending order (newest first), but UI expects
            // ascending order (oldest first) so new SSE entries append at the bottom
            const entries = logData.data.entries.map((entry: { agent: string | null; message: string; timestamp: string | Date }) => ({
              timestamp: entry.timestamp instanceof Date
                ? entry.timestamp.toISOString()
                : String(entry.timestamp),
              agent: entry.agent ?? 'System',
              message: entry.message,
            })).reverse();
            setLogEntries(entries);
          }
        }
        // If logRes is not ok, we just don't set log entries - activity log is optional
      } catch (err) {
        // Activity log fetch failed - not critical, just log it
        console.warn("Failed to fetch activity log:", err);
      }

      // If mission is completed/archived, fetch token usage (SSE event was already emitted)
      const missionState = boardData.data?.currentMission?.state;
      if (missionState === 'completed' || missionState === 'archived') {
        try {
          const missionId = boardData.data.currentMission.id;
          const tokenRes = await fetch(`/api/missions/${missionId}/token-usage`, {
            headers: { 'X-Project-ID': projectId },
          });
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            if (tokenData.success && tokenData.data) {
              setTokenUsage({ agents: tokenData.data.agents, totals: tokenData.data.totals });
            }
          }
        } catch (err) {
          console.warn("Failed to fetch token usage:", err);
        }
      }

      setLoading(false);
    }

    fetchBoardData();
  }, [projectId]);

  // Filter work items based on current filter state
  const filteredWorkItems = filterWorkItems(workItems, filterState);

  // Determine if filters are hiding all items (for empty state display)
  const filtersHideAllItems = filteredWorkItems.length === 0 && workItems.length > 0;

  // Group filtered work items by stage
  const itemsByStage = ALL_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = filteredWorkItems.filter((item) => item.stage === stage);
      return acc;
    },
    {} as Record<Stage, WorkItem[]>
  );

  // Calculate blocked items count for notification
  const blockedCount = itemsByStage.blocked?.length ?? 0;

  // Calculate WIP current (items in testing + implementing + review + probing)
  const wipCurrent =
    itemsByStage.testing.length +
    itemsByStage.implementing.length +
    itemsByStage.review.length +
    itemsByStage.probing.length;

  // Get total WIP limit
  const wipLimit =
    (boardMetadata.wip_limits.testing || 0) +
    (boardMetadata.wip_limits.implementing || 0) +
    (boardMetadata.wip_limits.review || 0) +
    (boardMetadata.wip_limits.probing || 0);

  // Calculate stats dynamically from workItems to ensure UI reflects actual state
  // This fixes the bug where progress bar showed stale data when items moved via SSE
  const dynamicStats = {
    total_items: workItems.length,
    completed: itemsByStage.done.length,
    in_progress: wipCurrent,
    blocked: blockedCount,
    backlog: itemsByStage.briefings.length + itemsByStage.ready.length,
  };

  // Derive agent statuses from work items in active stages
  // An agent is "active" if assigned to an item in probing, testing, implementing, or review
  const agentStatuses = deriveAgentStatusesFromWorkItems(workItems);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground font-mono">Loading mission data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-destructive font-mono">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <HeaderBar
        mission={boardMetadata.mission}
        stats={dynamicStats}
        wipCurrent={wipCurrent}
        wipLimit={wipLimit}
        projects={projects}
        selectedProjectId={projectId}
        onProjectChange={handleProjectChange}
        projectsLoading={projectsLoading}
        projectsError={projectsError}
      />

      {/* Connection status */}
      <ConnectionStatusIndicator
        status={connectionState}
        error={connectionError}
        className="px-4 py-1 text-sm text-muted-foreground"
      />

      {/* Dashboard view nav */}
      <DashboardNav currentView={dashboardView} onViewChange={setDashboardView} />

      {/* Filter bar (board view only) */}
      {dashboardView === "board" && (
        <FilterBar
          typeFilter={filterState.typeFilter}
          agentFilter={filterState.agentFilter}
          statusFilter={filterState.statusFilter}
          searchQuery={filterState.searchQuery}
          onTypeFilterChange={setTypeFilter}
          onAgentFilterChange={setAgentFilter}
          onStatusFilterChange={setStatusFilter}
          onSearchQueryChange={setSearchQuery}
          onClearFilters={resetFilters}
        />
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {dashboardView === "board" ? (
          <>
            {/* Kanban columns or empty state */}
            {filtersHideAllItems ? (
              <div
                data-testid="filter-empty-state"
                className="flex-1 flex flex-col items-center justify-center"
              >
                <p className="text-sm text-gray-500">No items match filters</p>
                <button
                  type="button"
                  data-testid="empty-state-clear-filters"
                  className="mt-2 text-green-500 text-sm hover:underline"
                  onClick={resetFilters}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="flex-1 flex gap-2 p-4 overflow-x-auto">
                {ALL_STAGES.map((stage) => (
                  <BoardColumn
                    key={stage}
                    stage={stage}
                    items={itemsByStage[stage]}
                    wipLimit={boardMetadata.wip_limits[stage]}
                    onItemClick={(item) => setSelectedItem(item)}
                    animatingItems={animatingItems}
                    onAnimationEnd={handleAnimationEnd}
                    onWipLimitChange={handleWipLimitChange}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          /* Raw Agent View */
          <div className="flex-1">
            <RawAgentView events={hookEvents} />
          </div>
        )}

        {/* Right panel */}
        <div className="w-[400px] min-w-[350px] max-w-[500px] border-l border-border bg-card shrink-0 hidden lg:block overflow-y-auto">
          <LiveFeedPanel
            entries={logEntries}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pendingHumanInputCount={blockedCount}
            mission={boardMetadata.mission}
            finalReview={finalReview}
            postChecks={postChecks}
            documentation={documentation}
          />
          {tokenUsage && (
            <div data-testid="token-usage-section" className="border-t border-border">
              <div className="px-4 pt-3 pb-1">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Token Usage</h3>
              </div>
              <TokenUsagePanel agents={tokenUsage.agents} totals={tokenUsage.totals} />
            </div>
          )}
        </div>
      </div>

      {/* Agent status bar */}
      <AgentStatusBar agents={agentStatuses} />

      {/* Work item detail modal */}
      <ItemDetailModal
        isOpen={selectedItem !== null}
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
      />

      {/* Spacer for fixed bottom bar */}
      <div className="h-16" />
    </div>
  );
}

// Wrap in Suspense to allow useSearchParams() during static generation
export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}
