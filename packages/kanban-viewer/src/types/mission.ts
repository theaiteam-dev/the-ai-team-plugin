/**
 * Mission-related types for the API layer.
 *
 * These types define mission lifecycle states, missions, and check results
 * for the new API layer as specified in PRD 013-mcp-interface.md.
 */

/**
 * Valid mission lifecycle states.
 */
export type MissionState =
  | 'initializing'
  | 'prechecking'
  | 'precheck_failure'
  | 'running'
  | 'postchecking'
  | 'completed'
  | 'failed'
  | 'archived';

/**
 * Precheck output capturing stdout/stderr from check runs.
 * Uses an index signature to allow arbitrary check names (e.g. lint, unit, e2e).
 */
export type MissionPrecheckOutput = {
  [key: string]: { stdout: string; stderr: string; timedOut: boolean } | undefined;
};

/**
 * Mission entity representing a PRD-driven work session.
 */
export interface Mission {
  id: string;
  name: string;
  state: MissionState;
  prdPath: string;
  startedAt: Date;
  completedAt: Date | null;
  archivedAt: Date | null;
  precheckBlockers?: string[] | null;
  precheckOutput?: MissionPrecheckOutput | null;
}

/**
 * Pre-mission check results.
 * Validates codebase state before mission execution begins.
 */
export interface PrecheckResult {
  passed: boolean;
  lintErrors: number;
  testsPassed: number;
  testsFailed: number;
  blockers: string[];
}

/**
 * Post-mission check results.
 * Validates codebase state after mission completion including E2E tests.
 */
export interface PostcheckResult {
  passed: boolean;
  lintErrors: number;
  unitTestsPassed: number;
  unitTestsFailed: number;
  e2eTestsPassed: number;
  e2eTestsFailed: number;
  blockers: string[];
}
