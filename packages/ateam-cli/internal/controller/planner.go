// Package controller computes a single controller tick plan from board / pool /
// dependency state and returns a JSON-serialisable TickOutput.
//
// The package does NOT call any Claude Code primitives (Task, TeamCreate,
// SendMessage, ScheduleWakeup, SpawnTask). It is intentionally a pure Go
// planning library — the action plan it emits is executed by the Hannibal
// orchestrator layer above it.
package controller

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"ateam/internal/stages"
)

// Config holds all inputs the Planner needs to compute a tick plan.
type Config struct {
	// BaseURL is the kanban-viewer API base URL (e.g. "http://localhost:3000").
	BaseURL string
	// MissionID is the active mission identifier, e.g. "M-ai-team-20260501-001".
	MissionID string
	// Mode is "native-teams" or "legacy". Controls whether the pool
	// filesystem is consulted for WIP gating.
	Mode string
	// DryRun suppresses all write operations (activity log, checkpoint).
	DryRun bool
	// ProjectID is the X-Project-ID header value for multi-tenant isolation.
	ProjectID string
}

// TickOutput is the JSON plan emitted by controller tick on stdout.
//
// Every field is always present in the JSON (null for optional scalars,
// empty arrays for slices) so downstream consumers can branch on types
// without nil-checking.
type TickOutput struct {
	MissionID       string        `json:"missionId"`
	Mode            string        `json:"mode"`
	State           string        `json:"state"`
	NextWakeSeconds interface{}   `json:"nextWakeSeconds"` // int or null
	Summary         string        `json:"summary"`
	Actions         []Action      `json:"actions"`
	Messages        []interface{} `json:"messages"`
	NeedsJudgment   interface{}   `json:"needsJudgment"` // null or object
}

// Action describes one thing the orchestrator should do.
//
// All actions carry ID, Kind, and Why. Kind-specific fields use omitempty so
// they only appear in the JSON for the relevant action kinds.
type Action struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// Why is the human-readable rationale. It is written to ActivityLog (for
	// audit/debuggability) but deliberately omitted from the model-facing tick
	// JSON — the executor never reads it, and re-serialising a sentence per
	// action on every tick is pure context cost. See postActivityEntry.
	Why        string   `json:"-"`
	ItemID     string   `json:"itemId,omitempty"`
	ItemTitle  string   `json:"itemTitle,omitempty"`
	Agent      string   `json:"agent,omitempty"`
	ToStage    string   `json:"toStage,omitempty"`    // set for "move" actions
	LaneNumber int      `json:"laneNumber,omitempty"` // set for "setup-lane" actions
	Instances  []string `json:"instances,omitempty"`  // set for "setup-lane" actions
}

// HTTPError is returned by fetch for non-2xx responses. Callers can inspect
// StatusCode to distinguish "not found" (404) from hard errors.
type HTTPError struct {
	StatusCode int
	Body       string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.StatusCode, e.Body)
}

// Planner executes a single controller tick.
type Planner struct {
	cfg     Config
	httpCli *http.Client
}

// NewPlanner constructs a Planner with a default 10-second HTTP timeout.
func NewPlanner(cfg Config) *Planner {
	return &Planner{
		cfg:     cfg,
		httpCli: &http.Client{Timeout: 10 * time.Second},
	}
}

// Tick reads all required board / pool / dependency state, computes the
// action plan, optionally persists writes, and returns the plan.
//
// On API failure it returns (fail-closed plan, non-nil error). The plan is
// always non-nil so the caller can print it regardless of success.
func (p *Planner) Tick() (*TickOutput, error) {
	missionID := p.cfg.MissionID
	mode := p.cfg.Mode

	// ── 1. Mission ────────────────────────────────────────────────────────
	mission, missionErr := p.fetchMission()
	if missionErr != nil {
		return p.failClosed(missionID, mode, fmt.Errorf("fetch mission: %w", missionErr)), missionErr
	}
	// If missionID was not provided via config/env, use the one returned by the API.
	if missionID == "" {
		missionID = mission.ID
	}

	// ── 1b. Runaway backstop ──────────────────────────────────────────────
	// Before doing any scheduling work, halt a mission that has blown its
	// wall-clock budget. This is the durable-layer guard against a control-loop
	// livelock (the 40-hour runaway) that no per-item rejection cap can bound.
	if bp := p.runawayBackstop(missionID, mode, mission.State, mission.StartedAt); bp != nil {
		return bp, nil
	}

	// ── 2. Health report (non-fatal — used for stale-claim recovery) ────────
	health, _ := p.fetchHealth()
	if health == nil {
		health = &healthData{}
	}

	// ── 3. Checkpoint (404 = no checkpoint yet — non-fatal) ───────────────
	checkpoint, checkpointErr := p.fetchCheckpointOrEmpty(missionID)
	if checkpointErr != nil {
		return p.failClosed(missionID, mode, fmt.Errorf("fetch checkpoint: %w", checkpointErr)), checkpointErr
	}

	// ── 4. Dependency readiness ───────────────────────────────────────────
	deps, depsErr := p.fetchDeps()
	if depsErr != nil {
		return p.failClosed(missionID, mode, fmt.Errorf("fetch deps: %w", depsErr)), depsErr
	}
	readySet := stringSet(deps.ReadyItems)

	// ── 5. Items by stage ─────────────────────────────────────────────────
	allStages := []string{
		"briefings", "ready", "testing", "implementing",
		"review", "probing", "blocked", "done",
	}
	itemsByStage := make(map[string][]boardItem)
	for _, stage := range allStages {
		items, err := p.fetchItemsByStage(stage)
		if err != nil {
			return p.failClosed(missionID, mode, fmt.Errorf("fetch items for stage %s: %w", stage, err)), err
		}
		itemsByStage[stage] = items
	}
	itemByID := make(map[string]boardItem)
	for _, items := range itemsByStage {
		for _, item := range items {
			itemByID[item.ID] = item
		}
	}

	// ── 6. Scaling ───────────────────────────────────────────────────────────
	// Fetch the recommended lane count from the API. Non-fatal: falls back to 1.
	maxLanes := 1
	if scaling, err := p.fetchScaling(); err == nil {
		maxLanes = scaling.InstanceCount
	}

	// ── 7. Pool observation (native-teams only) ───────────────────────────
	idleAgentCount := 0
	if mode == "native-teams" {
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)
		idleAgentCount = countIdleAgents(poolDir, "murdock")
	} else {
		// Legacy mode: no pool — treat as unlimited capacity.
		idleAgentCount = 1<<31 - 1
	}

	// Per-stage WIP gate. A ready item enters the pipeline at the `testing`
	// stage (Murdock), so the ready-dispatch loop must respect testing's WIP cap
	// — not only the idle pool count. Otherwise the planner emits dispatches the
	// API later rejects with WIP_LIMIT_EXCEEDED. Missing/null limit = unlimited.
	wipLimits := p.fetchStageWIPLimits()
	const entryStage = "testing"
	entryRemaining := 1<<31 - 1
	if lim, ok := wipLimits[entryStage]; ok {
		entryRemaining = lim - len(itemsByStage[entryStage])
		if entryRemaining < 0 {
			entryRemaining = 0
		}
	}

	// ── 7. Compute dispatch actions ───────────────────────────────────────
	var actions []Action
	seq := nextSequence(checkpoint)

	readyItems := itemsByStage["ready"]
	dispatchable := filterDispatchable(readyItems, readySet)

	cap := rejectionCap()
	dispatched := 0
	claimedInstances := map[string]bool{} // prevent double-claiming within one tick
	for _, item := range dispatchable {
		// Stop when either the physical lane capacity (idle pool slots) or the
		// entry stage's WIP cap is reached — both must hold.
		if dispatched >= idleAgentCount || dispatched >= entryRemaining {
			break
		}
		// Planner-side runaway/rework guard: an item that has bounced back
		// rejectionCap times is blocked here, in the durable layer, regardless of
		// how it re-entered (the API cap only fires on a clean agentStop rejection).
		if item.RejectionCount >= cap {
			if blk, ok := buildBlockAction(checkpoint, missionID, item, cap, seq); ok {
				actions = append(actions, blk)
				seq++
			}
			continue
		}
		// Dedup is keyed on the rejection GENERATION so re-dispatch after a
		// legitimate rework bounce (a new generation) is allowed, while a
		// duplicate dispatch of the same generation is suppressed.
		if dispatchAlreadyKnown(checkpoint, missionID, item.ID, item.RejectionCount) {
			continue
		}
		instance := "murdock"
		if mode == "native-teams" {
			poolDir := poolDirForMission(missionID)
			instance = p.selectInstance(poolDir, "murdock", claimedInstances)
			if instance == "" {
				break // no more idle instances
			}
		}
		actionID := buildDispatchActionID(missionID, item.ID, item.RejectionCount, instance, seq)
		why := fmt.Sprintf(
			"dispatch %s to %s (gen %d) — deps satisfied, lane free",
			item.ID, instance, item.RejectionCount,
		)
		actions = append(actions, Action{
			ID:        actionID,
			Kind:      "dispatch",
			Why:       why,
			ItemID:    item.ID,
			ItemTitle: item.Title,
			Agent:     instance, // specific instance, e.g. "murdock-2"
		})
		seq++
		dispatched++
	}

	// ── 8b. Setup-lane — spawn additional lanes up to maxLanes when demand exceeds capacity ──
	// Emit setup-lane for each lane that is needed but not yet in the pool.
	// Condition: more dispatchable items than idle agents, AND unused lanes available (nextLane <= maxLanes).
	// Guards: only in native-teams mode; skip if a lane is already being set up (non-idle busy agents exist
	// for the target lane number, meaning a prior setup-lane is still in progress).
	if mode == "native-teams" {
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)
		undispatched := len(dispatchable) - dispatched
		plannedLanes := map[int]bool{}
		for undispatched > 0 {
			laneNum := nextLaneNumber(poolDir, plannedLanes)
			if laneNum > maxLanes {
				break
			}
			// Skip if this lane's murdock is already busy (prior setup-lane in progress).
			busyPath := filepath.Join(poolDir, fmt.Sprintf("murdock-%d.busy", laneNum))
			if _, err := os.Stat(busyPath); err == nil {
				break
			}
			plannedLanes[laneNum] = true
			instances := []string{
				fmt.Sprintf("murdock-%d", laneNum),
				fmt.Sprintf("ba-%d", laneNum),
				fmt.Sprintf("lynch-%d", laneNum),
				fmt.Sprintf("amy-%d", laneNum),
			}
			laneAgent := fmt.Sprintf("lane-%d", laneNum)
			if actionAlreadyKnown(checkpoint, missionID, "lane", "setup-lane", laneAgent) {
				break
			}
			actionID := buildActionID(missionID, "lane", "setup-lane", laneAgent, seq)
			actions = append(actions, Action{
				ID:         actionID,
				Kind:       "setup-lane",
				Why:        fmt.Sprintf("%d ready items, only %d idle murdock — pre-warm lane %d (max %d)", len(dispatchable), idleAgentCount, laneNum, maxLanes),
				LaneNumber: laneNum,
				Instances:  instances,
			})
			seq++
			undispatched--
		}
	}

	// ── 8. Orphan dispatch — active-stage items with no assigned agent ───────
	// Covers handoff failures: if an item is in testing/implementing/review/probing
	// but has no assignedAgent, dispatch the responsible agent directly.
	for stageName, stageInfo := range stages.PipelineStages {
		for _, item := range itemsByStage[stageName] {
			if item.AssignedAgent != "" {
				continue // already claimed — skip
			}
			// Same durable runaway/rework guard as the ready-dispatch loop: this
			// orphan path is the one that previously re-dispatched a cycling item
			// forever with no cap awareness.
			if item.RejectionCount >= cap {
				if blk, ok := buildBlockAction(checkpoint, missionID, item, cap, seq); ok {
					actions = append(actions, blk)
					seq++
				}
				continue
			}
			if dispatchAlreadyKnown(checkpoint, missionID, item.ID, item.RejectionCount) {
				continue
			}
			agentType := stageInfo.Agent
			dispatchAgent := agentType
			if mode == "native-teams" {
				poolDir := poolDirForMission(missionID)
				dispatchAgent = p.selectInstance(poolDir, agentType, claimedInstances)
				if dispatchAgent == "" {
					continue
				}
			}
			actionID := buildDispatchActionID(missionID, item.ID, item.RejectionCount, dispatchAgent, seq)
			why := fmt.Sprintf(
				"orphan dispatch: %s in %s with no assigned agent — dispatching %s",
				item.ID, stageName, dispatchAgent,
			)
			actions = append(actions, Action{
				ID:        actionID,
				Kind:      "dispatch",
				Why:       why,
				ItemID:    item.ID,
				ItemTitle: item.Title,
				Agent:     dispatchAgent,
			})
			seq++
		}
	}

	// ── 9. Final-review action ────────────────────────────────────────────
	nonDoneStages := []string{
		"briefings", "ready", "testing", "implementing",
		"review", "probing", "blocked",
	}
	hasNonDoneItems := itemsExistInAny(itemsByStage, nonDoneStages)
	hasDoneItems := len(itemsByStage["done"]) > 0
	finalReviewAbsent := isFinalReviewAbsent(mission.FinalReview)

	finalReviewAlreadyDispatched := func() bool {
		prefix := missionID + ":mission:final-review:"
		for _, id := range checkpoint.ConfirmedActionIDs {
			if strings.HasPrefix(id, prefix) {
				return true
			}
		}
		for _, id := range checkpoint.PendingActionIDs {
			if strings.HasPrefix(id, prefix) {
				return true
			}
		}
		return false
	}

	if !hasNonDoneItems && hasDoneItems && finalReviewAbsent && !finalReviewAlreadyDispatched() {
		actionID := buildActionID(missionID, "mission", "final-review", "stockwell", seq)
		why := "all items are done and no final review has been recorded"
		actions = append(actions, Action{
			ID:   actionID,
			Kind: "final-review",
			Why:  why,
		})
		seq++
	}

	// ── 9. Recovery actions (release stale claims + move dep-ready briefings) ─
	recovery := computeRecovery(p.cfg, mode, *health, itemsByStage["briefings"], readySet, checkpoint, seq)
	actions = append(actions, recovery.Actions...)

	// ── 10. Cadence ───────────────────────────────────────────────────────────
	hasDispatchable := len(dispatchable) > 0
	hasIdleLane := idleAgentCount > 0
	hasNonDone := hasNonDoneItems

	nextWake := computeNextWake(hasDispatchable, hasIdleLane, hasNonDone, len(actions))

	// ── 11. Assemble plan ─────────────────────────────────────────────────────
	if actions == nil {
		actions = []Action{}
	}
	plan := &TickOutput{
		MissionID:       missionID,
		Mode:            mode,
		State:           mission.State,
		NextWakeSeconds: nextWake,
		Summary:         buildSummary(mission.State, actions),
		Actions:         actions,
		Messages:        []interface{}{},
		NeedsJudgment:   recovery.NeedsJudgment,
	}

	// ── 12. Writes (skipped in dry-run) ───────────────────────────────────────
	if !p.cfg.DryRun {
		for _, action := range actions {
			if err := p.postActivityEntry(action); err != nil {
				return plan, err
			}
		}
		// Reclaim pool slots whose dispatch never took effect (native-teams
		// only). This mutates checkpoint.ConfirmedActionIDs in place — dropping
		// the stale dispatch IDs — so the checkpoint write below persists the
		// reclaim and the next tick re-dispatches the freed slots.
		if mode == "native-teams" {
			reclaimed := p.reclaimStuckSlots(poolDirForMission(missionID), itemByID, &checkpoint)
			// A reclaim freed a slot whose dispatch was dropped — re-tick promptly
			// so the freed slot is re-dispatched on the next cycle rather than after
			// the (longer) idle cadence. Bounds the dropped-dispatch dead-time.
			if len(reclaimed) > 0 {
				plan.NextWakeSeconds = 5
			}
		}
		if err := p.postCheckpoint(missionID, actions, checkpoint); err != nil {
			return plan, err
		}
	}

	return plan, nil
}

// ── API data types ────────────────────────────────────────────────────────────

type scalingData struct {
	InstanceCount int `json:"instanceCount"`
}

type missionData struct {
	ID          string      `json:"id"`
	State       string      `json:"state"`
	FinalReview interface{} `json:"finalReview"`
	StartedAt   string      `json:"startedAt"`
}

type depsData struct {
	ReadyItems   []string      `json:"readyItems"`
	BlockedItems []interface{} `json:"blockedItems"`
}

type boardItem struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	StageID        string `json:"stageId"`
	Type           string `json:"type"`
	AssignedAgent  string `json:"assignedAgent"`
	RejectionCount int    `json:"rejectionCount"`
}

// checkpointData mirrors the GET /api/controller-checkpoint/:missionId
// response body. All six fields are required by WI-002's POST contract;
// callers must pass them all back on upsert.
type checkpointData struct {
	TickedAt           string            `json:"tickedAt"`
	ActivityCursor     int               `json:"activityCursor"`
	PendingActionIDs   []string          `json:"pendingActionIds"`
	ConfirmedActionIDs []string          `json:"confirmedActionIds"`
	RetryCounters      map[string]int    `json:"retryCounters"`
	LastLaneState      map[string]string `json:"lastLaneState"`
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

func (p *Planner) fetchMission() (*missionData, error) {
	var envelope struct {
		Success bool        `json:"success"`
		Data    missionData `json:"data"`
	}
	if err := p.fetchAndDecode("/api/missions/current", &envelope); err != nil {
		return nil, err
	}
	return &envelope.Data, nil
}

func (p *Planner) fetchScaling() (*scalingData, error) {
	encoded, _ := json.Marshal(map[string]interface{}{})
	reqURL := strings.TrimRight(p.cfg.BaseURL, "/") + "/api/scaling/compute"
	req, err := http.NewRequest(http.MethodPost, reqURL, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	p.injectHeaders(req)
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.httpCli.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var envelope struct {
		Success bool        `json:"success"`
		Data    scalingData `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Data.InstanceCount < 1 {
		envelope.Data.InstanceCount = 1
	}
	return &envelope.Data, nil
}

// fetchStageWIPLimits returns a map of stageID → WIP limit from GET /api/board.
// Stages with a null limit (unlimited) are omitted. Non-fatal: on any error it
// returns nil, and the caller treats a missing entry as unlimited.
func (p *Planner) fetchStageWIPLimits() map[string]int {
	var envelope struct {
		Data struct {
			Stages []struct {
				ID       string `json:"id"`
				WipLimit *int   `json:"wipLimit"`
			} `json:"stages"`
		} `json:"data"`
	}
	if err := p.fetchAndDecode("/api/board", &envelope); err != nil {
		return nil
	}
	limits := make(map[string]int)
	for _, s := range envelope.Data.Stages {
		if s.WipLimit != nil {
			limits[s.ID] = *s.WipLimit
		}
	}
	return limits
}

func (p *Planner) fetchHealth() (*healthData, error) {
	var envelope struct {
		Success bool       `json:"success"`
		Data    healthData `json:"data"`
	}
	if err := p.fetchAndDecode("/api/missions/current/health-report", &envelope); err != nil {
		return nil, err
	}
	return &envelope.Data, nil
}

func (p *Planner) fetchCheckpointOrEmpty(missionID string) (checkpointData, error) {
	var empty checkpointData
	path := "/api/controller-checkpoint/" + missionID
	body, err := p.fetchRaw(path)
	if err != nil {
		var httpErr *HTTPError
		if errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusNotFound {
			return empty, nil // 404 = no checkpoint yet — return empty
		}
		return empty, err
	}
	var envelope struct {
		Success bool           `json:"success"`
		Data    checkpointData `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return empty, err
	}
	return envelope.Data, nil
}

func (p *Planner) fetchDeps() (*depsData, error) {
	var envelope struct {
		Success bool     `json:"success"`
		Data    depsData `json:"data"`
	}
	if err := p.fetchAndDecode("/api/deps/check", &envelope); err != nil {
		return nil, err
	}
	return &envelope.Data, nil
}

func (p *Planner) fetchItemsByStage(stage string) ([]boardItem, error) {
	var envelope struct {
		Success bool        `json:"success"`
		Data    []boardItem `json:"data"`
	}
	if err := p.fetchAndDecode("/api/items?stage="+stage, &envelope); err != nil {
		return nil, err
	}
	return envelope.Data, nil
}

// fetchRaw makes a GET request and returns the raw response body.
// Returns *HTTPError for non-2xx status codes.
func (p *Planner) fetchRaw(path string) ([]byte, error) {
	reqURL := strings.TrimRight(p.cfg.BaseURL, "/") + path
	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request for %s: %w", path, err)
	}
	p.injectHeaders(req)

	resp, err := p.httpCli.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body for %s: %w", path, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := string(body)
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return nil, &HTTPError{StatusCode: resp.StatusCode, Body: snippet}
	}

	return body, nil
}

// fetchAndDecode fetches path and JSON-decodes the response into dest.
func (p *Planner) fetchAndDecode(path string, dest interface{}) error {
	body, err := p.fetchRaw(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, dest); err != nil {
		return fmt.Errorf("parse %s response: %w", path, err)
	}
	return nil
}

// ── Write helpers ─────────────────────────────────────────────────────────────

func (p *Planner) postActivityEntry(action Action) error {
	body := map[string]interface{}{
		"agent":   "controller",
		"level":   "info",
		"message": action.Why,
	}
	return p.postJSON("/api/activity", body)
}

func (p *Planner) postCheckpoint(missionID string, actions []Action, existing checkpointData) error {
	// Passthrough fields default to safe zero values when the existing
	// checkpoint was absent (404) — empty arrays/objects, cursor 0.
	confirmedActionIDs := append([]string{}, existing.ConfirmedActionIDs...)
	confirmed := stringSet(confirmedActionIDs)

	// Auto-confirm dispatch actions. The controller has already performed the
	// deterministic part of a dispatch (atomically claiming the pool slot), so
	// Claude's only remaining step is the SendMessage/Task call — there is no
	// separate Claude-side confirm. Recording the dispatch ID as confirmed here
	// keeps the next tick idempotent (a dropped SendMessage is recovered by
	// reclaimStuckSlots, not by re-emitting the same action ID).
	for _, a := range actions {
		if a.Kind == "dispatch" && !confirmed[a.ID] {
			confirmedActionIDs = append(confirmedActionIDs, a.ID)
			confirmed[a.ID] = true
		}
	}

	pendingActionIDs := make([]string, 0, len(existing.PendingActionIDs)+len(actions))
	seenPending := map[string]bool{}
	for _, id := range existing.PendingActionIDs {
		if confirmed[id] || seenPending[id] {
			continue
		}
		pendingActionIDs = append(pendingActionIDs, id)
		seenPending[id] = true
	}
	for _, a := range actions {
		// Dispatch actions are auto-confirmed above; everything else is left
		// pending for Claude to confirm after it executes the action.
		if a.Kind == "dispatch" || confirmed[a.ID] || seenPending[a.ID] {
			continue
		}
		pendingActionIDs = append(pendingActionIDs, a.ID)
		seenPending[a.ID] = true
	}
	retryCounters := existing.RetryCounters
	if retryCounters == nil {
		retryCounters = map[string]int{}
	}
	lastLaneState := existing.LastLaneState
	if lastLaneState == nil {
		lastLaneState = map[string]string{}
	}

	body := map[string]interface{}{
		"tickedAt":           time.Now().UTC().Format(time.RFC3339),
		"activityCursor":     existing.ActivityCursor,
		"pendingActionIds":   pendingActionIDs,
		"confirmedActionIds": confirmedActionIDs,
		"retryCounters":      retryCounters,
		"lastLaneState":      lastLaneState,
	}
	return p.postJSON("/api/controller-checkpoint/"+missionID, body)
}

// postJSON marshals body and POSTs it to path.
func (p *Planner) postJSON(path string, body interface{}) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body for %s: %w", path, err)
	}
	reqURL := strings.TrimRight(p.cfg.BaseURL, "/") + path
	req, err := http.NewRequest(http.MethodPost, reqURL, bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("build POST request for %s: %w", path, err)
	}
	p.injectHeaders(req)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.httpCli.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", path, err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body) // drain
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := string(respBody)
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return &HTTPError{StatusCode: resp.StatusCode, Body: snippet}
	}
	return nil
}

func (p *Planner) injectHeaders(req *http.Request) {
	if p.cfg.ProjectID != "" {
		req.Header.Set("X-Project-ID", p.cfg.ProjectID)
	}
}

// ── Pool observation ──────────────────────────────────────────────────────────

// pickIdleInstance returns the name of the first idle instance of agentType
// that is not already in the claimed map. Returns "" if none available.
func pickIdleInstance(poolDir, agentType string, claimed map[string]bool) string {
	patterns := []string{
		filepath.Join(poolDir, agentType+"-*.idle"),
		filepath.Join(poolDir, agentType+".idle"),
	}
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			continue
		}
		sort.Strings(matches)
		for _, match := range matches {
			name := strings.TrimSuffix(filepath.Base(match), ".idle")
			if !claimed[name] {
				return name
			}
		}
	}
	return ""
}

// selectInstance picks an idle instance of agentType to dispatch to. In a real
// (non-dry-run) tick it atomically CLAIMS the slot on the filesystem before
// returning it, so the slot is marked .busy the instant the controller decides
// to dispatch — closing the window where two consecutive ticks could both
// dispatch the same idle slot before the worker self-claims. In dry-run it only
// observes (never mutates the pool). Returns "" when no slot could be claimed.
//
// Claimed instances are tracked in `claimed` so a single tick never selects the
// same slot twice across the dispatch and orphan-dispatch passes.
func (p *Planner) selectInstance(poolDir, agentType string, claimed map[string]bool) string {
	if p.cfg.DryRun {
		inst := pickIdleInstance(poolDir, agentType, claimed)
		if inst != "" {
			claimed[inst] = true
		}
		return inst
	}
	for {
		inst := pickIdleInstance(poolDir, agentType, claimed)
		if inst == "" {
			return ""
		}
		// Mark as seen regardless of outcome so a lost race doesn't loop.
		claimed[inst] = true
		if claimSlot(poolDir, inst) {
			return inst
		}
	}
}

// claimSlot atomically claims an idle pool slot by hard-linking <instance>.idle
// to <instance>.busy and unlinking the .idle entry — exactly one caller wins
// under contention (os.Link refuses to clobber an existing .busy). It then
// stamps the .busy mtime to now so reclaimStuckSlots can measure how long the
// slot has been claimed (a hard link otherwise inherits the .idle inode's
// original mtime). Mirrors the primitive in cmd/pool_claim.go; returns true
// only when this caller won the slot.
func claimSlot(poolDir, instance string) bool {
	idleFile := filepath.Join(poolDir, instance+".idle")
	busyFile := filepath.Join(poolDir, instance+".busy")
	if err := os.Link(idleFile, busyFile); err != nil {
		return false
	}
	if err := os.Remove(idleFile); err != nil && !os.IsNotExist(err) {
		// Claimed but couldn't drop the .idle hardlink — the slot is still ours.
		// Leave the stray .idle for pool tooling rather than failing the claim.
	}
	now := time.Now()
	_ = os.Chtimes(busyFile, now, now)
	return true
}

// releaseSlot returns a claimed slot to the idle pool by writing <instance>.idle
// and removing <instance>.busy. It is the controller-side inverse of claimSlot,
// used by reclaimStuckSlots to recover a slot whose dispatch never started.
func releaseSlot(poolDir, instance string) {
	_ = os.WriteFile(filepath.Join(poolDir, instance+".idle"), nil, 0o644)
	_ = os.Remove(filepath.Join(poolDir, instance+".busy"))
}

// reclaimThresholdSeconds returns how long a dispatched-but-unstarted slot may
// stay .busy before the controller reclaims it. Override via
// ATEAM_RECLAIM_SECONDS; default 120s — comfortably longer than normal worker
// startup (renderItem + self-claim + agentStart), short enough to recover a
// dropped SendMessage within a couple of ticks.
func reclaimThresholdSeconds() float64 {
	if s := os.Getenv("ATEAM_RECLAIM_SECONDS"); s != "" {
		if v, err := strconv.ParseFloat(s, 64); err == nil && v > 0 {
			return v
		}
	}
	return 120
}

// rejectionCap returns the per-item rejection/rework cap. An item that has
// bounced back this many times is routed to `blocked` by the planner instead of
// being re-dispatched. Override via ATEAM_REJECTION_CAP (matches the API server's
// own env var); default 4.
func rejectionCap() int {
	if s := os.Getenv("ATEAM_REJECTION_CAP"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v >= 1 {
			return v
		}
	}
	return 4
}

// maxMissionHours returns the wall-clock budget for a single mission. Past this,
// the controller stops dispatching and escalates a runaway-backstop. Override via
// ATEAM_MAX_MISSION_HOURS; default 24h. This is the durable-layer backstop that a
// per-item rejection cap cannot provide — the 40-hour runaway was a control-loop
// livelock, not a single item rejecting forever.
func maxMissionHours() float64 {
	if s := os.Getenv("ATEAM_MAX_MISSION_HOURS"); s != "" {
		if v, err := strconv.ParseFloat(s, 64); err == nil && v > 0 {
			return v
		}
	}
	return 24
}

// runawayBackstop returns a non-nil halt plan when an active mission has been
// running past the wall-clock budget. The plan carries zero dispatch actions, a
// loud needsJudgment, and a long nextWake so the loop idles (≈hourly) and alerts
// the operator instead of ticking hot — rather than re-arming on the normal
// cadence. Terminal missions never trip it.
func (p *Planner) runawayBackstop(missionID, mode, state, startedAt string) *TickOutput {
	switch state {
	case "", "completed", "aborted", "archived":
		return nil
	}
	if startedAt == "" {
		return nil
	}
	started, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return nil
	}
	elapsed := time.Since(started).Hours()
	budget := maxMissionHours()
	if elapsed < budget {
		return nil
	}
	return &TickOutput{
		MissionID:       missionID,
		Mode:            mode,
		State:           state,
		NextWakeSeconds: 3600, // idle hourly + alert; do not tick hot
		Summary: fmt.Sprintf(
			"runaway backstop — mission running %.1fh exceeds %.0fh budget; halting dispatch, alerting operator",
			elapsed, budget,
		),
		Actions:  []Action{},
		Messages: []interface{}{},
		NeedsJudgment: map[string]interface{}{
			"kind": "runaway-backstop",
			"reason": fmt.Sprintf(
				"mission has been running %.1f hours, exceeding the %.0f-hour wall-clock budget (ATEAM_MAX_MISSION_HOURS)",
				elapsed, budget,
			),
			"suggestedInvestigation": "The control loop is likely livelocked against a stalled board. " +
				"Inspect the board for a looping/stuck item, then either abort the mission or fix and run /ai-team:resume. " +
				"The controller will not dispatch further work until the mission is resumed or aborted.",
		},
	}
}

// buildDispatchActionID constructs a dispatch action ID of the form
//
//	<missionId>:<itemId>:dispatch:g<gen>:<agent>:<seq>
//
// where gen is the item's rejection count (its rework generation). Encoding the
// generation makes the ID's dedup key change after a legitimate rework bounce
// (so re-dispatch is allowed) while a duplicate dispatch of the SAME generation
// is suppressed.
func buildDispatchActionID(missionID, itemID string, gen int, agent string, seq int) string {
	return fmt.Sprintf("%s:%s:dispatch:g%d:%s:%d", missionID, itemID, gen, agent, seq)
}

// dispatchAlreadyKnown reports whether a dispatch for (missionID,itemID) at the
// given rejection generation is already pending or confirmed. Keyed on the
// generation so it suppresses same-generation duplicates but permits a fresh
// dispatch after a rework bounce advanced the generation.
func dispatchAlreadyKnown(cp checkpointData, missionID, itemID string, gen int) bool {
	prefix := fmt.Sprintf("%s:%s:dispatch:g%d:", missionID, itemID, gen)
	for _, id := range append(cp.PendingActionIDs, cp.ConfirmedActionIDs...) {
		if strings.HasPrefix(id, prefix) {
			return true
		}
	}
	return false
}

// buildBlockAction returns a move-to-blocked action for an item that has hit the
// rejection cap, plus ok=false if such a block is already pending/confirmed.
// Routing a runaway item to `blocked` (for human triage) is the planner-side
// terminal-failure state that the durable layer previously lacked.
func buildBlockAction(cp checkpointData, missionID string, item boardItem, cap, seq int) (Action, bool) {
	if actionAlreadyKnown(cp, missionID, item.ID, "move", "controller-block") {
		return Action{}, false
	}
	return Action{
		ID:        buildActionID(missionID, item.ID, "move", "controller-block", seq),
		Kind:      "move",
		ToStage:   "blocked",
		ItemID:    item.ID,
		ItemTitle: item.Title,
		Why: fmt.Sprintf(
			"block %s — rejected %d times (cap %d); routing to blocked for human triage instead of re-dispatching",
			item.ID, item.RejectionCount, cap,
		),
	}, true
}

// parseDispatchActionID extracts the itemId and instance from a dispatch action
// ID of the form "<missionId>:<itemId>:dispatch:g<gen>:<instance>:<seq>". It
// parses from the right so a missionId containing ':' does not break the split.
// Returns ok=false for non-dispatch or malformed IDs.
func parseDispatchActionID(id string) (itemID, instance string, ok bool) {
	parts := strings.Split(id, ":")
	if len(parts) < 6 {
		return "", "", false
	}
	n := len(parts)
	if parts[n-4] != "dispatch" {
		return "", "", false
	}
	return parts[n-5], parts[n-2], true
}

// reclaimStuckSlots releases pool slots whose dispatch never took effect and
// drops the corresponding confirmed dispatch action so the next tick can
// re-dispatch.
//
// A confirmed dispatch action means the controller claimed a slot and emitted a
// START for the named instance. A worker that picked up the START would have
// called agentStart, setting the item's assignedAgent (and moving a ready item
// into testing). So when the slot is still .busy past the reclaim threshold AND
// the dispatched item still has no assignedAgent (or has vanished entirely), the
// START was dropped — e.g. the orchestrator turn died after the tick claimed the
// slot but before SendMessage. Reclaim it.
//
// A legitimately busy slot whose worker is mid-flight has assignedAgent set, so
// it is never reclaimed regardless of how long the work takes.
//
// Mutates checkpoint.ConfirmedActionIDs in place, returning the reclaimed IDs.
func (p *Planner) reclaimStuckSlots(poolDir string, itemByID map[string]boardItem, checkpoint *checkpointData) []string {
	if len(checkpoint.ConfirmedActionIDs) == 0 {
		return nil
	}
	threshold := reclaimThresholdSeconds()
	kept := make([]string, 0, len(checkpoint.ConfirmedActionIDs))
	var reclaimed []string
	for _, id := range checkpoint.ConfirmedActionIDs {
		itemID, instance, ok := parseDispatchActionID(id)
		if !ok {
			kept = append(kept, id)
			continue
		}
		slot := checkPoolSlot(poolDir, instance)
		item, found := itemByID[itemID]
		stuck := slot.IsBusy && slot.BusyAgeSeconds > threshold && (!found || item.AssignedAgent == "")
		if !stuck {
			kept = append(kept, id)
			continue
		}
		releaseSlot(poolDir, instance)
		reclaimed = append(reclaimed, id)
		_ = p.postActivityEntry(Action{
			Kind:   "reclaim",
			ItemID: itemID,
			Agent:  instance,
			Why: fmt.Sprintf(
				"reclaim stuck slot %s — dispatch of %s never started"+
					" (slot .busy for %.0fs, threshold %.0fs); releasing for re-dispatch",
				instance, itemID, slot.BusyAgeSeconds, threshold,
			),
		})
	}
	checkpoint.ConfirmedActionIDs = kept
	return reclaimed
}

// countIdleAgents returns how many idle instances of agentType exist in poolDir.
// Matches both "agentType.idle" and "agentType-N.idle" filenames.
// Returns 0 (not an error) when poolDir does not exist — the caller interprets
// a zero count as "no capacity".
func countIdleAgents(poolDir, agentType string) int {
	patterns := []string{
		filepath.Join(poolDir, agentType+".idle"),
		filepath.Join(poolDir, agentType+"-*.idle"),
	}
	var count int
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			continue
		}
		count += len(matches)
	}
	return count
}

// ── Planning helpers ──────────────────────────────────────────────────────────

// anyMurdockExists returns true if any murdock-N.idle or murdock-N.busy file exists in poolDir.
// Used to distinguish "pool completely empty" from "all murdocks busy".
func anyMurdockExists(poolDir string) bool {
	for _, pat := range []string{"murdock-*.idle", "murdock-*.busy", "murdock.idle", "murdock.busy"} {
		matches, _ := filepath.Glob(filepath.Join(poolDir, pat))
		if len(matches) > 0 {
			return true
		}
	}
	return false
}

// nextLaneNumber returns the lowest lane number N such that murdock-N.idle does not
// exist in poolDir and N has not already been planned in the current tick.
// If poolDir doesn't exist or is empty, returns 1.
func nextLaneNumber(poolDir string, planned map[int]bool) int {
	for n := 1; n <= 16; n++ {
		if planned[n] {
			continue
		}
		idlePath := filepath.Join(poolDir, fmt.Sprintf("murdock-%d.idle", n))
		busyPath := filepath.Join(poolDir, fmt.Sprintf("murdock-%d.busy", n))
		if _, errI := os.Stat(idlePath); os.IsNotExist(errI) {
			if _, errB := os.Stat(busyPath); os.IsNotExist(errB) {
				return n
			}
		}
	}
	return 1
}

// filterDispatchable returns ready items whose ID appears in the deps readySet.
// Order is preserved (stable, sorted by item position in the slice) so action
// IDs are deterministic across re-runs.
func filterDispatchable(items []boardItem, readySet map[string]bool) []boardItem {
	var out []boardItem
	for _, item := range items {
		if readySet[item.ID] {
			out = append(out, item)
		}
	}
	return out
}

// itemsExistInAny returns true iff at least one of the given stages has items.
func itemsExistInAny(itemsByStage map[string][]boardItem, stages []string) bool {
	for _, stage := range stages {
		if len(itemsByStage[stage]) > 0 {
			return true
		}
	}
	return false
}

// isFinalReviewAbsent returns true when the finalReview JSON value is absent,
// null, or an empty string — i.e. no review has been recorded yet.
func isFinalReviewAbsent(v interface{}) bool {
	if v == nil {
		return true
	}
	if s, ok := v.(string); ok && s == "" {
		return true
	}
	return false
}

// nextSequence returns the starting sequence counter for new actions in this
// tick. It uses the length of the existing pendingActionIds so that a fresh
// checkpoint (empty) always produces sequence 1, and repeated ticks without
// checkpoint updates produce the same IDs.
func nextSequence(cp checkpointData) int {
	return len(cp.PendingActionIDs) + 1
}

// buildActionID constructs the deterministic action ID in the form
//
//	<missionId>:<itemId>:<kind>:<agent>:<sequence>
func buildActionID(missionID, itemID, kind, agent string, seq int) string {
	return fmt.Sprintf("%s:%s:%s:%s:%d", missionID, itemID, kind, agent, seq)
}

// actionAlreadyKnown returns true when the checkpoint has a pending or
// confirmed action with the same semantic key. Pass agent="" to match any
// agent/instance for that mission+item+kind.
func actionAlreadyKnown(cp checkpointData, missionID, itemID, kind, agent string) bool {
	prefix := fmt.Sprintf("%s:%s:%s:", missionID, itemID, kind)
	if agent != "" {
		prefix += agent + ":"
	}
	for _, id := range append(cp.PendingActionIDs, cp.ConfirmedActionIDs...) {
		if strings.HasPrefix(id, prefix) {
			return true
		}
	}
	return false
}

// computeNextWake returns the recommended seconds until the next tick.
//
//	Actions emitted           → 5   (something happened, check back quickly)
//	Ready items, no idle lane → 45  (lanes busy — within [30,60])
//	Non-done items, no ready  → 180 (deps pending — within [120,300])
//	Nothing to do             → 300 (all done or truly idle)
func computeNextWake(hasDispatchable, hasIdleLane, hasNonDone bool, actionCount int) int {
	if actionCount > 0 {
		return 5
	}
	if hasDispatchable && !hasIdleLane {
		return 45
	}
	if hasNonDone {
		return 180
	}
	return 300
}

// buildSummary generates a human-readable tick summary.
func buildSummary(missionState string, actions []Action) string {
	if len(actions) == 0 {
		return fmt.Sprintf("mission %s — no actions this tick", missionState)
	}
	kinds := make(map[string]int)
	for _, a := range actions {
		kinds[a.Kind]++
	}
	var parts []string
	for k, n := range kinds {
		parts = append(parts, fmt.Sprintf("%d %s", n, k))
	}
	sort.Strings(parts)
	return fmt.Sprintf("mission %s — %s", missionState, strings.Join(parts, ", "))
}

// ── Fail-closed plan ──────────────────────────────────────────────────────────

// failClosed builds the plan returned when the API is unavailable or returns
// malformed data. It carries a needsJudgment payload and zero dispatch actions.
func (p *Planner) failClosed(missionID, mode string, cause error) *TickOutput {
	return &TickOutput{
		MissionID:       missionID,
		Mode:            mode,
		State:           "error",
		NextWakeSeconds: nil,
		Summary:         "API error — needs human judgment",
		Actions:         []Action{},
		Messages:        []interface{}{},
		NeedsJudgment: map[string]interface{}{
			"reason": cause.Error(),
		},
	}
}

// ── Utility ───────────────────────────────────────────────────────────────────

// stringSet converts a string slice into a lookup map.
func stringSet(ss []string) map[string]bool {
	m := make(map[string]bool, len(ss))
	for _, s := range ss {
		m[s] = true
	}
	return m
}

// poolDirForMission returns the filesystem path of the pool directory for the
// given missionID. It respects the same convention as 'ateam pool init'.
func poolDirForMission(missionID string) string {
	return filepath.Join("/tmp", ".ateam-pool", missionID)
}

// ModeFromEnv detects native-teams vs legacy mode from the environment.
func ModeFromEnv() string {
	if os.Getenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS") == "1" {
		return "native-teams"
	}
	return "legacy"
}
