/**
 * Shared transformation functions for converting database items to API response formats.
 *
 * These functions ensure consistent item serialization across all API routes.
 */

import type { StageId } from '@/types/board';
import type { Item, ItemType, ItemPriority, ItemWithRelations, WorkLogEntry, ItemOutputs } from '@/types/item';

/**
 * Database item shape for the basic Item response (without relations).
 */
export interface DbItem {
  id: string;
  title: string;
  description: string;
  objective: string | null;
  acceptance: string | null;
  context: string | null;
  type: string;
  priority: string;
  stageId: string;
  assignedAgent: string | null;
  rejectionCount: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  outputTest: string | null;
  outputImpl: string | null;
  outputTypes: string | null;
}

/**
 * Database item shape with optional relations for ItemWithRelations response.
 */
export interface DbItemWithRelations extends DbItem {
  dependsOn?: Array<{ dependsOnId: string }>;
  workLogs?: Array<{
    id: number;
    agent: string;
    action: string;
    summary: string;
    timestamp: Date;
  }>;
}

/**
 * Build outputs object from database fields.
 * Filters out null/undefined values.
 */
function buildOutputs(item: DbItem): ItemOutputs {
  const outputs: ItemOutputs = {};
  if (item.outputTest) outputs.test = item.outputTest;
  if (item.outputImpl) outputs.impl = item.outputImpl;
  if (item.outputTypes) outputs.types = item.outputTypes;
  return outputs;
}

/**
 * Transform a database item to the basic Item response format.
 *
 * Use this for endpoints that return items without relations.
 */
/**
 * Parse acceptance JSON string from database to string array.
 */
function parseAcceptance(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((el): el is string => typeof el === 'string') : undefined;
  } catch {
    return undefined;
  }
}

export function transformItemToResponse(item: DbItem): Item {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    ...(item.objective && { objective: item.objective }),
    ...(item.acceptance && { acceptance: parseAcceptance(item.acceptance) }),
    ...(item.context && { context: item.context }),
    type: item.type as ItemType,
    priority: item.priority as ItemPriority,
    stageId: item.stageId as StageId,
    assignedAgent: item.assignedAgent,
    rejectionCount: item.rejectionCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
    outputs: buildOutputs(item),
  };
}

/**
 * Transform a database item with relations to the ItemWithRelations response format.
 *
 * Use this for endpoints that return items with dependencies and work logs.
 */
export function transformItemWithRelationsToResponse(
  item: DbItemWithRelations
): ItemWithRelations {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    ...(item.objective && { objective: item.objective }),
    ...(item.acceptance && { acceptance: parseAcceptance(item.acceptance) }),
    ...(item.context && { context: item.context }),
    type: item.type as ItemType,
    priority: item.priority as ItemPriority,
    stageId: item.stageId as StageId,
    assignedAgent: item.assignedAgent,
    rejectionCount: item.rejectionCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
    outputs: buildOutputs(item),
    dependencies: (item.dependsOn ?? []).map((d) => d.dependsOnId),
    workLogs: (item.workLogs ?? []).map((log): WorkLogEntry => ({
      id: log.id,
      agent: log.agent,
      action: log.action as WorkLogEntry['action'],
      summary: log.summary,
      timestamp: log.timestamp,
    })),
  };
}
