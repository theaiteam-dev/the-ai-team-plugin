/**
 * API Route: /api/tuning/fingerprints/{slug}/defer
 *
 * POST - Durable "not now" for a fingerprint (FR-8, collapsed verb set):
 *        records the fingerprint's CURRENT distinctMissions as a watermark
 *        (Fingerprint.deferredAtMissions). The candidate walk
 *        (GET /api/tuning/candidates) then reports this fingerprint as
 *        `actionable: false` until distinctMissions climbs DEFER_MARGIN past
 *        that watermark — more evidence, not a fixed cooldown, is what brings
 *        it back.
 *
 * Fingerprint-scoped, not proposal-scoped: unlike the old reject/demote verbs
 * (which required an already-existing TuningProposal id, forcing a throwaway
 * `propose` call just to dismiss a fresh card), defer needs nothing but the
 * fingerprint slug — a proposal may never exist for a deferred fingerprint at
 * all.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError } from '@/lib/errors';
import { getCorroboration } from '@/lib/corroboration';
import type { ApiError } from '@/types/api';

/**
 * POST /api/tuning/fingerprints/:slug/defer
 *
 * No request body. Sets deferredAtMissions = the fingerprint's current
 * distinctMissions (computed the same way GET /api/tuning/candidates and
 * @/lib/corroboration do — COUNT(DISTINCT missionId), missionId not null).
 * 404 if the fingerprint slug doesn't exist.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const { slug } = await params;

    const fingerprint = await prisma.fingerprint.findUnique({ where: { slug } });
    if (!fingerprint) {
      const notFound: ApiError = {
        success: false,
        error: { code: 'FINGERPRINT_NOT_FOUND', message: `Fingerprint ${slug} not found` },
      };
      return NextResponse.json(notFound, { status: 404 });
    }

    const { distinctMissions } = await getCorroboration(slug);

    const updated = await prisma.fingerprint.update({
      where: { slug },
      data: { deferredAtMissions: distinctMissions },
    });

    return NextResponse.json({
      success: true,
      data: {
        slug: updated.slug,
        deferredAtMissions: updated.deferredAtMissions,
        distinctMissions,
      },
    });
  } catch (error) {
    console.error('POST /api/tuning/fingerprints/[slug]/defer error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to defer fingerprint', error).toResponse(),
      { status: 500 }
    );
  }
}
