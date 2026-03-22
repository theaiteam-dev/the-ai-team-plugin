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
] as const;

export type AgentId = (typeof VALID_AGENTS)[number];

export const AGENT_DISPLAY_NAMES: Record<AgentId, string> = {
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

export function normalizeAgentName(raw: string): string {
  return raw.toLowerCase().replace(/\./g, '');
}

export function isValidAgent(name: string): name is AgentId {
  return VALID_AGENTS.includes(normalizeAgentName(name) as AgentId);
}
