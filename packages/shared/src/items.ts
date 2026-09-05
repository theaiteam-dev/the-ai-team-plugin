export const ITEM_TYPES = ['feature', 'bug', 'task', 'enhancement'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type ItemPriority = (typeof ITEM_PRIORITIES)[number];

/**
 * Finding-severity vocabulary, shared between Item.severity (WI-936, an
 * item's own finding provenance) and RetroLearning.severity — the single
 * source of truth both POST /api/items, PATCH /api/items/:id, and
 * POST /api/learnings validate against. Also matches the review-severity
 * mapping in commands/review.md.
 */
export const SEVERITY_VALUES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITY_VALUES)[number];

export interface ItemOutputs {
  test?: string;
  impl?: string;
  types?: string;
}

export interface WorkLogEntry {
  agent: string;
  timestamp: string;
  status: 'success' | 'failed';
  summary: string;
  files_created?: string[];
  files_modified?: string[];
}
