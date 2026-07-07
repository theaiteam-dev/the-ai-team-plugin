/**
 * API Route: /api/learnings
 *
 * POST - Capture a RetroLearning row for the retro agent's Debrief and the
 *        corpus backfill, deduping duplicate fingerprints within a mission.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId, ensureProject } from '@/lib/project-utils';
import { createDatabaseError, createMissionNotFoundError, createValidationError } from '@/lib/errors';
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

// The column vocabulary. Review-surface terms (Must Fix / Should Fix /
// Consider) are mapped to these at the capture boundary (sweep/retro prompts),
// never stored raw — a typo here would silently never match rank/tuning.
const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
type Severity = (typeof VALID_SEVERITIES)[number];

/**
 * Prisma raises P2002 when an insert violates a unique constraint. We match on
 * the code alone (not `instanceof PrismaClientKnownRequestError`) so the check
 * survives mocked errors in tests and any client-bundling quirks.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

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

    if (!VALID_SEVERITIES.includes(body.severity as Severity)) {
      return NextResponse.json(
        createValidationError(`severity must be one of: ${VALID_SEVERITIES.join(', ')}`).toResponse(),
        { status: 400 }
      );
    }

    // Only provision the Project row once the payload is known-valid — otherwise
    // a well-formed but invalid request from a never-before-seen project ID would
    // still leave behind a Project row despite the 400.
    await ensureProject(projectId);

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
        return NextResponse.json(createMissionNotFoundError(missionId).toResponse(), { status: 404 });
      }

      const existing = await prisma.retroLearning.findFirst({
        where: { projectId, missionId, fingerprint: data.fingerprint },
      });
      if (existing) {
        return NextResponse.json({ success: true, data: { id: existing.id } }, { status: 200 });
      }
    }

    // The findFirst above is a fast-path, not a guarantee: two concurrent POSTs
    // can both pass it before either inserts. The @@unique([projectId, missionId,
    // fingerprint]) index is the real dedupe backstop — on a P2002 collision,
    // re-fetch the row the winning insert created and return it (200), matching
    // the deduped-row semantics instead of surfacing a 500. Null-missionId rows
    // are never constrained, so this branch only fires for real missions.
    try {
      const created = await prisma.retroLearning.create({ data });
      return NextResponse.json({ success: true, data: { id: created.id } }, { status: 201 });
    } catch (error) {
      if (isUniqueConstraintViolation(error) && missionId !== null) {
        const existing = await prisma.retroLearning.findFirst({
          where: { projectId, missionId, fingerprint: data.fingerprint },
        });
        if (existing) {
          return NextResponse.json({ success: true, data: { id: existing.id } }, { status: 200 });
        }
      }
      throw error;
    }
  } catch (error) {
    console.error('POST /api/learnings error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to capture learning', error).toResponse(),
      { status: 500 }
    );
  }
}
