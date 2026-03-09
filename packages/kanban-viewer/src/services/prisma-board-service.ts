/**
 * Prisma-based Board Data Service
 *
 * Data access layer for reading board state from SQLite via Prisma.
 * This replaces filesystem reads with direct Prisma queries.
 *
 * Server Components should import and use this service directly
 * instead of making HTTP fetch calls.
 */

import { prisma } from '@/lib/db';
import type { BoardMetadata, WorkItem, Stage, AgentName } from '../types';
import type { LogEntry } from '../lib/activity-log';

/**
 * Type definitions for Prisma query results
 */
interface PrismaItem {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  stageId: string;
  assignedAgent: string | null;
  rejectionCount: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  archivedAt: Date | null;
  dependsOn?: { dependsOnId: string }[];
  workLogs?: {
    id: number;
    agent: string;
    action: string;
    summary: string;
    timestamp: Date;
  }[];
}

interface PrismaMission {
  id: string;
  name: string;
  state: string;
  prdPath: string;
  startedAt: Date;
  completedAt: Date | null;
  archivedAt: Date | null;
}

interface PrismaStage {
  id: string;
  name: string;
  order: number;
  wipLimit: number | null;
}

interface PrismaActivityLog {
  id: number;
  missionId: string | null;
  agent: string | null;
  message: string;
  level: string;
  timestamp: Date;
}

/**
 * Map Prisma item to WorkItem format
 */
function mapPrismaItemToWorkItem(item: PrismaItem): WorkItem {
  return {
    id: item.id,
    title: item.title,
    type: item.type as WorkItem['type'],
    status: item.completedAt ? 'completed' : 'pending',
    assigned_agent: item.assignedAgent as AgentName | undefined,
    rejection_count: item.rejectionCount,
    dependencies: item.dependsOn?.map((d) => d.dependsOnId) ?? [],
    outputs: {},
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
    stage: item.stageId as Stage,
    content: item.description,
  };
}

/**
 * Map Prisma activity log to LogEntry format
 */
function mapPrismaActivityLogToLogEntry(log: PrismaActivityLog): LogEntry {
  // Determine highlight type based on message content
  let highlightType: LogEntry['highlightType'];
  if (log.message.startsWith('APPROVED')) {
    highlightType = 'approved';
  } else if (log.message.startsWith('REJECTED')) {
    highlightType = 'rejected';
  } else if (log.message.startsWith('ALERT:')) {
    highlightType = 'alert';
  } else if (log.message.startsWith('COMMITTED')) {
    highlightType = 'committed';
  }

  return {
    timestamp: log.timestamp.toISOString(),
    agent: log.agent ?? 'System',
    message: log.message,
    highlightType,
  };
}

/**
 * PrismaBoardService - Queries SQLite database via Prisma
 *
 * This service provides the same interface as BoardService but uses
 * Prisma to query the database instead of reading from the filesystem.
 */
export class PrismaBoardService {
  /**
   * Get board metadata by querying Prisma for mission, stages, and stats
   * @returns BoardMetadata or null
   */
  async getBoardMetadata(): Promise<BoardMetadata | null> {
    // Query mission, stages, items, and claims in parallel
    const [mission, stages, items, claims] = await Promise.all([
      prisma.mission.findFirst({
        where: { archivedAt: null },
        orderBy: { startedAt: 'desc' },
      }) as Promise<PrismaMission | null>,
      prisma.stage.findMany({
        orderBy: { order: 'asc' },
      }) as Promise<PrismaStage[]>,
      prisma.item.findMany({
        where: { archivedAt: null },
      }) as Promise<PrismaItem[]>,
      prisma.agentClaim.findMany() as Promise<
        { agentName: string; itemId: string; claimedAt: Date }[]
      >,
    ]);

    // Build WIP limits from stages
    const wipLimits: Record<string, number> = {};
    for (const stage of stages) {
      if (stage.wipLimit !== null) {
        wipLimits[stage.id] = stage.wipLimit;
      }
    }

    // Calculate stats from items
    const completedItems = items.filter((i) => i.stageId === 'done');
    const inProgressItems = items.filter(
      (i) =>
        i.stageId === 'testing' ||
        i.stageId === 'implementing' ||
        i.stageId === 'review' ||
        i.stageId === 'probing'
    );
    const blockedItems = items.filter((i) => i.stageId === 'blocked');
    const backlogItems = items.filter(
      (i) => i.stageId === 'briefings' || i.stageId === 'ready'
    );

    // Build assignments from claims
    const assignments: Record<string, string> = {};
    for (const claim of claims) {
      assignments[claim.itemId] = claim.agentName.toLowerCase();
    }

    // Build agent status from claims and items
    const agents: Record<string, { status: string; current_item?: string }> = {
      hannibal: { status: 'watching' },
      face: { status: 'idle' },
      murdock: { status: 'idle' },
      ba: { status: 'idle' },
      amy: { status: 'idle' },
      lynch: { status: 'idle' },
    };

    for (const claim of claims) {
      const agentKey = claim.agentName.toLowerCase().replace(/\./g, '');
      if (agents[agentKey]) {
        agents[agentKey] = {
          status: 'active',
          current_item: claim.itemId,
        };
      }
    }

    // Build phases mapping
    const phases: Record<string, string[]> = {};
    for (const stage of stages) {
      const stageItems = items
        .filter((i) => i.stageId === stage.id)
        .map((i) => i.id);
      if (stageItems.length > 0) {
        phases[stage.id] = stageItems;
      }
    }

    // Map all mission states consistently with api-transform.ts and board/events/route.ts
    let missionStatus: BoardMetadata['mission']['status'] = 'planning';
    switch (mission?.state) {
      case 'initializing':
        missionStatus = 'planning';
        break;
      case 'prechecking':
      case 'running':
      case 'postchecking':
        missionStatus = 'active';
        break;
      case 'failed':
      case 'precheck_failure':
        missionStatus = 'paused';
        break;
      case 'completed':
      case 'archived':
        missionStatus = 'completed';
        break;
    }

    return {
      mission: {
        name: mission?.name ?? 'No Active Mission',
        started_at: mission?.startedAt?.toISOString(),
        completed_at: mission?.completedAt?.toISOString(),
        status: missionStatus,
      },
      wip_limits: wipLimits,
      phases,
      assignments,
      agents,
      stats: {
        total_items: items.length,
        completed: completedItems.length,
        in_progress: inProgressItems.length,
        blocked: blockedItems.length,
        backlog: backlogItems.length,
      },
      last_updated: new Date().toISOString(),
    };
  }

  /**
   * Get all work items from the database
   * @returns Array of WorkItems
   */
  async getAllWorkItems(): Promise<WorkItem[]> {
    const items = (await prisma.item.findMany({
      where: { archivedAt: null },
      include: {
        dependsOn: true,
        workLogs: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as PrismaItem[];

    return items.map(mapPrismaItemToWorkItem);
  }

  /**
   * Get work items by stage
   * @param stage - The stage to filter by
   * @returns Array of WorkItems in that stage
   */
  async getWorkItemsByStage(stage: Stage): Promise<WorkItem[]> {
    const items = (await prisma.item.findMany({
      where: {
        stageId: stage,
        archivedAt: null,
      },
      include: {
        dependsOn: true,
        workLogs: true,
      },
      orderBy: { createdAt: 'asc' },
    })) as PrismaItem[];

    return items.map(mapPrismaItemToWorkItem);
  }

  /**
   * Get a single work item by ID
   * @param id - The work item ID
   * @returns WorkItem or null if not found
   */
  async getWorkItemById(id: string): Promise<WorkItem | null> {
    const item = (await prisma.item.findUnique({
      where: { id },
      include: {
        dependsOn: true,
        workLogs: true,
      },
    })) as PrismaItem | null;

    if (!item) {
      return null;
    }

    return mapPrismaItemToWorkItem(item);
  }

  /**
   * Get activity log entries
   * @param lastN - Optional limit on number of entries to return
   * @returns Array of LogEntry objects
   */
  async getActivityLog(lastN?: number): Promise<LogEntry[]> {
    const logs = (await prisma.activityLog.findMany({
      orderBy: { timestamp: 'desc' },
      ...(lastN !== undefined && { take: lastN }),
    })) as PrismaActivityLog[];

    return logs.map(mapPrismaActivityLogToLogEntry);
  }
}
