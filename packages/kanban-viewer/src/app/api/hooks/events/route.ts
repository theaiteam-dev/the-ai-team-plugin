/**
 * API Route: /api/hooks/events
 *
 * POST - Store hook event payloads from observer hook scripts
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createValidationError } from '@/lib/errors';
import { getAndValidateProjectId, ensureProject } from '@/lib/project-utils';
import type { ApiError } from '@/types/api';

/** Valid hook event types. */
const VALID_EVENT_TYPES = [
  'pre_tool_use',
  'post_tool_use',
  'post_tool_use_failure',
  'subagent_start',
  'subagent_stop',
  'stop',
  'teammate_idle',
  'task_completed',
] as const;

type HookEventType = (typeof VALID_EVENT_TYPES)[number];

/** Hook event input shape (single or batch). */
interface HookEventInput {
  eventType: string;
  agentName: string;
  toolName?: string;
  status: string;
  durationMs?: number;
  summary: string;
  payload?: string;
  correlationId?: string;
  timestamp: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  model?: string;
}

/** Response for single event creation. */
interface CreateSingleEventResponse {
  success: true;
  data: {
    id: number;
    projectId: string;
    missionId: string | null;
    eventType: string;
    agentName: string;
    toolName?: string;
    status: string;
    durationMs?: number;
    summary: string;
    correlationId?: string;
    timestamp: Date;
  };
}

/** Response for batch event creation. */
interface CreateBatchEventResponse {
  success: true;
  data: {
    created: number;
    skipped: number;
  };
}

/**
 * POST /api/hooks/events
 *
 * Store hook event payloads. Supports single event or batch (array).
 *
 * Request body:
 * - Single event object OR array of events
 * - Each event requires: eventType, agentName, status, summary, timestamp
 * - Optional fields: toolName, durationMs, payload, correlationId, missionId
 *
 * Deduplication:
 * - Events with correlationId + eventType pair are deduplicated
 * - Events without correlationId are always stored
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<CreateSingleEventResponse | CreateBatchEventResponse | ApiError>> {
  try {
    // Validate project ID from header
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: projectValidation.error,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    // Ensure project exists (auto-create if needed)
    await ensureProject(projectId);

    // Parse request body
    let body: HookEventInput | HookEventInput[];
    try {
      body = await request.json();
    } catch {
      const apiError: ApiError = {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        },
      };
      return NextResponse.json(apiError, { status: 400 });
    }

    // Normalize to array for uniform processing
    const isBatch = Array.isArray(body);
    const events = Array.isArray(body) ? body : [body];

    // Validate batch size limit (Amy's finding: prevent DoS via large batches)
    if (events.length > 100) {
      return NextResponse.json(
        createValidationError(
          'Batch size exceeds limit of 100 events per request'
        ).toResponse(),
        { status: 400 }
      );
    }

    // Validate all events
    for (const event of events) {
      // Required fields
      if (!event.eventType || typeof event.eventType !== 'string') {
        return NextResponse.json(
          createValidationError('eventType is required and must be a string').toResponse(),
          { status: 400 }
        );
      }

      if (!VALID_EVENT_TYPES.includes(event.eventType as HookEventType)) {
        return NextResponse.json(
          createValidationError(
            `eventType must be one of: ${VALID_EVENT_TYPES.join(', ')}`
          ).toResponse(),
          { status: 400 }
        );
      }

      if (!event.agentName || typeof event.agentName !== 'string') {
        return NextResponse.json(
          createValidationError('agentName is required and must be a string').toResponse(),
          { status: 400 }
        );
      }

      if (!event.summary || typeof event.summary !== 'string') {
        return NextResponse.json(
          createValidationError('summary is required and must be a string').toResponse(),
          { status: 400 }
        );
      }

      if (!event.timestamp) {
        return NextResponse.json(
          createValidationError('timestamp is required').toResponse(),
          { status: 400 }
        );
      }

      // Validate timestamp format (Amy's finding: reject malformed timestamps)
      const parsedTimestamp = new Date(event.timestamp);
      if (isNaN(parsedTimestamp.getTime())) {
        return NextResponse.json(
          createValidationError('timestamp must be a valid ISO 8601 timestamp').toResponse(),
          { status: 400 }
        );
      }

      // Validate payload size limit (Amy's finding: prevent database bloat)
      if (event.payload && event.payload.length > 1024 * 1024) {
        return NextResponse.json(
          createValidationError(
            'payload size exceeds 1MB limit'
          ).toResponse(),
          { status: 400 }
        );
      }

      // Validate token fields are non-negative integers when present
      const tokenFields = [
        ['inputTokens', event.inputTokens],
        ['outputTokens', event.outputTokens],
        ['cacheCreationTokens', event.cacheCreationTokens],
        ['cacheReadTokens', event.cacheReadTokens],
      ] as const;

      for (const [field, value] of tokenFields) {
        if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
          return NextResponse.json(
            createValidationError(`${field} must be a non-negative integer`).toResponse(),
            { status: 400 }
          );
        }
      }

      if (event.model !== undefined && (typeof event.model !== 'string' || event.model.trim() === '')) {
        return NextResponse.json(
          createValidationError('model must be a non-empty string').toResponse(),
          { status: 400 }
        );
      }
    }

    // Find current mission for this project.
    // A mission is "current" until archived (archivedAt set), matching
    // /api/missions/current behavior. No state filter — completed/failed
    // missions that haven't been archived yet should still receive events.
    const currentMission = await prisma.mission.findFirst({
      where: {
        projectId,
        archivedAt: null,
      },
      orderBy: { startedAt: 'desc' },
    });
    const missionId = currentMission?.id ?? null;

    // Process events with deduplication
    let created = 0;
    let skipped = 0;
    let singleEventResult = null;

    for (const event of events) {
      // Atomic deduplication: Try to create, handle unique constraint violation
      // This prevents race conditions where concurrent requests both pass the check
      try {
        const createdEvent = await prisma.hookEvent.create({
          data: {
            projectId,
            missionId,
            eventType: event.eventType,
            agentName: event.agentName,
            toolName: event.toolName ?? null,
            status: event.status,
            durationMs: event.durationMs ?? null,
            summary: event.summary,
            payload: event.payload ?? '{}',
            correlationId: event.correlationId ?? null,
            timestamp: new Date(event.timestamp),
            inputTokens: event.inputTokens ?? null,
            outputTokens: event.outputTokens ?? null,
            cacheCreationTokens: event.cacheCreationTokens ?? null,
            cacheReadTokens: event.cacheReadTokens ?? null,
            model: event.model ?? null,
          },
        });

        created++;

        // Store single event result for non-batch response
        if (!isBatch) {
          singleEventResult = createdEvent;
        }
      } catch (error: unknown) {
        // Handle unique constraint violation (duplicate correlationId + eventType)
        const err = typeof error === 'object' && error !== null
          ? (error as { code?: string; message?: string; meta?: { target?: unknown } })
          : null;
        if (err?.code === 'P2002') {
          // Check meta.target (PostgreSQL driver format: array of field names)
          const target = Array.isArray(err?.meta?.target) ? (err.meta.target as unknown[]) : [];
          const targetMatchesFields =
            target.includes('correlationId') && target.includes('eventType');
          // Check error message (libsql/SQLite driver format: message contains field names)
          const messageMatchesFields =
            typeof err.message === 'string' &&
            err.message.includes('correlationId') &&
            err.message.includes('eventType');
          if (targetMatchesFields || messageMatchesFields) {
            skipped++;
            continue; // Skip duplicate
          }
        }
        // Re-throw other errors
        throw error;
      }
    }

    // Return appropriate response format
    if (isBatch) {
      const response: CreateBatchEventResponse = {
        success: true,
        data: {
          created,
          skipped,
        },
      };
      return NextResponse.json(response, { status: 201 });
    } else {
      if (!singleEventResult) {
        // Single event was skipped due to deduplication
        const response: CreateBatchEventResponse = {
          success: true,
          data: {
            created: 0,
            skipped: 1,
          },
        };
        return NextResponse.json(response, { status: 201 });
      }

      const response: CreateSingleEventResponse = {
        success: true,
        data: {
          id: singleEventResult.id,
          projectId: singleEventResult.projectId,
          missionId: singleEventResult.missionId,
          eventType: singleEventResult.eventType,
          agentName: singleEventResult.agentName,
          toolName: singleEventResult.toolName ?? undefined,
          status: singleEventResult.status,
          durationMs: singleEventResult.durationMs ?? undefined,
          summary: singleEventResult.summary,
          correlationId: singleEventResult.correlationId ?? undefined,
          timestamp: singleEventResult.timestamp,
        },
      };
      return NextResponse.json(response, { status: 201 });
    }
  } catch (error) {
    console.error('POST /api/hooks/events error:', error);
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create hook event',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
