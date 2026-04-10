/**
 * Core TypeScript types and interfaces for Kanban Viewer
 */

// ============ API Layer Types (PRD 013) ============
// Re-export all types from the new API layer type modules

// Hook event types
export type { HookEventSummary } from './hook-event';

// Board types
export type {
  StageId,
  BoardState,
  WipStatus,
} from './board';

// Item types
export type {
  ItemType,
  ItemPriority,
  WorkLogAction,
  Item,
  ItemWithRelations,
  WorkLogEntry,
  ItemOutputs,
} from './item';

// Agent types
import type { AgentName } from './agent';
import type { WorkLogEntry } from './item';
export type {
  AgentName,
  AgentClaim,
} from './agent';

// Mission types
export type {
  MissionState,
  Mission as ApiMission,
  MissionPrecheckOutput,
  PrecheckResult,
  PostcheckResult,
} from './mission';

// API request/response types
export type {
  // Board endpoints
  GetBoardResponse,
  MoveItemRequest,
  MoveItemResponse,
  ClaimItemRequest,
  ClaimItemResponse,
  ReleaseItemRequest,
  ReleaseItemResponse,
  // Item endpoints
  CreateItemRequest,
  CreateItemResponse,
  UpdateItemRequest,
  UpdateItemResponse,
  RenderItemResponse,
  // Agent endpoints
  AgentStartRequest,
  AgentStartResponse,
  AgentStopRequest,
  AgentStopResponse,
  // Mission endpoints
  CreateMissionRequest,
  CreateMissionResponse,
  GetCurrentMissionResponse,
  PrecheckResponse,
  PostcheckResponse,
  ArchiveMissionResponse,
  // Utility endpoints
  DepsCheckResponse,
  LogActivityRequest,
  LogActivityResponse,
  ActivityLogEntry,
  GetActivityResponse,
  // Project endpoints
  Project,
  GetProjectsResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  // Error handling
  ApiError,
  ApiResponse,
} from './api';

// Filter types for kanban board filtering
export type TypeFilter = 'All Types' | 'implementation' | 'test' | 'interface' | 'integration' | 'feature' | 'bug' | 'enhancement';
export type AgentFilter = 'All Agents' | 'Unassigned' | AgentName;
export type StatusFilter = 'All Status' | 'Active' | 'Blocked' | 'Has Rejections' | 'Has Dependencies' | 'Completed';

export interface FilterState {
  typeFilter: TypeFilter;
  agentFilter: AgentFilter;
  statusFilter: StatusFilter;
  searchQuery: string;
}
export type AgentStatus = 'watching' | 'active' | 'idle';

// Stage definitions
export type Stage = 'briefings' | 'ready' | 'testing' | 'implementing' | 'review' | 'probing' | 'done' | 'blocked';

// Work item type definitions
export type WorkItemType = 'implementation' | 'interface' | 'integration' | 'test';

// Work item frontmatter type (from markdown files)
export type WorkItemFrontmatterType = 'feature' | 'bug' | 'enhancement' | 'task';

// Rejection history entry for tracking work item rejections
export interface RejectionHistoryEntry {
  number: number;
  reason: string;
  agent: AgentName;
}

// Work item interface
export interface WorkItem {
  id: string;
  title: string;
  type: WorkItemFrontmatterType;
  status: string;
  assigned_agent?: AgentName;
  rejection_count: number;
  rejection_history?: RejectionHistoryEntry[];
  work_logs?: WorkLogEntry[];
  dependencies: string[];
  outputs: {
    test?: string;
    impl?: string;
    types?: string;
  };
  objective?: string;
  acceptance?: string[];
  context?: string;
  created_at: string;
  updated_at: string;
  stage: Stage;
  content: string;
}

// Work item modal props interface
export interface WorkItemModalProps {
  item: WorkItem;
  isOpen: boolean;
  onClose: () => void;
}

// Mission phase definitions for mission completion flow
export type MissionPhase = 'active' | 'final_review' | 'post_checks' | 'documentation' | 'complete';

// Check result status for post-completion checks
export type CheckResultStatus = 'pending' | 'running' | 'passed' | 'failed';

// Check result interface for individual check outcomes
export interface CheckResult {
  status: CheckResultStatus;
  completed_at?: string;
}

// Final review status interface for mission review tracking
export interface FinalReviewStatus {
  started_at: string;
  completed_at?: string;
  passed: boolean;
  verdict?: string;
  agent: AgentName;
  rejections: number;
}

// Post-checks status interface for automated validation
export interface PostChecksStatus {
  started_at: string;
  completed_at?: string;
  passed: boolean;
  results: {
    lint: CheckResult;
    typecheck: CheckResult;
    test: CheckResult;
    build: CheckResult;
  };
}

// Documentation status interface for mission documentation tracking
export interface DocumentationStatus {
  started_at: string;
  completed_at?: string;
  completed: boolean;
  agent: AgentName;
  files_modified: string[];
  commit?: string;
  summary?: string;
}

// Mission interface for board metadata
export interface Mission {
  name: string;
  started_at?: string;
  created_at?: string;
  completed_at?: string;
  duration_ms?: number;
  status: 'active' | 'paused' | 'completed' | 'planning' | 'final_review' | 'post_checks' | 'documentation' | 'complete';
  scalingRationale?: import('@ai-team/shared').ScalingRationale | null;
}

// Board metadata interface
export interface BoardMetadata {
  mission: Mission;
  wip_limits: Record<string, number | null>;
  phases: Record<string, string[]>;
  assignments: Record<string, unknown>; // task_id -> agent_name or assignment info
  agents: Record<string, { status: string; current_item?: string }>;
  stats: {
    total_items: number;
    completed: number;
    in_progress: number;
    blocked: number;
    backlog: number;
    briefings?: number;
    ready?: number;
    testing?: number;
    implementing?: number;
    probing?: number;
    review?: number;
    done?: number;
  };
  last_updated: string;
  /** Project name derived from parent folder of mission directory */
  projectName?: string;
  /** Final review status for mission completion flow */
  finalReview?: FinalReviewStatus;
  /** Post-completion checks status */
  postChecks?: PostChecksStatus;
  /** Documentation status for mission completion */
  documentation?: DocumentationStatus;
}

/**
 * Per-agent token usage breakdown for a completed mission.
 * Emitted as part of the `mission-token-usage` SSE event.
 */
export interface MissionTokenUsageData {
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

// Board event types
export type BoardEventType =
  | 'item-added'
  | 'item-moved'
  | 'item-updated'
  | 'item-deleted'
  | 'board-updated'
  | 'activity-entry-added'
  | 'hook-event'
  | 'mission-completed'
  | 'mission-token-usage'
  | 'final-review-started'
  | 'final-review-complete'
  | 'post-checks-started'
  | 'post-check-update'
  | 'post-checks-complete'
  | 'documentation-started'
  | 'documentation-complete';

// Re-export LogEntry from activity-log module
export type { LogEntry } from '../lib/activity-log';

// Discriminated union for type-safe board events
// Each event type has properly typed data properties

export interface ItemAddedEvent {
  type: 'item-added';
  timestamp: string;
  data: {
    item: WorkItem;
    itemId?: string;
    toStage?: string;
  };
}

export interface ItemMovedEvent {
  type: 'item-moved';
  timestamp: string;
  data: {
    itemId: string;
    fromStage: string;
    toStage: string;
    item?: WorkItem; // Full item data including assigned_agent
  };
}

export interface ItemUpdatedEvent {
  type: 'item-updated';
  timestamp: string;
  data: {
    item: WorkItem;
    itemId?: string;
    toStage?: string;
  };
}

export interface ItemDeletedEvent {
  type: 'item-deleted';
  timestamp: string;
  data: {
    itemId: string;
    fromStage?: string;
  };
}

export interface BoardUpdatedEvent {
  type: 'board-updated';
  timestamp: string;
  data: {
    board?: BoardMetadata;
  };
}

export interface ActivityEntryAddedEvent {
  type: 'activity-entry-added';
  timestamp: string;
  data: {
    logEntry: import('../lib/activity-log').LogEntry;
  };
}

export interface MissionCompletedEvent {
  type: 'mission-completed';
  timestamp: string;
  data: {
    completed_at?: string;
    duration_ms?: number;
    stats?: BoardMetadata['stats'];
  };
}

export interface FinalReviewStartedEvent {
  type: 'final-review-started';
  timestamp: string;
  data: {
    started_at: string;
    agent: AgentName;
    rejections: number;
    passed: boolean;
  };
}

export interface FinalReviewCompleteEvent {
  type: 'final-review-complete';
  timestamp: string;
  data: {
    started_at: string;
    completed_at?: string;
    agent: AgentName;
    passed: boolean;
    verdict?: string;
    rejections: number;
  };
}

export interface PostChecksStartedEvent {
  type: 'post-checks-started';
  timestamp: string;
  data: {
    started_at: string;
    passed: boolean;
    results: {
      lint: CheckResult;
      typecheck: CheckResult;
      test: CheckResult;
      build: CheckResult;
    };
  };
}

export interface PostCheckUpdateEvent {
  type: 'post-check-update';
  timestamp: string;
  data: {
    check: 'lint' | 'typecheck' | 'test' | 'build';
    status: CheckResultStatus;
    completed_at?: string;
  };
}

export interface PostChecksCompleteEvent {
  type: 'post-checks-complete';
  timestamp: string;
  data: {
    started_at: string;
    completed_at?: string;
    passed: boolean;
    results: {
      lint: CheckResult;
      typecheck: CheckResult;
      test: CheckResult;
      build: CheckResult;
    };
  };
}

export interface DocumentationStartedEvent {
  type: 'documentation-started';
  timestamp: string;
  data: {
    started_at: string;
    agent: AgentName;
    completed: boolean;
    files_modified: string[];
  };
}

export interface DocumentationCompleteEvent {
  type: 'documentation-complete';
  timestamp: string;
  data: {
    started_at: string;
    completed_at?: string;
    agent: AgentName;
    completed: boolean;
    files_modified: string[];
    commit?: string;
    summary?: string;
  };
}

export interface HookEventNotification {
  type: 'hook-event';
  timestamp: string;
  data: import('./hook-event').HookEventSummary | import('./hook-event').HookEventSummary[];
}

export interface MissionTokenUsageEvent {
  type: 'mission-token-usage';
  timestamp: string;
  data: {
    missionId: string;
    agents: MissionTokenUsageData[];
    totals: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      estimatedCostUsd: number;
    };
  };
}

export type BoardEvent =
  | ItemAddedEvent
  | ItemMovedEvent
  | ItemUpdatedEvent
  | ItemDeletedEvent
  | BoardUpdatedEvent
  | ActivityEntryAddedEvent
  | HookEventNotification
  | MissionCompletedEvent
  | MissionTokenUsageEvent
  | FinalReviewStartedEvent
  | FinalReviewCompleteEvent
  | PostChecksStartedEvent
  | PostCheckUpdateEvent
  | PostChecksCompleteEvent
  | DocumentationStartedEvent
  | DocumentationCompleteEvent;

// Theme color types for dark mode
export interface ThemeColors {
  background: {
    primary: string;
    cards: string;
    columns: string;
  };
  text: {
    primary: string;
    secondary: string;
  };
  accent: {
    success: string;
    warning: string;
    active: string;
    idle: string;
  };
}

// Dark mode color palette matching PRD specification
export const DARK_THEME_COLORS: ThemeColors = {
  background: {
    primary: '#1a1a1a',
    cards: '#2a2a2a',
    columns: '#242424',
  },
  text: {
    primary: '#ffffff',
    secondary: '#a0a0a0',
  },
  accent: {
    success: '#22c55e',
    warning: '#f59e0b',
    active: '#ef4444',
    idle: '#6b7280',
  },
} as const;

// Work item type badge colors
export type WorkItemTypeBadgeColor = {
  [K in WorkItemType]: string;
};

export const WORK_ITEM_TYPE_BADGE_COLORS: WorkItemTypeBadgeColor = {
  implementation: '#22c55e',
  integration: '#3b82f6',
  interface: '#8b5cf6',
  test: '#eab308',
} as const;

// Tab notification types for Human Input tab indicator
export interface TabNotificationProps {
  hasNotification: boolean;
  count?: number;
}

// Notification dot/badge component props
export interface NotificationDotProps {
  visible: boolean;
  count?: number;
  className?: string;
}

/**
 * Connection status values for SSE real-time connection state.
 * - 'connected': Active connection, receiving events (green indicator)
 * - 'connecting': Attempting to establish connection (yellow indicator)
 * - 'disconnected': No active connection (red indicator)
 * - 'error': Connection failed with error (red indicator + error message)
 */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/**
 * Props for the ConnectionStatusIndicator component.
 * Displays the real-time SSE connection state to users with visual feedback.
 */
export interface ConnectionStatusIndicatorProps {
  /** Current connection state */
  status: ConnectionStatus;
  /** Optional error details when status is 'error' */
  error?: Error | null;
  /** Optional additional CSS classes for styling */
  className?: string;
}

// Card animation types for movement between columns

/**
 * Animation state for a work item card.
 * - 'entering': Card is animating into a column
 * - 'exiting': Card is animating out of a column
 * - 'idle': Card is stationary, no animation
 */
export type CardAnimationState = 'entering' | 'exiting' | 'idle';

/**
 * Direction of card animation movement.
 * - 'left': Moving toward a column on the left
 * - 'right': Moving toward a column on the right
 * - 'none': No directional animation
 */
export type CardAnimationDirection = 'left' | 'right' | 'none';

/**
 * Interface for tracking which items are currently animating.
 * Used by page.tsx to coordinate animation state across columns.
 */
export interface AnimatingItem {
  /** The work item ID being animated */
  itemId: string;
  /** Current animation state */
  state: CardAnimationState;
  /** Direction of movement */
  direction: CardAnimationDirection;
  /** Source stage (for exit animations) */
  fromStage?: Stage;
  /** Destination stage (for enter animations) */
  toStage?: Stage;
}
