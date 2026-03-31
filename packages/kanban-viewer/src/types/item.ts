/**
 * Item-related types for the API layer.
 *
 * These types define work items, their properties, and work log entries
 * for the new API layer as specified in PRD 013-mcp-interface.md.
 */

import type { StageId } from './board';
import type { ItemType, ItemPriority, ItemOutputs } from '@ai-team/shared';

// Re-export shared types for backward compatibility
export type { ItemType, ItemPriority, ItemOutputs };

/**
 * Valid work log action types.
 */
export type WorkLogAction = 'started' | 'completed' | 'rejected' | 'note';

/**
 * Base work item interface.
 */
export interface Item {
  id: string;
  title: string;
  description: string;
  objective?: string;
  acceptance?: string[];
  context?: string;
  type: ItemType;
  priority: ItemPriority;
  stageId: StageId;
  assignedAgent: string | null;
  rejectionCount: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  outputs: ItemOutputs;
}

/**
 * Work log entry recording agent actions on an item.
 */
export interface WorkLogEntry {
  id: number;
  agent: string;
  action: WorkLogAction;
  summary: string;
  timestamp: Date;
}

/**
 * Extended item interface including dependency and work log relations.
 */
export interface ItemWithRelations extends Item {
  dependencies: string[];
  workLogs: WorkLogEntry[];
}
