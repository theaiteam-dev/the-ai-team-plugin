/**
 * API Route: /api/learnings
 *
 * POST - Capture a RetroLearning row for the retro agent's Debrief and the
 *        corpus backfill, deduping duplicate fingerprints within a mission.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError, createValidationError } from '@/lib/errors';
import type { ApiError } from '@/types/api';

const REQUIRED_FIELDS = [
  'source',
  'severity',
  'attributedAgent',
  'targetSurface',
  'pattern',
  'fingerprint',
  'title',
] as const;

interface LearningCaptureBody {
  source: string;
  severity: string;
  attributedAgent: string;
  targetSurface: string;
  pattern: string;
  fingerprint: string;
  title: string;
  detail?: string | null;
  missionId?: string | null;
}

/**
 * POST /api/learnings
 *
 * Body: { source, severity, attributedAgent, targetSurface, pattern, fingerprint,
 *         title, detail?, missionId? }
 *
 * Dedupe is app-level and scoped per mission: when missionId is non-null, an
 * existing row with the same (projectId, missionId, fingerprint) is returned
 * as-is (200) instead of creating a duplicate. A null missionId (backfill of
 * stalled drafts) always inserts a new row (200 -> 201, never deduped).
 */
export async function POST(request: Request) {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    const body = (await request.json()) as Partial<LearningCaptureBody> & Record<string, unknown>;

    for (const field of REQUIRED_FIELDS) {
      const value = body[field];
      if (typeof value !== 'string' || value.length === 0) {
        return NextResponse.json(
          createValidationError(`${field} field is required and must be a non-empty string`).toResponse(),
          { status: 400 }
        );
      }
    }

    const missionId = body.missionId === undefined || body.missionId === null ? null : body.missionId;
    const detail = body.detail === undefined || body.detail === null ? null : body.detail;

    const data = {
      projectId,
      missionId,
      source: body.source as string,
      severity: body.severity as string,
      attributedAgent: body.attributedAgent as string,
      targetSurface: body.targetSurface as string,
      pattern: body.pattern as string,
      fingerprint: body.fingerprint as string,
      title: body.title as string,
      detail,
    };

    // Dedupe only applies when a learning is attributed to a specific mission;
    // null-missionId rows (backfill) are always distinct inserts.
    if (missionId !== null) {
      // Verify the mission exists AND belongs to the requesting project before
      // touching RetroLearning — otherwise a foreign or nonexistent missionId
      // either links a row across tenants or throws an unhandled FK violation.
      // A single project-scoped lookup covers both cases without leaking which
      // one occurred (both resolve to the same 404).
      const mission = await prisma.mission.findFirst({ where: { id: missionId, projectId } });
      if (!mission) {
        return NextResponse.json(
          { success: false, error: { code: 'MISSION_NOT_FOUND', message: `Mission ${missionId} not found` } },
          { status: 404 }
        );
      }

      const existing = await prisma.retroLearning.findFirst({
        where: { projectId, missionId, fingerprint: data.fingerprint },
      });
      if (existing) {
        return NextResponse.json({ success: true, data: { id: existing.id } }, { status: 200 });
      }
    }

    const created = await prisma.retroLearning.create({ data });

    return NextResponse.json({ success: true, data: { id: created.id } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/learnings error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to capture learning', error).toResponse(),
      { status: 500 }
    );
  }
}
