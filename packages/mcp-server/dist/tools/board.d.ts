/**
 * Board Tools for the A(i)-Team MCP Server.
 * Provides MCP tools for managing the kanban board state.
 */
import { z } from 'zod';
import { BoardState, KanbanApiClient } from '../client/index.js';
import type { ToolResponse, ToolErrorResponse } from '../lib/tool-response.js';
/**
 * Zod schema for board_read input (empty object).
 */
export declare const BoardReadInputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
/**
 * Zod schema for board_move input.
 */
export declare const BoardMoveInputSchema: z.ZodObject<{
    itemId: z.ZodString;
    to: z.ZodString;
}, "strip", z.ZodTypeAny, {
    itemId: string;
    to: string;
}, {
    itemId: string;
    to: string;
}>;
/**
 * Zod schema for board_claim input.
 * Agent name accepts lowercase (murdock, ba, lynch, amy) and transforms to API format.
 */
export declare const BoardClaimInputSchema: z.ZodObject<{
    itemId: z.ZodString;
    agent: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
}, "strip", z.ZodTypeAny, {
    itemId: string;
    agent: string;
}, {
    itemId: string;
    agent: string;
}>;
/**
 * Zod schema for board_release input.
 */
export declare const BoardReleaseInputSchema: z.ZodObject<{
    itemId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    itemId: string;
}, {
    itemId: string;
}>;
/**
 * Input types derived from Zod schemas.
 */
export type BoardReadInput = z.infer<typeof BoardReadInputSchema>;
export type BoardMoveInput = z.infer<typeof BoardMoveInputSchema>;
export type BoardClaimInput = z.infer<typeof BoardClaimInputSchema>;
export type BoardReleaseInput = z.infer<typeof BoardReleaseInputSchema>;
/**
 * Result type for board_move operation.
 */
export interface MoveResult {
    success: boolean;
    itemId: string;
    from: string;
    to: string;
}
/**
 * Result type for board_claim operation.
 */
export interface ClaimResult {
    success: boolean;
    itemId: string;
    agent: string;
}
/**
 * Result type for board_release operation.
 */
export interface ReleaseResult {
    success: boolean;
    itemId: string;
}
export type { ToolResponse, ToolErrorResponse };
/**
 * Read the full board state.
 *
 * @param _input - Unused input parameter (required for MCP handler signature)
 * @returns The full board state as structured JSON
 */
export declare function boardRead(_input?: BoardReadInput): Promise<ToolResponse<BoardState>>;
/**
 * Move an item to a target stage.
 * Validates stage transitions and enforces WIP limits.
 *
 * @param input - The move parameters (itemId, to)
 * @param client - Optional HTTP client (uses default if not provided)
 * @returns The move result or validation error
 */
export declare function boardMove(input: BoardMoveInput, client?: KanbanApiClient): Promise<ToolResponse<MoveResult> | ToolErrorResponse>;
/**
 * Claim an item for an agent.
 * Detects and rejects conflicts when item is already claimed.
 *
 * @param input - The claim parameters (itemId, agent)
 * @param client - Optional HTTP client (uses default if not provided)
 * @returns The claim result or validation error
 */
export declare function boardClaim(input: BoardClaimInput, client?: KanbanApiClient): Promise<ToolResponse<ClaimResult> | ToolErrorResponse>;
/**
 * Release an item's agent assignment.
 * Handles unclaimed items gracefully (idempotent).
 *
 * @param input - The release parameters (itemId)
 * @param client - Optional HTTP client (uses default if not provided)
 * @returns The release result or validation error
 */
export declare function boardRelease(input: BoardReleaseInput, client?: KanbanApiClient): Promise<ToolResponse<ReleaseResult> | ToolErrorResponse>;
/**
 * Tool definitions for MCP registration.
 */
export declare const boardTools: {
    board_read: {
        name: string;
        description: string;
        inputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
        handler: typeof boardRead;
    };
    board_move: {
        name: string;
        description: string;
        inputSchema: z.ZodObject<{
            itemId: z.ZodString;
            to: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            itemId: string;
            to: string;
        }, {
            itemId: string;
            to: string;
        }>;
        handler: typeof boardMove;
    };
    board_claim: {
        name: string;
        description: string;
        inputSchema: z.ZodObject<{
            itemId: z.ZodString;
            agent: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
        }, "strip", z.ZodTypeAny, {
            itemId: string;
            agent: string;
        }, {
            itemId: string;
            agent: string;
        }>;
        handler: typeof boardClaim;
    };
    board_release: {
        name: string;
        description: string;
        inputSchema: z.ZodObject<{
            itemId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            itemId: string;
        }, {
            itemId: string;
        }>;
        handler: typeof boardRelease;
    };
};
//# sourceMappingURL=board.d.ts.map