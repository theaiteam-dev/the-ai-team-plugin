"use client";

import * as React from "react";
import { useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { HookEventSummary } from "@/types/hook-event";

export interface RawAgentViewProps {
  events: HookEventSummary[];
}

// Agent display name mapping
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  hannibal: "Hannibal",
  face: "Face",
  murdock: "Murdock",
  ba: "B.A.",
  amy: "Amy",
  lynch: "Lynch",
  tawnia: "Tawnia",
};

// Canonical agent order for swim lanes
const AGENT_ORDER = ["hannibal", "face", "murdock", "ba", "amy", "lynch", "tawnia"];

// Status color mapping
function getStatusColor(status: string): string {
  switch (status) {
    case "success":
      return "bg-green-500";
    case "failure":
      return "bg-red-500";
    case "pending":
      return "bg-yellow-500";
    case "denied":
      return "bg-orange-500";
    default:
      return "bg-gray-500";
  }
}

// Format timestamp as HH:MM:SS (Amy's fix: null safety for invalid timestamps)
function formatTimestamp(timestamp: Date | null | undefined): string {
  if (!timestamp) return "--:--:--";

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "--:--:--";

  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

// Event card component (Amy's fix: React.memo for performance)
interface EventCardProps {
  event: HookEventSummary;
}

const EventCard = React.memo(({ event }: EventCardProps) => {
  const isDenied = event.status === "denied";

  // Amy's fix: Null safety for tool/event type display
  const toolOrEventType = event.toolName || event.eventType || "(unknown)";

  return (
    <div
      data-testid={`event-card-${event.id}`}
      data-correlation-id={event.correlationId}
      className={cn(
        "rounded-lg border p-3 text-sm max-w-full",
        isDenied
          ? "border-orange-500 border-2 bg-orange-50 dark:bg-orange-950 dark:border-orange-600"
          : "border-border bg-background"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Status indicator */}
        <div
          data-testid={`status-${event.status ?? 'unknown'}-${event.id}`}
          className={cn(
            "mt-1 h-2 w-2 rounded-full flex-shrink-0",
            getStatusColor(event.status)
          )}
        />

        <div className="flex-1 min-w-0 space-y-1">
          {/* First line: timestamp, tool/event type, duration, denial badge */}
          <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
            <span className="font-mono text-xs flex-shrink-0">{formatTimestamp(event.timestamp)}</span>
            <span className="text-xs truncate">
              {toolOrEventType}
            </span>
            {event.durationMs !== undefined && (
              <span className="text-xs flex-shrink-0">{event.durationMs}ms</span>
            )}
            {isDenied && (
              <span
                data-testid={`denial-badge-${event.id}`}
                className="rounded bg-orange-500 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-300 flex-shrink-0"
              >
                DENIED
              </span>
            )}
            {event.correlationId && (
              <span
                data-testid={`correlation-indicator-${event.id}`}
                className="rounded bg-muted px-2 py-0.5 text-xs font-mono flex-shrink-0"
              >
                {event.correlationId.slice(0, 8)}
              </span>
            )}
          </div>

          {/* Second line: summary (Amy's fix: text overflow with line-clamp-2) */}
          <div className="text-foreground line-clamp-2">
            {event.summary || ""}
          </div>
        </div>
      </div>
    </div>
  );
});

EventCard.displayName = "EventCard";

// Swim lane component (Amy's fix: React.memo for performance)
interface SwimLaneProps {
  agentName: string;
  events: HookEventSummary[];
}

const SwimLane = React.memo(({ agentName, events }: SwimLaneProps) => {
  const displayName = AGENT_DISPLAY_NAMES[agentName] || agentName;

  return (
    <div
      data-testid={`swim-lane-${agentName}`}
      className="rounded-lg border bg-card p-4"
    >
      {/* Agent header (Amy's fix: handle long agent names) */}
      <h3 className="mb-3 font-semibold text-foreground truncate">{displayName}</h3>

      {/* Events container */}
      <div data-testid="events-container" className="flex flex-col gap-2">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
});

SwimLane.displayName = "SwimLane";

// Main component
export function RawAgentView({ events }: RawAgentViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Amy's fix: Performance - useMemo for event grouping and sorting
  const { eventsByAgent, sortedAgents } = useMemo(() => {
    // Group events by agent (Amy's fix: null safety for agentName)
    const grouped = events.reduce<Record<string, HookEventSummary[]>>(
      (acc, event) => {
        if (!event.agentName) return acc;
        const agentKey = event.agentName.toLowerCase();
        if (!acc[agentKey]) {
          acc[agentKey] = [];
        }
        acc[agentKey].push(event);
        return acc;
      },
      {}
    );

    // Sort events within each agent by timestamp
    Object.values(grouped).forEach((agentEvents) => {
      agentEvents.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    });

    // Get agents in canonical order, then append any unmatched agents
    const sorted = AGENT_ORDER.filter((agent) => grouped[agent]);
    const unmatched = Object.keys(grouped).filter(
      (agent) => !AGENT_ORDER.includes(agent)
    );
    sorted.push(...unmatched);

    return { eventsByAgent: grouped, sortedAgents: sorted };
  }, [events]);

  // Amy's fix: Auto-scroll with requestAnimationFrame debouncing
  useEffect(() => {
    // Cancel any pending RAF
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    // Schedule scroll update
    rafRef.current = requestAnimationFrame(() => {
      if (containerRef.current) {
        const { scrollHeight, scrollTop, clientHeight } = containerRef.current;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

        if (isNearBottom) {
          containerRef.current.scrollTop = scrollHeight;
        }
      }
      rafRef.current = null;
    });

    // Amy's fix: Clean up RAF on unmount
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [events]);

  // Empty state
  if (events.length === 0) {
    return (
      <div
        ref={containerRef}
        data-testid="raw-agent-view"
        className="flex h-full flex-col gap-4 overflow-y-auto p-4"
      >
        <div
          data-testid="empty-state"
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center"
        >
          <p className="text-lg font-semibold text-muted-foreground">
            No hook events yet
          </p>
          <p className="text-sm text-muted-foreground">
            Hook events will appear here as agents execute tools
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="raw-agent-view"
      className="flex h-full flex-col gap-4 overflow-y-auto p-4"
    >
      {sortedAgents.map((agentName) => (
        <SwimLane
          key={agentName}
          agentName={agentName}
          events={eventsByAgent[agentName]}
        />
      ))}
    </div>
  );
}
