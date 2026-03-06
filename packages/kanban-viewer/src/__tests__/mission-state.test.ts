import { describe, it, expect } from 'vitest';
import type { MissionState, Mission, MissionPrecheckOutput } from '@/types/mission';

describe('MissionState type includes precheck_failure', () => {
  it('should accept precheck_failure as a valid MissionState', () => {
    const state: MissionState = 'precheck_failure';
    expect(state).toBe('precheck_failure');
  });

  it('should accept all original states alongside precheck_failure', () => {
    const states: MissionState[] = [
      'initializing',
      'prechecking',
      'precheck_failure',
      'running',
      'postchecking',
      'completed',
      'failed',
      'archived',
    ];
    expect(states).toContain('precheck_failure');
    expect(states.length).toBeGreaterThanOrEqual(8);
  });
});

describe('Mission interface has precheckBlockers and precheckOutput fields', () => {
  it('should accept a mission with precheckBlockers as string array', () => {
    const mission: Mission = {
      id: 'M-001',
      name: 'Test Mission',
      state: 'precheck_failure',
      prdPath: '/prd/test.md',
      startedAt: new Date(),
      completedAt: null,
      archivedAt: null,
      precheckBlockers: ['lint errors in src/foo.ts', 'test suite failing'],
      precheckOutput: null,
    };
    expect(mission.precheckBlockers).toHaveLength(2);
    expect(mission.precheckBlockers![0]).toBe('lint errors in src/foo.ts');
  });

  it('should accept a mission with precheckBlockers null and precheckOutput null', () => {
    const mission: Mission = {
      id: 'M-002',
      name: 'Clean Mission',
      state: 'running',
      prdPath: '/prd/clean.md',
      startedAt: new Date(),
      completedAt: null,
      archivedAt: null,
      precheckBlockers: null,
      precheckOutput: null,
    };
    expect(mission.precheckBlockers).toBeNull();
    expect(mission.precheckOutput).toBeNull();
  });
});

describe('MissionPrecheckOutput type structure', () => {
  it('should accept lint and tests output fields', () => {
    const output: MissionPrecheckOutput = {
      lint: { stdout: 'error: bad code', stderr: '', timedOut: false },
      tests: { stdout: '', stderr: 'FAIL src/__tests__/foo.test.ts', timedOut: false },
    };
    expect(output.lint?.stdout).toBe('error: bad code');
    expect(output.tests?.timedOut).toBe(false);
  });

  it('should accept partial output with only lint or only tests', () => {
    const lintOnly: MissionPrecheckOutput = {
      lint: { stdout: '3 errors', stderr: '', timedOut: false },
    };
    const timedOut: MissionPrecheckOutput = {
      tests: { stdout: '', stderr: '', timedOut: true },
    };
    expect(lintOnly.lint?.stdout).toBe('3 errors');
    expect(lintOnly.tests).toBeUndefined();
    expect(timedOut.tests?.timedOut).toBe(true);
  });

  it('should allow precheckOutput on a mission with the full type', () => {
    const output: MissionPrecheckOutput = {
      lint: { stdout: 'lint failed', stderr: '', timedOut: false },
    };
    const mission: Mission = {
      id: 'M-003',
      name: 'Failed Precheck Mission',
      state: 'precheck_failure',
      prdPath: '/prd/broken.md',
      startedAt: new Date(),
      completedAt: null,
      archivedAt: null,
      precheckBlockers: ['lint errors'],
      precheckOutput: output,
    };
    expect(mission.precheckOutput?.lint?.stdout).toBe('lint failed');
    expect(mission.state).toBe('precheck_failure');
  });
});
