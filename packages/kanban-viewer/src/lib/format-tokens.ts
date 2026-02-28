/**
 * format-tokens.ts - Shared token and cost formatting utilities.
 *
 * Canonical source for formatTokenCount and formatCostUsd.
 * Imported by token-usage-panel.tsx and token-summary.ts.
 */

/**
 * Format a token count into a human-readable string.
 * Values below 1000 are returned as-is.
 * Values in the thousands are formatted as "X.XK" (one decimal place).
 * Values in the millions are formatted as "X.XM" (one decimal place).
 *
 * Examples: 0 → "0", 999 → "999", 1000 → "1.0K", 45230 → "45.2K", 1200000 → "1.2M"
 */
export function formatTokenCount(count: number): string {
  if (count === 0) return "0";
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * Format a USD cost value as a dollar string with exactly 2 decimal places.
 *
 * Examples: 2.47 → "$2.47", 3 → "$3.00", 0 → "$0.00"
 */
export function formatCostUsd(cost: number): string {
  return `$${cost.toFixed(2)}`;
}
