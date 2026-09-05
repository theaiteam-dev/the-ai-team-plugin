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
import { SEVERITY_VALUES } from '@ai-team/shared';
import type { Severity } from '@ai-team/shared';

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
// Reuses the single shared source of truth — also used by Item.severity
// (POST/PATCH /api/items, WI-936) so both surfaces validate identically.
const VALID_SEVERITIES = SEVERITY_VALUES;

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
  sourceItemId?: string | null;
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

    const missionId = body.missionId === undefined || body.missionId === null ? null : body.missionId;

    // Verify the mission exists AND belongs to the requesting project before
    // ANY write — otherwise a foreign or nonexistent missionId either links a
    // row across tenants, throws an unhandled FK violation, or (for the
    // Fingerprint upsert and Project provisioning below) leaves a side effect
    // behind despite the request being rejected. A single project-scoped
    // lookup covers both cases without leaking which one occurred (both
    // resolve to the same 404). Dedupe/writes only apply when a learning is
    // attributed to a specific mission; null-missionId rows (backfill) are
    // always distinct inserts and have no owner to check.
    //
    // This runs before ensureProject below: the lookup filters on
    // Mission.projectId directly (a plain WHERE, not a FK join), so it needs
    // no Project row to exist — only the eventual RetroLearning/Fingerprint
    // writes do. Checking mission ownership first means a never-before-seen
    // project ID with a bad missionId never provisions a Project row either,
    // consistent with the rule below.
    if (missionId !== null) {
      const mission = await prisma.mission.findFirst({ where: { id: missionId, projectId } });
      if (!mission) {
        return NextResponse.json(createMissionNotFoundError(missionId).toResponse(), { status: 404 });
      }
    }

    // Only provision the Project row once the payload and mission are
    // known-valid — otherwise a well-formed but invalid request from a
    // never-before-seen project ID would still leave behind a Project row
    // despite the rejection.
    await ensureProject(projectId);

    const detail = body.detail === undefined || body.detail === null ? null : body.detail;
    const sourceItemId =
      body.sourceItemId === undefined || body.sourceItemId === null ? null : body.sourceItemId;

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
      sourceItemId,
    };

    // WI-936: when the capture names a source item, dedupe keys on
    // (projectId, missionId, sourceItemId) instead of fingerprint — a
    // source-item-derived capture updates its existing row even if the
    // fingerprint changed between captures. Preserves the original
    // fingerprint-keyed dedupe exactly for captures with no source item.
    const dedupeWhere = sourceItemId !== null
      ? { projectId, missionId, sourceItemId }
      : { projectId, missionId, fingerprint: data.fingerprint };

    // RetroLearning.fingerprint is a required FK to Fingerprint.slug, so the
    // Fingerprint row must exist before ANY write that references it — the
    // create below, but also the sourceItemId-keyed update path just below,
    // which can rewrite `fingerprint` to a brand-new slug on a re-capture. Do
    // this before the dedupe check so both writers are covered by one call;
    // create carries this capture's pattern/severity, update is a no-op so we
    // never clobber values another surface (e.g. a merge) may own. This runs
    // after the mission-ownership check above so a rejected request never
    // leaves a Fingerprint row behind.
    await prisma.fingerprint.upsert({
      where: { slug: data.fingerprint },
      update: {},
      create: { slug: data.fingerprint, pattern: data.pattern, severity: data.severity },
    });

    if (missionId !== null) {
      const existing = await prisma.retroLearning.findFirst({ where: dedupeWhere });
      if (existing) {
        // Source-item-derived rows are re-captured across debrief re-runs
        // (e.g. a fix bounces, then lands — the outcome in `detail` changes)
        // — a re-run must UPDATE the stored content, not just report the
        // same id back unchanged. Fingerprint-only (no sourceItemId) hits
        // keep the original find-and-return-unchanged behavior exactly —
        // that path is ad-hoc capture, not idempotent re-derivation, and is
        // out of scope for this fix.
        if (sourceItemId !== null) {
          const mutableFields = {
            source: data.source,
            severity: data.severity,
            attributedAgent: data.attributedAgent,
            targetSurface: data.targetSurface,
            pattern: data.pattern,
            fingerprint: data.fingerprint,
            title: data.title,
            detail: data.detail,
          };
          await prisma.retroLearning.update({ where: { id: existing.id }, data: mutableFields });
          return NextResponse.json(
            { success: true, data: { id: existing.id, ...mutableFields } },
            { status: 200 }
          );
        }
        return NextResponse.json({ success: true, data: { id: existing.id } }, { status: 200 });
      }
    }

    // The findFirst above is a fast-path, not a guarantee: two concurrent POSTs
    // can both pass it before either inserts. The unique index matching
    // dedupeWhere's key (either @@unique([projectId, missionId, fingerprint])
    // or the sourceItemId-keyed one, WI-936) is the real dedupe backstop — on a
    // P2002 collision, re-fetch the row the winning insert created and return
    // it (200), matching the deduped-row semantics instead of surfacing a 500.
    // Null-missionId rows are never constrained, so this branch only fires for
    // real missions.
    try {
      const created = await prisma.retroLearning.create({ data });
      return NextResponse.json({ success: true, data: { id: created.id } }, { status: 201 });
    } catch (error) {
      if (isUniqueConstraintViolation(error) && missionId !== null) {
        const existing = await prisma.retroLearning.findFirst({ where: dedupeWhere });
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
