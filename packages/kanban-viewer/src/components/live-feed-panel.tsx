"use client";

import * as React from "react";
import { useRef, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  AgentName,
  LogEntry,
  Mission,
  FinalReviewStatus,
  PostChecksStatus,
  DocumentationStatus,
  CheckResultStatus,
} from "@/types";

export type { LogEntry };

// Types
export type TabId = "live-feed" | "human-input" | "git" | "new-mission" | "completion";

export interface LiveFeedPanelProps {
  entries: LogEntry[];
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  pendingHumanInputCount?: number;
  /** Mission data for completion flow */
  mission?: Mission;
  /** Final review status for completion panel */
  finalReview?: FinalReviewStatus;
  /** Post-checks status for completion panel */
  postChecks?: PostChecksStatus;
  /** Documentation status for completion panel */
  documentation?: DocumentationStatus;
}

// Agent color mapping
export const agentColors: Record<AgentName, string> = {
  Hannibal: "text-green-500",
  Face: "text-cyan-500",
  Murdock: "text-amber-500",
  "B.A.": "text-red-500",
  Amy: "text-pink-500",
  Lynch: "text-blue-500",
  Tawnia: "text-teal-500",
};

// Get message highlight class based on content
function getMessageHighlightClass(message: string): string | undefined {
  if (message.includes("APPROVED")) {
    return "text-green-500";
  }
  if (message.includes("REJECTED")) {
    return "text-red-500";
  }
  if (message.includes("ALERT")) {
    return "text-yellow-500";
  }
  if (message.startsWith("COMMITTED")) {
    return "text-teal-500";
  }
  return undefined;
}

// Check if mission is in a completion phase
function isCompletionPhase(status?: Mission["status"]): boolean {
  if (!status) return false;
  return ["final_review", "post_checks", "documentation", "complete"].includes(status);
}

// Phase status type for completion panel
type PhaseStatus = "pending" | "active" | "complete" | "failed";

// Determine Final Review phase status
function getFinalReviewPhaseStatus(
  mission?: Mission,
  finalReview?: FinalReviewStatus
): PhaseStatus {
  if (!mission || !finalReview) return "pending";
  if (finalReview.completed_at || ["post_checks", "documentation", "complete"].includes(mission.status)) {
    return finalReview.passed ? "complete" : "failed";
  }
  if (finalReview.started_at && mission.status === "final_review") {
    return "active";
  }
  return "pending";
}

// Determine Post-Checks phase status
function getPostChecksPhaseStatus(
  mission?: Mission,
  postChecks?: PostChecksStatus
): PhaseStatus {
  if (!mission || !postChecks) return "pending";
  if (postChecks.completed_at) {
    return postChecks.passed ? "complete" : "failed";
  }
  if (postChecks.started_at && mission.status === "post_checks") {
    return "active";
  }
  return "pending";
}

// Determine Documentation phase status
function getDocumentationPhaseStatus(
  mission?: Mission,
  documentation?: DocumentationStatus
): PhaseStatus {
  if (!mission || !documentation) return "pending";
  if (documentation.completed) {
    return "complete";
  }
  if (documentation.started_at && mission.status === "documentation") {
    return "active";
  }
  return "pending";
}

// Status color mapping for phases
function getPhaseStatusColorClass(status: PhaseStatus): string {
  switch (status) {
    case "complete":
      return "border-green-500 bg-green-500/10";
    case "failed":
      return "border-red-500 bg-red-500/10";
    case "active":
      return "border-yellow-500 bg-yellow-500/10";
    case "pending":
    default:
      return "border-gray-500 bg-gray-500/10";
  }
}

// Status text color class
function getPhaseTextClass(status: PhaseStatus): string {
  switch (status) {
    case "complete":
      return "text-green-500";
    case "failed":
      return "text-red-500";
    case "active":
      return "text-yellow-500";
    case "pending":
    default:
      return "text-gray-500";
  }
}

// Check icon component for post-checks
function CheckIcon({ status }: { status: CheckResultStatus }) {
  switch (status) {
    case "passed":
      return <span data-icon="check" className="text-green-500">&#10003;</span>;
    case "failed":
      return <span data-icon="x" className="text-red-500">&#10007;</span>;
    case "running":
      return <span data-icon="running" className="text-yellow-500 animate-pulse">&#8635;</span>;
    case "pending":
    default:
      return <span data-icon="pending" className="text-gray-400">&#8226;</span>;
  }
}

// Check status color class
function getCheckStatusClass(status: CheckResultStatus): string {
  switch (status) {
    case "passed":
      return "text-green-500";
    case "failed":
      return "text-red-500";
    case "running":
      return "text-yellow-500";
    case "pending":
    default:
      return "text-gray-400";
  }
}

// Format timestamp to HH:MM:SS
function formatCompletionTime(isoString?: string): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

// Format timestamp from ISO to HH:MM:SS
function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function LiveFeedPanel({
  entries,
  activeTab,
  onTabChange,
  pendingHumanInputCount,
  mission,
  finalReview,
  postChecks,
  documentation,
}: LiveFeedPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Completion phase status calculations
  const showCompletionTab = isCompletionPhase(mission?.status);
  const finalReviewStatus = getFinalReviewPhaseStatus(mission, finalReview);
  const postChecksStatus = getPostChecksPhaseStatus(mission, postChecks);
  const documentationStatus = getDocumentationPhaseStatus(mission, documentation);
  const postChecksFailed = postChecks?.completed_at !== undefined && !postChecks.passed;
  const showSummaryCard = mission?.status === "complete";

  // Track scroll position to determine if user is at bottom
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceFromBottom < 50;
  };

  // Auto-scroll to bottom when new entries arrive, only if already at bottom
  useEffect(() => {
    if (scrollRef.current && activeTab === "live-feed" && isAtBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, activeTab]);

  return (
    <div data-testid="live-feed-panel" className="flex flex-col h-full bg-[#1a1a1a] border-l border-[#374151]">
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as TabId)}
        className="flex flex-col h-full"
      >
        <TabsList className="w-full justify-start">
          <TabsTrigger value="live-feed">Live Feed</TabsTrigger>
          <TabsTrigger value="human-input" className="relative">
            Human Input
            {pendingHumanInputCount !== undefined && pendingHumanInputCount > 0 && (
              <span
                data-testid="human-input-badge"
                className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-semibold rounded-full bg-red-500 text-white min-w-[1.25rem]"
              >
                {pendingHumanInputCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="git">Git</TabsTrigger>
          <TabsTrigger value="new-mission">New Mission</TabsTrigger>
          {showCompletionTab && (
            <TabsTrigger value="completion" className="text-green-500">
              Completion
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="live-feed" className="flex-1 overflow-hidden">
          <div className="h-full p-2 flex flex-col">
            <div className="text-xs text-muted-foreground font-mono uppercase mb-2">
              {">_ SYSTEM LOG"}
            </div>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              data-testid="log-entries"
              className="font-mono text-xs space-y-1 scroll-smooth overflow-y-auto h-full"
            >
              {entries.map((entry, index) => {
                const agentColor =
                  agentColors[entry.agent as AgentName] ?? "text-foreground";
                const messageHighlight = getMessageHighlightClass(entry.message);

                return (
                  <div
                    key={`${entry.timestamp}-${index}`}
                    className="flex items-start gap-2"
                  >
                    <span className="text-muted-foreground shrink-0">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                    <span
                      data-testid={`agent-name-${entry.agent}`}
                      className={cn("flex-shrink-0 w-20 font-semibold font-sans text-xs text-left", agentColor)}
                    >
                      [{entry.agent}]
                    </span>
                    <span className={cn("break-words", messageHighlight)}>
                      {entry.message}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="human-input" className="flex-1">
          <div
            data-testid="human-input-placeholder"
            className="flex items-center justify-center h-full text-muted-foreground"
          >
            Human Input panel coming soon
          </div>
        </TabsContent>

        <TabsContent value="git" className="flex-1">
          <div
            data-testid="git-placeholder"
            className="flex items-center justify-center h-full text-muted-foreground"
          >
            Git panel coming soon
          </div>
        </TabsContent>

        <TabsContent value="new-mission" className="flex-1">
          <div
            data-testid="new-mission-placeholder"
            className="flex items-center justify-center h-full text-muted-foreground"
          >
            New Mission panel coming soon
          </div>
        </TabsContent>

        {/* Mission Completion Panel */}
        {showCompletionTab && (
          <TabsContent value="completion" className="flex-1 overflow-auto">
            <div data-testid="mission-completion-panel" className="p-4">
              {/* Three-phase pipeline */}
              <div className="flex flex-col gap-3">
                {/* Final Review Phase */}
                <div
                  data-testid="phase-final-review"
                  data-status={finalReviewStatus}
                  className={cn(
                    "p-3 rounded-lg border-2",
                    getPhaseStatusColorClass(finalReviewStatus)
                  )}
                >
                  <div className="font-semibold mb-2">Final Review</div>
                  {finalReview?.agent && (
                    <div className="text-sm mb-1">
                      <span
                        data-testid={`agent-indicator-${finalReview.agent}`}
                        className="text-purple-500"
                      >
                        {finalReview.agent}
                      </span>
                    </div>
                  )}
                  {finalReviewStatus === "active" && (
                    <div className={cn("text-sm", getPhaseTextClass(finalReviewStatus))}>
                      reviewing...
                    </div>
                  )}
                  {finalReview?.verdict && (
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        finalReview.passed ? "text-green-500" : "text-red-500"
                      )}
                    >
                      {finalReview.verdict}
                    </div>
                  )}
                  {finalReview?.rejections !== undefined && finalReview.rejections > 0 && (
                    <div className="text-sm">
                      Rejections: <span data-testid="rejection-count">{finalReview.rejections}</span>
                    </div>
                  )}
                  {finalReview?.completed_at && (
                    <div className="text-xs text-gray-400 mt-1">
                      {formatCompletionTime(finalReview.completed_at)}
                    </div>
                  )}
                </div>

                {/* Arrow connector */}
                <div data-testid="pipeline-connector" className="flex justify-center">
                  <span className="text-gray-500 text-lg">&#8595;</span>
                </div>

                {/* Post-Checks Phase */}
                <div
                  data-testid="phase-post-checks"
                  data-status={postChecksStatus}
                  className={cn(
                    "p-3 rounded-lg border-2",
                    getPhaseStatusColorClass(postChecksStatus)
                  )}
                >
                  <div className="font-semibold mb-2">Post-Checks</div>
                  <div className="space-y-1">
                    {(["lint", "typecheck", "test", "build"] as const).map((checkName) => {
                      const checkResult = postChecks?.results?.[checkName] ?? { status: "pending" as CheckResultStatus };
                      return (
                        <div
                          key={checkName}
                          data-testid={`check-${checkName}`}
                          data-status={checkResult.status}
                          className={cn(
                            "flex items-center gap-2 text-sm",
                            getCheckStatusClass(checkResult.status)
                          )}
                        >
                          <CheckIcon status={checkResult.status} />
                          <span>{checkName}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Arrow connector */}
                <div data-testid="pipeline-connector" className="flex justify-center">
                  <span className="text-gray-500 text-lg">&#8595;</span>
                </div>

                {/* Documentation Phase */}
                <div
                  data-testid="phase-documentation"
                  data-status={documentationStatus}
                  className={cn(
                    "p-3 rounded-lg border-2",
                    getPhaseStatusColorClass(documentationStatus)
                  )}
                >
                  <div className="font-semibold mb-2">Documentation</div>
                  {documentation?.agent && (
                    <div className="text-sm mb-1">
                      <span
                        data-testid={`agent-indicator-${documentation.agent}`}
                        className="text-teal-500"
                      >
                        {documentation.agent}
                      </span>
                    </div>
                  )}
                  {postChecksFailed && documentationStatus === "pending" && (
                    <div className="text-sm text-gray-400">blocked</div>
                  )}
                  {!postChecksFailed && documentationStatus === "pending" && !documentation && (
                    <div className="text-sm text-gray-400">waiting</div>
                  )}
                  {documentationStatus === "active" && (
                    <div className={cn("text-sm", getPhaseTextClass(documentationStatus))}>
                      writing...
                    </div>
                  )}
                  {documentation?.completed && (
                    <>
                      <div className="text-sm text-green-500 font-semibold">COMMITTED</div>
                      {documentation.commit && (
                        <div className="text-xs font-mono mt-1">{documentation.commit}</div>
                      )}
                    </>
                  )}
                  {documentation?.files_modified && documentation.files_modified.length > 0 && !showSummaryCard && (
                    <div className="text-xs mt-2 space-y-0.5">
                      {documentation.files_modified.map((file) => (
                        <div key={file} className="text-gray-400">{file}</div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Failure card */}
                {postChecksFailed && postChecks && (
                  <div
                    data-testid="failure-card"
                    className="mt-2 p-4 bg-red-500/10 border border-red-500 rounded-lg"
                  >
                    <div className="flex items-center">
                      <span className="text-red-500 text-xl mr-2">&#9888;</span>
                      <span className="font-semibold text-red-500">
                        Check Failed:{" "}
                        {Object.entries(postChecks.results)
                          .filter(([, result]) => result.status === "failed")
                          .map(([name]) => name)
                          .join(", ")}
                      </span>
                    </div>
                  </div>
                )}

                {/* Completion summary card */}
                {showSummaryCard && (
                  <div
                    data-testid="completion-summary-card"
                    className="mt-2 p-4 bg-green-500/10 border border-green-500 rounded-lg"
                  >
                    <div className="flex items-center mb-2">
                      <span className="text-green-500 text-2xl mr-2">&#10004;</span>
                      <span className="font-bold text-green-500 text-lg">MISSION COMPLETE</span>
                    </div>
                    {documentation?.commit && (
                      <div className="text-sm mb-1">
                        Commit: <span className="font-mono">{documentation.commit}</span>
                      </div>
                    )}
                    {documentation?.summary && (
                      <div className="text-sm text-gray-300 mb-2">{documentation.summary}</div>
                    )}
                    {documentation?.files_modified && documentation.files_modified.length > 0 && (
                      <div className="text-xs mt-2">
                        <div className="text-gray-400 mb-1">Files:</div>
                        {documentation.files_modified.map((file) => (
                          <div key={file} className="text-gray-300 ml-2">{file}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
