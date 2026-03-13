import { describe, it, expect } from 'vitest';
import type {
  AgentName,
  Mission,
  BoardMetadata,
  FinalReviewStatus,
  PostChecksStatus,
  CheckResult,
  DocumentationStatus,
  MissionPhase,
} from '../types';

/**
 * Tests for Mission Completion Flow Types (PRD 012)
 *
 * These tests define acceptance criteria for the mission completion types.
 * Tests will FAIL until B.A. implements the types in src/types/index.ts.
 */
describe('Mission Completion Flow Types', () => {
  describe('AgentName - Tawnia Addition', () => {
    it('should accept Tawnia as a valid AgentName', () => {
      const agent: AgentName = 'Tawnia';
      expect(agent).toBe('Tawnia');
    });

    it('should have exactly 7 valid agent names including Tawnia', () => {
      const allAgents: AgentName[] = [
        'Hannibal',
        'Face',
        'Murdock',
        'B.A.',
        'Amy',
        'Lynch',
        'Tawnia',
      ];

      expect(allAgents).toHaveLength(7);
      allAgents.forEach((agent) => {
        expect(typeof agent).toBe('string');
      });
    });

    it('should still accept all existing agent names', () => {
      const hannibal: AgentName = 'Hannibal';
      const face: AgentName = 'Face';
      const murdock: AgentName = 'Murdock';
      const ba: AgentName = 'B.A.';
      const amy: AgentName = 'Amy';
      const lynch: AgentName = 'Lynch';

      expect(hannibal).toBe('Hannibal');
      expect(face).toBe('Face');
      expect(murdock).toBe('Murdock');
      expect(ba).toBe('B.A.');
      expect(amy).toBe('Amy');
      expect(lynch).toBe('Lynch');
    });
  });

  describe('MissionPhase Type', () => {
    it('should accept active as a valid MissionPhase', () => {
      const phase: MissionPhase = 'active';
      expect(phase).toBe('active');
    });

    it('should accept final_review as a valid MissionPhase', () => {
      const phase: MissionPhase = 'final_review';
      expect(phase).toBe('final_review');
    });

    it('should accept post_checks as a valid MissionPhase', () => {
      const phase: MissionPhase = 'post_checks';
      expect(phase).toBe('post_checks');
    });

    it('should accept documentation as a valid MissionPhase', () => {
      const phase: MissionPhase = 'documentation';
      expect(phase).toBe('documentation');
    });

    it('should accept complete as a valid MissionPhase', () => {
      const phase: MissionPhase = 'complete';
      expect(phase).toBe('complete');
    });

    it('should have all 5 mission phases defined', () => {
      const phases: MissionPhase[] = [
        'active',
        'final_review',
        'post_checks',
        'documentation',
        'complete',
      ];
      expect(phases).toHaveLength(5);
    });

    it('should reject invalid mission phase at compile time', () => {
      // @ts-expect-error - 'invalid_phase' is not a valid MissionPhase
      const invalid: MissionPhase = 'invalid_phase';
      expect(invalid).toBeDefined();
    });
  });

  describe('CheckResult Interface', () => {
    it('should have status and completed_at fields', () => {
      const result: CheckResult = {
        status: 'passed',
        completed_at: '2026-01-20T12:00:00.000Z',
      };
      expect(result.status).toBe('passed');
      expect(result.completed_at).toBe('2026-01-20T12:00:00.000Z');
    });

    it('should accept pending status', () => {
      const result: CheckResult = {
        status: 'pending',
        completed_at: undefined,
      };
      expect(result.status).toBe('pending');
    });

    it('should accept running status', () => {
      const result: CheckResult = {
        status: 'running',
        completed_at: undefined,
      };
      expect(result.status).toBe('running');
    });

    it('should accept passed status', () => {
      const result: CheckResult = {
        status: 'passed',
        completed_at: '2026-01-20T12:00:00.000Z',
      };
      expect(result.status).toBe('passed');
    });

    it('should accept failed status', () => {
      const result: CheckResult = {
        status: 'failed',
        completed_at: '2026-01-20T12:00:00.000Z',
      };
      expect(result.status).toBe('failed');
    });

    it('should reject invalid status at compile time', () => {
      const result: CheckResult = {
        // @ts-expect-error - 'invalid_status' is not valid for CheckResult.status
        status: 'invalid_status',
        completed_at: undefined,
      };
      expect(result).toBeDefined();
    });
  });

  describe('FinalReviewStatus Interface', () => {
    it('should have all required fields', () => {
      const status: FinalReviewStatus = {
        started_at: '2026-01-20T10:00:00.000Z',
        completed_at: '2026-01-20T11:00:00.000Z',
        passed: true,
        verdict: 'All items meet quality standards',
        agent: 'Lynch',
        rejections: 0,
      };

      expect(status.started_at).toBe('2026-01-20T10:00:00.000Z');
      expect(status.completed_at).toBe('2026-01-20T11:00:00.000Z');
      expect(status.passed).toBe(true);
      expect(status.verdict).toBe('All items meet quality standards');
      expect(status.agent).toBe('Lynch');
      expect(status.rejections).toBe(0);
    });

    it('should accept FinalReviewStatus without completed_at when in progress', () => {
      const status: FinalReviewStatus = {
        started_at: '2026-01-20T10:00:00.000Z',
        completed_at: undefined,
        passed: false,
        verdict: undefined,
        agent: 'Lynch',
        rejections: 0,
      };

      expect(status.started_at).toBe('2026-01-20T10:00:00.000Z');
      expect(status.completed_at).toBeUndefined();
      expect(status.passed).toBe(false);
    });

    it('should track rejections count', () => {
      const status: FinalReviewStatus = {
        started_at: '2026-01-20T10:00:00.000Z',
        completed_at: '2026-01-20T11:00:00.000Z',
        passed: false,
        verdict: 'Items require revision',
        agent: 'Lynch',
        rejections: 3,
      };

      expect(status.rejections).toBe(3);
    });

    it('should accept valid AgentName for agent field', () => {
      const status: FinalReviewStatus = {
        started_at: '2026-01-20T10:00:00.000Z',
        completed_at: undefined,
        passed: false,
        verdict: undefined,
        agent: 'Tawnia',
        rejections: 0,
      };

      expect(status.agent).toBe('Tawnia');
    });
  });

  describe('PostChecksStatus Interface', () => {
    it('should have all required fields', () => {
      const status: PostChecksStatus = {
        started_at: '2026-01-20T12:00:00.000Z',
        completed_at: '2026-01-20T12:30:00.000Z',
        passed: true,
        results: {
          lint: { status: 'passed', completed_at: '2026-01-20T12:10:00.000Z' },
          typecheck: { status: 'passed', completed_at: '2026-01-20T12:15:00.000Z' },
          test: { status: 'passed', completed_at: '2026-01-20T12:25:00.000Z' },
          build: { status: 'passed', completed_at: '2026-01-20T12:30:00.000Z' },
        },
      };

      expect(status.started_at).toBe('2026-01-20T12:00:00.000Z');
      expect(status.completed_at).toBe('2026-01-20T12:30:00.000Z');
      expect(status.passed).toBe(true);
      expect(status.results.lint.status).toBe('passed');
      expect(status.results.typecheck.status).toBe('passed');
      expect(status.results.test.status).toBe('passed');
      expect(status.results.build.status).toBe('passed');
    });

    it('should handle pending checks', () => {
      const status: PostChecksStatus = {
        started_at: '2026-01-20T12:00:00.000Z',
        completed_at: undefined,
        passed: false,
        results: {
          lint: { status: 'passed', completed_at: '2026-01-20T12:10:00.000Z' },
          typecheck: { status: 'running', completed_at: undefined },
          test: { status: 'pending', completed_at: undefined },
          build: { status: 'pending', completed_at: undefined },
        },
      };

      expect(status.results.lint.status).toBe('passed');
      expect(status.results.typecheck.status).toBe('running');
      expect(status.results.test.status).toBe('pending');
      expect(status.results.build.status).toBe('pending');
    });

    it('should handle failed checks', () => {
      const status: PostChecksStatus = {
        started_at: '2026-01-20T12:00:00.000Z',
        completed_at: '2026-01-20T12:20:00.000Z',
        passed: false,
        results: {
          lint: { status: 'passed', completed_at: '2026-01-20T12:10:00.000Z' },
          typecheck: { status: 'failed', completed_at: '2026-01-20T12:20:00.000Z' },
          test: { status: 'pending', completed_at: undefined },
          build: { status: 'pending', completed_at: undefined },
        },
      };

      expect(status.passed).toBe(false);
      expect(status.results.typecheck.status).toBe('failed');
    });
  });

  describe('DocumentationStatus Interface', () => {
    it('should have all required fields', () => {
      const status: DocumentationStatus = {
        started_at: '2026-01-20T13:00:00.000Z',
        completed_at: '2026-01-20T13:30:00.000Z',
        completed: true,
        agent: 'Tawnia',
        files_modified: ['README.md', 'docs/api.md', 'CHANGELOG.md'],
        commit: 'abc123def456',
        summary: 'Updated documentation for mission completion feature',
      };

      expect(status.started_at).toBe('2026-01-20T13:00:00.000Z');
      expect(status.completed_at).toBe('2026-01-20T13:30:00.000Z');
      expect(status.completed).toBe(true);
      expect(status.agent).toBe('Tawnia');
      expect(status.files_modified).toHaveLength(3);
      expect(status.commit).toBe('abc123def456');
      expect(status.summary).toBe('Updated documentation for mission completion feature');
    });

    it('should handle in-progress documentation', () => {
      const status: DocumentationStatus = {
        started_at: '2026-01-20T13:00:00.000Z',
        completed_at: undefined,
        completed: false,
        agent: 'Tawnia',
        files_modified: [],
        commit: undefined,
        summary: undefined,
      };

      expect(status.completed).toBe(false);
      expect(status.completed_at).toBeUndefined();
      expect(status.files_modified).toHaveLength(0);
      expect(status.commit).toBeUndefined();
    });

    it('should accept any valid AgentName for agent field', () => {
      const status: DocumentationStatus = {
        started_at: '2026-01-20T13:00:00.000Z',
        completed_at: undefined,
        completed: false,
        agent: 'Hannibal',
        files_modified: [],
        commit: undefined,
        summary: undefined,
      };

      expect(status.agent).toBe('Hannibal');
    });
  });

  describe('BoardMetadata - Mission Completion Fields', () => {
    it('should accept optional finalReview field', () => {
      const metadata: BoardMetadata = {
        mission: {
          name: 'Test Mission',
          status: 'active',
        },
        wip_limits: {},
        phases: {},
        assignments: {},
        agents: {},
        stats: {
          total_items: 5,
          completed: 5,
          in_progress: 0,
          blocked: 0,
          backlog: 0,
        },
        last_updated: '2026-01-20T12:00:00.000Z',
        finalReview: {
          started_at: '2026-01-20T10:00:00.000Z',
          completed_at: '2026-01-20T11:00:00.000Z',
          passed: true,
          verdict: 'Approved',
          agent: 'Lynch',
          rejections: 0,
        },
      };

      expect(metadata.finalReview?.passed).toBe(true);
      expect(metadata.finalReview?.agent).toBe('Lynch');
    });

    it('should accept optional postChecks field', () => {
      const metadata: BoardMetadata = {
        mission: {
          name: 'Test Mission',
          status: 'active',
        },
        wip_limits: {},
        phases: {},
        assignments: {},
        agents: {},
        stats: {
          total_items: 5,
          completed: 5,
          in_progress: 0,
          blocked: 0,
          backlog: 0,
        },
        last_updated: '2026-01-20T12:00:00.000Z',
        postChecks: {
          started_at: '2026-01-20T12:00:00.000Z',
          completed_at: '2026-01-20T12:30:00.000Z',
          passed: true,
          results: {
            lint: { status: 'passed', completed_at: '2026-01-20T12:10:00.000Z' },
            typecheck: { status: 'passed', completed_at: '2026-01-20T12:15:00.000Z' },
            test: { status: 'passed', completed_at: '2026-01-20T12:25:00.000Z' },
            build: { status: 'passed', completed_at: '2026-01-20T12:30:00.000Z' },
          },
        },
      };

      expect(metadata.postChecks?.passed).toBe(true);
      expect(metadata.postChecks?.results.lint.status).toBe('passed');
    });

    it('should accept optional documentation field', () => {
      const metadata: BoardMetadata = {
        mission: {
          name: 'Test Mission',
          status: 'active',
        },
        wip_limits: {},
        phases: {},
        assignments: {},
        agents: {},
        stats: {
          total_items: 5,
          completed: 5,
          in_progress: 0,
          blocked: 0,
          backlog: 0,
        },
        last_updated: '2026-01-20T12:00:00.000Z',
        documentation: {
          started_at: '2026-01-20T13:00:00.000Z',
          completed_at: '2026-01-20T13:30:00.000Z',
          completed: true,
          agent: 'Tawnia',
          files_modified: ['README.md'],
          commit: 'abc123',
          summary: 'Docs updated',
        },
      };

      expect(metadata.documentation?.completed).toBe(true);
      expect(metadata.documentation?.agent).toBe('Tawnia');
    });

    it('should work without any new optional fields (backward compatibility)', () => {
      const metadata: BoardMetadata = {
        mission: {
          name: 'Legacy Mission',
          status: 'active',
        },
        wip_limits: {},
        phases: {},
        assignments: {},
        agents: {},
        stats: {
          total_items: 5,
          completed: 3,
          in_progress: 2,
          blocked: 0,
          backlog: 0,
        },
        last_updated: '2026-01-20T12:00:00.000Z',
      };

      expect(metadata.finalReview).toBeUndefined();
      expect(metadata.postChecks).toBeUndefined();
      expect(metadata.documentation).toBeUndefined();
    });

    it('should accept all mission completion fields together', () => {
      const metadata: BoardMetadata = {
        mission: {
          name: 'Complete Mission',
          status: 'completed',
          completed_at: '2026-01-20T14:00:00.000Z',
          duration_ms: 28800000, // 8 hours
        },
        wip_limits: {},
        phases: {},
        assignments: {},
        agents: {},
        stats: {
          total_items: 10,
          completed: 10,
          in_progress: 0,
          blocked: 0,
          backlog: 0,
        },
        last_updated: '2026-01-20T14:00:00.000Z',
        finalReview: {
          started_at: '2026-01-20T10:00:00.000Z',
          completed_at: '2026-01-20T11:00:00.000Z',
          passed: true,
          verdict: 'All clear',
          agent: 'Lynch',
          rejections: 0,
        },
        postChecks: {
          started_at: '2026-01-20T12:00:00.000Z',
          completed_at: '2026-01-20T12:30:00.000Z',
          passed: true,
          results: {
            lint: { status: 'passed', completed_at: '2026-01-20T12:10:00.000Z' },
            typecheck: { status: 'passed', completed_at: '2026-01-20T12:15:00.000Z' },
            test: { status: 'passed', completed_at: '2026-01-20T12:25:00.000Z' },
            build: { status: 'passed', completed_at: '2026-01-20T12:30:00.000Z' },
          },
        },
        documentation: {
          started_at: '2026-01-20T13:00:00.000Z',
          completed_at: '2026-01-20T13:30:00.000Z',
          completed: true,
          agent: 'Tawnia',
          files_modified: ['README.md', 'CHANGELOG.md'],
          commit: 'abc123',
          summary: 'Documentation complete',
        },
      };

      expect(metadata.mission.status).toBe('completed');
      expect(metadata.finalReview?.passed).toBe(true);
      expect(metadata.postChecks?.passed).toBe(true);
      expect(metadata.documentation?.completed).toBe(true);
    });
  });

  describe('Mission.status - Extended Phases', () => {
    it('should still accept existing status values', () => {
      const active: Mission = { name: 'M1', status: 'active' };
      const paused: Mission = { name: 'M2', status: 'paused' };
      const completed: Mission = { name: 'M3', status: 'completed' };
      const planning: Mission = { name: 'M4', status: 'planning' };

      expect(active.status).toBe('active');
      expect(paused.status).toBe('paused');
      expect(completed.status).toBe('completed');
      expect(planning.status).toBe('planning');
    });

    it('should accept final_review as Mission status', () => {
      const mission: Mission = {
        name: 'Review Mission',
        status: 'final_review',
      };
      expect(mission.status).toBe('final_review');
    });

    it('should accept post_checks as Mission status', () => {
      const mission: Mission = {
        name: 'Checking Mission',
        status: 'post_checks',
      };
      expect(mission.status).toBe('post_checks');
    });

    it('should accept documentation as Mission status', () => {
      const mission: Mission = {
        name: 'Documenting Mission',
        status: 'documentation',
      };
      expect(mission.status).toBe('documentation');
    });

    it('should accept complete as Mission status', () => {
      const mission: Mission = {
        name: 'Done Mission',
        status: 'complete',
      };
      expect(mission.status).toBe('complete');
    });
  });
});
