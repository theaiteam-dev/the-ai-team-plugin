/**
 * API Route Handlers for /api/projects
 *
 * GET  - List all projects
 * POST - Create a new project
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateAndGetProjectId } from '@/lib/project-utils';
import type { ApiError } from '@/types/api';

/**
 * Project response format for API.
 */
interface ProjectResponse {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * GET /api/projects
 *
 * Returns all projects ordered by createdAt descending.
 */
export async function GET(_request?: NextRequest): Promise<NextResponse<{ success: true; data: ProjectResponse[] } | ApiError>> {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      data: projects,
    });
  } catch (error) {
    const errorResponse: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to fetch projects from database',
        details: error instanceof Error ? error.message : String(error),
      },
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

/**
 * POST /api/projects
 *
 * Creates a new project.
 * Request body: { id: string, name: string }
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<{ success: true; data: ProjectResponse } | ApiError>> {
  try {
    // Parse request body
    let body: { id?: string; name?: string };
    try {
      body = await request.json();
    } catch {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid JSON body',
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate id is present and is a string
    if (body.id === undefined || body.id === null || body.id === '') {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'id is required',
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate id is a string type
    if (typeof body.id !== 'string') {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'id must be a string',
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate id format using project-utils
    const idValidation = validateAndGetProjectId(body.id);
    if (!idValidation.valid) {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: idValidation.error.code,
          // Remap 'projectId' to 'id' in error messages for this endpoint
          message: idValidation.error.message.replace(/projectId/g, 'id'),
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate name is present and is a string
    if (body.name === undefined || body.name === null) {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'name is required',
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate name is a string type
    if (typeof body.name !== 'string') {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'name must be a string',
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Validate name is not empty after trimming
    if (body.name.trim() === '') {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'name is required',
        },
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Normalize id to lowercase
    const normalizedId = body.id.toLowerCase();

    // Check for duplicate (case-insensitive)
    const existingProject = await prisma.project.findUnique({
      where: { id: normalizedId },
    });

    if (existingProject) {
      const errorResponse: ApiError = {
        success: false,
        error: {
          code: 'CONFLICT',
          message: `Project with id '${normalizedId}' already exists`,
        },
      };
      return NextResponse.json(errorResponse, { status: 409 });
    }

    // Create the project
    const newProject = await prisma.project.create({
      data: {
        id: normalizedId,
        name: body.name.trim(),
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: newProject,
      },
      { status: 201 }
    );
  } catch (error) {
    const errorResponse: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to create project in database',
        details: error instanceof Error ? error.message : String(error),
      },
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}
