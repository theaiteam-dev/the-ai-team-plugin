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
import { type McpErrorResponse } from '../lib/errors.js';
import type { ToolResponse } from '../lib/tool-response.js';
/**
 * Schema for mission_init tool input.
 */
export declare const MissionInitInputSchema: z.ZodObject<{
    name: z.ZodString;
    prdPath: z.ZodString;
    force: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    prdPath: string;
    force: boolean;
}, {
    name: string;
    prdPath: string;
    force?: boolean | undefined;
}>;
/**
 * Schema for mission_current tool input.
 */
export declare const MissionCurrentInputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
/**
 * Schema for mission_precheck tool input.
 * Accepts a pre-computed result from the caller — no shell execution here.
 */
export declare const MissionPrecheckInputSchema: z.ZodObject<{
    passed: z.ZodBoolean;
    blockers: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    output: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        timedOut: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }, {
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }>>>;
}, "strip", z.ZodTypeAny, {
    passed: boolean;
    blockers: string[];
    output: Record<string, {
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }>;
}, {
    passed: boolean;
    blockers?: string[] | undefined;
    output?: Record<string, {
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }> | undefined;
}>;
/**
 * Schema for mission_list tool input.
 */
export declare const MissionListInputSchema: z.ZodObject<{
    state: z.ZodOptional<z.ZodEnum<["initializing", "prechecking", "precheck_failure", "running", "postchecking", "completed", "failed", "archived"]>>;
}, "strip", z.ZodTypeAny, {
    state?: "failed" | "completed" | "initializing" | "prechecking" | "precheck_failure" | "running" | "postchecking" | "archived" | undefined;
}, {
    state?: "failed" | "completed" | "initializing" | "prechecking" | "precheck_failure" | "running" | "postchecking" | "archived" | undefined;
}>;
/**
 * Schema for mission_postcheck tool input.
 * Accepts a pre-computed result from the caller — no shell execution here.
 * Hannibal reads ateam.config.json, runs checks via Bash in the target project,
 * then passes results here.
 */
export declare const MissionPostcheckInputSchema: z.ZodObject<{
    passed: z.ZodBoolean;
    blockers: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    output: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        timedOut: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }, {
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }>>>;
}, "strip", z.ZodTypeAny, {
    passed: boolean;
    blockers: string[];
    output: Record<string, {
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }>;
}, {
    passed: boolean;
    blockers?: string[] | undefined;
    output?: Record<string, {
        stdout: string;
        stderr: string;
        timedOut: boolean;
    }> | undefined;
}>;
/**
 * Schema for mission_archive tool input.
 */
export declare const MissionArchiveInputSchema: z.ZodObject<{
    itemIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    complete: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    dryRun: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    complete: boolean;
    dryRun: boolean;
    itemIds?: string[] | undefined;
}, {
    itemIds?: string[] | undefined;
    complete?: boolean | undefined;
    dryRun?: boolean | undefined;
}>;
type MissionInitInput = z.infer<typeof MissionInitInputSchema>;
type MissionCurrentInput = z.infer<typeof MissionCurrentInputSchema>;
type MissionPrecheckInput = z.infer<typeof MissionPrecheckInputSchema>;
type MissionPostcheckInput = z.input<typeof MissionPostcheckInputSchema>;
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
    checks: Array<{
        name: string;
        passed: boolean;
    }>;
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
    data: {
        passed: boolean;
        lintErrors: number;
        unitTestsPassed: number;
        unitTestsFailed: number;
        e2eTestsPassed: number;
        e2eTestsFailed: number;
        blockers: string[];
    };
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
/**
 * Creates a new mission directory structure.
 */
export declare function missionInit(input: MissionInitInput): Promise<ToolResponse<MissionInitResult> | McpErrorResponse>;
/**
 * Returns active mission metadata.
 */
export declare function missionCurrent(input: MissionCurrentInput): Promise<ToolResponse<MissionCurrentResult> | McpErrorResponse>;
/**
 * Accepts a pre-computed precheck result and forwards it to the API.
 * The caller runs lint/tests and passes { passed, blockers, output }.
 */
export declare function missionPrecheck(input: MissionPrecheckInput): Promise<ToolResponse<MissionPrecheckResult> | McpErrorResponse>;
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
export declare function missionList(input: MissionListInput): Promise<ToolResponse<MissionListResult> | McpErrorResponse>;
/**
 * Records pre-computed post-completion check results.
 * The caller (Hannibal) runs checks via Bash in the target project first,
 * then passes results here to update mission state.
 */
export declare function missionPostcheck(input: MissionPostcheckInput): Promise<ToolResponse<MissionPostcheckResult> | McpErrorResponse>;
/**
 * Moves completed mission items to archive.
 */
export declare function missionArchive(input: MissionArchiveInput): Promise<ToolResponse<MissionArchiveResult> | McpErrorResponse>;
/**
 * Tool definitions for MCP server registration.
 * Each tool includes the original Zod schema for use with McpServer.tool() API.
 */
export declare const missionTools: ({
    name: string;
    description: string;
    inputSchema: object;
    zodSchema: z.ZodObject<{
        name: z.ZodString;
        prdPath: z.ZodString;
        force: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        prdPath: string;
        force: boolean;
    }, {
        name: string;
        prdPath: string;
        force?: boolean | undefined;
    }>;
    handler: typeof missionInit;
} | {
    name: string;
    description: string;
    inputSchema: object;
    zodSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    handler: typeof missionCurrent;
} | {
    name: string;
    description: string;
    inputSchema: object;
    zodSchema: z.ZodObject<{
        passed: z.ZodBoolean;
        blockers: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        output: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            stdout: z.ZodString;
            stderr: z.ZodString;
            timedOut: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            stdout: string;
            stderr: string;
            timedOut: boolean;
        }, {
            stdout: string;
            stderr: string;
            timedOut: boolean;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        passed: boolean;
        blockers: string[];
        output: Record<string, {
            stdout: string;
            stderr: string;
            timedOut: boolean;
        }>;
    }, {
        passed: boolean;
        blockers?: string[] | undefined;
        output?: Record<string, {
            stdout: string;
            stderr: string;
            timedOut: boolean;
        }> | undefined;
    }>;
    handler: typeof missionPrecheck;
} | {
    name: string;
    description: string;
    inputSchema: object;
    zodSchema: z.ZodObject<{
        passed: z.ZodBoolean;
        blockers: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        output: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            stdout: z.ZodString;
            stderr: z.ZodString;
            timedOut: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            stdout: string;
            stderr: string;
            timedOut: boolean;
        }, {
            stdout: string;
            stderr: string;
            timedOut: boolean;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        passed: boolean;
        blockers: string[];
        output: Record<string, {
            stdout: string;
            stderr: string;
            timedOut: boolean;
        }>;
    }, {
        passed: boolean;
        blockers?: string[] | undefined;
        output?: Record<string, {
            stdout: string;
            stderr: string;
            timedOut: boolean;
        }> | undefined;
    }>;
    handler: typeof missionPostcheck;
} | {
    name: string;
    description: string;
    inputSchema: object;
    zodSchema: z.ZodObject<{
        itemIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        complete: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        dryRun: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        complete: boolean;
        dryRun: boolean;
        itemIds?: string[] | undefined;
    }, {
        itemIds?: string[] | undefined;
        complete?: boolean | undefined;
        dryRun?: boolean | undefined;
    }>;
    handler: typeof missionArchive;
} | {
    name: string;
    description: string;
    inputSchema: object;
    zodSchema: z.ZodObject<{
        state: z.ZodOptional<z.ZodEnum<["initializing", "prechecking", "precheck_failure", "running", "postchecking", "completed", "failed", "archived"]>>;
    }, "strip", z.ZodTypeAny, {
        state?: "failed" | "completed" | "initializing" | "prechecking" | "precheck_failure" | "running" | "postchecking" | "archived" | undefined;
    }, {
        state?: "failed" | "completed" | "initializing" | "prechecking" | "precheck_failure" | "running" | "postchecking" | "archived" | undefined;
    }>;
    handler: typeof missionList;
})[];
export {};
//# sourceMappingURL=missions.d.ts.map