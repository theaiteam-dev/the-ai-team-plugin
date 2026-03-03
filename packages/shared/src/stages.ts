export const ALL_STAGES = [
  'briefings',
  'ready',
  'testing',
  'implementing',
  'review',
  'probing',
  'done',
  'blocked',
] as const;

export type StageId = (typeof ALL_STAGES)[number];

export const TRANSITION_MATRIX: Record<StageId, readonly StageId[]> = {
  briefings: ['ready', 'blocked'],
  ready: ['testing', 'implementing', 'probing', 'blocked', 'briefings'],
  testing: ['implementing', 'blocked'],
  implementing: ['review', 'blocked'],
  probing: ['ready', 'done', 'blocked'],
  review: ['testing', 'implementing', 'probing', 'blocked'],
  done: [],
  blocked: ['ready'],
};

export function isValidTransition(from: StageId, to: StageId): boolean {
  return TRANSITION_MATRIX[from].includes(to);
}

export function getValidNextStages(from: StageId): readonly StageId[] {
  return TRANSITION_MATRIX[from];
}

/**
 * Maps each pipeline stage to the agent responsible for it and the
 * expected next stage in the happy-path pipeline flow.
 *
 * Used by the MCP server to build actionable error messages that tell
 * the orchestrator exactly which agent to dispatch when a transition
 * is rejected.
 */
export interface PipelineStageInfo {
  /** Agent responsible for work in this stage */
  readonly agent: string;
  /** Display name shown in error messages */
  readonly agentDisplay: string;
  /** The expected next stage in the happy-path pipeline */
  readonly nextStage: StageId | null;
  /** Human-readable description of what happens in this stage */
  readonly description: string;
}

export const PIPELINE_STAGES: Partial<Record<StageId, PipelineStageInfo>> = {
  testing: {
    agent: 'murdock',
    agentDisplay: 'Murdock',
    nextStage: 'implementing',
    description: 'writes tests defining acceptance criteria',
  },
  implementing: {
    agent: 'ba',
    agentDisplay: 'B.A.',
    nextStage: 'review',
    description: 'implements code to pass tests',
  },
  review: {
    agent: 'lynch',
    agentDisplay: 'Lynch',
    nextStage: 'probing',
    description: 'reviews tests and implementation together',
  },
  probing: {
    agent: 'amy',
    agentDisplay: 'Amy',
    nextStage: 'done',
    description: 'investigates for bugs beyond test coverage',
  },
};
