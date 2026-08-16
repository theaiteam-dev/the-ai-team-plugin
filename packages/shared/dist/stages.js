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
];
export const TRANSITION_MATRIX = {
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
export function isValidTransition(from, to) {
    return TRANSITION_MATRIX[from].includes(to);
}
export function getValidNextStages(from) {
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
const DEPENDENCY_SATISFYING_STAGES = ['staged', 'done'];
/**
 * Answers "is a dependency in this stage satisfied?" — true for 'staged'
 * and 'done', false for every other stage. Use this everywhere dependency
 * completion is checked instead of comparing against 'done' directly, so
 * every call site stays in lockstep (see WI-788).
 */
export function isDependencySatisfied(stageId) {
    return DEPENDENCY_SATISFYING_STAGES.includes(stageId);
}
export const PIPELINE_STAGES = {
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
