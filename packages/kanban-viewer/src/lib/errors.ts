/**
 * API Error types and factory functions for the Kanban Viewer API layer.
 *
 * Provides standardized error handling with consistent error codes
 * and response formats as specified in PRD 013-mcp-interface.md.
 */

import { ERROR_CODES as SHARED_ERROR_CODES } from '@ai-team/shared';

/**
 * Error codes for all API errors.
 * These codes should be used for programmatic error handling.
 *
 * Combines shared error codes with kanban-viewer-specific codes.
 */
export const ErrorCodes = {
  ...SHARED_ERROR_CODES,
  // Stage / transition errors
  INVALID_STAGE: 'INVALID_STAGE',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  // Dependency errors
  DEPENDENCY_CYCLE: 'DEPENDENCY_CYCLE',
  DEPENDENCIES_NOT_MET: 'DEPENDENCIES_NOT_MET',
  OUTPUT_COLLISION: 'OUTPUT_COLLISION',
  // Claim / agent errors
  CLAIM_CONFLICT: 'CLAIM_CONFLICT',
  ITEM_CLAIMED: 'ITEM_CLAIMED',
  NOT_CLAIMED: 'NOT_CLAIMED',
  CLAIM_MISMATCH: 'CLAIM_MISMATCH',
  // Mission errors
  NO_ACTIVE_MISSION: 'NO_ACTIVE_MISSION',
  INVALID_MISSION_STATE: 'INVALID_MISSION_STATE',
  // Resource not found
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  STAGE_NOT_FOUND: 'STAGE_NOT_FOUND',
  // Generic
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SERVER_ERROR: 'SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Canonical HTTP status code for each error code.
 * Route handlers use this instead of hardcoding status numbers.
 */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  // 400 Bad Request
  [ErrorCodes.VALIDATION_ERROR]: 400,
  [ErrorCodes.INVALID_TRANSITION]: 400,
  [ErrorCodes.WIP_LIMIT_EXCEEDED]: 400,
  [ErrorCodes.AGENT_BUSY]: 400,
  [ErrorCodes.DEPS_NOT_MET]: 400,
  [ErrorCodes.MISSION_ALREADY_ACTIVE]: 409,
  [ErrorCodes.INVALID_STAGE]: 400,
  [ErrorCodes.DEPENDENCY_CYCLE]: 400,
  [ErrorCodes.DEPENDENCIES_NOT_MET]: 400,
  [ErrorCodes.OUTPUT_COLLISION]: 400,
  [ErrorCodes.NOT_CLAIMED]: 400,
  [ErrorCodes.INVALID_MISSION_STATE]: 400,
  // 403 Forbidden
  [ErrorCodes.UNAUTHORIZED]: 403,
  [ErrorCodes.CLAIM_MISMATCH]: 403,
  // 404 Not Found
  [ErrorCodes.ITEM_NOT_FOUND]: 404,
  [ErrorCodes.MISSION_NOT_FOUND]: 404,
  [ErrorCodes.NO_ACTIVE_MISSION]: 404,
  [ErrorCodes.PROJECT_NOT_FOUND]: 404,
  [ErrorCodes.STAGE_NOT_FOUND]: 404,
  // 409 Conflict
  [ErrorCodes.CLAIM_CONFLICT]: 409,
  [ErrorCodes.ITEM_CLAIMED]: 409,
  [ErrorCodes.CONFLICT]: 409,
  // 500 Internal Server Error
  [ErrorCodes.SERVER_ERROR]: 500,
  [ErrorCodes.DATABASE_ERROR]: 500,
};

/**
 * API error response format for serialization.
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Custom error class for API errors.
 * Extends Error with code, HTTP status, details, and serialization support.
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code as ErrorCode] ?? 500;
    this.details = details;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * Serialize error to API response format.
   */
  toResponse(): ApiErrorResponse {
    const response: ApiErrorResponse = {
      success: false,
      error: {
        code: this.code,
        message: this.message,
      },
    };

    if (this.details !== undefined) {
      response.error.details = this.details;
    }

    return response;
  }
}

// ============ Error Factory Functions ============

/**
 * Create an error for when an item is not found.
 */
export function createItemNotFoundError(itemId: string): ApiError {
  return new ApiError(
    ErrorCodes.ITEM_NOT_FOUND,
    `Item ${itemId} not found`,
    { itemId }
  );
}

/**
 * Create an error for invalid stage transitions.
 */
export function createInvalidTransitionError(from: string, to: string): ApiError {
  return new ApiError(
    ErrorCodes.INVALID_TRANSITION,
    `Invalid transition from ${from} to ${to}`,
    { from, to }
  );
}

/**
 * Create an error for WIP limit exceeded.
 */
export function createWipLimitExceededError(
  stageId: string,
  limit: number,
  current: number
): ApiError {
  return new ApiError(
    ErrorCodes.WIP_LIMIT_EXCEEDED,
    `WIP limit exceeded for stage ${stageId}: limit is ${limit}, current is ${current}`,
    { stageId, limit, current }
  );
}

/**
 * Create an error for dependency cycles.
 */
export function createDependencyCycleError(cycle: string[]): ApiError {
  return new ApiError(
    ErrorCodes.DEPENDENCY_CYCLE,
    `Dependency cycle detected: ${cycle.join(' -> ')}`,
    { cycle }
  );
}

/**
 * Create a generic validation error.
 */
export function createValidationError(message: string, details?: unknown): ApiError {
  return new ApiError(ErrorCodes.VALIDATION_ERROR, message, details);
}

/**
 * Create an unauthorized error.
 */
export function createUnauthorizedError(message?: string): ApiError {
  return new ApiError(
    ErrorCodes.UNAUTHORIZED,
    message ?? 'Unauthorized'
  );
}

/**
 * Create a server error.
 */
export function createServerError(message?: string): ApiError {
  return new ApiError(
    ErrorCodes.SERVER_ERROR,
    message ?? 'Internal server error'
  );
}

/**
 * Create a database error with optional details from the caught exception.
 */
export function createDatabaseError(message: string, error?: unknown): ApiError {
  const details = error instanceof Error ? error.message : error !== undefined ? String(error) : undefined;
  return new ApiError(ErrorCodes.DATABASE_ERROR, message, details);
}

/**
 * Create an error for invalid stage operations.
 */
export function createInvalidStageError(
  currentStage: string,
  requiredStage: string,
  message?: string
): ApiError {
  return new ApiError(
    ErrorCodes.INVALID_STAGE,
    message ?? `Item must be in ${requiredStage} stage to be rejected`,
    { currentStage, requiredStage }
  );
}

/**
 * Collision information for the output collision error.
 */
export interface OutputCollisionDetail {
  /** The file path that has a collision */
  file: string;
  /** Item IDs that share this output path without a dependency relationship */
  items: string[];
}

/**
 * Create an error for output file collisions between items.
 *
 * This error is raised when two or more items share the same output file path
 * but do not have a dependency relationship, which could cause parallel write
 * conflicts during execution.
 */
export function createOutputCollisionError(
  collisions: OutputCollisionDetail[]
): ApiError {
  const fileList = collisions.map((c) => c.file).join(', ');
  return new ApiError(
    ErrorCodes.OUTPUT_COLLISION,
    `Output file collision detected: ${fileList}. Items sharing output files must have a dependency relationship.`,
    { collisions }
  );
}

/**
 * Create an error for claim conflicts during concurrent operations.
 *
 * This error occurs when an item is claimed by another agent during
 * a concurrent claim request (race condition detected via unique constraint).
 */
export function createClaimConflictError(itemId: string): ApiError {
  return new ApiError(
    ErrorCodes.CLAIM_CONFLICT,
    'Item was claimed by another agent during this request',
    { itemId }
  );
}

/**
 * Create an error when an item is already claimed by an agent.
 */
export function createItemClaimedError(itemId: string, claimedBy: string): ApiError {
  return new ApiError(
    ErrorCodes.ITEM_CLAIMED,
    `Item ${itemId} is already claimed by ${claimedBy}`,
    { itemId, claimedBy }
  );
}

/**
 * Create an error when trying to release/stop a claim that does not exist.
 */
export function createNotClaimedError(itemId: string): ApiError {
  return new ApiError(
    ErrorCodes.NOT_CLAIMED,
    `Item ${itemId} is not currently claimed`,
    { itemId }
  );
}

/**
 * Create an error when an agent tries to stop work on an item claimed by a different agent.
 */
export function createClaimMismatchError(itemId: string, claimedBy: string, requestedBy: string): ApiError {
  return new ApiError(
    ErrorCodes.CLAIM_MISMATCH,
    `Item ${itemId} is claimed by ${claimedBy}, not ${requestedBy}`,
    { itemId, claimedBy, requestedBy }
  );
}

/**
 * Create an error when no active mission exists for an operation that requires one.
 */
export function createNoActiveMissionError(): ApiError {
  return new ApiError(
    ErrorCodes.NO_ACTIVE_MISSION,
    'No active mission found'
  );
}

/**
 * Create an error when a mission is in the wrong state for an operation.
 */
export function createInvalidMissionStateError(currentState: string, requiredStates: string[]): ApiError {
  return new ApiError(
    ErrorCodes.INVALID_MISSION_STATE,
    `Mission is in state '${currentState}', expected one of: ${requiredStates.join(', ')}`,
    { currentState, requiredStates }
  );
}

/**
 * Create a generic conflict error (e.g. duplicate resource).
 */
export function createConflictError(message: string, details?: unknown): ApiError {
  return new ApiError(ErrorCodes.CONFLICT, message, details);
}

/**
 * Create an error when a project is not found.
 */
export function createProjectNotFoundError(projectId: string): ApiError {
  return new ApiError(
    ErrorCodes.PROJECT_NOT_FOUND,
    `Project '${projectId}' not found`,
    { projectId }
  );
}

/**
 * Create an error when a stage is not found.
 */
export function createStageNotFoundError(stageId: string): ApiError {
  return new ApiError(
    ErrorCodes.STAGE_NOT_FOUND,
    `Stage '${stageId}' not found`,
    { stageId }
  );
}

/**
 * Create an error when item dependencies are not yet in the done stage.
 */
export function createDependenciesNotMetError(itemId: string, unmetDependencies: string[]): ApiError {
  return new ApiError(
    ErrorCodes.DEPENDENCIES_NOT_MET,
    `Item ${itemId} has unmet dependencies: ${unmetDependencies.join(', ')}`,
    { itemId, unmetDependencies }
  );
}
