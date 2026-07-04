/**
 * API Route: /api/tuning/corroboration
 *
 * GET - Thin wrapper over getCorroboration(), reporting in-project hits,
 *       cross-project presence, and the derived corroborated flag for a
 *       given fingerprint.
 */

import { NextResponse } from 'next/server';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { createValidationError, createDatabaseError } from '@/lib/errors';
import { getCorroboration } from '@/lib/corroboration';
import type { ApiError } from '@/types/api';

export async function GET(request: Request) {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      const errorResponse: ApiError = { success: false, error: projectValidation.error };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const fingerprint = searchParams.get('fingerprint');
    if (!fingerprint) {
      const error = createValidationError('fingerprint is required');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    const data = await getCorroboration(projectValidation.projectId, fingerprint);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/tuning/corroboration error:', error);
    return NextResponse.json(
      createDatabaseError('Failed to fetch corroboration signal', error).toResponse(),
      { status: 500 }
    );
  }
}
