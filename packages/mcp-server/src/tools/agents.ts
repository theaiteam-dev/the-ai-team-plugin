/**
 * Agent lifecycle MCP tools.
 *
 * Provides tools for managing agent work sessions:
 * - agent_start: Claims an item and writes assigned_agent to frontmatter
 * - agent_stop: Signals completion and adds work summary to work_log
 */

import { z } from 'zod';
import { createClient } from '../client/index.js';
import { config } from '../config.js';
import { VALID_AGENTS_LOWER, AgentNameSchema } from '../lib/agents.js';
import type { ToolResponse } from '../lib/tool-response.js';
import { formatErrorMessage } from '../lib/tool-response.js';

/**
 * Input schema for agent_start tool.
 */
export const AgentStartSchema = z.object({
  itemId: z.string().min(1, 'itemId is required'),
  agent: AgentNameSchema,
  task_id: z.string().optional(),
});

export type AgentStartInput = z.infer<typeof AgentStartSchema>;

/**
 * Input schema for agent_stop tool.
 */
export const AgentStopSchema = z.object({
  itemId: z.string().min(1, 'itemId is required'),
  agent: AgentNameSchema,
  status: z.enum(['success', 'failed']),
  summary: z.string().min(1, 'summary is required'),
  files_created: z.array(z.string()).optional(),
  files_modified: z.array(z.string()).optional(),
});

export type AgentStopInput = z.infer<typeof AgentStopSchema>;

/**
 * Response structure for agent_start.
 */
interface AgentStartResponse {
  success: boolean;
  itemId: string;
  agent: string;
  task_id?: string;
  timestamp: string;
}

/**
 * Work log entry structure.
 */
interface WorkLogEntry {
  agent: string;
  timestamp: string;
  status: 'success' | 'failed';
  summary: string;
  files_created?: string[];
  files_modified?: string[];
}

/**
 * Response structure for agent_stop.
 */
interface AgentStopResponse {
  success: boolean;
  itemId: string;
  agent: string;
  status: 'success' | 'failed';
  completed_at: string;
  work_log_entry: WorkLogEntry;
}

/**
 * Creates the HTTP client for API calls.
 */
function getClient() {
  return createClient({
    baseUrl: config.apiUrl,
    projectId: config.projectId,
    apiKey: config.apiKey,
    timeout: config.timeout,
    retries: config.retries,
  });
}

/**
 * Claims an item and writes assigned_agent to frontmatter.
 *
 * @param input - The agent start input parameters
 * @returns MCP tool response with success/error information
 */
export async function agentStart(
  input: AgentStartInput
): Promise<ToolResponse> {
  const client = getClient();

  try {
    const body: Record<string, string> = {
      itemId: input.itemId,
      agent: input.agent,
    };

    if (input.task_id) {
      body.task_id = input.task_id;
    }

    const response = await client.post<AgentStartResponse>(
      '/api/agents/start',
      body
    );

    const data = response.data;

    // Auto-post to activity feed so the agent's work appears in the timeline
    client.post('/api/activity', {
      agent: input.agent,
      message: `Started working on ${input.itemId}`,
    }).catch(() => {});  // Best-effort, don't fail the start

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: data.success,
              message: `Agent ${data.agent} claimed item ${data.itemId}`,
              itemId: data.itemId,
              agent: data.agent,
              timestamp: data.timestamp,
              ...(data.task_id && { task_id: data.task_id }),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage = formatErrorMessage(error);

    return {
      content: [
        {
          type: 'text',
          text: errorMessage,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Signals completion and adds work summary to work_log.
 *
 * @param input - The agent stop input parameters
 * @returns MCP tool response with success/error information
 */
export async function agentStop(input: AgentStopInput): Promise<ToolResponse> {
  const client = getClient();

  try {
    const body: Record<string, unknown> = {
      itemId: input.itemId,
      agent: input.agent,
      outcome: input.status === 'failed' ? 'blocked' : 'completed',
      summary: input.summary,
    };

    if (input.files_created) {
      body.files_created = input.files_created;
    }

    if (input.files_modified) {
      body.files_modified = input.files_modified;
    }

    const response = await client.post<AgentStopResponse>(
      '/api/agents/stop',
      body
    );

    const data = response.data;

    // Auto-post to activity feed so the agent's completion appears in the timeline
    const statusLabel = input.status === 'success' ? 'completed' : 'failed';
    client.post('/api/activity', {
      agent: input.agent,
      message: `${statusLabel} ${input.itemId}: ${input.summary}`,
    }).catch(() => {});  // Best-effort, don't fail the stop

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: data.success,
              message: `Agent ${data.agent} completed work on item ${data.itemId}`,
              itemId: data.itemId,
              agent: data.agent,
              status: data.status,
              completed_at: data.completed_at,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage = formatErrorMessage(error);

    return {
      content: [
        {
          type: 'text',
          text: errorMessage,
        },
      ],
      isError: true,
    };
  }
}

/**
 * MCP tool definition structure.
 */
interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Tool definitions for MCP server registration.
 * Each tool includes the original Zod schema for use with McpServer.tool() API.
 */
export const agentTools = [
  {
    name: 'agent_start',
    description:
      'Claims a work item for an agent and writes assigned_agent to the item frontmatter. ' +
      'Use this at the start of working on an item to signal that the agent has begun work. ' +
      'The item will be marked as claimed in board.json and the frontmatter will be updated.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        itemId: {
          type: 'string',
          description: 'The ID of the work item to claim',
        },
        agent: {
          type: 'string',
          description: `The agent name (one of: ${VALID_AGENTS_LOWER.join(', ')})`,
          enum: VALID_AGENTS_LOWER,
        },
        task_id: {
          type: 'string',
          description: 'Optional task ID for tracking background tasks',
        },
      },
      required: ['itemId', 'agent'],
    },
    zodSchema: AgentStartSchema,
    handler: agentStart,
  },
  {
    name: 'agent_stop',
    description:
      'Signals that an agent has completed work on an item and adds a work summary to the work_log. ' +
      'Use this when finished working on an item to record what was done. ' +
      'The agent claim will be released and the summary will be appended to the item frontmatter.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        itemId: {
          type: 'string',
          description: 'The ID of the work item that was worked on',
        },
        agent: {
          type: 'string',
          description: `The agent name (one of: ${VALID_AGENTS_LOWER.join(', ')})`,
          enum: VALID_AGENTS_LOWER,
        },
        status: {
          type: 'string',
          description: 'The completion status',
          enum: ['success', 'failed'],
        },
        summary: {
          type: 'string',
          description: 'A brief summary of the work completed',
        },
        files_created: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of file paths that were created',
        },
        files_modified: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of file paths that were modified',
        },
      },
      required: ['itemId', 'agent', 'status', 'summary'],
    },
    zodSchema: AgentStopSchema,
    handler: agentStop,
  },
];
