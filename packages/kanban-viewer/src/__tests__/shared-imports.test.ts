import { describe, it, expect } from 'vitest';
import {
  TRANSITION_MATRIX,
  isValidTransition,
  getValidNextStages,
  normalizeAgentName,
  isValidAgent,
} from '@ai-team/shared';

describe('kanban-viewer shared imports', () => {
  describe('Stage transition functions', () => {
    it('should validate allowed transitions', () => {
      expect(isValidTransition('ready', 'testing')).toBe(true);
      expect(isValidTransition('done', 'testing')).toBe(false);
    });

    it('should return valid next stages', () => {
      expect(getValidNextStages('ready')).toContain('testing');
    });

    it('should have done stage with no valid transitions', () => {
      expect(TRANSITION_MATRIX.done).toEqual([]);
    });

    it('should allow briefings to transition to ready', () => {
      expect(TRANSITION_MATRIX.briefings).toContain('ready');
    });
  });

  describe('Agent validation functions', () => {
    it('should normalize agent display names to IDs', () => {
      expect(normalizeAgentName('B.A.')).toBe('ba');
    });

    it('should validate known agents', () => {
      expect(isValidAgent('murdock')).toBe(true);
      expect(isValidAgent('invalid')).toBe(false);
    });
  });
});
