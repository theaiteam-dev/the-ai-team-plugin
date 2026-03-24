/**
 * Agent-related types for the API layer.
 *
 * These types define agent names and claims for the new API layer
 * as specified in PRD 013-mcp-interface.md.
 */

/**
 * Valid agent names for the A(i)-Team.
 */
export type AgentName =
  | 'Hannibal'
  | 'Face'
  | 'Murdock'
  | 'B.A.'
  | 'Lynch'
  | 'Amy'
  | 'Tawnia'
  | 'Stockwell';

/**
 * Agent claim on a work item.
 * Represents an agent's active assignment to a specific item.
 */
export interface AgentClaim {
  agentName: AgentName;
  itemId: string;
  claimedAt: Date;
}
