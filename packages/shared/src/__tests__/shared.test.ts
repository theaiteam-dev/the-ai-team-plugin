import { describe, it, expect } from 'vitest';
import {
  ALL_STAGES,
  TRANSITION_MATRIX,
  PIPELINE_STAGES,
  isValidTransition,
  getValidNextStages,
  isDependencySatisfied,
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
    it('should contain all expected stages, with staged positioned between probing and done', () => {
      expect(ALL_STAGES).toEqual([
        'briefings',
        'ready',
        'testing',
        'implementing',
        'review',
        'probing',
        'staged',
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
      expect(isValidTransition('probing', 'staged')).toBe(true);
      // staged -> ready is the operator escape hatch (mirrors probing -> ready)
      expect(isValidTransition('staged', 'ready')).toBe(true);

      // Invalid transitions - review cannot skip probing to reach done
      expect(isValidTransition('review', 'done')).toBe(false);
      expect(isValidTransition('briefings', 'done')).toBe(false);
      expect(isValidTransition('testing', 'done')).toBe(false);
      expect(isValidTransition('done', 'ready')).toBe(false);
      // probing no longer routes directly to done — it must land in staged first
      expect(isValidTransition('probing', 'done')).toBe(false);
    });

    it('answers false — never throws — for an origin stage that is not in the matrix', () => {
      // Item.stageId is a plain String column, so `from` is unvalidated DB
      // data at every real call site: a legacy or typo'd stage id used to
      // index the matrix to `undefined` and throw a TypeError inside
      // POST /api/board/move, turning a bad request into a 500. An
      // unrecognized origin stage has no legal transitions — it answers
      // false, and the route can return its clean 400.
      expect(() =>
        isValidTransition('nonexistent' as StageId, 'done')
      ).not.toThrow();
      expect(isValidTransition('nonexistent' as StageId, 'done')).toBe(false);
      expect(isValidTransition('' as StageId, 'ready')).toBe(false);
      expect(isValidTransition(undefined as unknown as StageId, 'ready')).toBe(false);
    });

    it('returns an empty list — never undefined — for an origin stage that is not in the matrix', () => {
      // Same unvalidated-DB-data hazard isValidTransition() guards against: an
      // unknown stage id must not hand callers undefined to .includes/.map on.
      expect(getValidNextStages('nonexistent' as StageId)).toEqual([]);
    });

    it('done has no outbound transitions to any stage (terminal)', () => {
      for (const target of ALL_STAGES) {
        expect(isValidTransition('done', target)).toBe(false);
      }
    });

    it('TRANSITION_MATRIX.probing is exactly [ready, staged, blocked] — no longer routes to done', () => {
      expect(getValidNextStages('probing')).toEqual(['ready', 'staged', 'blocked']);
    });

    it('TRANSITION_MATRIX.staged is exactly [done, testing, implementing, ready, blocked]', () => {
      expect(getValidNextStages('staged')).toEqual([
        'done',
        'testing',
        'implementing',
        'ready',
        'blocked',
      ]);
    });

    it('TRANSITION_MATRIX.done remains an empty array (unchanged)', () => {
      expect(getValidNextStages('done')).toEqual([]);
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

      const doneNext = getValidNextStages('done');
      expect(doneNext).toEqual([]);
    });

    it('should define pipeline stages with agent assignments, with probing handing off to staged', () => {
      expect(PIPELINE_STAGES.testing?.agent).toBe('murdock');
      expect(PIPELINE_STAGES.testing?.nextStage).toBe('implementing');
      expect(PIPELINE_STAGES.implementing?.agent).toBe('ba');
      expect(PIPELINE_STAGES.implementing?.nextStage).toBe('review');
      expect(PIPELINE_STAGES.review?.agent).toBe('lynch');
      expect(PIPELINE_STAGES.review?.nextStage).toBe('probing');
      expect(PIPELINE_STAGES.probing?.agent).toBe('amy');
      expect(PIPELINE_STAGES.probing?.nextStage).toBe('staged');
    });

    it('PIPELINE_STAGES has no staged key — no agent owns the holding pen (Partial<Record> is not compiler-enforced)', () => {
      expect(Object.prototype.hasOwnProperty.call(PIPELINE_STAGES, 'staged')).toBe(false);
      expect(PIPELINE_STAGES.staged).toBeUndefined();
    });
  });

  // WI-788: dependency-wave satisfaction must accept 'staged' as complete
  // (not just 'done'), because once the pipeline ends at 'staged' nothing
  // ever reaches 'done' until the mission tail promotes it — every wave-2+
  // item would deadlock otherwise. This is the ONE shared predicate that
  // both GET /api/deps/check and POST /api/agents/start must call — the
  // item's context is explicit that a duplicated inline condition in either
  // route (instead of importing this) is exactly the bug class this item
  // exists to prevent.
  describe('isDependencySatisfied (WI-788: staged counts as complete for dependency-wave satisfaction)', () => {
    it('returns true for staged and done', () => {
      expect(isDependencySatisfied('staged')).toBe(true);
      expect(isDependencySatisfied('done')).toBe(true);
    });

    it('returns false for every non-terminal stage', () => {
      // Derived from ALL_STAGES (not a hardcoded list) so this test
      // automatically covers any stage added in the future.
      const nonTerminalStages = ALL_STAGES.filter(
        (stage) => stage !== 'staged' && stage !== 'done'
      );
      expect(nonTerminalStages.length).toBeGreaterThan(0); // sanity: the filter actually excluded something

      for (const stage of nonTerminalStages) {
        expect(isDependencySatisfied(stage)).toBe(false);
      }
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
        'frankie',
      ]);
    });

    it('should normalize agent names correctly', () => {
      expect(normalizeAgentName('Hannibal')).toBe('hannibal');
      expect(normalizeAgentName('B.A.')).toBe('ba');
      expect(normalizeAgentName('b.a.')).toBe('ba');
      expect(normalizeAgentName('MURDOCK')).toBe('murdock');
      expect(normalizeAgentName('Stockwell')).toBe('stockwell');
      expect(normalizeAgentName('Frankie')).toBe('frankie');
    });

    it('should validate agent names and map to display names', () => {
      expect(isValidAgent('murdock')).toBe(true);
      expect(isValidAgent('B.A.')).toBe(true);
      expect(isValidAgent('invalid')).toBe(false);
      expect(isValidAgent('stockwell')).toBe(true);
      expect(isValidAgent('frankie')).toBe(true);
      expect(isValidAgent('Frankie')).toBe(true);
      expect(isValidAgent('notanagent')).toBe(false);

      expect(AGENT_DISPLAY_NAMES['ba']).toBe('B.A.');
      expect(AGENT_DISPLAY_NAMES['hannibal']).toBe('Hannibal');
      expect(AGENT_DISPLAY_NAMES['stockwell']).toBe('Stockwell');
      expect(AGENT_DISPLAY_NAMES['frankie']).toBe('Frankie');
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
