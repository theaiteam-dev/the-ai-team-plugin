export const ALL_STAGES = [
    'briefings',
    'ready',
    'testing',
    'implementing',
    'review',
    'probing',
    'done',
    'blocked',
];
export const TRANSITION_MATRIX = {
    briefings: ['ready', 'blocked'],
    ready: ['testing', 'implementing', 'probing', 'blocked', 'briefings'],
    testing: ['implementing', 'blocked'],
    implementing: ['review', 'blocked'],
    probing: ['ready', 'done', 'blocked'],
    review: ['testing', 'implementing', 'probing', 'blocked'],
    done: [],
    blocked: ['ready'],
};
export function isValidTransition(from, to) {
    return TRANSITION_MATRIX[from].includes(to);
}
export function getValidNextStages(from) {
    return TRANSITION_MATRIX[from];
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
        nextStage: 'done',
        description: 'investigates for bugs beyond test coverage',
    },
};
