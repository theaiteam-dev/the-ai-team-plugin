/**
 * API Route: /api/tuning/proposals
 *
 * POST - Create a TuningProposal. Proposals are GLOBAL and post-agreement
 *        (Phase A): there is no eager "draft" creation for browsing — a
 *        card is a VIEW over a fingerprint (see /api/tuning/candidates)
 *        until the maintainer actually agrees to act on it. This POST *is*
 *        that agreement: it links the proposal to one or more fingerprints,
 *        stores the agreed targetSurface/altitude/proposalText, and is
 *        gated by the same FR-9 corroboration check as the accept/edit
 *        verbs on /api/tuning/proposals/{id} — every linked fingerprint
 *        must be corroborated, or the whole create is rejected with 422.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError, createValidationError } from '@/lib/errors';
import { areAllCorroborated } from '@/lib/corroboration';
import type { ApiError } from '@/types/api';

const VALID_ALTITUDES = ['skill-text', 'agent-prompt', 'hook'] as const;
type Altitude = (typeof VALID_ALTITUDES)[number];

interface CreateProposalBody {
  fingerprints?: unknown;
  targetSurface?: unknown;
  altitude?: unknown;
  proposalText?: unknown;
}

/**
 * POST /api/tuning/proposals
 *
 * Body: { fingerprints: string[], targetSurface: string, altitude: string, proposalText: string }
 *
 * Creates the proposal with status='accepted' directly — the POST itself is
 * the agreement, so there is no separate later "accept" step for a brand-new
 * proposal (accept/edit on /{id} exist for re-confirming or amending an
 * already-created one).
 */
export async function POST(request: Request) {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    let body: CreateProposalBody;
    try {
      body = (await request.json()) as CreateProposalBody;
    } catch {
      return NextResponse.json(
        createValidationError('Request body must be valid JSON').toResponse(),
        { status: 400 }
      );
    }

    const fingerprints = body.fingerprints;
    if (
      !Array.isArray(fingerprints) ||
      fingerprints.length === 0 ||
      !fingerprints.every((fp): fp is string => typeof fp === 'string' && fp.length > 0)
    ) {
      return NextResponse.json(
        createValidationError('fingerprints must be a non-empty array of non-empty strings').toResponse(),
        { status: 400 }
      );
    }
    const fingerprintSlugs = Array.from(new Set(fingerprints));

    const targetSurface = body.targetSurface;
    if (typeof targetSurface !== 'string' || targetSurface.length === 0) {
      return NextResponse.json(
        createValidationError('targetSurface field is required and must be a non-empty string').toResponse(),
        { status: 400 }
      );
    }

    const altitude = body.altitude;
    if (typeof altitude !== 'string' || !VALID_ALTITUDES.includes(altitude as Altitude)) {
      return NextResponse.json(
        createValidationError(`altitude must be one of: ${VALID_ALTITUDES.join(', ')}`).toResponse(),
        { status: 400 }
      );
    }

    const proposalText = body.proposalText;
    if (typeof proposalText !== 'string' || proposalText.length === 0) {
      return NextResponse.json(
        createValidationError('proposalText field is required and must be a non-empty string').toResponse(),
        { status: 400 }
      );
    }

    const existingFingerprints = await prisma.fingerprint.findMany({
      where: { slug: { in: fingerprintSlugs } },
      select: { slug: true },
    });
    const existingSlugs = new Set(existingFingerprints.map((f) => f.slug));
    const missingSlugs = fingerprintSlugs.filter((slug) => !existingSlugs.has(slug));
    if (missingSlugs.length > 0) {
      return NextResponse.json(
        createValidationError(`unknown fingerprint(s): ${missingSlugs.join(', ')}`).toResponse(),
        { status: 400 }
      );
    }

    const corroborated = await areAllCorroborated(fingerprintSlugs);
    if (!corroborated) {
      const gated: ApiError = {
        success: false,
        error: {
          code: 'NOT_CORROBORATED',
          message:
            'Promotion blocked: not every linked fingerprint is corroborated (needs >=3 distinct missions).',
        },
      };
      return NextResponse.json(gated, { status: 422 });
    }

    const proposal = await prisma.tuningProposal.create({
      data: {
        targetSurface,
        altitude,
        proposalText,
        status: 'accepted',
        fingerprints: { connect: fingerprintSlugs.map((slug) => ({ slug })) },
      },
      include: { fingerprints: { select: { slug: true } } },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: proposal.id,
          status: proposal.status,
          fingerprints: proposal.fingerprints.map((f) => f.slug),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/tuning/proposals error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to create tuning proposal', error).toResponse(),
      { status: 500 }
    );
  }
}
