import type { AgentName } from '@/types';

export interface AgentBadgeProps {
  agent?: AgentName;
}

const AGENT_COLORS: Record<AgentName, string> = {
  Hannibal: 'bg-blue-500',
  Face: 'bg-green-500',
  Murdock: 'bg-yellow-500',
  'B.A.': 'bg-orange-500',
  Amy: 'bg-pink-500',
  Lynch: 'bg-purple-500',
  Tawnia: 'bg-teal-500',
  Stockwell: 'bg-gray-700',
};

export function AgentBadge({ agent }: AgentBadgeProps) {
  if (!agent) {
    return null;
  }

  const colorClass = AGENT_COLORS[agent] || 'bg-gray-500';

  return (
    <span
      data-testid="agent-badge"
      className="flex items-center gap-1 text-xs"
    >
      <span
        data-testid="agent-dot"
        className={`w-2 h-2 rounded-full ${colorClass}`}
      />
      {agent}
    </span>
  );
}
