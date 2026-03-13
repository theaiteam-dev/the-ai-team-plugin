/**
 * SSE (Server-Sent Events) utility functions for formatting and parsing board events
 */

import type { BoardEvent, BoardEventType } from '@/types';

/** Set of all valid board event type strings for runtime validation */
const VALID_BOARD_EVENT_TYPES = new Set<BoardEventType>([
  'item-added',
  'item-moved',
  'item-updated',
  'item-deleted',
  'board-updated',
  'activity-entry-added',
  'hook-event',
  'mission-completed',
  'mission-token-usage',
  'final-review-started',
  'final-review-complete',
  'post-checks-started',
  'post-check-update',
  'post-checks-complete',
  'documentation-started',
  'documentation-complete',
]);

/**
 * Formats a BoardEvent into SSE wire format
 *
 * SSE format:
 * data: {"type":"...","timestamp":"...","data":{...}}
 *
 * (followed by double newline)
 *
 * @param event - The board event to format
 * @returns Formatted SSE message string
 */
export function formatSSEEvent(event: BoardEvent): string {
  // Use a replacer to convert undefined to null to preserve property existence
  const json = JSON.stringify(event, (_, value) => (value === undefined ? null : value));
  return `data: ${json}\n\n`;
}

/**
 * Parses an SSE message string back into a BoardEvent object.
 * Returns null if the event type is not a known BoardEventType.
 *
 * @param message - The SSE formatted message string
 * @returns Parsed board event object, or null if the type is unknown
 * @throws Error if the message is not valid SSE format or contains invalid JSON
 */
export function parseSSEEvent(message: string): BoardEvent | null {
  // Remove the 'data: ' prefix
  const dataPrefix = 'data: ';
  if (!message.startsWith(dataPrefix)) {
    throw new Error('Invalid SSE format: message must start with "data: "');
  }

  // Extract JSON string (remove prefix and trailing newlines)
  const jsonString = message.slice(dataPrefix.length).trim();

  let parsed: { type?: unknown; timestamp?: unknown; data?: unknown };
  try {
    parsed = JSON.parse(jsonString) as typeof parsed;
  } catch (error) {
    throw new Error(`Invalid SSE format: failed to parse JSON - ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  // Validate that the type is a known BoardEventType
  if (!VALID_BOARD_EVENT_TYPES.has(parsed.type as BoardEventType)) {
    return null;
  }

  return parsed as unknown as BoardEvent;
}
