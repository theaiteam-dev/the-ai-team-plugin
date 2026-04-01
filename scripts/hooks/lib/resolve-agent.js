/**
 * resolve-agent.js - Shared utility for extracting agent name from hook stdin JSON.
 *
 * Claude Code sends hook context via STDIN as JSON. This utility reads
 * `agent_type` first (primary identifier for native teammates and legacy
 * subagents), falls back to `teammate_name`, strips the `ai-team:` prefix,
 * normalizes to lowercase, and returns null if neither field is set.
 */

/**
 * All known A(i)-Team agents.
 */
export const KNOWN_AGENTS = ['hannibal', 'face', 'sosa', 'murdock', 'ba', 'lynch', 'stockwell', 'amy', 'tawnia'];

/**
 * Extracts and normalizes the agent name from a Claude Code hook input object.
 *
 * Fails open: returns null for null/undefined input or unidentifiable sessions.
 *
 * @param {Object} hookInput - Parsed stdin JSON from Claude Code
 * @returns {string|null} Normalized agent name, or null if unidentifiable
 */
export function resolveAgent(hookInput) {
  if (hookInput == null) return null;

  // Only accept string values; non-strings (number, boolean, object) are ignored
  const agentType = typeof hookInput.agent_type === 'string' ? hookInput.agent_type : '';
  const teammateName = typeof hookInput.teammate_name === 'string' ? hookInput.teammate_name : '';

  const raw = agentType || teammateName;
  if (!raw) return null;

  // Strip the ai-team: prefix if present, then normalize to lowercase
  const normalized = raw.replace(/^ai-team:/, '').toLowerCase();

  // Strip trailing dash-digit suffix (e.g. -1, -12) only when the base name is a known agent.
  // Unknown agents (e.g. explore-1) keep their suffix intact.
  const suffixMatch = normalized.match(/^(.+)-\d+$/);
  if (suffixMatch && KNOWN_AGENTS.includes(suffixMatch[1])) {
    return suffixMatch[1];
  }

  return normalized;
}

/**
 * Returns true if the given name is a known A(i)-Team agent.
 *
 * @param {string} name - Agent name to check
 * @returns {boolean}
 */
export function isKnownAgent(name) {
  return KNOWN_AGENTS.includes(name);
}
