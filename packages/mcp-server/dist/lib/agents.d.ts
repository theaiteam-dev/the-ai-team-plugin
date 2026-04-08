/**
 * Shared agent name validation module.
 *
 * Centralizes agent name constants, normalization, and Zod schema
 * used across board, agents, and utils tool modules.
 */
import { z } from 'zod';
import { normalizeAgentName as sharedNormalizeAgentName } from '@ai-team/shared';
/**
 * Valid agent names (lowercase for input validation).
 * Re-exported from @ai-team/shared for backward compatibility.
 */
export declare const VALID_AGENTS_LOWER: readonly ["murdock", "ba", "lynch", "amy", "hannibal", "face", "sosa", "tawnia", "stockwell"];
export type ValidAgentLower = (typeof VALID_AGENTS_LOWER)[number];
/**
 * Map from lowercase agent names to API-expected format.
 * Re-exported from @ai-team/shared for backward compatibility.
 */
export declare const AGENT_NAME_MAP: Record<"murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>;
/**
 * Normalize agent name to lowercase key format.
 * Handles special cases like "B.A." -> "ba"
 * Re-exported from @ai-team/shared.
 */
export declare const normalizeAgentName: typeof sharedNormalizeAgentName;
/**
 * Zod schema for agent name validation.
 * Accepts case-insensitive input, validates, and transforms to API format.
 */
export declare const AgentNameSchema: z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, "murdock" | "ba" | "lynch" | "amy" | "hannibal" | "face" | "sosa" | "tawnia" | "stockwell", string>, string, string>;
//# sourceMappingURL=agents.d.ts.map