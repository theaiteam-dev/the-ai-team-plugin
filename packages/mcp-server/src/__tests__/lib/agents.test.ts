import { describe, it, expect } from 'vitest';

/**
 * Tests for the shared agent name validation module.
 *
 * This module extracts duplicated agent validation logic from
 * board.ts, agents.ts, and utils.ts into a single shared module.
 */

// Import from the shared module (does not exist yet - tests should fail)
import {
  VALID_AGENTS_LOWER,
  AGENT_NAME_MAP,
  normalizeAgentName,
  AgentNameSchema,
} from '../../lib/agents.js';

describe('lib/agents - shared agent validation', () => {
  describe('VALID_AGENTS_LOWER', () => {
    it('contains all expected agent names', () => {
      const expected = ['murdock', 'ba', 'lynch', 'amy', 'hannibal', 'face', 'sosa', 'tawnia', 'stockwell'];
      expect([...VALID_AGENTS_LOWER]).toEqual(expect.arrayContaining(expected));
      expect(VALID_AGENTS_LOWER).toHaveLength(expected.length);
    });
  });

  describe('normalizeAgentName', () => {
    it('normalizes various agent name formats to lowercase keys', () => {
      // Standard capitalized names
      expect(normalizeAgentName('Murdock')).toBe('murdock');
      expect(normalizeAgentName('Lynch')).toBe('lynch');
      expect(normalizeAgentName('Amy')).toBe('amy');

      // Special case: B.A. with dots
      expect(normalizeAgentName('B.A.')).toBe('ba');
      expect(normalizeAgentName('b.a.')).toBe('ba');

      // Already lowercase
      expect(normalizeAgentName('face')).toBe('face');

      // All uppercase
      expect(normalizeAgentName('HANNIBAL')).toBe('hannibal');
    });
  });

  describe('AgentNameSchema', () => {
    it('validates and transforms correct names to API format', () => {
      // Lowercase input -> API format
      expect(AgentNameSchema.parse('murdock')).toBe('Murdock');
      expect(AgentNameSchema.parse('ba')).toBe('B.A.');
      expect(AgentNameSchema.parse('lynch')).toBe('Lynch');
      expect(AgentNameSchema.parse('tawnia')).toBe('Tawnia');

      // Case-insensitive input
      expect(AgentNameSchema.parse('MURDOCK')).toBe('Murdock');
      expect(AgentNameSchema.parse('B.A.')).toBe('B.A.');
      expect(AgentNameSchema.parse('Face')).toBe('Face');
    });

    it('rejects invalid agent names', () => {
      expect(() => AgentNameSchema.parse('invalid')).toThrow();
      expect(() => AgentNameSchema.parse('')).toThrow();
      expect(() => AgentNameSchema.parse('nobody')).toThrow();
    });
  });
});
