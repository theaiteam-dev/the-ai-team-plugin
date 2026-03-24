import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { WorkItemModalProps, WorkItemFrontmatterType, AgentName } from '@/types';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPE_COLORS: Record<WorkItemFrontmatterType, string> = {
  feature: 'bg-cyan-500',
  bug: 'bg-red-500',
  enhancement: 'bg-blue-500',
  task: 'bg-green-500',
};

const AGENT_ROLES: Record<AgentName, string> = {
  Hannibal: 'Lead',
  Face: 'Design',
  Murdock: 'QA',
  'B.A.': 'Implementation',
  Amy: 'Investigation',
  Lynch: 'Review',
  Stockwell: 'Final Review',
  Tawnia: 'Documentation',
};

function formatId(id: string): string {
  return id.padStart(3, '0');
}

function getProgressText(status: string): string {
  switch (status) {
    case 'done':
      return 'Completed';
    case 'implementing':
      return 'In progress';
    case 'testing':
      return 'Under test';
    case 'review':
      return 'Awaiting review';
    case 'blocked':
      return 'Blocked';
    case 'ready':
      return 'Ready to start';
    case 'briefings':
      return 'Awaiting briefing';
    default:
      return status;
  }
}

interface ChecklistItem {
  checked: boolean;
  text: string;
}

function parseContent(content: string): { objective: string; criteria: ChecklistItem[] } {
  if (!content) {
    return { objective: '', criteria: [] };
  }

  const criteria: ChecklistItem[] = [];
  let objective = '';

  // Extract objective section
  const objectiveMatch = content.match(/##\s*Objective\s*\n\n?([\s\S]*?)(?=##|$)/i);
  if (objectiveMatch) {
    objective = objectiveMatch[1].trim();
  }

  // Extract acceptance criteria checklist items
  const checklistPattern = /- \[([ x])\] (.+)/g;
  let match;
  while ((match = checklistPattern.exec(content)) !== null) {
    criteria.push({
      checked: match[1] === 'x',
      text: match[2].trim(),
    });
  }

  return { objective, criteria };
}

export function WorkItemModal({ item, isOpen, onClose }: WorkItemModalProps) {
  const { objective, criteria } = parseContent(item.content);
  const hasRejections = item.rejection_count > 0;
  const hasRejectionHistory = hasRejections && item.rejection_history && item.rejection_history.length > 0;
  const hasAgent = item.assigned_agent !== undefined;
  const hasCriteria = criteria.length > 0;
  const typeColorClass = TYPE_COLORS[item.type] || 'bg-gray-500';
  // Only show rejection badge when we're not showing the full history table
  const showRejectionBadge = hasRejections && !hasRejectionHistory;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay onClick={onClose} />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          data-testid="work-item-modal"
          className={cn(
            "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] rounded-lg border shadow-lg duration-200 outline-none sm:max-w-2xl max-h-[90vh] overflow-y-auto",
            "p-0 gap-0"
          )}
          onInteractOutside={onClose}
        >
          {/* Header row: ID badge, type tag, status, close button */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
                {formatId(item.id)}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white ${typeColorClass}`}
              >
                {item.type}
              </span>
              <span className="text-sm text-muted-foreground capitalize">
                {item.status}
              </span>
            </div>
            <button
              onClick={onClose}
              className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Title bar: title, agent with status dot, rejection badge */}
          <div className="p-4 border-b border-border">
            <DialogTitle className="text-xl font-semibold mb-2">{item.title}</DialogTitle>
            <div className="flex items-center gap-4">
              {hasAgent && (
                <div className="flex items-center gap-2">
                  <span
                    data-testid="agent-status-dot"
                    className="w-2 h-2 rounded-full bg-green-500"
                  />
                  <span className="text-sm text-muted-foreground">
                    Assigned
                  </span>
                </div>
              )}
              {showRejectionBadge && (
                <div
                  data-testid="rejection-count-badge"
                  className="flex items-center gap-1 text-amber-500"
                >
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">{item.rejection_count}</span>
                </div>
              )}
            </div>
          </div>

          {/* Objective section */}
          <div className="p-4 border-b border-border min-w-0">
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">Objective</h3>
            <p className="text-sm break-words">
              {objective || <span className="text-muted-foreground italic">No description provided</span>}
            </p>
          </div>

          {/* Acceptance Criteria section */}
          {hasCriteria && (
            <div className="p-4 border-b border-border min-w-0">
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">Acceptance Criteria</h3>
              <ul className="space-y-2">
                {criteria.map((criterion, index) => (
                  <li key={index} className="flex items-start gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={criterion.checked}
                      readOnly
                      className="mt-0.5 shrink-0"
                    />
                    <span className={`text-sm break-words ${criterion.checked ? 'text-muted-foreground line-through' : ''}`}>
                      {criterion.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Rejection History section */}
          {hasRejectionHistory && (
            <div className="p-4 border-b border-border min-w-0">
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">Rejection History</h3>
              <table data-testid="rejection-history-table" className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2 pr-2 whitespace-nowrap">#</th>
                    <th className="pb-2 pr-2">Reason</th>
                    <th className="pb-2 whitespace-nowrap">Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {item.rejection_history!.map((entry) => (
                    <tr key={entry.number} data-testid="rejection-history-row">
                      <td className="py-1 pr-2 align-top whitespace-nowrap">{entry.number}</td>
                      <td className="py-1 pr-2 break-words">{entry.reason}</td>
                      <td className="py-1 align-top whitespace-nowrap">{entry.agent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Current Status section */}
          <div data-testid="current-status-section" className="p-4">
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">Current Status</h3>
            <div className="text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Agent: </span>
                {hasAgent ? (
                  <>
                    {item.assigned_agent}
                    {item.assigned_agent && (
                      <span className="text-muted-foreground"> ({AGENT_ROLES[item.assigned_agent]})</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground italic">Unassigned</span>
                )}
              </p>
              <div data-testid="progress-indicator">
                <span className="text-muted-foreground">Progress: </span>
                <span className="capitalize">{getProgressText(item.status)}</span>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
