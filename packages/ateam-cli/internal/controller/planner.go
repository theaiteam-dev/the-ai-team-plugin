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
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Why        string   `json:"why"`
	ItemID     string   `json:"itemId,omitempty"`
	ItemTitle  string   `json:"itemTitle,omitempty"`
	Agent      string   `json:"agent,omitempty"`
	ToStage    string   `json:"toStage,omitempty"`   // set for "move" actions
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

	// ── 2. Health report (non-fatal — used for stale-claim recovery) ────────
	health, _ := p.fetchHealth()
	if health == nil {
		health = &healthData{}
	}

	// ── 3. Checkpoint (404 = no checkpoint yet — non-fatal) ───────────────
	checkpoint := p.fetchCheckpointOrEmpty(missionID)

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
		if err == nil {
			itemsByStage[stage] = items
		}
	}

	// ── 6. Pool observation (native-teams only) ───────────────────────────
	idleAgentCount := 0
	if mode == "native-teams" {
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)
		idleAgentCount = countIdleAgents(poolDir, "murdock")
	} else {
		// Legacy mode: no pool — treat as unlimited capacity.
		idleAgentCount = 1<<31 - 1
	}

	// ── 7. Compute dispatch actions ───────────────────────────────────────
	var actions []Action
	seq := nextSequence(checkpoint)

	readyItems := itemsByStage["ready"]
	dispatchable := filterDispatchable(readyItems, readySet)

	dispatched := 0
	for _, item := range dispatchable {
		if dispatched >= idleAgentCount {
			break
		}
		agentType := "murdock"
		actionID := buildActionID(missionID, item.ID, "dispatch", agentType, seq)
		why := fmt.Sprintf(
			"dispatch %s to %s — deps satisfied, lane free",
			item.ID, agentType,
		)
		actions = append(actions, Action{
			ID:        actionID,
			Kind:      "dispatch",
			Why:       why,
			ItemID:    item.ID,
			ItemTitle: item.Title,
			Agent:     agentType,
		})
		seq++
		dispatched++
	}

	// ── 7b. Setup-lane — ready items exist but pool is completely empty ──────
	// Emit one setup-lane action so Hannibal spawns the full pipeline quartet
	// (murdock-N, ba-N, lynch-N, amy-N) and marks them idle before the next tick.
	// Only fires when there are NO murdock files at all (not even busy) —
	// if agents are busy, work is in progress; wait for them instead of spawning a new lane.
	if mode == "native-teams" && len(dispatchable) > 0 && idleAgentCount == 0 && dispatched == 0 {
		poolDir := filepath.Join("/tmp", ".ateam-pool", missionID)
		if !anyMurdockExists(poolDir) {
			laneNum := nextLaneNumber(poolDir)
			instances := []string{
				fmt.Sprintf("murdock-%d", laneNum),
				fmt.Sprintf("ba-%d", laneNum),
				fmt.Sprintf("lynch-%d", laneNum),
				fmt.Sprintf("amy-%d", laneNum),
			}
			actionID := buildActionID(missionID, "lane", "setup-lane", fmt.Sprintf("lane-%d", laneNum), seq)
			actions = append(actions, Action{
				ID:         actionID,
				Kind:       "setup-lane",
				Why:        fmt.Sprintf("ready items exist (%d) but pool is empty — pre-warm lane %d", len(dispatchable), laneNum),
				LaneNumber: laneNum,
				Instances:  instances,
			})
			seq++
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
			agentType := stageInfo.Agent
			actionID := buildActionID(missionID, item.ID, "dispatch", agentType, seq)
			why := fmt.Sprintf(
				"orphan dispatch: %s in %s with no assigned agent — dispatching %s",
				item.ID, stageName, agentType,
			)
			actions = append(actions, Action{
				ID:        actionID,
				Kind:      "dispatch",
				Why:       why,
				ItemID:    item.ID,
				ItemTitle: item.Title,
				Agent:     agentType,
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

	if !hasNonDoneItems && hasDoneItems && finalReviewAbsent {
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
			_ = p.postActivityEntry(action)
		}
		_ = p.postCheckpoint(missionID, actions, checkpoint)
	}

	return plan, nil
}

// ── API data types ────────────────────────────────────────────────────────────

type missionData struct {
	ID          string      `json:"id"`
	State       string      `json:"state"`
	FinalReview interface{} `json:"finalReview"`
}

type depsData struct {
	ReadyItems   []string `json:"readyItems"`
	BlockedItems []interface{} `json:"blockedItems"`
}

type boardItem struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	StageID       string `json:"stageId"`
	Type          string `json:"type"`
	AssignedAgent string `json:"assignedAgent"`
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

func (p *Planner) fetchCheckpointOrEmpty(missionID string) checkpointData {
	var empty checkpointData
	path := "/api/controller-checkpoint/" + missionID
	body, err := p.fetchRaw(path)
	if err != nil {
		var httpErr *HTTPError
		if errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusNotFound {
			return empty // 404 = no checkpoint yet — return empty
		}
		return empty // other errors: use empty checkpoint
	}
	var envelope struct {
		Success bool           `json:"success"`
		Data    checkpointData `json:"data"`
	}
	_ = json.Unmarshal(body, &envelope)
	return envelope.Data
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
	ids := make([]string, 0, len(actions))
	for _, a := range actions {
		ids = append(ids, a.ID)
	}

	// Passthrough fields default to safe zero values when the existing
	// checkpoint was absent (404) — empty arrays/objects, cursor 0.
	confirmedActionIDs := existing.ConfirmedActionIDs
	if confirmedActionIDs == nil {
		confirmedActionIDs = []string{}
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
		"pendingActionIds":   ids,
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
	_, _ = io.ReadAll(resp.Body) // drain
	return nil
}

func (p *Planner) injectHeaders(req *http.Request) {
	if p.cfg.ProjectID != "" {
		req.Header.Set("X-Project-ID", p.cfg.ProjectID)
	}
}

// ── Pool observation ──────────────────────────────────────────────────────────

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
// exist in poolDir. If poolDir doesn't exist or is empty, returns 1.
func nextLaneNumber(poolDir string) int {
	for n := 1; n <= 16; n++ {
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
