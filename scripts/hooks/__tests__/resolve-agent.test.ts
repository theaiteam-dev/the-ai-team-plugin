/**
 * Tests for the shared resolveAgent() utility.
 *
 * resolveAgent(hookInput) extracts and normalizes an agent name from
 * Claude Code's hook stdin JSON. It reads `agent_type` first (primary
 * identifier for native teammates and legacy subagents), falls back to
 * `teammate_name`, strips the `ai-team:` prefix, lowercases, and
 * returns null if neither field is set.
 *
 * MODULE FORMAT NOTE: Vitest handles ESM imports fine. However, the real
 * consumers of resolve-agent are CommonJS hook scripts in scripts/hooks/
 * that use require(). The implementation must be CommonJS (module.exports)
 * or dual-format so hooks can require() it without transpilation.
 * B.A. should implement as CommonJS to match the existing hook ecosystem.
 */

import { describe, it, expect } from 'vitest';
import { resolveAgent, isKnownAgent, KNOWN_AGENTS } from '../lib/resolve-agent.js';

describe('resolveAgent()', () => {
  it('returns agent_type as-is when no prefix present', () => {
    expect(resolveAgent({ agent_type: 'murdock' })).toBe('murdock');
  });

  it('strips ai-team: prefix from agent_type', () => {
    expect(resolveAgent({ agent_type: 'ai-team:murdock' })).toBe('murdock');
  });

  it('falls back to teammate_name when agent_type is absent', () => {
    expect(resolveAgent({ teammate_name: 'murdock' })).toBe('murdock');
  });

  it('prefers agent_type over teammate_name when both present', () => {
    expect(resolveAgent({ agent_type: 'ai-team:ba', teammate_name: 'ba' })).toBe('ba');
  });

  it('returns null when neither agent_type nor teammate_name is set', () => {
    expect(resolveAgent({})).toBeNull();
  });

  it('normalizes to lowercase', () => {
    expect(resolveAgent({ agent_type: 'Explore' })).toBe('explore');
  });

  // Edge cases: fail-open for bad inputs

  it('returns null for null input (fail-open, no TypeError)', () => {
    expect(resolveAgent(null)).toBeNull();
  });

  it('returns null for undefined input (fail-open, no TypeError)', () => {
    expect(resolveAgent(undefined)).toBeNull();
  });

  it('handles empty string agent_type by falling back to teammate_name', () => {
    expect(resolveAgent({ agent_type: '', teammate_name: 'lynch' })).toBe('lynch');
  });

  it('returns null for empty string agent_type with no teammate_name', () => {
    expect(resolveAgent({ agent_type: '' })).toBeNull();
  });

  it('handles non-string agent_type gracefully (number)', () => {
    // Should not throw TypeError from .replace() on a non-string
    expect(() => resolveAgent({ agent_type: 42 as unknown as string })).not.toThrow();
  });

  it('handles non-string agent_type gracefully (boolean)', () => {
    expect(() => resolveAgent({ agent_type: true as unknown as string })).not.toThrow();
  });
});

describe('isKnownAgent()', () => {
  it('returns true for known agents', () => {
    expect(isKnownAgent('murdock')).toBe(true);
  });

  it('returns false for unknown/system agents', () => {
    expect(isKnownAgent('explore')).toBe(false);
  });
});

describe('KNOWN_AGENTS', () => {
  it('contains all nine A(i)-Team agents', () => {
    expect(KNOWN_AGENTS).toEqual(
      expect.arrayContaining(['hannibal', 'face', 'sosa', 'murdock', 'ba', 'lynch', 'stockwell', 'amy', 'tawnia'])
    );
    expect(KNOWN_AGENTS).toHaveLength(9);
  });
});
