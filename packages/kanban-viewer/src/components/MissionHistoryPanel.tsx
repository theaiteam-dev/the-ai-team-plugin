"use client";

import * as React from "react";
import { useState, useEffect } from "react";

interface ApiMission {
  id: string;
  name: string;
  state: string;
  prdPath: string;
  startedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  precheckBlockers?: string[] | null;
  precheckOutput?: Record<string, unknown> | null;
}

interface MissionHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

function formatPrecheckOutput(output: Record<string, unknown>): string {
  const sections: string[] = [];
  for (const [checkName, result] of Object.entries(output)) {
    if (result && typeof result === "object") {
      const r = result as { stdout?: string; stderr?: string };
      const parts = [r.stdout, r.stderr].filter(Boolean);
      sections.push(`[${checkName}]\n${parts.join("\n")}`);
    }
  }
  return sections.join("\n\n").trim() || "(no output captured)";
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatDuration(startedAt: string, completedAt: string | null): string | null {
  if (!completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  const ms = end - start;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const STATE_BADGE_CLASSES: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  precheck_failure: "bg-amber-100 text-amber-800",
  archived: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-800",
  initializing: "bg-gray-100 text-gray-600",
  prechecking: "bg-blue-50 text-blue-600",
  postchecking: "bg-blue-50 text-blue-600",
};

function StateBadge({ missionId, state }: { missionId: string; state: string }) {
  const cls = STATE_BADGE_CLASSES[state] ?? "bg-gray-100 text-gray-600";
  return (
    <span
      data-testid={`state-badge-${missionId}`}
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}
    >
      {state}
    </span>
  );
}

interface DetailPaneProps {
  mission: ApiMission;
}

function DetailPane({ mission }: DetailPaneProps) {
  const blockers = mission.precheckBlockers ?? [];
  const duration = formatDuration(mission.startedAt, mission.completedAt);

  return (
    <div data-testid="mission-detail-pane" className="p-4 space-y-3 text-sm">
      <div>
        <span className="font-semibold text-lg">{mission.name}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">State:</span>
        <span data-testid="detail-state-badge">
          <StateBadge missionId={mission.id} state={mission.state} />
        </span>
      </div>

      <div>
        <span className="text-muted-foreground text-xs block">PRD Path</span>
        <span className="font-mono text-xs break-all">{mission.prdPath}</span>
      </div>

      <div>
        <span className="text-muted-foreground text-xs block">Started</span>
        <span>{formatDate(mission.startedAt)}</span>
      </div>

      {mission.completedAt && (
        <div>
          <span className="text-muted-foreground text-xs block">Completed</span>
          <span>{formatDate(mission.completedAt)}</span>
        </div>
      )}

      {mission.archivedAt && (
        <div>
          <span className="text-muted-foreground text-xs block">Archived</span>
          <span>{formatDate(mission.archivedAt)}</span>
        </div>
      )}

      {duration !== null && (
        <div data-testid="detail-duration">
          <span className="text-muted-foreground text-xs block">Duration</span>
          <span>{duration}</span>
        </div>
      )}

      {mission.state === "precheck_failure" && blockers.length > 0 && (
        <div>
          <span className="text-muted-foreground text-xs block mb-1">Precheck Blockers</span>
          <ul className="space-y-1">
            {blockers.map((b, i) => (
              <li key={i} className="text-amber-800 text-xs">
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mission.state === "precheck_failure" && mission.precheckOutput && (
        <div>
          <span className="text-muted-foreground text-xs block mb-1">Precheck Output</span>
          <pre
            data-testid="detail-precheck-output"
            className="text-xs text-amber-800 whitespace-pre-wrap break-all bg-amber-50 rounded p-2 overflow-x-auto"
          >
            {formatPrecheckOutput(mission.precheckOutput)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function MissionHistoryPanel({ isOpen, onClose, projectId }: MissionHistoryPanelProps) {
  const [missions, setMissions] = useState<ApiMission[]>([]);
  const [selected, setSelected] = useState<ApiMission | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();

    async function loadMissions() {
      if (!controller.signal.aborted) setMissions([]);
      if (!controller.signal.aborted) setLoading(true);
      if (!controller.signal.aborted) setSelected(null);
      try {
        const r = await fetch("/api/missions", {
          headers: { "X-Project-ID": projectId },
          signal: controller.signal,
        });
        const data = await r.json();
        if (data.success && Array.isArray(data.data)) {
          // Sort by startedAt descending (newest first)
          const sorted = [...data.data].sort(
            (a: ApiMission, b: ApiMission) =>
              new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
          );
          if (!controller.signal.aborted) setMissions(sorted);
        }
      } catch {
        if (!controller.signal.aborted) setMissions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadMissions();

    return () => controller.abort();
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="mission-history-panel"
      className="fixed inset-y-0 right-0 z-50 flex w-[700px] max-w-full bg-background border-l border-border shadow-xl"
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card z-10">
        <span className="font-semibold text-sm">Mission History</span>
        <button
          data-testid="history-panel-close"
          onClick={onClose}
          aria-label="Close mission history"
          className="text-muted-foreground hover:text-foreground text-lg leading-none"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex w-full pt-12 overflow-hidden">
        {/* Left rail: mission list */}
        <div className="w-56 border-r border-border overflow-y-auto shrink-0">
          {loading && (
            <div className="p-4 text-xs text-muted-foreground">Loading...</div>
          )}
          {!loading && missions.length === 0 && (
            <div
              data-testid="mission-history-empty"
              className="p-4 text-xs text-muted-foreground"
            >
              No missions found.
            </div>
          )}
          {missions.map((m) => (
            <button
              key={m.id}
              data-testid="mission-history-row"
              onClick={() => setSelected(m)}
              className={`w-full text-left px-3 py-3 border-b border-border text-xs hover:bg-muted/50 transition-colors ${
                selected?.id === m.id ? "bg-muted" : ""
              }`}
            >
              <div className="font-medium truncate mb-1">{m.name}</div>
              <StateBadge missionId={m.id} state={m.state} />
            </button>
          ))}
        </div>

        {/* Right: detail pane */}
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <DetailPane mission={selected} />
          ) : (
            <div className="p-6 text-xs text-muted-foreground">
              Select a mission to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
