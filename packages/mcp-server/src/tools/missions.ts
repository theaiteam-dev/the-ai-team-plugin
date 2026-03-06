/**
 * Mission lifecycle MCP tools.
 *
 * Provides tools for managing mission lifecycle:
 * - mission_init: Create new mission directory structure
 * - mission_current: Return active mission metadata
 * - mission_precheck: Run configured pre-flight checks
 * - mission_postcheck: Run configured post-completion checks
 * - mission_archive: Move completed mission to archive
 */

import { z } from 'zod';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { createClient } from '../client/index.js';
import { config } from '../config.js';
import { withErrorBoundary, type McpErrorResponse } from '../lib/errors.js';
import { zodToJsonSchema } from '../lib/schema-utils.js';
import type { ToolResponse } from '../lib/tool-response.js';

// Initialize HTTP client
const client = createClient({
  baseUrl: config.apiUrl,
  projectId: config.projectId,
  apiKey: config.apiKey,
  timeout: config.timeout,
  retries: config.retries,
});

// ============================================================================
// Mission-Active Marker
// ============================================================================
// Marker file at /tmp/.ateam-mission-active-{projectId} tells enforcement
// hooks that a mission is running. Managed here (not via playbook Bash
// commands) so the guarantee is code-level, not LLM-instruction-level.

function missionMarkerPath(): string {
  return join(tmpdir(), `.ateam-mission-active-${config.projectId}`);
}

function setMissionActive(): void {
  const p = missionMarkerPath();
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, new Date().toISOString());
  } catch { /* non-blocking — hooks degrade gracefully without marker */ }
}

function clearMissionActive(): void {
  try {
    unlinkSync(missionMarkerPath());
  } catch { /* ignore — already cleared or never set */ }
}

// ============================================================================
// Zod Schemas for Input Validation
// ============================================================================

/**
 * Schema for mission_init tool input.
 */
export const MissionInitInputSchema = z.object({
  name: z.string().min(1),
  prdPath: z.string().min(1),
  force: z.boolean().optional().default(false),
});

/**
 * Schema for mission_current tool input.
 */
export const MissionCurrentInputSchema = z.object({});

/**
 * Schema for mission_precheck tool input.
 * Accepts a pre-computed result from the caller — no shell execution here.
 */
export const MissionPrecheckInputSchema = z.object({
  passed: z.boolean(),
  blockers: z.array(z.string()).default([]),
  output: z.object({
    lint: z.object({ stdout: z.string(), stderr: z.string(), timedOut: z.boolean() }).optional(),
    tests: z.object({ stdout: z.string(), stderr: z.string(), timedOut: z.boolean() }).optional(),
  }).default({}),
});

/**
 * Schema for mission_list tool input.
 */
export const MissionListInputSchema = z.object({
  state: z.enum(['initializing', 'prechecking', 'precheck_failure', 'running', 'postchecking', 'completed', 'failed', 'archived']).optional(),
});

/**
 * Schema for mission_postcheck tool input.
 */
export const MissionPostcheckInputSchema = z.object({
  checks: z.array(z.string()).optional(),
});

/**
 * Schema for mission_archive tool input.
 */
export const MissionArchiveInputSchema = z.object({
  itemIds: z.array(z.string()).optional(),
  complete: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
});

// ============================================================================
// Type Definitions
// ============================================================================

type MissionInitInput = z.infer<typeof MissionInitInputSchema>;
type MissionCurrentInput = z.infer<typeof MissionCurrentInputSchema>;
type MissionPrecheckInput = z.infer<typeof MissionPrecheckInputSchema>;
type MissionPostcheckInput = z.infer<typeof MissionPostcheckInputSchema>;
type MissionArchiveInput = z.infer<typeof MissionArchiveInputSchema>;
type MissionListInput = z.infer<typeof MissionListInputSchema>;

interface PreviousMission {
  name: string;
  archiveDir: string;
  itemCount: number;
}

interface MissionInitResult {
  success: boolean;
  initialized: boolean;
  missionName: string;
  archived: boolean;
  previousMission?: PreviousMission;
  directories?: string[];
}

interface Mission {
  name: string;
  status: string;
  created_at: string;
  postcheck: PostcheckInfo | null;
}

interface PostcheckInfo {
  timestamp: string;
  passed: boolean;
  checks: Array<{ name: string; passed: boolean }>;
}

interface Columns {
  briefings: string[];
  ready: string[];
  testing: string[];
  implementing: string[];
  review: string[];
  probing: string[];
  done: string[];
  blocked: string[];
}

interface MissionCurrentResult {
  success: boolean;
  mission: Mission;
  progress: {
    done: number;
    total: number;
  };
  wip: {
    current: number;
    limit: number;
  };
  columns: Columns;
}

interface CheckResult {
  name: string;
  command?: string;
  passed: boolean;
  error?: string;
}

interface MissionPrecheckResult {
  success: boolean;
  allPassed: boolean;
  checks: CheckResult[];
  skipped?: boolean;
  configSource?: string;
}

interface MissionPostcheckResult {
  success: boolean;
  allPassed: boolean;
  checks: CheckResult[];
  boardUpdated?: boolean;
}

interface MissionArchiveResult {
  success: boolean;
  archived?: number;
  wouldArchive?: number;
  destination?: string;
  items?: string[];
  missionComplete?: boolean;
  summary?: string;
  message?: string;
  dryRun?: boolean;
  activityLogArchived?: boolean;
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Creates a new mission directory structure.
 */
export async function missionInit(
  input: MissionInitInput
): Promise<ToolResponse<MissionInitResult> | McpErrorResponse> {
  const handler = async (args: MissionInitInput) => {
    const body: Record<string, unknown> = {
      name: args.name,
      prdPath: args.prdPath,
    };
    if (args.force !== undefined) {
      body.force = args.force;
    }

    const result = await client.post<MissionInitResult>('/api/missions', body);

    // Clear any stale mission-active marker from a previous crashed session.
    // Done AFTER the POST succeeds so we don't incorrectly clear the marker
    // when there's an actually-running mission and the POST throws.
    clearMissionActive();

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.data) }],
      data: result.data,
    };
  };

  return withErrorBoundary(handler)(input);
}

/**
 * Returns active mission metadata.
 */
export async function missionCurrent(
  input: MissionCurrentInput
): Promise<ToolResponse<MissionCurrentResult> | McpErrorResponse> {
  const handler = async (_args: MissionCurrentInput) => {
    const result = await client.get<MissionCurrentResult>('/api/missions/current');
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.data) }],
      data: result.data,
    };
  };

  return withErrorBoundary(handler)(input);
}

/**
 * Accepts a pre-computed precheck result and forwards it to the API.
 * The caller runs lint/tests and passes { passed, blockers, output }.
 */
export async function missionPrecheck(
  input: MissionPrecheckInput
): Promise<ToolResponse<MissionPrecheckResult> | McpErrorResponse> {
  const handler = async (args: MissionPrecheckInput) => {
    const result = await client.post<MissionPrecheckResult>('/api/missions/precheck', {
      passed: args.passed,
      blockers: args.blockers,
      output: args.output,
    });

    // Set mission-active marker when prechecks pass — signals enforcement
    // hooks that Hannibal's orchestration loop is about to start
    if (result.data.allPassed) {
      setMissionActive();
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.data) }],
      data: result.data,
    };
  };

  return withErrorBoundary(handler)(input);
}

interface MissionSummary {
  id: string;
  name: string;
  state: string;
  prdPath: string;
  startedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}

interface MissionListResult {
  success: boolean;
  data: MissionSummary[];
}

/**
 * Lists missions, optionally filtered by state.
 */
export async function missionList(
  input: MissionListInput
): Promise<ToolResponse<MissionListResult> | McpErrorResponse> {
  const handler = async (args: MissionListInput) => {
    const url = args.state ? `/api/missions?state=${args.state}` : '/api/missions';
    const result = await client.get<MissionListResult>(url);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.data) }],
      data: result.data,
    };
  };

  return withErrorBoundary(handler)(input);
}

/**
 * Runs configured post-completion checks.
 */
export async function missionPostcheck(
  input: MissionPostcheckInput
): Promise<ToolResponse<MissionPostcheckResult> | McpErrorResponse> {
  const handler = async (args: MissionPostcheckInput) => {
    const body: Record<string, unknown> = {};
    if (args.checks !== undefined) {
      body.checks = args.checks;
    }

    const result = await client.post<MissionPostcheckResult>('/api/missions/postcheck', body);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.data) }],
      data: result.data,
    };
  };

  return withErrorBoundary(handler)(input);
}

/**
 * Moves completed mission items to archive.
 */
export async function missionArchive(
  input: MissionArchiveInput
): Promise<ToolResponse<MissionArchiveResult> | McpErrorResponse> {
  const handler = async (args: MissionArchiveInput) => {
    const body: Record<string, unknown> = {};
    if (args.itemIds !== undefined) {
      body.itemIds = args.itemIds;
    }
    if (args.complete !== undefined) {
      body.complete = args.complete;
    }
    if (args.dryRun !== undefined) {
      body.dryRun = args.dryRun;
    }

    const result = await client.post<MissionArchiveResult>('/api/missions/archive', body);

    // Clear mission-active marker when the full mission is archived
    // (not for partial item archives or dry runs)
    if (args.complete && !args.dryRun && result.data.success) {
      clearMissionActive();
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.data) }],
      data: result.data,
    };
  };

  return withErrorBoundary(handler)(input);
}

// ============================================================================
// Tool Definitions for MCP Server Registration
// ============================================================================

/**
 * Tool definitions for MCP server registration.
 * Each tool includes the original Zod schema for use with McpServer.tool() API.
 */
export const missionTools = [
  {
    name: 'mission_init',
    description: 'Create a new mission. Requires name and prdPath. Use force flag to archive existing active mission.',
    inputSchema: zodToJsonSchema(MissionInitInputSchema),
    zodSchema: MissionInitInputSchema,
    handler: missionInit,
  },
  {
    name: 'mission_current',
    description: 'Return active mission metadata including progress, WIP limits, and column/phase information.',
    inputSchema: zodToJsonSchema(MissionCurrentInputSchema),
    zodSchema: MissionCurrentInputSchema,
    handler: missionCurrent,
  },
  {
    name: 'mission_precheck',
    description: 'Run configured pre-flight checks (lint, tests) before starting mission execution.',
    inputSchema: zodToJsonSchema(MissionPrecheckInputSchema),
    zodSchema: MissionPrecheckInputSchema,
    handler: missionPrecheck,
  },
  {
    name: 'mission_postcheck',
    description: 'Run configured post-completion checks (lint, unit tests, e2e) after all items are done.',
    inputSchema: zodToJsonSchema(MissionPostcheckInputSchema),
    zodSchema: MissionPostcheckInputSchema,
    handler: missionPostcheck,
  },
  {
    name: 'mission_archive',
    description: 'Move completed mission items to archive. Use complete flag to archive entire mission with summary.',
    inputSchema: zodToJsonSchema(MissionArchiveInputSchema),
    zodSchema: MissionArchiveInputSchema,
    handler: missionArchive,
  },
  {
    name: 'mission_list',
    description: 'List missions for the current project, optionally filtered by state.',
    inputSchema: zodToJsonSchema(MissionListInputSchema),
    zodSchema: MissionListInputSchema,
    handler: missionList,
  },
];
