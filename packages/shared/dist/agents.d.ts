export declare const VALID_AGENTS: readonly ["murdock", "ba", "lynch", "amy", "hannibal", "face", "sosa", "tawnia", "stockwell"];
export type AgentId = (typeof VALID_AGENTS)[number];
export declare const AGENT_DISPLAY_NAMES: Record<AgentId, string>;
export declare function normalizeAgentName(raw: string): string;
export declare function isValidAgent(name: string): name is AgentId;
