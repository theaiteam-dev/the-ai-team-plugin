/**
 * Utility MCP tools.
 *
 * Provides helper functionality:
 * - deps_check: Validate dependency graph and detect cycles
 * - activity_log: Append structured JSON to activity feed
 * - log: Simple shorthand for activity logging
 */
import { z } from 'zod';
import type { ToolResponse } from '../lib/tool-response.js';
/**
 * Schema for deps_check tool input.
 */
export declare const DepsCheckSchema: z.ZodObject<{
    verbose: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    verbose?: boolean | undefined;
}, {
    verbose?: boolean | undefined;
}>;
/**
 * Schema for activity_log tool input.
 */
export declare const ActivityLogSchema: z.ZodObject<{
    agent: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    agent: string;
}, {
    message: string;
    agent: string;
}>;
/**
 * Schema for log tool input (simple shorthand).
 */
export declare const LogSchema: z.ZodObject<{
    agent: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
    agent: string;
}, {
    message: string;
    agent: string;
}>;
type DepsCheckInput = z.infer<typeof DepsCheckSchema>;
type ActivityLogInput = z.infer<typeof ActivityLogSchema>;
type LogInput = z.infer<typeof LogSchema>;
interface DepsCheckResponse {
    valid: boolean;
    totalItems: number;
    cycles: string[][];
    depths: Record<string, number>;
    maxDepth: number;
    parallelWaves: number;
    readyItems: string[];
    validationErrors?: Array<{
        item: string;
        error: string;
        dependency?: string;
        message: string;
    }>;
    waves?: Record<string, string[]>;
    graph?: Record<string, string[]>;
    message?: string;
}
interface ActivityLogResponse {
    success: boolean;
    logged: {
        timestamp: string;
        agent: string;
        message: string;
    };
}
/**
 * Schema for plugin_root tool input (no parameters needed).
 */
export declare const PluginRootSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
type PluginRootInput = z.infer<typeof PluginRootSchema>;
/**
 * Returns the absolute path to the plugin root directory.
 * Derives this from the MCP server's own file location.
 */
export declare function pluginRoot(_input: PluginRootInput): Promise<ToolResponse<{
    path: string;
}>>;
/**
 * Validates the dependency graph and detects cycles.
 */
export declare function depsCheck(input: DepsCheckInput): Promise<ToolResponse<DepsCheckResponse>>;
/**
 * Appends structured JSON to activity feed.
 */
export declare function activityLog(input: ActivityLogInput): Promise<ToolResponse<ActivityLogResponse>>;
/**
 * Simple shorthand for activity logging.
 */
export declare function log(input: LogInput): Promise<ToolResponse<ActivityLogResponse>>;
/**
 * Tool definitions for MCP server registration.
 * Each tool includes the original Zod schema for use with McpServer.tool() API.
 */
export declare const utilsTools: ({
    name: string;
    description: string;
    inputSchema: object;
    zodSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    handler: typeof pluginRoot;
} | {
    name: string;
    description: string;
    inputSchema: object;
    zodSchema: z.ZodObject<{
        verbose: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        verbose?: boolean | undefined;
    }, {
        verbose?: boolean | undefined;
    }>;
    handler: typeof depsCheck;
} | {
    name: string;
    description: string;
    inputSchema: object;
    zodSchema: z.ZodObject<{
        agent: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        message: string;
        agent: string;
    }, {
        message: string;
        agent: string;
    }>;
    handler: typeof activityLog;
})[];
export {};
//# sourceMappingURL=utils.d.ts.map