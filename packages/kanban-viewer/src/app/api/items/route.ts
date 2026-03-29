/**
 * API Route Handlers for /api/items
 *
 * GET  - List items with optional filters
 * POST - Create a new item
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  createValidationError,
  createDependencyCycleError,
  createOutputCollisionError,
  createServerError,
} from '@/lib/errors';
import { validateDependencies, validateOutputCollisions } from '@/lib/validation';
import type { OutputCollisionItem } from '@/lib/validation';
import { getAndValidateProjectId, ensureProject } from '@/lib/project-utils';
import { transformItemWithRelationsToResponse } from '@/lib/item-transform';
import type { ItemType, ItemPriority } from '@/types/item';
import type { CreateItemRequest } from '@/types/api';
import { ITEM_TYPES, ITEM_PRIORITIES } from '@ai-team/shared';

// Valid values for type and priority
const VALID_TYPES: ItemType[] = ITEM_TYPES as unknown as ItemType[];
const VALID_PRIORITIES: ItemPriority[] = ITEM_PRIORITIES as unknown as ItemPriority[];

/**
 * Generate next item ID in WI-NNN format.
 * Uses MAX(id) instead of COUNT(*) to avoid collisions when items have been hard-deleted.
 */
async function generateItemId(): Promise<string> {
  const items = await prisma.item.findMany({
    select: { id: true },
    orderBy: { id: 'desc' },
    take: 1,
  });
  const maxNum = items.length > 0 ? parseInt(items[0].id.replace('WI-', ''), 10) : 0;
  return `WI-${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * GET /api/items
 *
 * List items with optional filters:
 * - stage: Filter by stage ID
 * - type: Filter by item type
 * - priority: Filter by priority
 * - agent: Filter by assigned agent (use "null" for unassigned)
 * - includeArchived: Include archived items (default: false)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: { code: projectValidation.error.code, message: 'X-Project-ID header is required' } },
        { status: 400 }
      );
    }
    const projectId = projectValidation.projectId;

    // Build where clause with projectId filter
    const where: Record<string, unknown> = {
      projectId,
    };

    // Stage filter
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage');
    if (stage) {
      where.stageId = stage;
    }

    // Type filter
    const type = searchParams.get('type');
    if (type) {
      where.type = type;
    }

    // Priority filter
    const priority = searchParams.get('priority');
    if (priority) {
      where.priority = priority;
    }

    // Agent filter
    const agent = searchParams.get('agent');
    if (agent !== null && agent !== '') {
      where.assignedAgent = agent === 'null' ? null : agent;
    }

    // Archive filter (default: exclude archived)
    const includeArchived = searchParams.get('includeArchived') === 'true';
    if (!includeArchived) {
      where.archivedAt = null;
    }

    // Query items with relations
    const items = await prisma.item.findMany({
      where,
      include: {
        dependsOn: true,
        workLogs: {
          orderBy: { timestamp: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Transform to response format
    const responseItems = items.map(transformItemWithRelationsToResponse);

    return NextResponse.json({ success: true, data: responseItems });
  } catch (error) {
    console.error('GET /api/items error:', error);
    const apiError = createServerError('Internal server error');
    return NextResponse.json(apiError.toResponse(), { status: 500 });
  }
}

/**
 * POST /api/items
 *
 * Create a new item in the briefings stage.
 * Request body: CreateItemRequest
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const projectValidation = getAndValidateProjectId(request.headers);
    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: { code: projectValidation.error.code, message: 'X-Project-ID header is required' } },
        { status: 400 }
      );
    }
    const projectId = projectValidation.projectId;

    let body: CreateItemRequest;
    try {
      body = await request.json();
    } catch {
      const error = createValidationError('Invalid JSON body');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Validate required fields
    if (body.title === undefined || body.title === null) {
      const error = createValidationError('title is required');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    if (typeof body.title !== 'string' || body.title.trim() === '') {
      const error = createValidationError('title cannot be empty');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    if (body.title.length > 200) {
      const error = createValidationError('title must not exceed 200 characters');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Validate type
    if (!body.type || !VALID_TYPES.includes(body.type)) {
      const error = createValidationError('Invalid type value');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Validate priority
    if (!body.priority || !VALID_PRIORITIES.includes(body.priority)) {
      const error = createValidationError('Invalid priority value');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Validate description
    if (body.description === undefined || body.description === null) {
      const error = createValidationError('description is required');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    // Validate structured fields (required)
    if (!body.objective || typeof body.objective !== 'string' || body.objective.trim() === '') {
      const error = createValidationError('objective is required');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    if (!Array.isArray(body.acceptance) || body.acceptance.length === 0) {
      const error = createValidationError('acceptance is required (non-empty array of criteria)');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    if (!body.context || typeof body.context !== 'string' || body.context.trim() === '') {
      const error = createValidationError('context is required');
      return NextResponse.json(error.toResponse(), { status: 400 });
    }

    const dependencies = body.dependencies ?? [];

    // Validate that all dependencies exist and belong to the same project
    if (dependencies.length > 0) {
      const existingDeps = await prisma.item.findMany({
        where: { id: { in: dependencies } },
        select: { id: true, projectId: true },
      });

      const existingIds = new Set(existingDeps.map((d) => d.id));
      const missingIds = dependencies.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        const error = createValidationError(
          `Dependencies not found: ${missingIds.join(', ')}`
        );
        return NextResponse.json(error.toResponse(), { status: 400 });
      }

      // Check that all dependencies belong to the same project
      for (const dep of existingDeps) {
        if (dep.projectId !== projectId) {
          const error = createValidationError(
            `Dependency ${dep.id} does not belong to the same project`
          );
          return NextResponse.json(error.toResponse(), { status: 400 });
        }
      }

      // Build existing dependency graph for cycle detection
      const allDependencies = await prisma.itemDependency.findMany();
      const existingGraph: Record<string, string[]> = {};
      for (const dep of allDependencies) {
        if (!existingGraph[dep.itemId]) {
          existingGraph[dep.itemId] = [];
        }
        existingGraph[dep.itemId].push(dep.dependsOnId);
      }

      // Use a temporary placeholder ID for cycle validation
      // Since this is a new item, it won't be in the existing graph
      const tempIdForCycleCheck = `__new_item_${Date.now()}`;

      // Validate dependencies don't create a cycle
      const validationResult = validateDependencies(tempIdForCycleCheck, dependencies, existingGraph);
      if (!validationResult.valid && validationResult.cycle) {
        const error = createDependencyCycleError(validationResult.cycle);
        return NextResponse.json(error.toResponse(), { status: 400 });
      }
    }

    // Validate output collisions if the new item has outputs
    const newItemOutputs = body.outputs ?? {};
    if (newItemOutputs.impl || newItemOutputs.test || newItemOutputs.types) {
      // Get all existing items in the same project with their outputs and dependencies
      const existingItems = await prisma.item.findMany({
        where: {
          projectId,
          archivedAt: null,
          stageId: { not: 'done' }, // Only check non-completed items
        },
        select: {
          id: true,
          outputImpl: true,
          outputTest: true,
          outputTypes: true,
          dependsOn: {
            select: { dependsOnId: true },
          },
        },
      });

      // Build items array for collision validation including the new item
      const itemsForCollisionCheck: OutputCollisionItem[] = existingItems.map((item) => ({
        id: item.id,
        outputs: {
          impl: item.outputImpl ?? undefined,
          test: item.outputTest ?? undefined,
          types: item.outputTypes ?? undefined,
        },
        dependencies: item.dependsOn.map((d) => d.dependsOnId),
      }));

      // Add the new item (using a temporary ID since it hasn't been created yet)
      const tempNewItemId = `__new_item__`;
      itemsForCollisionCheck.push({
        id: tempNewItemId,
        outputs: {
          impl: newItemOutputs.impl,
          test: newItemOutputs.test,
          types: newItemOutputs.types,
        },
        dependencies: dependencies,
      });

      const collisionResult = validateOutputCollisions(itemsForCollisionCheck);
      if (!collisionResult.valid) {
        // Filter collisions to only show those involving the new item
        const relevantCollisions = collisionResult.collisions.filter(
          (c) => c.items.includes(tempNewItemId)
        );
        if (relevantCollisions.length > 0) {
          // Replace temp ID with a more readable message
          const formattedCollisions = relevantCollisions.map((c) => ({
            file: c.file,
            items: c.items.map((id) => (id === tempNewItemId ? 'new item' : id)),
          }));
          const error = createOutputCollisionError(formattedCollisions);
          return NextResponse.json(error.toResponse(), { status: 400 });
        }
      }
    }

    // Ensure project exists (auto-create if not)
    await ensureProject(projectId);

    // Generate item ID
    const itemId = await generateItemId();

    // Find current active mission (if any)
    const currentMission = await prisma.mission.findFirst({
      where: { projectId, archivedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    // Create item in backlog stage with projectId and link to current mission
    const createdItem = await prisma.item.create({
      data: {
        id: itemId,
        title: body.title.trim(),
        description: body.description,
        type: body.type,
        priority: body.priority,
        stageId: 'briefings',
        rejectionCount: 0,
        projectId,
        objective: body.objective,
        acceptance: JSON.stringify(body.acceptance),
        context: body.context,
        outputTest: body.outputs?.test ?? null,
        outputImpl: body.outputs?.impl ?? null,
        outputTypes: body.outputs?.types ?? null,
        dependsOn: dependencies.length > 0
          ? {
              create: dependencies.map((depId) => ({
                dependsOnId: depId,
              })),
            }
          : undefined,
        missionItems: currentMission
          ? { create: { missionId: currentMission.id } }
          : undefined,
      },
      include: {
        dependsOn: true,
        workLogs: true,
      },
    });

    // Transform to response format
    const responseItem = transformItemWithRelationsToResponse(createdItem);

    return NextResponse.json({ success: true, data: responseItem }, { status: 201 });
  } catch (error) {
    console.error('POST /api/items error:', error);
    const apiError = createServerError('Internal server error');
    return NextResponse.json(apiError.toResponse(), { status: 500 });
  }
}
