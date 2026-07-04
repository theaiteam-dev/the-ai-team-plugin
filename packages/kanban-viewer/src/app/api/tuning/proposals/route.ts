/**
 * API Route: /api/tuning/proposals
 *
 * POST - Draft a TuningProposal for one target surface, clustering that
 *        surface's live (open/recurred) RetroLearnings into the proposal and
 *        linking them via proposalId. proposalText is not synthesized here —
 *        that happens later on accept/edit (FR-7).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId, ensureProject } from '@/lib/project-utils';
import { createDatabaseError, createValidationError } from '@/lib/errors';
import type { ApiError } from '@/types/api';

const VALID_ALTITUDES = ['skill-text', 'agent-prompt', 'hook'] as const;
type Altitude = (typeof VALID_ALTITUDES)[number];

// A learning is "live" (still worth acting on) while open or recurred.
// Resolved/dismissed rows are excluded from clustering and stay unlinked.
const LIVE_STATUSES = ['open', 'recurred'];

interface CreateProposalBody {
  targetSurface: string;
  altitude: string;
  proposalText?: string | null;
}

/** Thrown inside the transaction to short-circuit to a 400 without a create. */
class NoLiveLearningsError extends Error {
  constructor(targetSurface: string) {
    super(`No live learnings for targetSurface "${targetSurface}"`);
    this.name = 'NoLiveLearningsError';
  }
}

/**
 * POST /api/tuning/proposals
 *
 * Body: { targetSurface, altitude, proposalText? }
 *
 * Idempotent per (projectId, targetSurface, status='draft') — a second POST
 * for a surface with an already-open draft resumes that draft (re-linking
 * any newly-live learnings) instead of creating a duplicate.
 */
export async function POST(request: Request) {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;
    await ensureProject(projectId);

    const body = (await request.json()) as Partial<CreateProposalBody> & Record<string, unknown>;

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

    const proposalText = typeof body.proposalText === 'string' ? body.proposalText : '';

    // The whole check-then-act sequence runs inside one transaction to prevent
    // a TOCTOU race: two concurrent POSTs for a brand-new surface could both
    // pass the existing-draft check and both create a draft, violating the
    // one-open-draft-per-surface invariant (AC6). Matches the established
    // pattern in board/claim/route.ts and agents/start/route.ts.
    const result = await prisma.$transaction(async (tx) => {
      const liveLearnings = await tx.retroLearning.findMany({
        where: { projectId, targetSurface, status: { in: LIVE_STATUSES } },
      });

      if (liveLearnings.length === 0) {
        throw new NoLiveLearningsError(targetSurface);
      }

      const existingDraft = await tx.tuningProposal.findFirst({
        where: { projectId, targetSurface, status: 'draft' },
      });

      const proposal =
        existingDraft ??
        (await tx.tuningProposal.create({
          data: { projectId, targetSurface, altitude, proposalText },
        }));

      await tx.retroLearning.updateMany({
        where: { projectId, targetSurface, status: { in: LIVE_STATUSES } },
        data: { proposalId: proposal.id },
      });

      return {
        id: proposal.id,
        linkedLearningIds: liveLearnings.map((l) => l.id),
        resumed: existingDraft !== null,
      };
    });

    return NextResponse.json(
      { success: true, data: { id: result.id, linkedLearningIds: result.linkedLearningIds } },
      { status: result.resumed ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof NoLiveLearningsError) {
      return NextResponse.json(createValidationError(error.message).toResponse(), { status: 400 });
    }
    console.error('POST /api/tuning/proposals error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to create tuning proposal', error).toResponse(),
      { status: 500 }
    );
  }
}
