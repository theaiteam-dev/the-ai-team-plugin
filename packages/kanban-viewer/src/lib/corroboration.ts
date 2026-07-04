import { prisma } from '@/lib/db';

const IN_PROJECT_THRESHOLD = 3;

export interface CorroborationResult {
  inProjectHits: number;
  crossProject: boolean;
  corroborated: boolean;
}

/**
 * Single source of truth for the corroboration threshold (>=3 in-project OR
 * >=1 cross-project) that FR-8 resurfacing and FR-9/FR-15 promotion gating
 * both depend on. Callers must import this rather than re-deriving it.
 *
 * The cross-project count is the only intentional tenant-isolation crossing:
 * it is scoped to fingerprint only and returns a count, never row content
 * (NFR-4).
 */
export async function getCorroboration(
  projectId: string,
  fingerprint: string
): Promise<CorroborationResult> {
  const [inProjectHits, crossProjectHits] = await Promise.all([
    prisma.retroLearning.count({
      where: { projectId, fingerprint },
    }),
    prisma.retroLearning.count({
      where: { fingerprint, projectId: { not: projectId } },
    }),
  ]);

  const crossProject = crossProjectHits > 0;
  const corroborated = inProjectHits >= IN_PROJECT_THRESHOLD || crossProject;

  return { inProjectHits, crossProject, corroborated };
}
