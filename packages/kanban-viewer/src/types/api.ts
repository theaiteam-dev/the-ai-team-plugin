/**
 * API request/response types for the Kanban Viewer API layer.
 *
 * These types define the contracts for all API endpoints
 * as specified in PRD 013-mcp-interface.md.
 */

import type { BoardState, StageId, WipStatus } from './board';
import type { Item, ItemType, ItemPriority, ItemWithRelations, WorkLogEntry, ItemOutputs } from './item';
import type { AgentName, AgentClaim } from './agent';
import type { Mission, PrecheckResult, PostcheckResult } from './mission';

// ============ Board Endpoints ============

/**
 * GET /api/board - Response with full board state.
 */
export interface GetBoardResponse {
  success: true;
  data: BoardState;
}

/**
 * POST /api/board/move - Request to move an item between stages.
 */
export interface MoveItemRequest {
  itemId: string;
  toStage: StageId;
  force?: boolean;
}

/**
 * POST /api/board/move - Response after moving an item.
 */
export interface MoveItemResponse {
  success: true;
  data: {
    item: Item;
    previousStage: StageId;
    wipStatus: WipStatus;
  };
}

/**
 * POST /api/board/claim - Request to claim an item for an agent.
 */
export interface ClaimItemRequest {
  itemId: string;
  agent: AgentName;
}

/**
 * POST /api/board/claim - Response with claim details.
 */
export interface ClaimItemResponse {
  success: true;
  data: AgentClaim;
}

/**
 * POST /api/board/release - Request to release an item claim.
 */
export interface ReleaseItemRequest {
  itemId: string;
}

/**
 * POST /api/board/release - Response after releasing a claim.
 *
 * When `released: true`, `agent` contains the name of the agent whose claim was released.
 * When `released: false` (idempotent no-op), `agent` is null since no claim existed.
 */
export interface ReleaseItemResponse {
  success: true;
  data: {
    released: boolean;
    agent: AgentName | null;
  };
}

// ============ Item Endpoints ============

/**
 * POST /api/items - Request to create a new item.
 */
export interface CreateItemRequest {
  title: string;
  description: string;
  objective: string;
  acceptance: string[];
  context: string;
  type: ItemType;
  priority: ItemPriority;
  dependencies?: string[];
  outputs?: ItemOutputs;
}

/**
 * POST /api/items - Response with created item.
 */
export interface CreateItemResponse {
  success: true;
  data: ItemWithRelations;
}

/**
 * PATCH /api/items/[id] - Request to update an item.
 */
export interface UpdateItemRequest {
  title?: string;
  description?: string;
  objective?: string;
  acceptance?: string[];
  context?: string;
  type?: ItemType;
  priority?: ItemPriority;
  dependencies?: string[];
  outputs?: ItemOutputs;
}

/**
 * PATCH /api/items/[id] - Response with updated item.
 */
export interface UpdateItemResponse {
  success: true;
  data: ItemWithRelations;
}

/**
 * POST /api/items/[id]/reject - Request to reject an item.
 */
export interface RejectItemRequest {
  reason: string;
  agent: AgentName;
}

/**
 * POST /api/items/[id]/reject - Response after rejecting an item.
 */
export interface RejectItemResponse {
  success: true;
  data: {
    item: Item;
    escalated: boolean;
    rejectionCount: number;
  };
}

/**
 * GET /api/items/[id]/render - Response with rendered markdown.
 */
export interface RenderItemResponse {
  success: true;
  data: {
    markdown: string;
  };
}

// ============ Agent Endpoints ============

/**
 * POST /api/agents/start - Request to start work on an item.
 */
export interface AgentStartRequest {
  itemId: string;
  agent: AgentName;
}

/**
 * POST /api/agents/start - Response with agent start details.
 */
export interface AgentStartResponse {
  success: true;
  data: {
    itemId: string;
    agent: AgentName;
    item: ItemWithRelations;
    claimedAt: Date;
  };
}

/**
 * POST /api/agents/stop - Request to stop work on an item.
 */
export interface AgentStopRequest {
  itemId: string;
  agent: AgentName;
  summary: string;
  outcome?: 'completed' | 'blocked';
  advance?: boolean;
}

/**
 * POST /api/agents/stop - Response with agent stop details.
 */
export interface AgentStopResponse {
  success: true;
  data: {
    itemId: string;
    agent: AgentName;
    workLogEntry: WorkLogEntry;
    nextStage: StageId | null;
    wipExceeded?: boolean;
    blockedStage?: StageId;
  };
}

// ============ Mission Endpoints ============

/**
 * POST /api/missions - Request to create a new mission.
 */
export interface CreateMissionRequest {
  name: string;
  prdPath: string;
  force?: boolean;
}

/**
 * POST /api/missions - Response with created mission.
 */
export interface CreateMissionResponse {
  success: true;
  data: Mission;
}

/**
 * GET /api/missions/current - Response with current mission.
 */
export interface GetCurrentMissionResponse {
  success: true;
  data: Mission | null;
}

/**
 * POST /api/missions/precheck - Response with precheck results.
 */
export interface PrecheckResponse {
  success: true;
  data: PrecheckResult;
}

/**
 * POST /api/missions/postcheck - Response with postcheck results.
 */
export interface PostcheckResponse {
  success: true;
  data: PostcheckResult;
}

/**
 * POST /api/missions/archive - Response with archived mission details.
 */
export interface ArchiveMissionResponse {
  success: true;
  data: {
    mission: Mission;
    archivedItems: number;
  };
}

// ============ Utility Endpoints ============

/**
 * GET /api/deps/check - Response with dependency validation results.
 */
export interface DepsCheckResponse {
  success: true;
  data: {
    valid: boolean;
    cycles: string[][];
    readyItems: string[];
    blockedItems: string[];
  };
}

/**
 * POST /api/activity - Request to log an activity entry.
 */
export interface LogActivityRequest {
  message: string;
  agent?: AgentName;
  level?: 'info' | 'warn' | 'error';
}

/**
 * POST /api/activity - Response after logging activity.
 */
export interface LogActivityResponse {
  success: true;
  data: {
    logged: boolean;
    timestamp: Date;
  };
}

/**
 * Activity log entry for GetActivityResponse.
 */
export interface ActivityLogEntry {
  id: number;
  missionId: string | null;
  agent: string | null;
  message: string;
  level: 'info' | 'warn' | 'error';
  timestamp: Date;
}

/**
 * GET /api/activity - Response with activity log entries.
 */
export interface GetActivityResponse {
  success: true;
  data: {
    entries: ActivityLogEntry[];
  };
}

// ============ Project Types ============

/**
 * Project entity for multi-project support.
 */
export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * GET /api/projects - Response with list of projects.
 */
export interface GetProjectsResponse {
  success: true;
  data: Project[];
}

/**
 * POST /api/projects - Request to create a new project.
 */
export interface CreateProjectRequest {
  id: string;
  name: string;
}

/**
 * POST /api/projects - Response with created project.
 */
export interface CreateProjectResponse {
  success: true;
  data: Project;
}

// ============ Error Response ============

/**
 * Standard API error response.
 */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Generic API response type - either success or error.
 */
export type ApiResponse<T> = T | ApiError;
