/**
 * API Route Handler for GET /api/items/[id]/render
 *
 * Returns a work item formatted as markdown, suitable for display or export.
 * Query param includeWorkLog (default true) controls work log inclusion.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createItemNotFoundError, createServerError } from '@/lib/errors';
import { getAndValidateProjectId } from '@/lib/project-utils';
import type { StageId } from '@/types/board';
import type { ItemType, ItemPriority, WorkLogEntry } from '@/types/item';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Format a Date object to a human-readable date/time string.
 * Format: YYYY-MM-DD HH:MM
 */
function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Format a work log entry as a markdown list item.
 * Format: - **YYYY-MM-DD HH:MM** [Agent] action: Summary
 */
function formatWorkLogEntry(entry: WorkLogEntry): string {
  const timestamp = formatTimestamp(entry.timestamp);
  return `- **${timestamp}** [${entry.agent}] ${entry.action}: ${entry.summary}`;
}

/**
 * Render a work item as markdown.
 */
function renderItemAsMarkdown(
  item: {
    id: string;
    title: string;
    description: string;
    objective: string | null;
    acceptance: string[];
    context: string | null;
    type: string;
    priority: string;
    stageId: string;
    dependencies: string[];
    outputs: { test?: string; impl?: string; types?: string };
    workLogs: WorkLogEntry[];
  },
  includeWorkLog: boolean
): string {
  const dependenciesDisplay = item.dependencies.length > 0
    ? item.dependencies.join(', ')
    : 'None';

  let markdown = `# ${item.id}: ${item.title}

**Type:** ${item.type}
**Priority:** ${item.priority}
**Stage:** ${item.stageId}
**Dependencies:** ${dependenciesDisplay}
`;

  if (item.objective) {
    markdown += `\n## Objective\n\n${item.objective}\n`;
  }

  if (item.acceptance.length > 0) {
    markdown += '\n## Acceptance Criteria\n\n';
    for (const criterion of item.acceptance) {
      markdown += `- ${criterion}\n`;
    }
  }

  if (item.context) {
    markdown += `\n## Context\n\n${item.context}\n`;
  }

  markdown += `\n## Description\n\n${item.description}\n`;

  // Outputs section
  const outputEntries = Object.entries(item.outputs).filter(([, v]) => v);
  if (outputEntries.length > 0) {
    markdown += '\n## Outputs\n\n';
    for (const [key, value] of outputEntries) {
      markdown += `- **${key}:** \`${value}\`\n`;
    }
  }

  if (includeWorkLog) {
    markdown += '\n## Work Log\n\n';
    if (item.workLogs.length === 0) {
      markdown += '_No work log entries._\n';
    } else {
      // Sort work logs chronologically
      const sortedLogs = [...item.workLogs].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );
      for (const log of sortedLogs) {
        markdown += formatWorkLogEntry(log) + '\n';
      }
    }
  }

  return markdown;
}

/**
 * GET /api/items/[id]/render
 *
 * Render a work item as formatted markdown.
 *
 * Query parameters:
 * - projectId (string, required): Filter item by project ID
 * - includeWorkLog (optional): boolean, defaults to true
 *   Controls whether the work log section is included in the output.
 *
 * Returns ITEM_NOT_FOUND for non-existent or archived items.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id: itemId } = await context.params;

    // Parse query parameters and header
    const projectValidation = getAndValidateProjectId(request.headers);
    const { searchParams } = new URL(request.url);
    const includeWorkLogParam = searchParams.get('includeWorkLog');
    const includeWorkLog = includeWorkLogParam !== 'false'; // default to true

    if (!projectValidation.valid) {
      return NextResponse.json(
        { success: false, error: { code: projectValidation.error.code, message: 'X-Project-ID header is required' } },
        { status: 400 }
      );
    }
    const projectId = projectValidation.projectId;

    // Find item excluding archived items, filtered by projectId
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

    // Parse acceptance from JSON string
    let acceptance: string[] = [];
    if (item.acceptance) {
      try {
        const parsed = JSON.parse(item.acceptance);
        if (Array.isArray(parsed)) acceptance = parsed;
      } catch { /* ignore invalid JSON */ }
    }

    // Build outputs object
    const outputs: { test?: string; impl?: string; types?: string } = {};
    if (item.outputTest) outputs.test = item.outputTest;
    if (item.outputImpl) outputs.impl = item.outputImpl;
    if (item.outputTypes) outputs.types = item.outputTypes;

    // Transform to render format
    const renderData = {
      id: item.id,
      title: item.title,
      description: item.description,
      objective: item.objective,
      acceptance,
      context: item.context,
      type: item.type as ItemType,
      priority: item.priority as ItemPriority,
      stageId: item.stageId as StageId,
      dependencies: (item.dependsOn ?? []).map((d) => d.dependsOnId),
      outputs,
      workLogs: (item.workLogs ?? []).map((log): WorkLogEntry => ({
        id: log.id,
        agent: log.agent,
        action: log.action as WorkLogEntry['action'],
        summary: log.summary,
        timestamp: log.timestamp,
      })),
    };

    const markdown = renderItemAsMarkdown(renderData, includeWorkLog);

    return NextResponse.json({
      success: true,
      data: { markdown },
    });
  } catch (error) {
    console.error('GET /api/items/[id]/render error:', error);
    const apiError = createServerError('Internal server error');
    return NextResponse.json(apiError.toResponse(), { status: 500 });
  }
}
