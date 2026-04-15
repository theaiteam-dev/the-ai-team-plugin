/**
 * Item-related MCP tools.
 *
 * Provides CRUD operations for work items:
 * - item_create: Create a new work item
 * - item_update: Update an existing work item
 * - item_get: Retrieve a single item by ID
 * - item_list: List items with optional filtering
 * - item_render: Get markdown representation
 */
import { z } from 'zod';
import { ITEM_TYPES, ITEM_PRIORITIES } from '@ai-team/shared';
import { createClient } from '../client/index.js';
import { config } from '../config.js';
import { withErrorBoundary } from '../lib/errors.js';
import { zodToJsonSchema } from '../lib/schema-utils.js';
// Initialize HTTP client
const client = createClient({
    baseUrl: config.apiUrl,
    projectId: config.projectId,
    apiKey: config.apiKey,
    timeout: config.timeout,
    retries: config.retries,
});
// ============================================================================
// Zod Schemas for Input Validation
// ============================================================================
/**
 * Schema for item_create tool input.
 */
/**
 * Validates that dependency IDs use the correct WI-XXX format.
 * This catches common mistakes like using bare numeric IDs ("001" instead of "WI-001").
 */
const dependencyIdSchema = z.string().refine((id) => /^WI-\d{3}[a-z]?$/.test(id), (id) => ({
    message: `Invalid dependency ID "${id}". Expected format "WI-XXX" (e.g., "WI-001"). Did you forget to use the ID returned from item_create?`,
}));
export const ItemCreateInputSchema = z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    type: z.enum(ITEM_TYPES),
    priority: z.enum(ITEM_PRIORITIES),
    status: z.string().optional().default('pending'),
    dependencies: z.array(dependencyIdSchema).optional().default([]),
    parallel_group: z.string().optional(),
    outputs: z.object({
        test: z.string().optional(),
        impl: z.string().optional(),
        types: z.string().optional(),
    }).optional(),
});
/**
 * Schema for item_update tool input.
 * Supports partial updates to any work item field.
 */
export const ItemUpdateInputSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    status: z.string().optional(),
    priority: z.enum(ITEM_PRIORITIES).optional(),
    assigned_agent: z.string().optional(),
    rejection_count: z.number().int().min(0).optional(),
    dependencies: z.array(dependencyIdSchema).optional(),
    parallel_group: z.string().optional(),
    outputs: z.object({
        test: z.string().optional(),
        impl: z.string().optional(),
        types: z.string().optional(),
    }).optional(),
});
/**
 * Schema for item_get tool input.
 */
export const ItemGetInputSchema = z.object({
    id: z.string().min(1),
});
/**
 * Schema for item_list tool input.
 */
export const ItemListInputSchema = z.object({
    status: z.string().optional(),
    stage: z.string().optional(),
    agent: z.string().optional(),
});
/**
 * Schema for item_render tool input.
 */
export const ItemRenderInputSchema = z.object({
    id: z.string().min(1),
});
// ============================================================================
// Tool Handlers
// ============================================================================
/**
 * Creates a new work item.
 */
export async function itemCreate(input) {
    // Validate input (especially dependency IDs) before sending to API
    const parsed = ItemCreateInputSchema.safeParse(input);
    if (!parsed.success) {
        const errorMessage = parsed.error.errors
            .map((e) => e.message)
            .join('; ');
        return {
            isError: true,
            code: 'VALIDATION_ERROR',
            message: errorMessage,
        };
    }
    const handler = async (args) => {
        const result = await client.post('/api/items', args);
        return {
            content: [{ type: 'text', text: JSON.stringify(result.data) }],
            data: result.data,
        };
    };
    return withErrorBoundary(handler)(parsed.data);
}
/**
 * Updates an existing work item.
 */
export async function itemUpdate(input) {
    // Validate input (especially dependency IDs) before sending to API
    const parsed = ItemUpdateInputSchema.safeParse(input);
    if (!parsed.success) {
        const errorMessage = parsed.error.errors
            .map((e) => e.message)
            .join('; ');
        return {
            isError: true,
            code: 'VALIDATION_ERROR',
            message: errorMessage,
        };
    }
    const handler = async (args) => {
        const { id, ...updateData } = args;
        const result = await client.patch(`/api/items/${id}`, updateData);
        return {
            content: [{ type: 'text', text: JSON.stringify(result.data) }],
            data: result.data,
        };
    };
    return withErrorBoundary(handler)(parsed.data);
}
/**
 * Retrieves a single work item by ID.
 */
export async function itemGet(input) {
    const handler = async (args) => {
        const result = await client.get(`/api/items/${args.id}`);
        return {
            content: [{ type: 'text', text: JSON.stringify(result.data) }],
            data: result.data,
        };
    };
    return withErrorBoundary(handler)(input);
}
/**
 * Lists work items with optional filtering.
 */
export async function itemList(input) {
    const handler = async (args) => {
        const queryParams = new URLSearchParams();
        if (args.status)
            queryParams.append('status', args.status);
        if (args.stage)
            queryParams.append('stage', args.stage);
        if (args.agent)
            queryParams.append('agent', args.agent);
        const queryString = queryParams.toString();
        const path = queryString ? `/api/items?${queryString}` : '/api/items';
        const result = await client.get(path);
        return {
            content: [{ type: 'text', text: JSON.stringify(result.data) }],
            data: result.data,
        };
    };
    return withErrorBoundary(handler)(input);
}
/**
 * Returns markdown representation of an item.
 */
export async function itemRender(input) {
    const handler = async (args) => {
        const result = await client.get(`/api/items/${args.id}/render`);
        return {
            content: [{ type: 'text', text: JSON.stringify(result.data) }],
            data: result.data,
        };
    };
    return withErrorBoundary(handler)(input);
}
// ============================================================================
// Tool Definitions for MCP Server Registration
// ============================================================================
/**
 * Tool definitions for MCP server registration.
 * Each tool includes the original Zod schema for use with McpServer.tool() API.
 */
export const itemTools = [
    {
        name: 'item_create',
        description: 'Create a new work item with title, type, and optional fields like dependencies and outputs.',
        inputSchema: zodToJsonSchema(ItemCreateInputSchema),
        zodSchema: ItemCreateInputSchema,
        handler: itemCreate,
    },
    {
        name: 'item_update',
        description: 'Update an existing work item. Supports: title, description, status, priority, dependencies, parallel_group, outputs, assigned_agent, rejection_count.',
        inputSchema: zodToJsonSchema(ItemUpdateInputSchema),
        zodSchema: ItemUpdateInputSchema,
        handler: itemUpdate,
    },
    {
        name: 'item_get',
        description: 'Retrieve a single work item by its ID.',
        inputSchema: zodToJsonSchema(ItemGetInputSchema),
        zodSchema: ItemGetInputSchema,
        handler: itemGet,
    },
    {
        name: 'item_list',
        description: 'List work items with optional filtering by status, stage, or assigned agent.',
        inputSchema: zodToJsonSchema(ItemListInputSchema),
        zodSchema: ItemListInputSchema,
        handler: itemList,
    },
    {
        name: 'item_render',
        description: 'Get the markdown representation of a work item including frontmatter.',
        inputSchema: zodToJsonSchema(ItemRenderInputSchema),
        zodSchema: ItemRenderInputSchema,
        handler: itemRender,
    },
];
//# sourceMappingURL=items.js.map