export const ALL_STAGES = [
  'briefings',
  'ready',
  'testing',
  'implementing',
  'review',
  'probing',
  'staged',
  'done',
  'blocked',
] as const;

export type StageId = (typeof ALL_STAGES)[number];

export const TRANSITION_MATRIX: Record<StageId, readonly StageId[]> = {
  briefings: ['ready', 'blocked'],
  ready: ['testing', 'implementing', 'probing', 'blocked', 'briefings'],
  testing: ['implementing', 'blocked'],
  implementing: ['review', 'blocked'],
  probing: ['ready', 'staged', 'blocked'],
  review: ['testing', 'implementing', 'probing', 'blocked'],
  staged: ['done', 'testing', 'implementing', 'ready', 'blocked'],
  done: [],
  blocked: ['ready'],
};

/**
 * Answers "may an item move from `from` to `to`?".
 *
 * `from` is typed as StageId but in practice arrives as unvalidated DB data
 * (Item.stageId is a plain String column, not an enum), so an unknown or
 * legacy stage id would index the matrix to `undefined` and throw a
 * TypeError — surfacing as a 500 from POST /api/board/move instead of a
 * clean "invalid transition" 400. An unrecognized origin stage has no legal
 * transitions, so it answers false.
 */
export function isValidTransition(from: StageId, to: StageId): boolean {
  return TRANSITION_MATRIX[from]?.includes(to) ?? false;
}

export function getValidNextStages(from: StageId): readonly StageId[] {
  return TRANSITION_MATRIX[from];
}

/**
 * Terminal stages that satisfy a dependency: a dependent item is unblocked
 * once every dependency reaches one of these stages.
 *
 * 'staged' counts alongside 'done' because the per-item pipeline now ends
 * at 'staged' — nothing reaches 'done' until Frankie's mission-tail walk
 * promotes it, so gating dependency waves on 'done' alone would deadlock
 * every multi-wave mission. See adr/0005-done-is-terminal-no-in-mission-rework.md.
 */
const DEPENDENCY_SATISFYING_STAGES: readonly StageId[] = ['staged', 'done'];

/**
 * Answers "is a dependency in this stage satisfied?" — true for 'staged'
 * and 'done', false for every other stage. Use this everywhere dependency
 * completion is checked instead of comparing against 'done' directly, so
 * every call site stays in lockstep (see WI-788).
 */
export function isDependencySatisfied(stageId: StageId): boolean {
  return DEPENDENCY_SATISFYING_STAGES.includes(stageId);
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
    nextStage: 'staged',
    description: 'investigates for bugs beyond test coverage',
  },
};
