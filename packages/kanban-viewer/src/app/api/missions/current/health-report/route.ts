/**
 * GET /api/missions/current/health-report
 *
 * Pure data-layer health-report for in-flight items in the active mission.
 * Returns activity timestamps & counts so callers can decide what to do —
 * no heuristics, no `likelyIssue`, no `suggestedAction`.
 *
 * `missionIdle` is true iff every in-flight item has idleSeconds > 600
 * (also true when there are no in-flight items).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import {
  createValidationError,
  createNoActiveMissionError,
  createDatabaseError,
} from '@/lib/errors';

const IN_FLIGHT_STAGES = ['testing', 'implementing', 'review', 'probing'] as const;
const IDLE_THRESHOLD_SECONDS = 600;

type ActivitySource = 'hook_event' | 'activity_log' | 'work_log' | 'agent_claim';

interface RecentActivityEntry {
  agent: string | null;
  tool: string | null;
  eventType: string;
  timestamp: string;
}

interface InFlightItem {
  itemId: string;
  title: string;
  stage: string;
  assignedAgent: string | null;
  claimedAt: string | null;
  lastActivityAt: string | null;
  lastActivitySource: ActivitySource | null;
  idleSeconds: number | null;
  lastWorkLogEntry: { agent: string; summary: string; timestamp: string } | null;
  recentActivity: RecentActivityEntry[];
}

/**
 * Safely parse the JSON `payload` column on a HookEvent row and return its
 * `itemId` field if present. Defensive: payload may be malformed or null.
 */
function extractItemIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'string' || payload.length === 0) return null;
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === 'object' && typeof parsed.itemId === 'string') {
      return parsed.itemId;
    }
  } catch {
    /* ignore malformed payloads */
  }
  return null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const err = createValidationError(
        projectValidation.error.message,
      );
      return NextResponse.json(err.toResponse(), { status: err.httpStatus });
    }
    const projectId = projectValidation.projectId;

    // Newest-first, same as /api/missions/current's tier 1 — an unordered
    // findFirst returns SQLite's lowest rowid, so a stale unarchived mission
    // could have this route report health for a mission that is not the one in
    // flight.
    const mission = await prisma.mission.findFirst({
      where: {
        projectId,
        archivedAt: null,
        state: {
          notIn: ['completed', 'failed', 'archived'],
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!mission) {
      const err = createNoActiveMissionError();
      return NextResponse.json(err.toResponse(), { status: err.httpStatus });
    }

    const generatedAt = new Date();
    const missionId = mission.id;

    // Fetch in-flight items scoped to the current mission via the MissionItem join table.
    // This prevents items from archived/old missions leaking into the report.
    const items = await prisma.item.findMany({
      where: {
        projectId,
        stageId: { in: [...IN_FLIGHT_STAGES] },
        missionItems: { some: { missionId } },
      },
    });

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          missionId,
          generatedAt: generatedAt.toISOString(),
          missionIdle: true,
          inFlightItems: [],
        },
      });
    }

    const itemIds = items.map((i) => i.id);

    // Fetch ancillary data in parallel — claims, work logs, hook events, activity logs.
    const [claims, workLogs, hookEvents, activityLogs] = await Promise.all([
      prisma.agentClaim.findMany({ where: { itemId: { in: itemIds } } }),
      prisma.workLog.findMany({ where: { itemId: { in: itemIds } } }),
      prisma.hookEvent.findMany({ where: { missionId, projectId } }),
      prisma.activityLog.findMany({ where: { missionId, projectId } }),
    ]);

    // Index claims by itemId for O(1) lookup.
    const claimByItemId = new Map<string, (typeof claims)[number]>();
    for (const claim of claims) {
      claimByItemId.set(claim.itemId, claim);
    }

    const inFlightItems: InFlightItem[] = items.map((item) => {
      const claim = claimByItemId.get(item.id) ?? null;
      const assignedAgent = claim?.agentName ?? null;
      const claimedAt = claim?.claimedAt ?? null;

      // Hook events: if payload.itemId is present, attribute ONLY to that item
      // (prevents cross-item leak when one agent works multiple items in a mission).
      // Fall back to agentName === assignedAgent only when payload.itemId is missing,
      // but constrain the fallback to events at or after claimedAt so we don't pick
      // up events from earlier claims on other items the same agent worked on.
      const itemHookEvents = hookEvents.filter((ev) => {
        if (claimedAt && ev.timestamp < claimedAt) return false;
        const payloadItemId = extractItemIdFromPayload(ev.payload);
        if (payloadItemId !== null) return payloadItemId === item.id;
        if (assignedAgent && ev.agentName === assignedAgent) return true;
        return false;
      });

      // Activity logs: linked by agent === assignedAgent within the mission.
      // Constrain to the current claim window (timestamp >= claimedAt) to avoid
      // attributing activity from earlier claims on other items to this item.
      const itemActivityLogs = assignedAgent
        ? activityLogs.filter(
            (log) => log.agent === assignedAgent && (!claimedAt || log.timestamp >= claimedAt),
          )
        : [];

      // Work logs scoped to this item, sorted desc by timestamp; newest is the lastWorkLogEntry.
      const itemWorkLogs = workLogs
        .filter((wl) => wl.itemId === item.id)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const newestWorkLog = itemWorkLogs[0] ?? null;

      // Determine freshest activity timestamp + its source.
      // Tie-breaking order on identical timestamps: hook_event > activity_log > work_log > agent_claim (first-pushed wins on tie).
      const candidates: { ts: Date; source: ActivitySource }[] = [];
      const newestHook = itemHookEvents.reduce<Date | null>(
        (max, ev) => (max === null || ev.timestamp > max ? ev.timestamp : max),
        null,
      );
      if (newestHook) candidates.push({ ts: newestHook, source: 'hook_event' });

      const newestActivity = itemActivityLogs.reduce<Date | null>(
        (max, log) => (max === null || log.timestamp > max ? log.timestamp : max),
        null,
      );
      if (newestActivity) candidates.push({ ts: newestActivity, source: 'activity_log' });

      if (newestWorkLog) candidates.push({ ts: newestWorkLog.timestamp, source: 'work_log' });
      if (claimedAt) candidates.push({ ts: claimedAt, source: 'agent_claim' });

      // No signals at all → emit nulls. Avoids the misleading "agent_claim @ generatedAt"
      // fallback that produced phantom idleSeconds: 0 for items with zero evidence.
      let lastActivityAt: Date | null = null;
      let lastActivitySource: ActivitySource | null = null;
      if (candidates.length > 0) {
        const freshest = candidates.reduce((best, c) => (c.ts > best.ts ? c : best));
        lastActivityAt = freshest.ts;
        lastActivitySource = freshest.source;
      }

      let idleSeconds: number | null = null;
      if (lastActivityAt !== null) {
        const idleSecondsRaw = Math.floor(
          (generatedAt.getTime() - lastActivityAt.getTime()) / 1000,
        );
        idleSeconds = idleSecondsRaw < 0 ? 0 : idleSecondsRaw;
      }

      // recentActivity: merged hook + activity rows, desc by timestamp, take 5.
      const merged: RecentActivityEntry[] = [
        ...itemHookEvents.map((ev) => ({
          agent: ev.agentName,
          tool: ev.toolName,
          eventType: ev.eventType,
          timestamp: ev.timestamp.toISOString(),
          _ts: ev.timestamp.getTime(),
        })),
        ...itemActivityLogs.map((log) => ({
          agent: log.agent,
          tool: null,
          eventType: 'activity',
          timestamp: log.timestamp.toISOString(),
          _ts: log.timestamp.getTime(),
        })),
      ]
        .sort((a, b) => b._ts - a._ts)
        .slice(0, 5)
        .map(({ agent, tool, eventType, timestamp }) => ({ agent, tool, eventType, timestamp }));

      const lastWorkLogEntry = newestWorkLog
        ? {
            agent: newestWorkLog.agent,
            summary: newestWorkLog.summary,
            timestamp: newestWorkLog.timestamp.toISOString(),
          }
        : null;

      return {
        itemId: item.id,
        title: item.title,
        stage: item.stageId,
        assignedAgent,
        claimedAt: claimedAt ? claimedAt.toISOString() : null,
        lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
        lastActivitySource,
        idleSeconds,
        lastWorkLogEntry,
        recentActivity: merged,
      };
    });

    // null idleSeconds means "no signals at all" — treat as idle for aggregate purposes.
    const missionIdle = inFlightItems.every(
      (i) => i.idleSeconds === null || i.idleSeconds > IDLE_THRESHOLD_SECONDS,
    );

    return NextResponse.json({
      success: true,
      data: {
        missionId,
        generatedAt: generatedAt.toISOString(),
        missionIdle,
        inFlightItems,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build health report';
    const err = createDatabaseError(message);
    return NextResponse.json(err.toResponse(), { status: err.httpStatus });
  }
}
