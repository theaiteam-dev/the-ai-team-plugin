import { describe, it, expect } from 'vitest';
import {
  ALL_STAGES,
  TRANSITION_MATRIX,
  PIPELINE_STAGES,
  isValidTransition,
  getValidNextStages,
  type StageId,
} from '../stages';
import {
  VALID_AGENTS,
  AGENT_DISPLAY_NAMES,
  normalizeAgentName,
  isValidAgent,
  type AgentId,
} from '../agents';
import {
  ITEM_TYPES,
  ITEM_PRIORITIES,
  type ItemType,
  type ItemPriority,
} from '../items';
import { ERROR_CODES, type ErrorCode } from '../errors';

describe('Shared Package', () => {
  describe('stages', () => {
    it('should contain all expected stages', () => {
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
    });

    it('should validate stage transitions correctly', () => {
      // Valid transitions
      expect(isValidTransition('briefings', 'ready')).toBe(true);
      expect(isValidTransition('ready', 'testing')).toBe(true);
      expect(isValidTransition('testing', 'implementing')).toBe(true);
      expect(isValidTransition('review', 'probing')).toBe(true);
      expect(isValidTransition('probing', 'done')).toBe(true);

      // Invalid transitions - review cannot skip probing to reach done
      expect(isValidTransition('review', 'done')).toBe(false);
      expect(isValidTransition('briefings', 'done')).toBe(false);
      expect(isValidTransition('testing', 'done')).toBe(false);
      expect(isValidTransition('done', 'ready')).toBe(false);
    });

    it('should return valid next stages for a given stage', () => {
      const briefingsNext = getValidNextStages('briefings');
      expect(briefingsNext).toEqual(['ready', 'blocked']);

      const testingNext = getValidNextStages('testing');
      expect(testingNext).toContain('implementing');
      expect(testingNext).not.toContain('review');

      const reviewNext = getValidNextStages('review');
      expect(reviewNext).not.toContain('done');
      expect(reviewNext).toContain('probing');
      expect(reviewNext).toContain('testing');

      const probingNext = getValidNextStages('probing');
      expect(probingNext).toContain('done');

      const doneNext = getValidNextStages('done');
      expect(doneNext).toEqual([]);
    });

    it('should define pipeline stages with agent assignments', () => {
      expect(PIPELINE_STAGES.testing?.agent).toBe('murdock');
      expect(PIPELINE_STAGES.testing?.nextStage).toBe('implementing');
      expect(PIPELINE_STAGES.implementing?.agent).toBe('ba');
      expect(PIPELINE_STAGES.implementing?.nextStage).toBe('review');
      expect(PIPELINE_STAGES.review?.agent).toBe('lynch');
      expect(PIPELINE_STAGES.review?.nextStage).toBe('probing');
      expect(PIPELINE_STAGES.probing?.agent).toBe('amy');
      expect(PIPELINE_STAGES.probing?.nextStage).toBe('done');
    });
  });

  describe('agents', () => {
    it('should contain all expected agents', () => {
      expect(VALID_AGENTS).toEqual([
        'murdock',
        'ba',
        'lynch',
        'amy',
        'hannibal',
        'face',
        'sosa',
        'tawnia',
        'stockwell',
      ]);
    });

    it('should normalize agent names correctly', () => {
      expect(normalizeAgentName('Hannibal')).toBe('hannibal');
      expect(normalizeAgentName('B.A.')).toBe('ba');
      expect(normalizeAgentName('b.a.')).toBe('ba');
      expect(normalizeAgentName('MURDOCK')).toBe('murdock');
      expect(normalizeAgentName('Stockwell')).toBe('stockwell');
    });

    it('should validate agent names and map to display names', () => {
      expect(isValidAgent('murdock')).toBe(true);
      expect(isValidAgent('B.A.')).toBe(true);
      expect(isValidAgent('invalid')).toBe(false);
      expect(isValidAgent('stockwell')).toBe(true);

      expect(AGENT_DISPLAY_NAMES['ba']).toBe('B.A.');
      expect(AGENT_DISPLAY_NAMES['hannibal']).toBe('Hannibal');
      expect(AGENT_DISPLAY_NAMES['stockwell']).toBe('Stockwell');
    });
  });

  describe('items', () => {
    it('should contain expected item types and priorities', () => {
      expect(ITEM_TYPES).toEqual(['feature', 'bug', 'task', 'enhancement']);
      expect(ITEM_PRIORITIES).toEqual(['critical', 'high', 'medium', 'low']);
    });
  });

  describe('errors', () => {
    it('should contain expected error codes', () => {
      expect(ERROR_CODES.ITEM_NOT_FOUND).toBe('ITEM_NOT_FOUND');
      expect(ERROR_CODES.INVALID_TRANSITION).toBe('INVALID_TRANSITION');
      expect(ERROR_CODES.WIP_LIMIT_EXCEEDED).toBe('WIP_LIMIT_EXCEEDED');
      expect(ERROR_CODES.AGENT_BUSY).toBe('AGENT_BUSY');
      expect(ERROR_CODES.DEPS_NOT_MET).toBe('DEPS_NOT_MET');
      expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ERROR_CODES.MISSION_NOT_FOUND).toBe('MISSION_NOT_FOUND');
      expect(ERROR_CODES.MISSION_ALREADY_ACTIVE).toBe('MISSION_ALREADY_ACTIVE');
    });
  });
});
