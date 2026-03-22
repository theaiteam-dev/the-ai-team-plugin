"use client";

import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkItem, AgentName } from "@/types";
import type { WorkLogEntry } from "@/types/item";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  FileCode,
  FileText,
  MessageSquare,
  PlayCircle,
  TestTube,
  X,
  XCircle,
} from "lucide-react";

export interface ItemDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: WorkItem | null;
}

function formatId(id: string): string {
  return id.padStart(3, "0");
}

function formatDate(dateString: string): string {
  return dateString.split("T")[0];
}

function formatWorkLogTimestamp(timestamp: Date | string): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

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

const AGENT_BULLET_COLORS: Record<AgentName, string> = {
  'Hannibal': 'bg-green-500',
  'Face': 'bg-cyan-500',
  'Murdock': 'bg-amber-500',
  'B.A.': 'bg-red-500',
  'Amy': 'bg-pink-500',
  'Lynch': 'bg-blue-500',
  'Tawnia': 'bg-teal-500',
  'Stockwell': 'bg-gray-700',
};

interface WorkLogActionConfig {
  icon: React.ElementType;
  colorClass: string;
  label: string;
}

const WORK_LOG_ACTION_CONFIG: Record<string, WorkLogActionConfig> = {
  started: {
    icon: PlayCircle,
    colorClass: "text-blue-400",
    label: "Started",
  },
  completed: {
    icon: CheckCircle,
    colorClass: "text-green-400",
    label: "Completed",
  },
  rejected: {
    icon: XCircle,
    colorClass: "text-red-400",
    label: "Rejected",
  },
  note: {
    icon: MessageSquare,
    colorClass: "text-gray-400",
    label: "Note",
  },
};

function getWorkLogActionConfig(action: string): WorkLogActionConfig {
  return WORK_LOG_ACTION_CONFIG[action] ?? {
    icon: Clock,
    colorClass: "text-gray-400",
    label: action,
  };
}

interface WorkHistorySectionProps {
  workLogs: WorkLogEntry[];
}

function WorkHistorySection({ workLogs }: WorkHistorySectionProps) {
  // Sort by timestamp, oldest first (chronological order for a history log)
  const sortedLogs = [...workLogs].sort((a, b) => {
    const dateA = typeof a.timestamp === "string" ? new Date(a.timestamp) : a.timestamp;
    const dateB = typeof b.timestamp === "string" ? new Date(b.timestamp) : b.timestamp;
    return dateA.getTime() - dateB.getTime();
  });

  return (
    <div className="border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-white mb-3">Work History</h3>
      <div className="space-y-3">
        {sortedLogs.map((log) => {
          const config = getWorkLogActionConfig(log.action);
          const Icon = config.icon;

          const agentColor = AGENT_TEXT_COLORS[log.agent as AgentName] || 'text-white';
          const bulletColor = AGENT_BULLET_COLORS[log.agent as AgentName] || 'bg-gray-500';

          return (
            <div
              key={log.id}
              className="flex items-start gap-3 text-sm"
            >
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${bulletColor}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-medium ${agentColor}`}>{log.agent}</span>
                  <span className={`text-xs font-medium ${config.colorClass}`}>
                    {config.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatWorkLogTimestamp(log.timestamp)}
                  </span>
                </div>
                {log.summary && (
                  <p className="text-muted-foreground mt-1 break-words">
                    {log.summary}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Simple markdown renderer for basic formatting.
 * Supports: headings, paragraphs, code blocks, lists.
 */
function renderMarkdown(content: string): React.ReactNode[] {
  if (!content) return [];

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let listItems: string[] = [];
  let keyCounter = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={keyCounter++} className="list-disc list-inside space-y-1 mb-4">
          {listItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block handling
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={keyCounter++}
            className="bg-muted p-3 rounded-md overflow-x-auto mb-4 text-sm"
          >
            <code>{codeBlockContent.join("\n")}</code>
          </pre>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // List item
    if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(line.slice(2));
      continue;
    }

    // Flush any pending list before other elements
    flushList();

    // Heading
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={keyCounter++} className="text-xl font-bold mb-3">
          {line.slice(2)}
        </h1>
      );
      continue;
    }

    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={keyCounter++} className="text-lg font-semibold mb-2">
          {line.slice(3)}
        </h2>
      );
      continue;
    }

    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={keyCounter++} className="text-base font-semibold mb-2">
          {line.slice(4)}
        </h3>
      );
      continue;
    }

    // Empty line - skip
    if (line.trim() === "") {
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={keyCounter++} className="mb-3">
        {line}
      </p>
    );
  }

  // Flush any remaining list
  flushList();

  return elements;
}

const TYPE_COLORS: Record<string, string> = {
  feature: "bg-cyan-500",
  bug: "bg-red-500",
  enhancement: "bg-blue-500",
  task: "bg-green-500",
};

export function ItemDetailModal({
  isOpen,
  onClose,
  item,
}: ItemDetailModalProps) {
  if (!item) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          data-testid="item-detail-modal"
          showCloseButton={false}
          className="bg-gray-800 border border-gray-700 rounded-xl max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        >
          <DialogClose
            className="absolute top-4 right-4 text-gray-500 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </DialogClose>
          <DialogHeader>
            <DialogTitle>No item selected</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const hasOutputs =
    item.outputs && (item.outputs.impl || item.outputs.test || item.outputs.types);
  const hasDependencies = item.dependencies && item.dependencies.length > 0;
  const hasWorkLogs = item.work_logs && item.work_logs.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="item-detail-modal"
        showCloseButton={false}
        className="bg-gray-800 border border-gray-700 rounded-xl max-w-lg p-6 max-h-[90vh] overflow-y-auto"
      >
        <DialogClose
          className="absolute top-4 right-4 text-gray-500 hover:text-white"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </DialogClose>
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-mono text-muted-foreground">
                  {formatId(item.id)}
                </span>
                {item.rejection_count > 0 && (
                  <div className="flex items-center gap-1 text-amber-500">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      {item.rejection_count}
                    </span>
                  </div>
                )}
              </div>
              <DialogTitle className="text-xl">{item.title}</DialogTitle>
            </div>
          </div>

          {/* Type badge and agent */}
          <div className="flex items-center gap-3 mt-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white ${TYPE_COLORS[item.type] || "bg-gray-500"}`}
            >
              {item.type}
            </span>
            {item.assigned_agent && (
              <span className="text-sm text-muted-foreground">
                Assigned to {item.assigned_agent}
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Metadata section */}
        <div className="border-t border-border pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Status:</span>
            <span className="font-medium">{item.status}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Created:</span>
            <span className="font-mono">{formatDate(item.created_at)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Updated:</span>
            <span className="font-mono">{formatDate(item.updated_at)}</span>
          </div>
        </div>

        {/* Dependencies section */}
        {hasDependencies && (
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-white mb-2">
              Dependencies
            </h3>
            <div className="flex flex-wrap gap-2">
              {item.dependencies.map((dep) => (
                <span
                  key={dep}
                  className="px-2 py-1 bg-muted rounded text-sm font-mono"
                >
                  {dep}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Outputs section */}
        {hasOutputs && (
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-white mb-2">
              Outputs
            </h3>
            <div className="space-y-2">
              {item.outputs.impl && (
                <div className="flex items-start gap-2 text-sm min-w-0">
                  <FileCode className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-muted-foreground shrink-0">impl:</span>
                  <span className="font-mono break-all">{item.outputs.impl}</span>
                </div>
              )}
              {item.outputs.test && (
                <div className="flex items-start gap-2 text-sm min-w-0">
                  <TestTube className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-muted-foreground shrink-0">test:</span>
                  <span className="font-mono break-all">{item.outputs.test}</span>
                </div>
              )}
              {item.outputs.types && (
                <div className="flex items-start gap-2 text-sm min-w-0">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-muted-foreground shrink-0">types:</span>
                  <span className="font-mono break-all">{item.outputs.types}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Work History section */}
        {hasWorkLogs && <WorkHistorySection workLogs={item.work_logs!} />}

        {/* Content section */}
        {item.content && (
          <div className="border-t border-border pt-4 min-w-0">
            <div className="prose prose-sm dark:prose-invert max-w-none break-words overflow-hidden">
              {renderMarkdown(item.content)}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
