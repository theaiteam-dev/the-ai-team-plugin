import { describe, it, expect } from 'vitest';
import {
  ALL_STAGES,
  VALID_AGENTS,
  ITEM_TYPES,
  ITEM_PRIORITIES,
  ERROR_CODES,
  TRANSITION_MATRIX,
  AGENT_DISPLAY_NAMES,
  isValidTransition,
  getValidNextStages,
  normalizeAgentName,
  isValidAgent,
  type StageId,
  type AgentId,
  type ItemType,
  type ItemPriority,
  type ItemOutputs,
  type WorkLogEntry,
  type ErrorCode,
} from '@ai-team/shared';

describe('kanban-viewer shared imports', () => {
  describe('Stage constants', () => {
    it('should import ALL_STAGES from shared package', () => {
      expect(ALL_STAGES).toEqual([
        'briefings',
        'ready',
        'testing',
        'implementing',
        'review',
        'probing',
        'done',
        'blocked',
      ]);
      expect(ALL_STAGES.length).toBe(8);
    });

    it('should import TRANSITION_MATRIX from shared package', () => {
      expect(TRANSITION_MATRIX).toBeDefined();
      expect(TRANSITION_MATRIX.briefings).toContain('ready');
      expect(TRANSITION_MATRIX.done).toEqual([]);
    });

    it('should import stage validation functions from shared package', () => {
      expect(typeof isValidTransition).toBe('function');
      expect(typeof getValidNextStages).toBe('function');

      // Verify functions work
      expect(isValidTransition('ready', 'testing')).toBe(true);
      expect(isValidTransition('done', 'testing')).toBe(false);
      expect(getValidNextStages('ready')).toContain('testing');
    });
  });

  describe('Agent constants', () => {
    it('should import VALID_AGENTS from shared package', () => {
      expect(VALID_AGENTS).toEqual([
        'murdock',
        'ba',
        'lynch',
        'amy',
        'hannibal',
        'face',
        'sosa',
        'tawnia',
      ]);
      expect(VALID_AGENTS.length).toBe(8);
    });

    it('should import AGENT_DISPLAY_NAMES from shared package', () => {
      expect(AGENT_DISPLAY_NAMES).toBeDefined();
      expect(AGENT_DISPLAY_NAMES.murdock).toBe('Murdock');
      expect(AGENT_DISPLAY_NAMES.ba).toBe('B.A.');
      expect(AGENT_DISPLAY_NAMES.hannibal).toBe('Hannibal');
    });

    it('should import agent validation functions from shared package', () => {
      expect(typeof normalizeAgentName).toBe('function');
      expect(typeof isValidAgent).toBe('function');

      // Verify functions work
      expect(normalizeAgentName('B.A.')).toBe('ba');
      expect(isValidAgent('murdock')).toBe(true);
      expect(isValidAgent('invalid')).toBe(false);
    });
  });

  describe('Item type constants', () => {
    it('should import ITEM_TYPES from shared package', () => {
      expect(ITEM_TYPES).toEqual(['feature', 'bug', 'task', 'enhancement']);
      expect(ITEM_TYPES.length).toBe(4);
    });

    it('should import ITEM_PRIORITIES from shared package', () => {
      expect(ITEM_PRIORITIES).toEqual(['critical', 'high', 'medium', 'low']);
      expect(ITEM_PRIORITIES.length).toBe(4);
    });

    it('should import ItemOutputs type from shared package', () => {
      // Type-only import - verify it compiles
      const outputs: ItemOutputs = {
        test: 'test.ts',
        impl: 'impl.ts',
        types: 'types.ts',
      };
      expect(outputs).toBeDefined();
    });

    it('should import WorkLogEntry type from shared package', () => {
      // Type-only import - verify it compiles
      const entry: WorkLogEntry = {
        agent: 'murdock',
        timestamp: '2026-02-09T10:00:00Z',
        status: 'success',
        summary: 'Test complete',
        files_created: ['test.ts'],
      };
      expect(entry).toBeDefined();
    });
  });

  describe('Error constants', () => {
    it('should import ERROR_CODES from shared package', () => {
      expect(ERROR_CODES).toBeDefined();
      expect(ERROR_CODES.ITEM_NOT_FOUND).toBe('ITEM_NOT_FOUND');
      expect(ERROR_CODES.INVALID_TRANSITION).toBe('INVALID_TRANSITION');
      expect(ERROR_CODES.WIP_LIMIT_EXCEEDED).toBe('WIP_LIMIT_EXCEEDED');
      expect(ERROR_CODES.AGENT_BUSY).toBe('AGENT_BUSY');
      expect(ERROR_CODES.DEPS_NOT_MET).toBe('DEPS_NOT_MET');
    });

    it('should import ErrorCode type from shared package', () => {
      // Type-only import - verify it compiles
      const code: ErrorCode = 'ITEM_NOT_FOUND';
      expect(code).toBeDefined();
    });
  });

  describe('Type exports', () => {
    it('should import StageId type from shared package', () => {
      // Type-only import - verify it compiles
      const stage: StageId = 'testing';
      expect(stage).toBeDefined();
    });

    it('should import AgentId type from shared package', () => {
      // Type-only import - verify it compiles
      const agent: AgentId = 'murdock';
      expect(agent).toBeDefined();
    });

    it('should import ItemType and ItemPriority types from shared package', () => {
      // Type-only imports - verify they compile
      const type: ItemType = 'feature';
      const priority: ItemPriority = 'high';
      expect(type).toBeDefined();
      expect(priority).toBeDefined();
    });
  });

  describe('Package dependency', () => {
    it('should declare @ai-team/shared as workspace dependency', async () => {
      // Read package.json directly
      const pkg = await import('../../package.json');
      const deps = pkg.dependencies as Record<string, string> | undefined;
      const devDeps = pkg.devDependencies as Record<string, string> | undefined;
      const hasDep =
        deps?.['@ai-team/shared'] ||
        devDeps?.['@ai-team/shared'];

      expect(hasDep).toBeDefined();
      expect(typeof hasDep).toBe('string');
    });
  });
});
