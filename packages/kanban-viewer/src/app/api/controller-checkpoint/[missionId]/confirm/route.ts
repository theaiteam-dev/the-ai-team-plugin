/**
 * API Route: /api/controller-checkpoint/[missionId]/confirm
 *
 * POST — Atomically append a single actionId to the confirmedActionIds list.
 *
 * This endpoint exists so the tick loop can confirm executed action IDs
 * without a full read-modify-write round-trip from the client.  The server
 * performs the append and server-side deduplication, touching ONLY the
 * confirmedActionIds column so other checkpoint state (activityCursor,
 * pendingActionIds, retryCounters, lastLaneState) remains untouched.
 *
 * Returns 404 with the literal { error: 'not_found' } sentinel when no
 * checkpoint exists for the mission (matches the contract used by GET).
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

// ────────────────────────────────────────────────────────────────
// Route handler
// ────────────────────────────────────────────────────────────────

/**
 * POST /api/controller-checkpoint/:missionId/confirm
 *
 * Body: { actionId: string }
 *
 * Appends actionId to confirmedActionIds with server-side deduplication.
 * Mutates ONLY confirmedActionIds — all other checkpoint fields are unchanged.
 * Returns 200 with the updated (parsed) checkpoint document.
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

    // Parse and validate the request body.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        createValidationError('Request body contains invalid JSON').toResponse(),
        { status: 400 }
      );
    }

    const body = rawBody as Record<string, unknown>;
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof body.actionId !== 'string'
    ) {
      return NextResponse.json(
        createValidationError('actionId must be a non-empty string').toResponse(),
        { status: 400 }
      );
    }
    const { actionId } = body as { actionId: string };

    // Use a transaction to make the read-append-write atomic.
    const updated = await prisma.$transaction(async (tx) => {
      // Scope lookup to the requesting project via the Mission relation.
      const checkpoint = await tx.controllerCheckpoint.findFirst({
        where: { missionId, mission: { projectId } },
      });

      if (!checkpoint) {
        return null;
      }

      const existing = JSON.parse(checkpoint.confirmedActionIds) as string[];
      const deduped = existing.includes(actionId) ? existing : [...existing, actionId];

      // Mutate ONLY confirmedActionIds — leave all other columns untouched.
      return tx.controllerCheckpoint.update({
        where: { missionId },
        data: { confirmedActionIds: JSON.stringify(deduped) },
      });
    });

    if (!updated) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: parseCheckpoint(updated),
    });
  } catch (error) {
    console.error('POST /api/controller-checkpoint/[missionId]/confirm error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to confirm action ID', error).toResponse(),
      { status: 500 }
    );
  }
}
