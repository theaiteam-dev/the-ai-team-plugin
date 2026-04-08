/**
 * Agent lifecycle MCP tools.
 *
 * Provides tools for managing agent work sessions:
 * - agent_start: Claims an item and writes assigned_agent to frontmatter
 * - agent_stop: Signals completion and adds work summary to work_log
 */
import { z } from 'zod';
import type { ToolResponse } from '../lib/tool-response.js';
/**
 * Input schema for agent_start tool.
 */
export declare const AgentStartSchema: z.ZodObject<{
    itemId: z.ZodString;
    agent: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
    task_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    itemId: string;
    agent: string;
    task_id?: string | undefined;
}, {
    itemId: string;
    agent: string;
    task_id?: string | undefined;
}>;
export type AgentStartInput = z.infer<typeof AgentStartSchema>;
/**
 * Input schema for agent_stop tool.
 */
export declare const AgentStopSchema: z.ZodObject<{
    itemId: z.ZodString;
    agent: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
    status: z.ZodEnum<["success", "failed"]>;
    summary: z.ZodString;
    files_created: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    files_modified: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    status: "success" | "failed";
    itemId: string;
    agent: string;
    summary: string;
    files_created?: string[] | undefined;
    files_modified?: string[] | undefined;
}, {
    status: "success" | "failed";
    itemId: string;
    agent: string;
    summary: string;
    files_created?: string[] | undefined;
    files_modified?: string[] | undefined;
}>;
export type AgentStopInput = z.infer<typeof AgentStopSchema>;
/**
 * Claims an item and writes assigned_agent to frontmatter.
 *
 * @param input - The agent start input parameters
 * @returns MCP tool response with success/error information
 */
export declare function agentStart(input: AgentStartInput): Promise<ToolResponse>;
/**
 * Signals completion and adds work summary to work_log.
 *
 * @param input - The agent stop input parameters
 * @returns MCP tool response with success/error information
 */
export declare function agentStop(input: AgentStopInput): Promise<ToolResponse>;
/**
 * Tool definitions for MCP server registration.
 * Each tool includes the original Zod schema for use with McpServer.tool() API.
 */
export declare const agentTools: ({
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            itemId: {
                type: string;
                description: string;
            };
            agent: {
                type: string;
                description: string;
                enum: readonly ["murdock", "ba", "lynch", "amy", "hannibal", "face", "sosa", "tawnia", "stockwell"];
            };
            task_id: {
                type: string;
                description: string;
            };
            status?: undefined;
            summary?: undefined;
            files_created?: undefined;
            files_modified?: undefined;
        };
        required: string[];
    };
    zodSchema: z.ZodObject<{
        itemId: z.ZodString;
        agent: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
        task_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        itemId: string;
        agent: string;
        task_id?: string | undefined;
    }, {
        itemId: string;
        agent: string;
        task_id?: string | undefined;
    }>;
    handler: typeof agentStart;
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            itemId: {
                type: string;
                description: string;
            };
            agent: {
                type: string;
                description: string;
                enum: readonly ["murdock", "ba", "lynch", "amy", "hannibal", "face", "sosa", "tawnia", "stockwell"];
            };
            status: {
                type: string;
                description: string;
                enum: string[];
            };
            summary: {
                type: string;
                description: string;
            };
            files_created: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            files_modified: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            task_id?: undefined;
        };
        required: string[];
    };
    zodSchema: z.ZodObject<{
        itemId: z.ZodString;
        agent: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
        status: z.ZodEnum<["success", "failed"]>;
        summary: z.ZodString;
        files_created: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        files_modified: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        status: "success" | "failed";
        itemId: string;
        agent: string;
        summary: string;
        files_created?: string[] | undefined;
        files_modified?: string[] | undefined;
    }, {
        status: "success" | "failed";
        itemId: string;
        agent: string;
        summary: string;
        files_created?: string[] | undefined;
        files_modified?: string[] | undefined;
    }>;
    handler: typeof agentStop;
})[];
//# sourceMappingURL=agents.d.ts.map