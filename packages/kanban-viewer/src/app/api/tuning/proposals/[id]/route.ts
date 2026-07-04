/**
 * API Route: /api/tuning/proposals/{id}
 *
 * PATCH - Apply a tuning verb to a proposal: accept | edit | defer | merge |
 *         demote | reject.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createValidationError } from '@/lib/errors';
import { getCorroboration } from '@/lib/corroboration';
import type { ApiError } from '@/types/api';

interface PatchBody {
  verb?: string;
  proposalText?: string;
  mergeIntoFingerprint?: string;
  dismissalNote?: string;
  altitude?: string;
}

/**
 * A proposal is corroborated when every distinct fingerprint among its
 * linked RetroLearnings (via proposalId, clustered by the WI-213 draft route)
 * is corroborated per WI-212's getCorroboration (>=3 in-project hits OR a
 * cross-project hit). A proposal with no linked learnings is not corroborated.
 */
async function isProposalCorroborated(projectId: string, proposalId: number): Promise<boolean> {
  const learnings = await prisma.retroLearning.findMany({
    where: { proposalId },
    select: { fingerprint: true },
  });
  const fingerprints = Array.from(new Set(learnings.map((l) => l.fingerprint)));
  if (fingerprints.length === 0) {
    return false;
  }
  const results = await Promise.all(fingerprints.map((fp) => getCorroboration(projectId, fp)));
  return results.every((r) => r.corroborated);
}

/**
 * PATCH /api/tuning/proposals/:id
 *
 * Body: { verb: 'accept'|'edit'|'defer'|'merge'|'demote'|'reject', proposalText?,
 *         mergeIntoFingerprint?, dismissalNote?, altitude? }
 *
 * accept/edit promote a proposal to status='accepted' (Phase 3 wires
 * accepted->eval; this mission stops at 'accepted'). Every valid altitude is a
 * system-rule altitude, so both are gated by FR-9 promotion corroboration —
 * 422 if the proposal's fingerprint(s) aren't corroborated. defer is not a
 * promotion and bypasses the gate, leaving the proposal untouched so it
 * resurfaces next round. merge/demote/reject are NOT promotions either (no
 * gate): merge re-points every project row sharing the source fingerprint to
 * mergeIntoFingerprint so hit counts sum across history; reject writes a
 * durable dismissal (status='dismissed' + dismissalNote, FR-8); demote writes
 * that same durable dismissal on the original altitude and additionally
 * creates a live proposal re-scoped down to the supplied lower altitude.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    const { id } = await params;
    const proposalId = Number(id);

    const proposal = Number.isInteger(proposalId)
      ? await prisma.tuningProposal.findFirst({ where: { id: proposalId, projectId } })
      : null;

    if (!proposal) {
      const notFound: ApiError = {
        success: false,
        error: { code: 'PROPOSAL_NOT_FOUND', message: `TuningProposal ${id} not found` },
      };
      return NextResponse.json(notFound, { status: 404 });
    }

    const body = (await request.json()) as PatchBody;
    const verb = body.verb;

    switch (verb) {
      case 'accept':
      case 'edit': {
        const corroborated = await isProposalCorroborated(projectId, proposal.id);
        if (!corroborated) {
          const gated: ApiError = {
            success: false,
            error: {
              code: 'NOT_CORROBORATED',
              message:
                'Promotion blocked: proposal fingerprint is not corroborated (needs >=3 in-project hits or a cross-project hit).',
            },
          };
          return NextResponse.json(gated, { status: 422 });
        }

        const data =
          verb === 'edit' && typeof body.proposalText === 'string'
            ? { status: 'accepted', proposalText: body.proposalText }
            : { status: 'accepted' };

        const updated = await prisma.tuningProposal.update({
          where: { id: proposal.id },
          data,
        });

        return NextResponse.json({ success: true, data: { id: updated.id, status: updated.status } });
      }

      case 'defer': {
        // Not a promotion — no gate, no write. The proposal stays 'draft' so
        // it resurfaces on the next tuning walk round.
        return NextResponse.json({ success: true, data: { id: proposal.id, status: proposal.status } });
      }

      case 'merge': {
        const mergeIntoFingerprint = body.mergeIntoFingerprint;
        if (typeof mergeIntoFingerprint !== 'string' || mergeIntoFingerprint.length === 0) {
          return NextResponse.json(
            createValidationError('mergeIntoFingerprint is required and must be a non-empty string').toResponse(),
            { status: 400 }
          );
        }

        // Source fingerprint(s) come from the proposal's currently-linked
        // learnings, but the re-point itself must cover EVERY project row
        // sharing that fingerprint across every status (not just the linked
        // subset) so historical hit counts sum after the merge.
        const linked = await prisma.retroLearning.findMany({
          where: { proposalId: proposal.id },
          select: { fingerprint: true },
        });
        const sourceFingerprints = Array.from(new Set(linked.map((l) => l.fingerprint)));

        if (sourceFingerprints.length > 0) {
          await prisma.retroLearning.updateMany({
            where: { projectId, fingerprint: { in: sourceFingerprints } },
            data: { fingerprint: mergeIntoFingerprint },
          });
        }

        return NextResponse.json({ success: true, data: { id: proposal.id } });
      }

      case 'reject': {
        const dismissalNote = body.dismissalNote;
        if (typeof dismissalNote !== 'string' || dismissalNote.length === 0) {
          return NextResponse.json(
            createValidationError('dismissalNote is required and must be a non-empty string').toResponse(),
            { status: 400 }
          );
        }

        const updated = await prisma.tuningProposal.update({
          where: { id: proposal.id },
          data: { status: 'dismissed', dismissalNote },
        });

        return NextResponse.json({ success: true, data: { id: updated.id, status: updated.status } });
      }

      case 'demote': {
        const dismissalNote = body.dismissalNote;
        if (typeof dismissalNote !== 'string' || dismissalNote.length === 0) {
          return NextResponse.json(
            createValidationError('dismissalNote is required and must be a non-empty string').toResponse(),
            { status: 400 }
          );
        }
        const altitude = body.altitude;
        if (typeof altitude !== 'string' || altitude.length === 0) {
          return NextResponse.json(
            createValidationError('altitude is required and must be a non-empty string').toResponse(),
            { status: 400 }
          );
        }

        // The rule is real but belongs lower: the current row becomes the
        // durable dismissed record on its ORIGINAL altitude carrying the note,
        // and a new row represents the rule re-scoped down to the supplied
        // lower altitude (there's no target-altitude column, so a live row AT
        // that altitude is the only way to express "re-scoped down"). Both
        // writes run in one transaction — a fault between them must not leave
        // a half-completed demote indistinguishable from a plain reject.
        const { dismissed, rescoped } = await prisma.$transaction(async (tx) => {
          const dismissedRow = await tx.tuningProposal.update({
            where: { id: proposal.id },
            data: { status: 'dismissed', dismissalNote },
          });

          const rescopedRow = await tx.tuningProposal.create({
            data: {
              projectId,
              targetSurface: proposal.targetSurface,
              altitude,
              proposalText: proposal.proposalText,
            },
          });

          return { dismissed: dismissedRow, rescoped: rescopedRow };
        });

        return NextResponse.json({
          success: true,
          data: { dismissedId: dismissed.id, rescopedId: rescoped.id },
        });
      }

      default:
        return NextResponse.json(
          createValidationError(`Unknown verb: ${String(verb)}`).toResponse(),
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('PATCH /api/tuning/proposals/[id] error:', error);
    const serverError: ApiError = {
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to apply tuning verb' },
    };
    return NextResponse.json(serverError, { status: 500 });
  }
}
