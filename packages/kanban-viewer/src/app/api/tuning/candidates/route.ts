/**
 * API Route: /api/tuning/candidates
 *
 * GET - The tuning walk's ordered candidate list (FR-8): recurrence-ranked
 *       live fingerprints (same semantics as /api/learnings/rank) PLUS
 *       previously-dismissed fingerprints that new evidence resurfaces.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createDatabaseError } from '@/lib/errors';
import { getCorroboration } from '@/lib/corroboration';
import type { ApiError } from '@/types/api';

const LIVE_STATUSES = new Set(['open', 'recurred']);

// A dismissed fingerprint resurfaces once it accrues this many new
// RetroLearning rows since dismissal — see getCorroboration for the
// single-source-of-truth threshold this mirrors for the cross-project leg.
const NEW_HITS_RESURFACE_THRESHOLD = 3;

const SEVERITY_ORDINAL: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
function severityOrdinal(severity: string): number {
  return SEVERITY_ORDINAL[severity] ?? -1;
}

interface CandidateRow {
  fingerprint: string;
  pattern: string;
  targetSurface: string;
  severity: string;
  hits: number;
  resurfaced?: true;
  dismissalNote?: string | null;
}

interface FingerprintGroup {
  fingerprint: string;
  pattern: string;
  targetSurface: string;
  severity: string;
  hits: number;
  hasLiveRow: boolean;
  createdAts: Date[];
  proposalIds: Set<number>;
}

/**
 * GET /api/tuning/candidates
 *
 * Builds on the grouping logic in /api/learnings/rank: groups the project's
 * RetroLearning rows by fingerprint, with hits = full historical row count
 * (incl. resolved/dismissed) and a representative pattern/targetSurface
 * (latest row wins) / severity (hottest-seen wins).
 *
 * A fingerprint whose latest linked TuningProposal (via RetroLearning.proposalId)
 * is status='dismissed' is excluded UNLESS it resurfaces: >=3 new RetroLearning
 * rows created after the proposal's updatedAt (DISMISSAL-CLOCK ASSUMPTION: a
 * dismissed proposal receives no further writes, so updatedAt is a stable proxy
 * for the dismissal timestamp), OR a cross-project hit per WI-212's
 * getCorroboration. Resurfaced entries carry resurfaced:true and the original
 * dismissalNote so the operator re-decides with memory.
 */
export async function GET(request: Request) {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    const rows = await prisma.retroLearning.findMany({
      where: { projectId },
      select: {
        fingerprint: true,
        pattern: true,
        targetSurface: true,
        severity: true,
        status: true,
        createdAt: true,
        proposalId: true,
      },
      // Oldest-first so the last row iterated per fingerprint is the most
      // recent, matching the rank route's representative-field selection.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const groups = new Map<string, FingerprintGroup>();
    for (const row of rows) {
      let group = groups.get(row.fingerprint);
      if (!group) {
        group = {
          fingerprint: row.fingerprint,
          pattern: row.pattern,
          targetSurface: row.targetSurface,
          severity: row.severity,
          hits: 0,
          hasLiveRow: false,
          createdAts: [],
          proposalIds: new Set(),
        };
        groups.set(row.fingerprint, group);
      }
      group.hits += 1;
      if (LIVE_STATUSES.has(row.status)) {
        group.hasLiveRow = true;
      }
      group.pattern = row.pattern;
      group.targetSurface = row.targetSurface;
      if (severityOrdinal(row.severity) > severityOrdinal(group.severity)) {
        group.severity = row.severity;
      }
      group.createdAts.push(row.createdAt);
      if (row.proposalId !== null) {
        group.proposalIds.add(row.proposalId);
      }
    }

    const allProposalIds = Array.from(
      new Set(Array.from(groups.values()).flatMap((g) => Array.from(g.proposalIds)))
    );
    const proposals = allProposalIds.length
      ? await prisma.tuningProposal.findMany({ where: { id: { in: allProposalIds } } })
      : [];
    const proposalsById = new Map(proposals.map((p) => [p.id, p]));

    const candidates: CandidateRow[] = [];

    for (const group of groups.values()) {
      const linkedProposals = Array.from(group.proposalIds)
        .map((id) => proposalsById.get(id))
        .filter((p): p is NonNullable<typeof p> => p !== undefined);

      const latestProposal = linkedProposals.length
        ? linkedProposals.reduce((latest, p) => (p.updatedAt > latest.updatedAt ? p : latest))
        : null;

      if (!latestProposal || latestProposal.status !== 'dismissed') {
        if (group.hasLiveRow) {
          candidates.push({
            fingerprint: group.fingerprint,
            pattern: group.pattern,
            targetSurface: group.targetSurface,
            severity: group.severity,
            hits: group.hits,
          });
        }
        continue;
      }

      const newHitsSinceDismissal = group.createdAts.filter(
        (createdAt) => createdAt > latestProposal.updatedAt
      ).length;

      let resurfaces = newHitsSinceDismissal >= NEW_HITS_RESURFACE_THRESHOLD;
      if (!resurfaces) {
        const corroboration = await getCorroboration(projectId, group.fingerprint);
        resurfaces = corroboration.crossProject;
      }

      if (resurfaces) {
        candidates.push({
          fingerprint: group.fingerprint,
          pattern: group.pattern,
          targetSurface: group.targetSurface,
          severity: group.severity,
          hits: group.hits,
          resurfaced: true,
          dismissalNote: latestProposal.dismissalNote,
        });
      }
    }

    candidates.sort((a, b) => b.hits - a.hits);

    return NextResponse.json({ success: true, data: candidates });
  } catch (error) {
    console.error('GET /api/tuning/candidates error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch tuning candidates', error).toResponse(),
      { status: 500 }
    );
  }
}
