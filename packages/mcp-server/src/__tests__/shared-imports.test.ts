/**
 * Integration tests verifying MCP server uses @ai-team/shared as source of truth.
 * These tests ensure shared domain concepts are imported, not duplicated.
 */

import { describe, it, expect } from 'vitest';
import { TRANSITION_MATRIX, VALID_AGENTS, normalizeAgentName, ITEM_TYPES, ITEM_PRIORITIES } from '@ai-team/shared';

describe('Shared Package Integration', () => {
  describe('TRANSITION_MATRIX', () => {
    it('should use shared stage transitions for board validation', () => {
      // Verify TRANSITION_MATRIX from @ai-team/shared matches expected structure
      expect(TRANSITION_MATRIX.briefings).toEqual(['ready', 'blocked']);
      expect(TRANSITION_MATRIX.ready).toEqual(['testing', 'implementing', 'probing', 'blocked', 'briefings']);
      expect(TRANSITION_MATRIX.testing).toEqual(['implementing', 'blocked']);
      expect(TRANSITION_MATRIX.implementing).toEqual(['review', 'blocked']);
      expect(TRANSITION_MATRIX.probing).toEqual(['ready', 'done', 'blocked']);
      expect(TRANSITION_MATRIX.review).toEqual(['testing', 'implementing', 'probing', 'blocked']);
      expect(TRANSITION_MATRIX.done).toEqual([]);
      expect(TRANSITION_MATRIX.blocked).toEqual(['ready']);
    });
  });

  describe('Agent Names', () => {
    it('should use shared VALID_AGENTS list', () => {
      // Verify all expected agents are in the shared list
      expect(VALID_AGENTS).toContain('murdock');
      expect(VALID_AGENTS).toContain('ba');
      expect(VALID_AGENTS).toContain('lynch');
      expect(VALID_AGENTS).toContain('amy');
      expect(VALID_AGENTS).toContain('hannibal');
      expect(VALID_AGENTS).toContain('face');
      expect(VALID_AGENTS).toContain('sosa');
      expect(VALID_AGENTS).toContain('tawnia');
      expect(VALID_AGENTS.length).toBe(8);
    });

    it('should use shared normalizeAgentName function', () => {
      // Test the normalization behavior from shared package
      expect(normalizeAgentName('B.A.')).toBe('ba');
      expect(normalizeAgentName('Murdock')).toBe('murdock');
      expect(normalizeAgentName('LYNCH')).toBe('lynch');
    });
  });

  describe('Item Types and Priorities', () => {
    it('should use shared ITEM_TYPES and ITEM_PRIORITIES', () => {
      // Verify shared item types match MCP server Zod schema expectations
      expect(ITEM_TYPES).toEqual(['feature', 'bug', 'task', 'enhancement']);

      // Verify shared priorities match MCP server Zod schema expectations
      expect(ITEM_PRIORITIES).toEqual(['critical', 'high', 'medium', 'low']);
    });
  });

  describe('Package Dependency', () => {
    it('should have @ai-team/shared as workspace dependency', async () => {
      // Read package.json to verify dependency
      const { default: pkg } = await import('../../package.json', { assert: { type: 'json' } });

      // Check for workspace dependency (could be in dependencies or devDependencies)
      const hasSharedDep =
        pkg.dependencies?.['@ai-team/shared'] === 'workspace:*' ||
        pkg.devDependencies?.['@ai-team/shared'] === 'workspace:*' ||
        pkg.dependencies?.['@ai-team/shared']?.startsWith('workspace:') ||
        pkg.devDependencies?.['@ai-team/shared']?.startsWith('workspace:');

      expect(hasSharedDep).toBe(true);
    });
  });
});
