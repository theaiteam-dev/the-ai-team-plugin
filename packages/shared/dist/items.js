export const ITEM_TYPES = ['feature', 'bug', 'task', 'enhancement'];
export const ITEM_PRIORITIES = ['critical', 'high', 'medium', 'low'];
/**
 * Finding-severity vocabulary, shared between Item.severity (WI-936, an
 * item's own finding provenance) and RetroLearning.severity — the single
 * source of truth both POST /api/items, PATCH /api/items/:id, and
 * POST /api/learnings validate against. Also matches the review-severity
 * mapping in commands/sweep.md.
 */
export const SEVERITY_VALUES = ['low', 'medium', 'high', 'critical'];
