package controller

// Recovery logic for the controller tick: stale-claim release, dep-ready move,
// and ambiguous-stall escalation.
//
// computeRecovery is called once per tick after dispatch and final-review
// actions are assembled. It pushes release/move actions onto the same Action
// slice and sets NeedsJudgment when contradictory signals prevent a safe
// automated recovery.

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ── Health report data types ──────────────────────────────────────────────────

// healthData mirrors the data field of GET /api/missions/current/health-report.
type healthData struct {
	MissionID     string             `json:"missionId"`
	InFlightItems []inFlightItemData `json:"inFlightItems"`
}

// inFlightItemData describes one in-flight work item from the health report.
type inFlightItemData struct {
	ItemID             string                `json:"itemId"`
	Title              string                `json:"title"`
	Stage              string                `json:"stage"`
	AssignedAgent      string                `json:"assignedAgent"`
	IdleSeconds        float64               `json:"idleSeconds"`
	LastActivitySource string                `json:"lastActivitySource"`
	RecentActivity     []recentActivityEntry `json:"recentActivity"`
}

// recentActivityEntry is one entry in inFlightItemData.RecentActivity.
// Entries with EventType == "activity" are ActivityLog writes; all others are
// hook events (tool calls tracked by the observer hook).
type recentActivityEntry struct {
	Agent     string  `json:"agent"`
	Tool      *string `json:"tool"` // nil for ActivityLog entries
	EventType string  `json:"eventType"`
	Timestamp string  `json:"timestamp"`
}

// ── Pool slot inspection ──────────────────────────────────────────────────────

// poolSlotState describes the current state of one pool slot on the filesystem.
type poolSlotState struct {
	IsIdle         bool
	IsBusy         bool
	IdleAgeSeconds float64 // seconds since the .idle file's mtime; 0 when not idle
	BusyAgeSeconds float64 // seconds since the .busy file's mtime; 0 when not busy
}

// checkPoolSlot reads the .idle and .busy marker files for instance in poolDir
// and returns their state. Missing files are not errors — a missing .idle
// simply means the slot is not idle.
func checkPoolSlot(poolDir, instance string) poolSlotState {
	idleFile := filepath.Join(poolDir, instance+".idle")
	busyFile := filepath.Join(poolDir, instance+".busy")

	var state poolSlotState
	if info, err := os.Stat(idleFile); err == nil {
		state.IsIdle = true
		state.IdleAgeSeconds = time.Since(info.ModTime()).Seconds()
	}
	if info, err := os.Stat(busyFile); err == nil {
		state.IsBusy = true
		state.BusyAgeSeconds = time.Since(info.ModTime()).Seconds()
	}
	return state
}

// staleThresholdSeconds returns the configured stale-claim threshold in seconds.
// Override via ATEAM_STALE_CLAIM_SECONDS; default is 600 (10 minutes), matching
// the idle threshold used by the health-report API endpoint.
func staleThresholdSeconds() float64 {
	if s := os.Getenv("ATEAM_STALE_CLAIM_SECONDS"); s != "" {
		if v, err := strconv.ParseFloat(s, 64); err == nil && v > 0 {
			return v
		}
	}
	return 600
}

// ── Signal helpers ────────────────────────────────────────────────────────────

// hasHookEvents returns true when any recentActivity entry has an EventType
// other than "activity" — i.e. a real observer-hook event fired for this item.
func hasHookEvents(item inFlightItemData) bool {
	for _, entry := range item.RecentActivity {
		if entry.EventType != "activity" {
			return true
		}
	}
	return false
}

// hasActivityLogEntries returns true when any recentActivity entry has EventType
// "activity" — written by the agent via `ateam activity createActivityEntry`.
func hasActivityLogEntries(item inFlightItemData) bool {
	for _, entry := range item.RecentActivity {
		if entry.EventType == "activity" {
			return true
		}
	}
	return false
}

// isReleaseAlreadyConfirmed returns true when checkpoint.ConfirmedActionIDs
// contains an entry with the prefix "<missionId>:<itemId>:release:" — meaning
// a prior release for this item has been confirmed and must not be re-emitted.
func isReleaseAlreadyConfirmed(checkpoint checkpointData, missionID, itemID string) bool {
	prefix := missionID + ":" + itemID + ":release:"
	for _, id := range checkpoint.ConfirmedActionIDs {
		if strings.HasPrefix(id, prefix) {
			return true
		}
	}
	return false
}

// ── Recovery computation ──────────────────────────────────────────────────────

// recoveryResult carries the actions and optional needsJudgment produced by
// one recovery pass. NeedsJudgment is nil unless an ambiguous stall is detected.
type recoveryResult struct {
	Actions       []Action
	NeedsJudgment interface{}
}

// computeRecovery evaluates in-flight items for stale claims and briefings items
// for dep-readiness, emitting release and move actions respectively. When
// contradictory signals prevent a safe automated decision it sets NeedsJudgment
// instead of guessing.
//
// Pool slot checking is only performed in native-teams mode (the pool filesystem
// does not exist in legacy mode).
func computeRecovery(
	cfg Config,
	mode string,
	health healthData,
	briefingsItems []boardItem,
	readySet map[string]bool,
	checkpoint checkpointData,
	startSeq int,
) recoveryResult {
	poolDir := poolDirForMission(cfg.MissionID)
	threshold := staleThresholdSeconds()

	var actions []Action
	var needsJudgment interface{}
	seq := startSeq

	// ── Release stale claims (native-teams only — pool filesystem required) ────
	if mode == "native-teams" {
		for _, item := range health.InFlightItems {
			if item.AssignedAgent == "" {
				continue
			}
			slot := checkPoolSlot(poolDir, item.AssignedAgent)
			hookEventsPresent := hasHookEvents(item)
			activityLogsPresent := hasActivityLogEntries(item)

			// AC3: Ambiguous stall — busy pool slot + no hook events + activity-log
			// entry present. The agent may be alive or orphaned; emit needsJudgment
			// and skip this item entirely to avoid wrongly releasing a live claim.
			if slot.IsBusy && !hookEventsPresent && activityLogsPresent {
				needsJudgment = map[string]interface{}{
					"kind":   "stall-ambiguous",
					"itemId": item.ItemID,
					"signals": map[string]interface{}{
						"poolState":          "busy",
						"hookEventsInWindow": false,
						"activityLogPresent": true,
						"assignedAgent":      item.AssignedAgent,
						"idleSeconds":        item.IdleSeconds,
					},
					"suggestedInvestigation": fmt.Sprintf(
						"Check whether agent %s is still active for item %s. "+
							"Pool slot is .busy but no hook events are present in the recent window. "+
							"The agent may be alive (activity log is recent) or the busy slot may be orphaned. "+
							"Inspect the agent process or use 'ateam pool release %s' after confirming it is dead.",
						item.AssignedAgent, item.ItemID, item.AssignedAgent,
					),
				}
				continue // do NOT emit release or move for this item
			}

			// AC1: Release — pool slot is idle past the stale threshold AND no hook
			// events have fired in the recent window. Both conditions are required.
			if slot.IsIdle && !slot.IsBusy && slot.IdleAgeSeconds > threshold && !hookEventsPresent {
				// AC5: Idempotency — skip if a prior release for this item is already
				// confirmed in the checkpoint, even if the pool state is still stale.
				if isReleaseAlreadyConfirmed(checkpoint, cfg.MissionID, item.ItemID) {
					continue
				}
				actionID := buildActionID(cfg.MissionID, item.ItemID, "release", item.AssignedAgent, seq)
				why := fmt.Sprintf(
					"release stale claim for %s — pool slot %s has been .idle for %.0fs"+
						" (threshold %.0fs), no hook events in recent activity window",
					item.ItemID, item.AssignedAgent, slot.IdleAgeSeconds, threshold,
				)
				actions = append(actions, Action{
					ID:     actionID,
					Kind:   "release",
					Why:    why,
					ItemID: item.ItemID,
					Agent:  item.AssignedAgent,
				})
				seq++
			}
		}
	}

	// ── Move dep-ready briefings items → ready ────────────────────────────────
	// Only items currently in 'briefings' are eligible. Backward transitions
	// (e.g. probing → ready) are never emitted — those are needsJudgment cases.
	for _, item := range briefingsItems {
		if !readySet[item.ID] {
			continue
		}
		if actionAlreadyKnown(checkpoint, cfg.MissionID, item.ID, "move", "controller") {
			continue
		}
		actionID := buildActionID(cfg.MissionID, item.ID, "move", "controller", seq)
		why := fmt.Sprintf(
			"move %s from briefings to ready — all dependencies are satisfied",
			item.ID,
		)
		actions = append(actions, Action{
			ID:      actionID,
			Kind:    "move",
			Why:     why,
			ItemID:  item.ID,
			ToStage: "ready",
		})
		seq++
	}

	return recoveryResult{Actions: actions, NeedsJudgment: needsJudgment}
}
