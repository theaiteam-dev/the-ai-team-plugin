import { Card } from '@/components/ui/card';
import type { WorkItem, WorkItemFrontmatterType, Stage, CardAnimationState, CardAnimationDirection, AgentName } from '@/types';
import { AlertTriangle, Link, Link2, User, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export interface WorkItemCardProps {
  item: WorkItem;
  blockerCount?: number;
  onClick?: () => void;
  agentStatus?: 'active' | 'blocked';
  animationState?: CardAnimationState;
  animationDirection?: CardAnimationDirection;
  onAnimationEnd?: () => void;
  showDependencyTooltip?: boolean;
  defaultTooltipOpen?: boolean;
}

const TYPE_BADGE_STYLES: Record<WorkItemFrontmatterType, string> = {
  feature: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50',
  bug: 'bg-red-500/20 text-red-400 border border-red-500/50',
  enhancement: 'bg-blue-500/20 text-blue-400 border border-blue-500/50',
  task: 'bg-green-500/20 text-green-400 border border-green-500/50',
};

const STATUS_DOT_COLORS = {
  active: 'bg-green-500',
  blocked: 'bg-red-500',
} as const;

const AGENT_TEXT_COLORS: Record<AgentName, string> = {
  'Hannibal': 'text-green-500',
  'Face': 'text-cyan-500',
  'Murdock': 'text-amber-500',
  'B.A.': 'text-red-500',
  'Amy': 'text-pink-500',
  'Lynch': 'text-blue-500',
  'Tawnia': 'text-teal-500',
  'Stockwell': 'text-gray-400',
};

const ACTIVE_STAGES: Stage[] = ['testing', 'implementing', 'review', 'probing'];

function formatId(id: string): string {
  return id.padStart(3, '0');
}

function getAnimationClasses(
  state: CardAnimationState | undefined,
  direction: CardAnimationDirection | undefined
): string {
  if (!state || state === 'idle') {
    return 'card-idle';
  }

  const baseClass = state === 'entering' ? 'card-entering' : 'card-exiting';
  const directionClass =
    direction === 'left'
      ? `${baseClass}-left`
      : direction === 'right'
        ? `${baseClass}-right`
        : '';

  return cn(baseClass, directionClass);
}

export function WorkItemCard({
  item,
  blockerCount,
  onClick,
  agentStatus,
  animationState,
  animationDirection,
  onAnimationEnd,
  defaultTooltipOpen,
}: WorkItemCardProps) {
  const showBlocker = blockerCount !== undefined && blockerCount > 0;
  const showRejection = item.rejection_count > 0;
  const showAgent = item.assigned_agent !== undefined && ACTIVE_STAGES.includes(item.stage);
  const showDependencies = item.dependencies && item.dependencies.length > 0 && blockerCount === undefined;
  const dotColor = STATUS_DOT_COLORS[agentStatus ?? 'active'];

  const animationClasses = getAnimationClasses(animationState, animationDirection);

  return (
    <Card
      data-testid="work-item-card"
      onClick={onClick}
      onAnimationEnd={onAnimationEnd}
      className={cn(
        'p-4 gap-2 hover:bg-accent transition-colors rounded-md min-h-[140px] flex flex-col justify-between',
        onClick && 'cursor-pointer',
        animationClasses
      )}
    >
      {/* Header row: ID and rejection warning */}
      <div className="flex justify-between items-start">
        <span className="text-xs text-muted-foreground font-mono">
          {formatId(item.id)}
        </span>
        {showRejection && (
          <div
            data-testid="rejection-indicator"
            className="flex items-center gap-1 bg-amber-500 px-2 py-1 rounded"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-white">{item.rejection_count}</span>
          </div>
        )}
      </div>

      {/* Title */}
      <div className="font-medium text-sm leading-tight">
        {item.title}
      </div>

      {/* Type badge */}
      <div>
        <span
          className={`
            inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
            ${TYPE_BADGE_STYLES[item.type]}
          `}
        >
          {item.type}
        </span>
      </div>

      {/* Footer row: Agent (left) and Dependency/Blocker (right) */}
      <div data-testid="card-footer" className="flex justify-between items-center mt-1">
        {showAgent ? (
          <div
            data-testid="agent-indicator"
            className="flex items-center gap-1.5"
          >
            <span
              data-status-dot
              className={`w-2 h-2 rounded-full ${dotColor}`}
            />
            <User
              data-testid="agent-icon"
              className="h-3 w-3 text-muted-foreground"
            />
            <span
              data-testid="agent-name"
              className={cn('text-xs', AGENT_TEXT_COLORS[item.assigned_agent!])}
            >
              {item.assigned_agent}
            </span>
          </div>
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2">
          {showDependencies && (
            <Tooltip defaultOpen={defaultTooltipOpen}>
              <TooltipTrigger asChild>
                <div
                  data-testid="dependency-indicator"
                  className="flex items-center gap-1 text-muted-foreground cursor-default"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span className="text-xs">{item.dependencies!.length}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <span>Depends on: {item.dependencies!.map(formatId).join(', ')}</span>
              </TooltipContent>
            </Tooltip>
          )}

          {showBlocker && (
            <div
              data-testid="blocker-indicator"
              className="flex items-center gap-1 text-muted-foreground"
            >
              <Link className="h-3 w-3" />
              <span className="text-xs">{blockerCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Work logs indicator */}
      {item.work_logs && item.work_logs.length > 0 && (
        <div data-testid="work-logs-section" className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
          <FileText className="h-3 w-3" />
          <span>{item.work_logs.length} work {item.work_logs.length === 1 ? 'summary' : 'summaries'}</span>
        </div>
      )}
    </Card>
  );
}
