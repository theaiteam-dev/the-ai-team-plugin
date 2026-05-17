/**
 * API Route: /api/controller-checkpoint/[missionId]
 *
 * GET  — Return the current checkpoint for a mission (404 if none exists).
 * POST — Upsert the full checkpoint document for a mission.
 *
 * Both endpoints are scoped to the requesting project via X-Project-ID.
 * GET returns the literal sentinel { error: 'not_found' } on 404 (not the
 * standard ApiError envelope) to match the contract consumed by the tick loop.
 *
 * JSON-serialised columns (pendingActionIds, confirmedActionIds, retryCounters,
 * lastLaneState) are parsed before returning so callers receive typed
 * arrays/objects, not raw JSON strings.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createValidationError, createDatabaseError } from '@/lib/errors';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ missionId: string }>;
}

/**
 * Shape of a valid POST body.  Fields are the runtime-typed values the caller
 * sends — JSON arrays/objects, not pre-stringified strings.
 */
interface CheckpointBody {
  tickedAt: string;
  activityCursor: number;
  pendingActionIds: string[];
  confirmedActionIds: string[];
  retryCounters: Record<string, number>;
  lastLaneState: Record<string, 'idle' | 'busy'>;
}

/** Raw DB row shape (JSON-string columns). */
interface DbCheckpoint {
  missionId: string;
  tickedAt: Date;
  activityCursor: number;
  pendingActionIds: string;
  confirmedActionIds: string;
  retryCounters: string;
  lastLaneState: string;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Parse JSON-string columns before sending to the HTTP client. */
function parseCheckpoint(checkpoint: DbCheckpoint) {
  return {
    ...checkpoint,
    pendingActionIds: JSON.parse(checkpoint.pendingActionIds) as string[],
    confirmedActionIds: JSON.parse(checkpoint.confirmedActionIds) as string[],
    retryCounters: JSON.parse(checkpoint.retryCounters) as Record<string, number>,
    lastLaneState: JSON.parse(checkpoint.lastLaneState) as Record<string, 'idle' | 'busy'>,
  };
}

/**
 * Validate the incoming POST body.
 * Returns a human-readable error string on failure, or null on success.
 */
function validateCheckpointBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Request body must be a JSON object';
  }

  const b = body as Record<string, unknown>;

  if (b.tickedAt === undefined || b.tickedAt === null) {
    return 'tickedAt is required';
  }

  if (b.activityCursor === undefined || b.activityCursor === null) {
    return 'activityCursor is required';
  }
  if (typeof b.activityCursor !== 'number') {
    return 'activityCursor must be a number';
  }

  if (b.pendingActionIds === undefined || b.pendingActionIds === null) {
    return 'pendingActionIds is required';
  }
  if (!Array.isArray(b.pendingActionIds)) {
    return 'pendingActionIds must be an array of strings';
  }
  if (!(b.pendingActionIds as unknown[]).every((item) => typeof item === 'string')) {
    return 'pendingActionIds must be an array of strings';
  }

  if (b.confirmedActionIds === undefined || b.confirmedActionIds === null) {
    return 'confirmedActionIds is required';
  }
  if (!Array.isArray(b.confirmedActionIds)) {
    return 'confirmedActionIds must be an array of strings';
  }
  if (!(b.confirmedActionIds as unknown[]).every((item) => typeof item === 'string')) {
    return 'confirmedActionIds must be an array of strings';
  }

  if (b.retryCounters === undefined || b.retryCounters === null) {
    return 'retryCounters is required';
  }
  if (typeof b.retryCounters !== 'object' || Array.isArray(b.retryCounters)) {
    return 'retryCounters must be a plain object';
  }
  if (
    !Object.values(b.retryCounters as Record<string, unknown>).every(
      (v) => typeof v === 'number'
    )
  ) {
    return 'retryCounters values must be numbers';
  }

  if (b.lastLaneState === undefined || b.lastLaneState === null) {
    return 'lastLaneState is required';
  }
  if (typeof b.lastLaneState !== 'object' || Array.isArray(b.lastLaneState)) {
    return 'lastLaneState must be a plain object';
  }
  if (
    !Object.values(b.lastLaneState as Record<string, unknown>).every(
      (v) => v === 'idle' || v === 'busy'
    )
  ) {
    return 'lastLaneState values must be "idle" or "busy"';
  }

  return null;
}

// ────────────────────────────────────────────────────────────────
// Route handlers
// ────────────────────────────────────────────────────────────────

/**
 * GET /api/controller-checkpoint/:missionId
 *
 * Returns the persisted checkpoint document for the mission, scoped to the
 * requesting project.  Returns 404 with the literal { error: 'not_found' }
 * sentinel when no checkpoint exists.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { missionId } = await context.params;

    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: projectValidation.error },
        { status: 400 }
      );
    }
    const { projectId } = projectValidation;

    // Scope the lookup to the requesting project via the Mission relation so
    // cross-project existence is not leaked.
    const checkpoint = await prisma.controllerCheckpoint.findFirst({
      where: { missionId, mission: { projectId } },
    });

    if (!checkpoint) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: parseCheckpoint(checkpoint),
    });
  } catch (error) {
    console.error('GET /api/controller-checkpoint/[missionId] error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch controller checkpoint', error).toResponse(),
      { status: 500 }
    );
  }
}

/**
 * POST /api/controller-checkpoint/:missionId
 *
 * Upserts the full checkpoint document for the mission.  Verifies that the
 * mission exists and belongs to the requesting project before writing.
 * Returns 200 with the persisted (parsed) document on success.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { missionId } = await context.params;

    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: projectValidation.error },
        { status: 400 }
      );
    }
    const { projectId } = projectValidation;

    // Parse body — surface malformed JSON as a 400 before hitting the DB.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        createValidationError('Request body contains invalid JSON').toResponse(),
        { status: 400 }
      );
    }

    const bodyError = validateCheckpointBody(rawBody);
    if (bodyError) {
      return NextResponse.json(
        createValidationError(bodyError).toResponse(),
        { status: 400 }
      );
    }

    const body = rawBody as CheckpointBody;

    // Verify the mission belongs to the requesting project.  This prevents
    // project B from creating/overwriting a checkpoint for project A's mission.
    const mission = await prisma.mission.findFirst({
      where: { id: missionId, projectId },
    });
    if (!mission) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const serialised = {
      tickedAt: new Date(body.tickedAt),
      activityCursor: body.activityCursor,
      pendingActionIds: JSON.stringify(body.pendingActionIds),
      confirmedActionIds: JSON.stringify(body.confirmedActionIds),
      retryCounters: JSON.stringify(body.retryCounters),
      lastLaneState: JSON.stringify(body.lastLaneState),
    };

    const checkpoint = await prisma.controllerCheckpoint.upsert({
      where: { missionId },
      create: { missionId, ...serialised },
      update: serialised,
    });

    return NextResponse.json({
      success: true,
      data: parseCheckpoint(checkpoint),
    });
  } catch (error) {
    console.error('POST /api/controller-checkpoint/[missionId] error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to upsert controller checkpoint', error).toResponse(),
      { status: 500 }
    );
  }
}
