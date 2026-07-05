/**
 * API Route: /api/tuning/proposals/{id}
 *
 * PATCH - Apply a tuning verb to a proposal: accept | edit | merge.
 *
 * `defer` no longer lives here: in the collapsed verb set (reject/demote are
 * gone, folded into a durable defer) defer acts on a FINGERPRINT before any
 * proposal exists, so it's `POST /api/tuning/fingerprints/{slug}/defer`
 * instead. This route only ever operates on an *already-created*
 * TuningProposal (accept/edit/merge).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createValidationError } from '@/lib/errors';
import { areAllCorroborated } from '@/lib/corroboration';
import type { ApiError } from '@/types/api';

const VALID_ALTITUDES = ['skill-text', 'agent-prompt', 'hook'] as const;
type Altitude = (typeof VALID_ALTITUDES)[number];

function isValidAltitude(value: unknown): value is Altitude {
  return typeof value === 'string' && (VALID_ALTITUDES as readonly string[]).includes(value);
}

interface PatchBody {
  verb?: string;
  proposalText?: string;
  targetSurface?: string;
  mergeIntoFingerprint?: string;
  altitude?: string;
}

/** Thrown inside the merge transaction to short-circuit to a 422 without any write. */
class SameMissionMergeError extends Error {
  constructor(
    public readonly sources: string[],
    public readonly target: string
  ) {
    super(
      `Cannot merge: fingerprint(s) [${sources.join(', ')}] share a mission with "${target}" — ` +
        `they are distinct facets of one mission's evidence, not independent corroboration.`
    );
    this.name = 'SameMissionMergeError';
  }
}

/** Thrown inside the merge transaction when the proposal has nothing to merge. */
class NoMergeSourceError extends Error {
  constructor() {
    super('Proposal has no linked fingerprints to merge (other than the merge target)');
    this.name = 'NoMergeSourceError';
  }
}

/**
 * PATCH /api/tuning/proposals/:id
 *
 * Body: { verb: 'accept'|'edit'|'merge', proposalText?, targetSurface?,
 *         mergeIntoFingerprint?, altitude? }
 *
 * accept/edit promote a proposal to status='accepted' (Phase 3 wires
 * accepted->eval; this mission stops at 'accepted'). Every valid altitude is a
 * system-rule altitude, so both are gated by FR-9 promotion corroboration —
 * 422 unless EVERY fingerprint linked to the proposal is individually
 * corroborated (>=3 distinct missions, global — see @/lib/corroboration).
 * edit additionally accepts targetSurface/altitude to re-target the agreed
 * surface as a first-class edit of the proposal, no new row required (this
 * folds in what a `demote`-style re-scope used to require a separate verb
 * for).
 *
 * merge is NOT a promotion (no gate). It de-aliases a duplicate fingerprint
 * slug into a canonical one — but ONLY across evidence from DIFFERENT
 * missions; two fingerprints that co-occur within the SAME mission are
 * distinct facets of that one mission, not corroboration duplicates, so
 * merging them could never legitimately reach the distinct-mission threshold
 * and is rejected with 422.
 *
 * `reject`/`demote` are gone (collapsed into the durable `defer` watermark —
 * see POST /api/tuning/fingerprints/{slug}/defer) and are no longer valid
 * verbs here.
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

    const { id } = await params;
    const proposalId = Number(id);

    const proposal = Number.isInteger(proposalId)
      ? await prisma.tuningProposal.findUnique({
          where: { id: proposalId },
          include: { fingerprints: { select: { slug: true } } },
        })
      : null;

    if (!proposal) {
      const notFound: ApiError = {
        success: false,
        error: { code: 'PROPOSAL_NOT_FOUND', message: `TuningProposal ${id} not found` },
      };
      return NextResponse.json(notFound, { status: 404 });
    }

    const linkedFingerprints = proposal.fingerprints.map((f) => f.slug);

    const body = (await request.json()) as PatchBody;
    const verb = body.verb;

    switch (verb) {
      case 'accept':
      case 'edit': {
        const corroborated = await areAllCorroborated(linkedFingerprints);
        if (!corroborated) {
          const gated: ApiError = {
            success: false,
            error: {
              code: 'NOT_CORROBORATED',
              message:
                'Promotion blocked: not every fingerprint linked to this proposal is corroborated (needs >=3 distinct missions).',
            },
          };
          return NextResponse.json(gated, { status: 422 });
        }

        const data: Record<string, unknown> = { status: 'accepted' };
        if (verb === 'edit') {
          if (typeof body.proposalText === 'string') data.proposalText = body.proposalText;
          if (typeof body.targetSurface === 'string' && body.targetSurface.length > 0) {
            data.targetSurface = body.targetSurface;
          }
          if (isValidAltitude(body.altitude)) data.altitude = body.altitude;
        }

        const updated = await prisma.tuningProposal.update({
          where: { id: proposal.id },
          data,
        });

        return NextResponse.json({ success: true, data: { id: updated.id, status: updated.status } });
      }

      case 'merge': {
        const mergeIntoFingerprint = body.mergeIntoFingerprint;
        if (typeof mergeIntoFingerprint !== 'string' || mergeIntoFingerprint.length === 0) {
          return NextResponse.json(
            createValidationError('mergeIntoFingerprint is required and must be a non-empty string').toResponse(),
            { status: 400 }
          );
        }

        try {
          const result = await prisma.$transaction(async (tx) => {
            const sourceFingerprints = linkedFingerprints.filter((slug) => slug !== mergeIntoFingerprint);

            if (sourceFingerprints.length === 0) {
              throw new NoMergeSourceError();
            }

            // Same-mission guard (FR-7): source and target must not share ANY
            // mission. If they do, they're distinct facets of one mission's
            // evidence, not independent corroboration, and merging them can
            // never legitimately reach the distinct-mission threshold.
            const [sourceRows, targetRows] = await Promise.all([
              tx.retroLearning.findMany({
                where: { fingerprint: { in: sourceFingerprints }, missionId: { not: null } },
                select: { missionId: true },
              }),
              tx.retroLearning.findMany({
                where: { fingerprint: mergeIntoFingerprint, missionId: { not: null } },
                select: { missionId: true },
              }),
            ]);
            const targetMissionIds = new Set(targetRows.map((r) => r.missionId));
            const overlaps = sourceRows.some((r) => targetMissionIds.has(r.missionId));
            if (overlaps) {
              throw new SameMissionMergeError(sourceFingerprints, mergeIntoFingerprint);
            }

            // Ensure the target Fingerprint row exists — derive pattern/severity
            // from a source Fingerprint row when the target slug is brand new.
            const sourceFingerprintRows = await tx.fingerprint.findMany({
              where: { slug: { in: sourceFingerprints } },
            });
            const representative = sourceFingerprintRows[0];
            await tx.fingerprint.upsert({
              where: { slug: mergeIntoFingerprint },
              update: {},
              create: {
                slug: mergeIntoFingerprint,
                pattern: representative?.pattern ?? mergeIntoFingerprint,
                severity: representative?.severity ?? 'medium',
              },
            });

            // Re-link every OTHER proposal referencing a source fingerprint to
            // the target BEFORE the source Fingerprint rows are deleted, so no
            // proposal silently loses its fingerprint association.
            const affectedProposals = await tx.tuningProposal.findMany({
              where: { fingerprints: { some: { slug: { in: sourceFingerprints } } } },
              select: { id: true },
            });
            for (const p of affectedProposals) {
              await tx.tuningProposal.update({
                where: { id: p.id },
                data: {
                  fingerprints: {
                    disconnect: sourceFingerprints.map((slug) => ({ slug })),
                    connect: { slug: mergeIntoFingerprint },
                  },
                },
              });
            }

            // Re-point EVERY RetroLearning row sharing a source fingerprint
            // (global — every project, every status) so historical hit counts
            // sum onto the target fingerprint after the merge.
            const { count } = await tx.retroLearning.updateMany({
              where: { fingerprint: { in: sourceFingerprints } },
              data: { fingerprint: mergeIntoFingerprint },
            });

            await tx.fingerprint.deleteMany({ where: { slug: { in: sourceFingerprints } } });

            return { mergedLearnings: count, mergedFingerprints: sourceFingerprints };
          });

          return NextResponse.json({
            success: true,
            data: { id: proposal.id, mergeIntoFingerprint, ...result },
          });
        } catch (error) {
          if (error instanceof SameMissionMergeError) {
            const conflict: ApiError = {
              success: false,
              error: { code: 'SAME_MISSION_MERGE', message: error.message },
            };
            return NextResponse.json(conflict, { status: 422 });
          }
          if (error instanceof NoMergeSourceError) {
            return NextResponse.json(createValidationError(error.message).toResponse(), { status: 400 });
          }
          throw error;
        }
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
