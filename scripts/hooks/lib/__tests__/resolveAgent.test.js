/**
 * Tests for instance suffix stripping in resolveAgent().
 *
 * Multi-instance pipeline agents (e.g. murdock-1, ba-3) must be treated
 * identically to their base agent names by enforcement hooks and telemetry.
 * resolveAgent() strips trailing dash-digit suffixes when the base name is
 * a known agent, making multi-instance transparent to all downstream consumers.
 */

import { describe, it, expect } from 'vitest';
import { resolveAgent, isKnownAgent } from '../resolve-agent.js';

describe('resolveAgent() — instance suffix stripping', () => {
  it('strips single-digit suffix from known agent with ai-team: prefix', () => {
    expect(resolveAgent({ agent_type: 'ai-team:murdock-1' })).toBe('murdock');
  });

  it('strips single-digit suffix from known agent ba', () => {
    expect(resolveAgent({ agent_type: 'ai-team:ba-3' })).toBe('ba');
  });

  it('does not alter a known agent with no suffix', () => {
    expect(resolveAgent({ agent_type: 'ai-team:murdock' })).toBe('murdock');
  });

  it('strips multi-digit suffix from known agent', () => {
    expect(resolveAgent({ agent_type: 'ai-team:murdock-12' })).toBe('murdock');
  });

  it('does not strip suffix from an unknown agent name', () => {
    // 'explore' is not a known A(i)-Team agent; suffix must be preserved
    expect(resolveAgent({ agent_type: 'ai-team:explore-1' })).toBe('explore-1');
  });

  it('strips suffix when agent name is provided via teammate_name', () => {
    expect(resolveAgent({ teammate_name: 'ai-team:ba-2' })).toBe('ba');
  });
});

describe('isKnownAgent() — works correctly after suffix stripping', () => {
  it('returns true for base name resolved from a suffixed input', () => {
    const resolved = resolveAgent({ agent_type: 'ai-team:murdock-1' });
    expect(isKnownAgent(resolved)).toBe(true);
  });

  it('returns true for base name resolved from an unsuffixed input', () => {
    const resolved = resolveAgent({ agent_type: 'ai-team:murdock' });
    expect(isKnownAgent(resolved)).toBe(true);
  });

  it('returns false when suffix was preserved (unknown agent)', () => {
    const resolved = resolveAgent({ agent_type: 'ai-team:explore-1' });
    expect(isKnownAgent(resolved)).toBe(false);
  });
});
