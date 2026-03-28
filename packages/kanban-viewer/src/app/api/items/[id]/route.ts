/**
 * API Route Handlers for /api/items/[id]
 *
 * GET    - Retrieve a single item with relations
 * PATCH  - Update an item (title, description, type, priority, dependencies)
 * DELETE - Soft delete an item by setting archivedAt
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  createItemNotFoundError,
  createValidationError,
  createDependencyCycleError,
  createServerError,
} from '@/lib/errors';
import { validateDependencies } from '@/lib/validation';
import { getAndValidateProjectId } from '@/lib/project-utils';
import { transformItemWithRelationsToResponse } from '@/lib/item-transform';
import type { ItemType, ItemPriority } from '@/types/item';
import type { UpdateItemRequest } from '@/types/api';
import { ITEM_TYPES, ITEM_PRIORITIES } from '@ai-team/shared';

// Valid values for type and priority
const VALID_TYPES: ItemType[] = ITEM_TYPES as unknown as ItemType[];
const VALID_PRIORITIES: ItemPriority[] = ITEM_PRIORITIES as unknown as ItemPriority[];

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/items/[id]
 *
 * Retrieve a single item by ID with full relations.
 * Returns ITEM_NOT_FOUND if item doesn't exist or is archived.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id: itemId } = await context.params;
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: { code: projectValidation.error.code, message: 'X-Project-ID header is required' } },
        { status: 400 }
      );
    }
    const projectId = projectValidation.projectId;

    // Find item excluding archived items and filtering by projectId
    const item = await prisma.item.findFirst({
      where: {
        id: itemId,
        projectId,
        archivedAt: null,
      },
      include: {
        dependsOn: true,
        workLogs: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!item) {
      const error = createItemNotFoundError(itemId);
      return NextResponse.json(error.toResponse(), { status: 404 });
    }

    const responseItem = transformItemWithRelationsToResponse(item);
    return NextResponse.json({ success: true, data: responseItem });
  } catch (error) {
    console.error('GET /api/items/[id] error:', error);
    const apiError = createServerError('Internal server error');
    return NextResponse.json(apiError.toResponse(), { status: 500 });
  }
}

/**
 * PATCH /api/items/[id]
 *
 * Update an item's title, description, type, priority, or dependencies.
 * Validates dependency changes don't create cycles.
 * Always updates the updatedAt timestamp on any change.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id: itemId } = await context.params;
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: { code: projectValidation.error.code, message: 'X-Project-ID header is required' } },
        { status: 400 }
      );
    }
    const projectId = projectValidation.projectId;

    // Parse request body
    let body: UpdateItemRequest;
    try {
      body = await request.json();
    } catch {
      const error = createValidationError('Invalid JSON body');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Find existing item (excluding archived) and filtering by projectId
    const existingItem = await prisma.item.findFirst({
      where: {
        id: itemId,
        projectId,
        archivedAt: null,
      },
      include: {
        dependsOn: true,
      },
    });

    if (!existingItem) {
      const error = createItemNotFoundError(itemId);
      return NextResponse.json(error.toResponse(), { status: 404 });
    }

    // Validate title if provided
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim() === '') {
        const error = createValidationError('title cannot be empty');
        return NextResponse.json(error.toResponse(), { status: 400 });
      }
      if (body.title.length > 200) {
        const error = createValidationError('title must not exceed 200 characters');
        return NextResponse.json(error.toResponse(), { status: 400 });
      }
    }

    // Validate type if provided
    if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
      const error = createValidationError('Invalid type value');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Validate priority if provided
    if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority)) {
      const error = createValidationError('Invalid priority value');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Validate dependencies if provided
    if (body.dependencies !== undefined) {
      // Check for self-reference
      if (body.dependencies.includes(itemId)) {
        const error = createDependencyCycleError([itemId, itemId]);
        return NextResponse.json(error.toResponse(), { status: 400 });
      }

      // Verify all dependencies exist and belong to the same project
      for (const depId of body.dependencies) {
        const dep = await prisma.item.findFirst({
          where: { id: depId, archivedAt: null },
          select: { id: true, projectId: true },
        });
        if (!dep) {
          const error = createValidationError(`Dependency ${depId} does not exist`);
          return NextResponse.json(error.toResponse(), { status: 400 });
        }
        if (dep.projectId !== projectId) {
          const error = createValidationError(`Dependency ${depId} does not belong to the same project`);
          return NextResponse.json(error.toResponse(), { status: 400 });
        }
      }

      // Check for cycles if adding new dependencies
      if (body.dependencies.length > 0) {
        // Build existing dependency graph for cycle detection
        const allDependencies = await prisma.itemDependency.findMany();
        const existingGraph: Record<string, string[]> = {};
        for (const dep of allDependencies) {
          if (!existingGraph[dep.itemId]) {
            existingGraph[dep.itemId] = [];
          }
          existingGraph[dep.itemId].push(dep.dependsOnId);
        }

        // Remove current item's existing dependencies from graph for fresh validation
        delete existingGraph[itemId];

        const validationResult = validateDependencies(itemId, body.dependencies, existingGraph);
        if (!validationResult.valid && validationResult.cycle) {
          const error = createDependencyCycleError(validationResult.cycle);
          return NextResponse.json(error.toResponse(), { status: 400 });
        }
      }
    }

    // Build update data
    const updateData: {
      title?: string;
      description?: string;
      objective?: string | null;
      acceptance?: string | null;
      context?: string | null;
      type?: string;
      priority?: string;
      outputTest?: string | null;
      outputImpl?: string | null;
      outputTypes?: string | null;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (body.title !== undefined) {
      updateData.title = body.title.trim();
    }
    if (body.description !== undefined) {
      updateData.description = body.description;
    }
    if (body.objective !== undefined) {
      updateData.objective = body.objective || null;
    }
    if (body.acceptance !== undefined) {
      updateData.acceptance = body.acceptance ? JSON.stringify(body.acceptance) : null;
    }
    if (body.context !== undefined) {
      updateData.context = body.context || null;
    }
    if (body.type !== undefined) {
      updateData.type = body.type;
    }
    if (body.priority !== undefined) {
      updateData.priority = body.priority;
    }
    if (body.outputs !== undefined) {
      // Update outputs - use null for undefined values to clear them
      updateData.outputTest = body.outputs.test ?? null;
      updateData.outputImpl = body.outputs.impl ?? null;
      updateData.outputTypes = body.outputs.types ?? null;
    }

    // Handle dependency updates in a transaction
    const updatedItem = await prisma.$transaction(async (tx) => {
      // Update dependencies if provided
      if (body.dependencies !== undefined) {
        // Delete existing dependencies
        await tx.itemDependency.deleteMany({
          where: { itemId },
        });

        // Create new dependencies
        if (body.dependencies.length > 0) {
          await tx.itemDependency.createMany({
            data: body.dependencies.map((depId) => ({
              itemId,
              dependsOnId: depId,
            })),
          });
        }
      }

      // Update item
      return tx.item.update({
        where: { id: itemId },
        data: updateData,
        include: {
          dependsOn: true,
          workLogs: {
            orderBy: { timestamp: 'asc' },
          },
        },
      });
    });

    const responseItem = transformItemWithRelationsToResponse(updatedItem);
    return NextResponse.json({ success: true, data: responseItem });
  } catch (error) {
    console.error('PATCH /api/items/[id] error:', error);
    const apiError = createServerError('Internal server error');
    return NextResponse.json(apiError.toResponse(), { status: 500 });
  }
}

/**
 * DELETE /api/items/[id]
 *
 * Soft delete an item by setting archivedAt timestamp.
 * Also removes the item from other items' dependency lists.
 * The item remains in the database for audit trail and recovery.
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id: itemId } = await context.params;
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: { code: projectValidation.error.code, message: 'X-Project-ID header is required' } },
        { status: 400 }
      );
    }
    const projectId = projectValidation.projectId;

    // Find existing item (excluding already archived) and filtering by projectId
    const existingItem = await prisma.item.findFirst({
      where: {
        id: itemId,
        projectId,
        archivedAt: null,
      },
    });

    if (!existingItem) {
      const error = createItemNotFoundError(itemId);
      return NextResponse.json(error.toResponse(), { status: 404 });
    }

    // Soft delete in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Remove this item from other items' dependency lists
      const deleteResult = await tx.itemDependency.deleteMany({
        where: { dependsOnId: itemId },
      });

      // Soft delete by setting archivedAt
      await tx.item.update({
        where: { id: itemId },
        data: { archivedAt: new Date() },
      });

      return {
        deleted: true,
        id: itemId,
        dependenciesRemoved: deleteResult.count,
      };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('DELETE /api/items/[id] error:', error);
    const apiError = createServerError('Internal server error');
    return NextResponse.json(apiError.toResponse(), { status: 500 });
  }
}
