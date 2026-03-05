/**
 * Hook Event Types
 *
 * Types for hook event summaries emitted via SSE.
 */

/**
 * Summary of a hook event for real-time display.
 * Excludes the full payload field to keep SSE messages lightweight.
 */
export interface HookEventSummary {
  id: number;
  eventType: string;
  agentName: string;
  toolName?: string;
  status: string;
  durationMs?: number;
  summary: string;
  correlationId?: string;
  timestamp: Date;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  model?: string;
}
