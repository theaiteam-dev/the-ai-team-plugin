import type { AgentName, AgentStatus } from '@/types';
import { AGENT_DISPLAY_NAMES } from '@ai-team/shared';

export interface AgentStatusBarProps {
  agents: Partial<Record<AgentName, AgentStatus>>;
}

export const AGENT_NAMES: AgentName[] = [
  'Hannibal',
  'Face',
  'Murdock',
  'B.A.',
  'Amy',
  'Lynch',
  'Tawnia',
];

export const AGENT_INITIALS: Record<AgentName, string> = {
  Hannibal: 'H',
  Face: 'F',
  Murdock: 'M',
  'B.A.': 'B',
  Amy: 'A',
  Lynch: 'L',
  Tawnia: 'T',
};

export const AGENT_COLORS: Record<AgentName, string> = {
  Hannibal: 'bg-green-500',
  Face: 'bg-cyan-500',
  Murdock: 'bg-amber-500',
  'B.A.': 'bg-red-500',
  Amy: 'bg-pink-500',
  Lynch: 'bg-blue-500',
  Tawnia: 'bg-teal-500',
};

const STATUS_DOT_COLORS: Record<AgentStatus, string> = {
  active: 'bg-green-500 animate-pulse',
  watching: 'bg-amber-500',
  idle: 'bg-gray-500',
};

function getStatusText(status: AgentStatus): string {
  return status.toUpperCase();
}

function getDotColor(status: AgentStatus): string {
  return STATUS_DOT_COLORS[status];
}

function getBadgeColor(agentName: AgentName, status: AgentStatus): string {
  if (status === 'idle') {
    return 'bg-gray-500';
  }
  return AGENT_COLORS[agentName];
}

export function AgentStatusBar({ agents }: AgentStatusBarProps) {
  const safeAgents = agents ?? {};

  return (
    <div
      data-testid="agent-status-bar"
      className="fixed bottom-0 left-0 w-full bg-card border-t border-border px-4 py-2"
    >
      <div className="flex items-center">
        {/* AGENTS label - left aligned */}
        <span
          data-testid="agents-label"
          className="text-muted-foreground uppercase tracking-wider text-sm font-medium flex-none"
        >
          AGENTS
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Agents container - right aligned with 80px gaps */}
        <div data-testid="agents-container" className="flex items-center gap-20">
        {AGENT_NAMES.map((agentName) => {
          const status: AgentStatus = safeAgents[agentName] ?? 'idle';
          const initial = AGENT_INITIALS[agentName];
          const dotColor = getDotColor(status);
          const badgeColor = getBadgeColor(agentName, status);

          return (
            <div key={agentName} className="flex items-center gap-2">
              {/* Circle badge with initial */}
              <div
                data-testid={`agent-badge-${agentName}`}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-sm ${badgeColor}`}
              >
                {initial}
              </div>

              {/* Agent name and status */}
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {agentName}
                </span>
                <div className="flex items-center gap-1.5">
                  {/* Status dot */}
                  <div
                    data-testid={`agent-dot-${agentName}`}
                    className={`w-2 h-2 rounded-full ${dotColor}`}
                  />
                  {/* Status text */}
                  <span
                    data-testid={`agent-status-${agentName}`}
                    className="text-xs text-muted-foreground uppercase tracking-wide"
                  >
                    {getStatusText(status)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
