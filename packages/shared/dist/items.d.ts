export declare const ITEM_TYPES: readonly ["feature", "bug", "task", "enhancement"];
export type ItemType = (typeof ITEM_TYPES)[number];
export declare const ITEM_PRIORITIES: readonly ["critical", "high", "medium", "low"];
export type ItemPriority = (typeof ITEM_PRIORITIES)[number];
/**
 * Finding-severity vocabulary, shared between Item.severity (WI-936, an
 * item's own finding provenance) and RetroLearning.severity — the single
 * source of truth both POST /api/items, PATCH /api/items/:id, and
 * POST /api/learnings validate against. Also matches the review-severity
 * mapping in commands/sweep.md.
 */
export declare const SEVERITY_VALUES: readonly ["low", "medium", "high", "critical"];
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
