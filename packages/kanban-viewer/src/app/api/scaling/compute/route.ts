/**
 * API Route Handler for POST /api/scaling/compute
 *
 * Computes the adaptive instance count for multi-instance agent dispatch.
 * Queries the current item dependency graph, checks available memory,
 * and returns a ScalingRationale with the recommended instance count.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createServerError, createValidationError } from '@/lib/errors';
import { getAndValidateProjectId } from '@/lib/project-utils';
import type { ApiError } from '@/types/api';
import { computeDepGraphMaxPerStage } from '@ai-team/shared';
import { computeMemoryBudget } from '@ai-team/shared';
import { computeAdaptiveScaling } from '@ai-team/shared';

/**
 * POST /api/scaling/compute
 *
 * Body (all optional):
 * - availableMemoryMB: number — override auto-detected free memory
 * - concurrencyOverride: number — bypass adaptive math with fixed N
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: projectValidation.error,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }
    const projectId = projectValidation.projectId;

    let body: { availableMemoryMB?: number; concurrencyOverride?: number } = {};
    try {
      const parsed = await request.json();
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed;
      }
    } catch {
      // Empty body is fine — all fields are optional
    }

    if (body.concurrencyOverride !== undefined && body.concurrencyOverride < 1) {
      return NextResponse.json(
        createValidationError('concurrencyOverride must be >= 1').toResponse(),
        { status: 400 }
      );
    }

    // Query non-archived items with dependencies for dep graph analysis
    const [items, testingStage] = await Promise.all([
      prisma.item.findMany({
        where: { archivedAt: null, projectId },
        include: { dependsOn: true },
      }),
      prisma.stage.findUnique({
        where: { id: 'testing' },
      }),
    ]);

    // Map to DepGraphItem format
    const depGraphItems = items.map((item) => ({
      id: item.id,
      dependencies: item.dependsOn.map((dep) => dep.dependsOnId),
    }));

    const depGraphMax = depGraphItems.length > 0
      ? computeDepGraphMaxPerStage(depGraphItems)
      : 1;

    const memoryCeiling = computeMemoryBudget(body.availableMemoryMB);
    const wipLimit = testingStage?.wipLimit ?? 3;

    const rationale = computeAdaptiveScaling({
      depGraphMax,
      memoryCeiling,
      wipLimit,
      concurrencyOverride: body.concurrencyOverride,
    });

    return NextResponse.json({
      success: true,
      data: rationale,
    });
  } catch (error) {
    console.error('POST /api/scaling/compute error:', error);
    const apiError = createServerError('Internal server error');
    return NextResponse.json(apiError.toResponse(), { status: 500 });
  }
}
