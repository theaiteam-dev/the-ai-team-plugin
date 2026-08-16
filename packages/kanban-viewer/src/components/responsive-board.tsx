"use client";

import { useState } from "react";
import { BoardColumn } from "@/components/board-column";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { WorkItem, Stage, CardAnimationState, CardAnimationDirection } from "@/types";

// All stage definitions for the board
export const ALL_STAGES: Stage[] = [
  "briefings",
  "ready",
  "testing",
  "implementing",
  "review",
  "probing",
  "staged",
  "done",
  "blocked",
];

// Stage display names for tabs
export const STAGE_LABELS: Record<Stage, string> = {
  briefings: "Briefings",
  ready: "Ready",
  testing: "Testing",
  implementing: "Implementing",
  review: "Review",
  probing: "Probing",
  staged: "Staged",
  done: "Done",
  blocked: "Blocked",
};

export interface ResponsiveBoardProps {
  /** Work items grouped by stage */
  itemsByStage: Record<Stage, WorkItem[]>;
  /** WIP limits per stage */
  wipLimits: Record<string, number | null>;
  /** Callback when an item is clicked */
  onItemClick?: (item: WorkItem) => void;
  /** Whether the side panel is visible (controlled externally) */
  isPanelOpen?: boolean;
  /** Callback when panel toggle is clicked */
  onPanelToggle?: () => void;
  /** Children to render in the side panel slot */
  sidePanel?: React.ReactNode;
  /** Callback when WIP limit is changed */
  onWipLimitChange?: (stageId: string, newLimit: number | null) => void;
  /** In-flight card move animations, keyed by item id (forwarded to every BoardColumn) */
  animatingItems?: Map<string, { state: CardAnimationState; direction: CardAnimationDirection }>;
  /** Callback fired when a card's move animation completes */
  onAnimationEnd?: (itemId: string) => void;
}

export function ResponsiveBoard({
  itemsByStage,
  wipLimits,
  onItemClick,
  isPanelOpen = true,
  onPanelToggle,
  sidePanel,
  onWipLimitChange,
  animatingItems,
  onAnimationEnd,
}: ResponsiveBoardProps) {
  // Mobile stage selector state
  const [selectedStage, setSelectedStage] = useState<Stage>("briefings");

  return (
    <div data-testid="responsive-board" className="flex flex-1 overflow-hidden">
      {/* Mobile view: Stage tabs with single column */}
      {/* WI-792 (Amy's FLAG, 3rd rework): min-w-0 overrides the flex item's
          default min-width:auto, which otherwise lets the TabsList's
          intrinsic content width (w-max, ~924px for 9 tabs) propagate up
          through this flex-column ancestor and force the mobile view wider
          than the viewport. JSDOM has no real CSS box layout so this was
          invisible to every existing test — Amy caught it live in a real
          browser and verified this exact fix via DOM patch. */}
      <div className="flex-1 flex flex-col min-w-0 md:hidden">
        <Tabs
          value={selectedStage}
          onValueChange={(value) => setSelectedStage(value as Stage)}
          className="flex flex-col h-full"
        >
          {/* Stage selector tabs - scrollable horizontally */}
          <div className="border-b border-border px-2 py-2 overflow-x-auto">
            <TabsList
              data-testid="mobile-stage-tabs"
              className="inline-flex w-max"
            >
              {ALL_STAGES.map((stage) => (
                <TabsTrigger
                  key={stage}
                  value={stage}
                  data-testid={`stage-tab-${stage}`}
                  className="text-xs px-3"
                >
                  {STAGE_LABELS[stage]}
                  <span className="ml-1 text-muted-foreground">
                    ({itemsByStage[stage]?.length || 0})
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Stage content - single column view */}
          {ALL_STAGES.map((stage) => (
            <TabsContent
              key={stage}
              value={stage}
              className="flex-1 overflow-auto p-2 mt-0"
              data-testid={`stage-content-${stage}`}
            >
              <BoardColumn
                stage={stage}
                items={itemsByStage[stage] || []}
                wipLimit={wipLimits[stage]}
                onItemClick={onItemClick}
                onWipLimitChange={onWipLimitChange}
                animatingItems={animatingItems}
                onAnimationEnd={onAnimationEnd}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Tablet/Desktop view: Horizontal scrollable columns */}
      <div className="hidden md:flex md:flex-1 gap-2 p-4 overflow-x-auto" data-testid="desktop-board">
        {ALL_STAGES.map((stage) => (
          <BoardColumn
            key={stage}
            stage={stage}
            items={itemsByStage[stage] || []}
            wipLimit={wipLimits[stage]}
            onItemClick={onItemClick}
            onWipLimitChange={onWipLimitChange}
            animatingItems={animatingItems}
            onAnimationEnd={onAnimationEnd}
          />
        ))}
      </div>

      {/* Panel toggle button - visible on tablet only (md to lg) */}
      {onPanelToggle && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onPanelToggle}
          className="hidden md:flex lg:hidden absolute right-2 top-20 z-10"
          data-testid="panel-toggle-button"
          aria-label={isPanelOpen ? "Close panel" : "Open panel"}
        >
          {isPanelOpen ? (
            <PanelRightClose className="h-5 w-5" />
          ) : (
            <PanelRightOpen className="h-5 w-5" />
          )}
        </Button>
      )}

      {/* Side panel - hidden on mobile, collapsible on tablet, always visible on desktop */}
      {sidePanel && (
        <div
          data-testid="side-panel-container"
          className={`
            hidden
            md:block
            w-[400px] min-w-[350px] max-w-[500px] border-l border-border bg-card shrink-0
            transition-all duration-300 ease-in-out
            ${isPanelOpen ? "md:w-[400px]" : "md:w-0 md:overflow-hidden md:border-l-0"}
            lg:w-[400px] lg:border-l lg:overflow-visible
          `}
        >
          {sidePanel}
        </div>
      )}
    </div>
  );
}
