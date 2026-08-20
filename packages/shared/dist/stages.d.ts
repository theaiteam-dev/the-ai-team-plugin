export declare const ALL_STAGES: readonly ["briefings", "ready", "testing", "implementing", "review", "probing", "staged", "done", "blocked"];
export type StageId = (typeof ALL_STAGES)[number];
export declare const TRANSITION_MATRIX: Record<StageId, readonly StageId[]>;
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
export declare function isValidTransition(from: StageId, to: StageId): boolean;
/**
 * Lists the stages an item may move to from `from`.
 *
 * Hardened the same way as isValidTransition() above and for the same reason:
 * `from` is unvalidated DB data (Item.stageId is a plain String column), so an
 * unknown or legacy stage id would otherwise hand callers `undefined` and blow
 * up on the first `.includes`/`.map`. An unrecognized origin stage has no legal
 * transitions, so it answers with an empty list.
 */
export declare function getValidNextStages(from: StageId): readonly StageId[];
/**
 * Answers "is a dependency in this stage satisfied?" — true for 'staged'
 * and 'done', false for every other stage. Use this everywhere dependency
 * completion is checked instead of comparing against 'done' directly, so
 * every call site stays in lockstep (see WI-788).
 */
export declare function isDependencySatisfied(stageId: StageId): boolean;
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
export declare const PIPELINE_STAGES: Partial<Record<StageId, PipelineStageInfo>>;
