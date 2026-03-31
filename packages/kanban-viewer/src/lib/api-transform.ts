/**
 * API Data Transformation Utilities
 *
 * Transforms data from the new database-backed API format to the UI format
 * expected by existing components.
 */

import type { BoardState, Stage as ApiStage, StageId } from '@/types/board';
import type { ItemWithRelations, WorkLogEntry } from '@/types/item';
import type { Mission as ApiMission } from '@/types/mission';
import type {
  WorkItem,
  Stage as UiStage,
  BoardMetadata,
  Mission as UiMission,
  WorkItemFrontmatterType,
} from '@/types';

/**
 * Maps API stage IDs to UI stage names.
 * After harmonization, API and UI use the same stage names.
 */
const STAGE_ID_TO_UI_STAGE: Record<StageId, UiStage> = {
  briefings: 'briefings',
  ready: 'ready',
  testing: 'testing',
  implementing: 'implementing',
  probing: 'probing',
  review: 'review',
  done: 'done',
  blocked: 'blocked',
};

/**
 * Maps API item types to UI frontmatter types.
 */
const API_TYPE_TO_FRONTMATTER_TYPE: Record<string, WorkItemFrontmatterType> = {
  feature: 'feature',
  bug: 'bug',
  chore: 'task',
  spike: 'enhancement',
};

/**
 * Transforms an API item to the UI WorkItem format.
 */
function transformApiItemToWorkItem(item: ItemWithRelations): WorkItem {
  const uiStage = STAGE_ID_TO_UI_STAGE[item.stageId] ?? 'briefings';
  const uiType = API_TYPE_TO_FRONTMATTER_TYPE[item.type] ?? 'feature';

  // Build outputs object from API item
  const outputs: WorkItem['outputs'] = {};
  if (item.outputs?.test) outputs.test = item.outputs.test;
  if (item.outputs?.impl) outputs.impl = item.outputs.impl;
  if (item.outputs?.types) outputs.types = item.outputs.types;

  return {
    id: item.id,
    title: item.title,
    type: uiType,
    status: item.stageId === 'done' ? 'completed' : 'pending',
    assigned_agent: item.assignedAgent as WorkItem['assigned_agent'],
    rejection_count: item.rejectionCount,
    rejection_history: [],
    work_logs: item.workLogs?.map((log): WorkLogEntry => ({
      id: log.id,
      agent: log.agent,
      action: log.action,
      summary: log.summary,
      timestamp: log.timestamp,
    })),
    dependencies: item.dependencies,
    outputs,
    ...(item.objective && { objective: item.objective }),
    ...(item.acceptance && { acceptance: item.acceptance }),
    ...(item.context && { context: item.context }),
    created_at: item.createdAt instanceof Date
      ? item.createdAt.toISOString()
      : String(item.createdAt),
    updated_at: item.updatedAt instanceof Date
      ? item.updatedAt.toISOString()
      : String(item.updatedAt),
    stage: uiStage,
    content: item.description,
  };
}

/**
 * Transforms an API mission to the UI Mission format.
 */
function transformApiMissionToUiMission(mission: ApiMission | null): UiMission {
  if (!mission) {
    return {
      name: 'No Active Mission',
      status: 'planning',
      started_at: new Date().toISOString(),
    };
  }

  // Map API mission state to UI status
  const statusMap: Record<string, UiMission['status']> = {
    initializing: 'planning',
    prechecking: 'active',
    running: 'active',
    postchecking: 'active',
    completed: 'completed',
    failed: 'paused',
    precheck_failure: 'paused',
    archived: 'completed',
  };

  return {
    name: mission.name,
    status: statusMap[mission.state] ?? 'active',
    started_at: mission.startedAt instanceof Date
      ? mission.startedAt.toISOString()
      : String(mission.startedAt),
    completed_at: mission.completedAt
      ? (mission.completedAt instanceof Date
        ? mission.completedAt.toISOString()
        : String(mission.completedAt))
      : undefined,
  };
}

/**
 * Builds WIP limits from API stages.
 */
function buildWipLimitsFromStages(stages: ApiStage[]): Record<string, number> {
  const wipLimits: Record<string, number> = {};

  for (const stage of stages) {
    const uiStage = STAGE_ID_TO_UI_STAGE[stage.id];
    if (uiStage && stage.wipLimit !== null) {
      wipLimits[uiStage] = stage.wipLimit;
    }
  }

  // Add defaults for stages that don't have WIP limits in the API
  // but are expected by the UI
  return {
    testing: wipLimits.testing ?? 2,
    implementing: wipLimits.implementing ?? 3,
    review: wipLimits.review ?? 2,
    probing: wipLimits.probing ?? 2,
    ...wipLimits,
  };
}

/**
 * Transforms the full API board state to UI BoardMetadata format.
 */
export function transformBoardStateToMetadata(boardState: BoardState): BoardMetadata {
  const mission = transformApiMissionToUiMission(boardState.currentMission);
  const wipLimits = buildWipLimitsFromStages(boardState.stages);

  // Calculate stats from items
  const items = boardState.items;
  const stats = {
    total_items: items.length,
    completed: items.filter(i => i.stageId === 'done').length,
    in_progress: items.filter(i =>
      i.stageId === 'testing' || i.stageId === 'implementing' ||
      i.stageId === 'probing' || i.stageId === 'review'
    ).length,
    blocked: items.filter(i => i.stageId === 'blocked').length,
    backlog: items.filter(i =>
      i.stageId === 'briefings' || i.stageId === 'ready'
    ).length,
  };

  // Build assignments from claims
  const assignments: Record<string, string> = {};
  for (const claim of boardState.claims) {
    assignments[claim.itemId] = claim.agentName;
  }

  return {
    mission,
    wip_limits: wipLimits,
    phases: {},
    assignments,
    agents: {},
    stats,
    last_updated: new Date().toISOString(),
  };
}

/**
 * Transforms an array of API items to UI WorkItems.
 */
export function transformApiItemsToWorkItems(items: ItemWithRelations[]): WorkItem[] {
  return items.map(transformApiItemToWorkItem);
}
