export const VALID_AGENTS = [
    'murdock',
    'ba',
    'lynch',
    'amy',
    'hannibal',
    'face',
    'sosa',
    'tawnia',
    'stockwell',
];
export const AGENT_DISPLAY_NAMES = {
    murdock: 'Murdock',
    ba: 'B.A.',
    lynch: 'Lynch',
    amy: 'Amy',
    hannibal: 'Hannibal',
    face: 'Face',
    sosa: 'Sosa',
    tawnia: 'Tawnia',
    stockwell: 'Stockwell',
};
export function normalizeAgentName(raw) {
    return raw.toLowerCase().replace(/\./g, '').replace(/-\d+$/, '');
}
export function isValidAgent(name) {
    return VALID_AGENTS.includes(normalizeAgentName(name));
}
