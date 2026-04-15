"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Activity, Check, Clock, Target, History } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ProjectSelector } from "./project-selector";
import { MissionHistoryPanel } from "./MissionHistoryPanel";
import { ScalingRationaleModal } from "./scaling-rationale-modal";
import { cn } from "@/lib/utils";
import type { Mission } from "@/types";
import type { Project } from "@/types/api";

export interface HeaderBarProps {
  mission: Mission;
  stats: {
    total_items: number;
    completed: number;
    in_progress: number;
    blocked: number;
  };
  wipCurrent: number;
  wipLimit: number;
  projects: Project[];
  selectedProjectId: string;
  onProjectChange: (projectId: string) => void;
  projectsLoading?: boolean;
  projectsError?: string | null;
}

function formatElapsedTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function calculateElapsedSeconds(startedAt: string | undefined, endedAt?: string): number {
  if (!startedAt) {
    return 0;
  }
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) {
    return 0;
  }
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (isNaN(end)) {
    return 0;
  }
  return Math.floor((end - start) / 1000);
}

function isMissionComplete(mission: Mission | null | undefined): boolean {
  if (!mission) {
    return false;
  }
  return mission.status === 'completed' || !!mission.completed_at;
}

function getMissionStartTime(mission: Mission | null | undefined): string | undefined {
  if (!mission) {
    return undefined;
  }
  return mission.started_at || mission.created_at;
}

const statusConfig = {
  active: {
    color: "bg-green-500",
    label: "MISSION ACTIVE",
  },
  paused: {
    color: "bg-yellow-500",
    label: "MISSION PAUSED",
  },
  completed: {
    color: "bg-red-500",
    label: "MISSION COMPLETED",
  },
  planning: {
    color: "bg-blue-500",
    label: "MISSION PLANNING",
  },
  final_review: {
    color: "bg-purple-500",
    label: "FINAL REVIEW",
  },
  post_checks: {
    color: "bg-yellow-500",
    label: "POST-CHECKS",
  },
  documentation: {
    color: "bg-teal-500",
    label: "DOCUMENTATION",
  },
  complete: {
    color: "bg-green-500",
    label: "MISSION COMPLETE",
  },
};

function getInitialElapsedTime(mission: Mission | null | undefined): number {
  if (!mission) {
    return 0;
  }
  // If mission is complete, use duration_ms or calculate frozen time
  if (mission.completed_at) {
    if (mission.duration_ms !== undefined) {
      return Math.floor(mission.duration_ms / 1000);
    }
    return calculateElapsedSeconds(getMissionStartTime(mission), mission.completed_at);
  }
  // For active/other missions, calculate from start to now
  return calculateElapsedSeconds(getMissionStartTime(mission));
}

export function HeaderBar({
  mission,
  stats,
  wipCurrent,
  wipLimit,
  projects,
  selectedProjectId,
  onProjectChange,
  projectsLoading,
  projectsError,
}: HeaderBarProps) {
  const [elapsedTime, setElapsedTime] = useState(() =>
    getInitialElapsedTime(mission)
  );
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    // If mission has completed_at, use duration_ms or calculate frozen time
    if (mission.completed_at) {
      const finalTime = mission.duration_ms !== undefined
        ? Math.floor(mission.duration_ms / 1000)
        : calculateElapsedSeconds(getMissionStartTime(mission), mission.completed_at);
      setElapsedTime(finalTime);
      return; // Don't start interval
    }

    // Only run timer when mission is active
    if (mission.status !== "active") {
      return;
    }

    // Set initial time based on start time
    setElapsedTime(calculateElapsedSeconds(getMissionStartTime(mission)));

    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.status, mission.completed_at, mission.duration_ms, mission.started_at, mission.created_at]);

  // Reset elapsed time when mission changes (handle rerenders with different mission data)
  useEffect(() => {
    setElapsedTime(getInitialElapsedTime(mission));
  }, [mission]);

  const progressPercentage =
    stats.total_items > 0
      ? Math.round((stats.completed / stats.total_items) * 100)
      : 0;

  const config = statusConfig[mission.status] ?? statusConfig.active;

  return (
    <header className="flex items-center gap-4 px-4 py-2 bg-card border-b border-border">
      {/* Project selector */}
      {projectsError ? (
        <div
          data-testid="project-selector-error"
          className="w-[180px] border-r border-gray-700 hidden lg:flex items-center pr-4"
        >
          <span className="text-xs text-destructive truncate" title={projectsError}>
            {projectsError}
          </span>
        </div>
      ) : projects && projects.length > 0 ? (
        <div
          data-testid="project-selector-container"
          className="w-[180px] min-w-0 border-r border-gray-700 hidden lg:flex items-center pr-4 overflow-hidden"
        >
          <ProjectSelector
            projects={projects}
            selectedProjectId={selectedProjectId}
            onProjectChange={onProjectChange}
            isLoading={projectsLoading}
          />
        </div>
      ) : null}

      {/* Status indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          data-testid="status-indicator"
          className={cn("w-3 h-3 rounded-full", config.color)}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:inline">
          {config.label}
        </span>
      </div>

      {/* Mission name */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Activity className="w-4 h-4 text-primary shrink-0" />
        <span className="font-semibold text-foreground truncate">
          {mission.name}
        </span>
      </div>

      {/* WIP indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <Target className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">WIP:</span>
        <span className="font-mono font-semibold text-foreground">
          {wipCurrent}/{wipLimit}
        </span>
      </div>

      {/* Progress bar with stats */}
      <div className="flex items-center gap-2 w-32 shrink-0 hidden md:flex">
        <Progress
          value={progressPercentage}
          isComplete={stats.total_items > 0 && stats.completed >= stats.total_items}
          className="w-20"
          aria-valuenow={progressPercentage}
          aria-valuemin={0}
          aria-valuemax={100}
        />
        <span className="font-mono text-sm text-foreground">
          {stats.completed}/{stats.total_items}
        </span>
      </div>

      {/* Timer */}
      <div className="flex items-center gap-2 shrink-0">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <span
          data-testid="timer-display"
          className={cn(
            "font-mono text-sm",
            isMissionComplete(mission) ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {formatElapsedTime(elapsedTime)}
        </span>
        {isMissionComplete(mission) && (
          <Check
            data-testid="timer-complete-icon"
            className="w-4 h-4 text-muted-foreground"
          />
        )}
      </div>

      {/* Scaling rationale */}
      <ScalingRationaleModal scalingRationale={mission.scalingRationale} />

      {/* History button */}
      <button
        data-testid="history-button"
        aria-label="View mission history"
        onClick={() => setHistoryOpen(true)}
        className="shrink-0 p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
      >
        <History className="w-4 h-4" />
      </button>

      {/* Mission history panel */}
      <MissionHistoryPanel
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        projectId={selectedProjectId}
      />
    </header>
  );
}
