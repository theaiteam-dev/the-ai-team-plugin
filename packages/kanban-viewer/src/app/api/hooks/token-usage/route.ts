/**
 * API Route: /api/hooks/token-usage
 *
 * POST - Upsert per-message token usage records from Stop/SubagentStop hooks
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createValidationError } from '@/lib/errors';
import { getAndValidateProjectId, ensureProject } from '@/lib/project-utils';
import type { ApiError } from '@/types/api';

interface TokenUsageRecord {
  messageId: string;
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  timestamp?: string;
}

interface UpsertTokenUsageResponse {
  success: true;
  data: {
    upserted: number;
  };
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<UpsertTokenUsageResponse | ApiError>> {
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

    await ensureProject(projectId);

    let body: TokenUsageRecord[];
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        createValidationError('Request body must be valid JSON').toResponse(),
        { status: 400 }
      );
    }

    if (!Array.isArray(body)) {
      return NextResponse.json(
        createValidationError('Request body must be an array of token usage records').toResponse(),
        { status: 400 }
      );
    }

    // Validate ALL records before writing any (no partial writes)
    for (const record of body) {
      if (!record.messageId || typeof record.messageId !== 'string') {
        return NextResponse.json(
          createValidationError('messageId is required and must be a string').toResponse(),
          { status: 400 }
        );
      }
      if (!record.agentName || typeof record.agentName !== 'string') {
        return NextResponse.json(
          createValidationError('agentName is required and must be a string').toResponse(),
          { status: 400 }
        );
      }
      if (!record.model || typeof record.model !== 'string') {
        return NextResponse.json(
          createValidationError('model is required and must be a string').toResponse(),
          { status: 400 }
        );
      }
    }

    const currentMission = await prisma.mission.findFirst({
      where: { projectId, archivedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    const missionId = currentMission?.id ?? null;

    for (const record of body) {
      await prisma.messageTokenUsage.upsert({
        where: { messageId: record.messageId },
        update: {
          agentName: record.agentName,
          model: record.model,
          inputTokens: record.inputTokens ?? 0,
          outputTokens: record.outputTokens ?? 0,
          cacheCreationTokens: record.cacheCreationTokens ?? 0,
          cacheReadTokens: record.cacheReadTokens ?? 0,
          timestamp: record.timestamp ? new Date(record.timestamp) : new Date(),
        },
        create: {
          messageId: record.messageId,
          projectId,
          missionId,
          agentName: record.agentName,
          model: record.model,
          inputTokens: record.inputTokens ?? 0,
          outputTokens: record.outputTokens ?? 0,
          cacheCreationTokens: record.cacheCreationTokens ?? 0,
          cacheReadTokens: record.cacheReadTokens ?? 0,
          timestamp: record.timestamp ? new Date(record.timestamp) : new Date(),
        },
      });
    }

    const response: UpsertTokenUsageResponse = {
      success: true,
      data: { upserted: body.length },
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('POST /api/hooks/token-usage error:', error);
    const apiError: ApiError = {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to upsert token usage records',
      },
    };
    return NextResponse.json(apiError, { status: 500 });
  }
}
