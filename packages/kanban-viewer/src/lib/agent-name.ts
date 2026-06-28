/**
 * Agent name normalization for token-usage aggregation.
 *
 * Pipeline runs spawn pool instances of a single logical role — e.g. the
 * Murdock role may run as `murdock`, `murdock-1`, `murdock-2`, `murdock-3`
 * concurrently. Aggregating token usage by the raw instance name fragments
 * one role's cost across N rows, making the per-agent breakdown unreadable.
 *
 * `baseAgentName` collapses a pool-instance name to its base role by stripping
 * a trailing numeric instance suffix (`-<digits>`). It ONLY strips a numeric
 * suffix, so legitimately-distinct agent names are never mangled. No A(i)-Team
 * agent has a real name ending in `-<digits>` (hannibal, face, sosa, murdock,
 * ba, lynch, amy, stockwell, tawnia, retro), so this is unambiguous.
 *
 * Examples:
 *   baseAgentName('murdock-2')  → 'murdock'
 *   baseAgentName('murdock')    → 'murdock'
 *   baseAgentName('ba-13')      → 'ba'
 *   baseAgentName('hannibal')   → 'hannibal'  (no suffix)
 *   baseAgentName('claude-4-6') → 'claude-4'  (only the LAST -<digits> is stripped)
 */
export function baseAgentName(agentName: string): string {
  return agentName.replace(/-\d+$/, '');
}
