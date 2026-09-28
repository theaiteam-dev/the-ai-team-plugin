package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"ateam/internal/client"
)

// Single-use pool mode (issue #74).
//
// In the default (reuse) mode a completing agent's slot goes back to .idle and
// the same session takes the next item, so its context grows for the whole
// mission. In single-use mode an instance only ever works one item. When it
// finishes, its marker is parked for that item (<instance>.parked-<itemId>)
// instead of returning to idle: a rejection of the same item routes back to
// the parked session, which already has the item's files in context, and no
// other item can claim it. When the item leaves the pipeline (staged, done, or
// blocked), agentStop deletes every parked marker for it and reports those
// instances in data.retire so the orchestrator shuts them down. agentStop also
// reports how many fresh instances of the completing agent's type the
// remaining board still needs (the "replenish" fact), so the orchestrator
// spawns replacements only while work is left.
//
// The mode lives in a file inside the pool dir, not an env var: pipeline agent
// shells routinely lose exported variables between Bash calls, and a mode that
// silently fell back to reuse would be invisible.

// singleUseMarker is the mode file written by `ateam pool init --single-use`.
// It carries no .idle/.busy suffix, so scanPool and claimIdleInstance ignore it.
const singleUseMarker = "single-use.mode"

// poolIsSingleUse reports whether the pool at poolDir runs in single-use mode.
func poolIsSingleUse(poolDir string) bool {
	_, err := os.Stat(filepath.Join(poolDir, singleUseMarker))
	return err == nil
}

// lanesMarker is the file written by `ateam pool init --single-use --lanes N`
// that records the configured lane count N — the memory- and dep-graph-bound
// concurrency limit `ateam scaling compute` derives, independent of any
// stage's WIP limit. computeReplenish reads it to cap replenish counts: a
// stage's default WIP limit (3) can otherwise let replenish spawn more
// instances than the mission's memory budget allows when N is smaller (e.g.
// N=1). Absent or unparseable means "no lane cap."
const lanesMarker = "single-use.lanes"

// poolLanes reads the configured lane count from poolDir, or 0 when absent
// or unparseable (no cap — the pre-existing behavior).
func poolLanes(poolDir string) int {
	content, err := os.ReadFile(filepath.Join(poolDir, lanesMarker))
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(content)))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// writeLanes records the configured lane count N in poolDir. n<=0 removes any
// existing marker, restoring "no cap."
func writeLanes(poolDir string, n int) error {
	path := filepath.Join(poolDir, lanesMarker)
	if n <= 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return os.WriteFile(path, []byte(strconv.Itoa(n)+"\n"), 0644)
}

// Pool modes reported to agents as data.poolMode on every agentStop response,
// so an agent learns the mode from the response instead of assuming it.
const (
	poolModeSingleUse = "single-use"
	poolModeReuse     = "reuse"
)

// currentPoolMode reports the mode of the current mission's pool, or "" when
// ATEAM_MISSION_ID is unset or the mission has no pool directory.
func currentPoolMode() string {
	missionID := os.Getenv("ATEAM_MISSION_ID")
	if missionID == "" {
		return ""
	}
	poolDir := filepath.Join("/tmp/.ateam-pool", filepath.Base(missionID))
	if info, err := os.Stat(poolDir); err != nil || !info.IsDir() {
		return ""
	}
	if poolIsSingleUse(poolDir) {
		return poolModeSingleUse
	}
	return poolModeReuse
}

// injectPoolMode merges data.poolMode into the API response JSON.
func injectPoolMode(resp []byte, mode string) []byte {
	if mode == "" {
		return resp
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(resp, &obj); err != nil {
		return resp
	}
	data, _ := obj["data"].(map[string]interface{})
	if data == nil {
		data = map[string]interface{}{}
		obj["data"] = data
	}
	data["poolMode"] = mode
	out, err := json.Marshal(obj)
	if err != nil {
		return resp
	}
	return out
}

// agentStage maps a pipeline agent type to the stage it works in.
var agentStage = map[string]string{
	"murdock": "testing",
	"ba":      "implementing",
	"lynch":   "review",
	"amy":     "probing",
}

// stageAgent is the inverse of agentStage, used to pick the rework agent for a
// rejection's return stage.
var stageAgent = map[string]string{
	"testing":      "murdock",
	"implementing": "ba",
	"review":       "lynch",
	"probing":      "amy",
}

// pipelineStageOrder lists the per-item stages that still lead to future
// pipeline work, in order. Items in staged, done, or blocked create no demand.
var pipelineStageOrder = []string{"briefings", "ready", "testing", "implementing", "review", "probing"}

// replenishInfo is the fact agentStop reports in single-use mode: how many
// fresh instances of the retiring agent's type the orchestrator should spawn.
type replenishInfo struct {
	AgentType string `json:"agentType"`
	Count     int    `json:"count"`
	Demand    int    `json:"demand"`
	Idle      int    `json:"idle"`
	Busy      int    `json:"busy"`
	// Parked counts upstream items that will return to an instance of this
	// type already parked for them, so they add no demand.
	Parked int `json:"parked"`
	// WipLimit is the stage's WIP limit; nil means the stage is unlimited.
	WipLimit *int `json:"wipLimit"`
	// Lanes is the configured lane count from `pool init --single-use --lanes`
	// (0/omitted means no cap was configured). Present so the fact explains
	// itself when it bounds Count below what Demand/WipLimit alone would allow.
	Lanes int `json:"lanes,omitempty"`
}

type boardSnapshot struct {
	Data struct {
		Stages []struct {
			ID       string `json:"id"`
			WipLimit *int   `json:"wipLimit"`
		} `json:"stages"`
		Items []struct {
			ID           string   `json:"id"`
			StageID      string   `json:"stageId"`
			Dependencies []string `json:"dependencies"`
			Outputs      struct {
				Test string `json:"test"`
			} `json:"outputs"`
		} `json:"items"`
	} `json:"data"`
}

// computeReplenish derives the replenish fact for the agent type role from a GET
// /api/board response and the current pool contents.
//
// demand = items not yet past the agent's stage (every stage before it) that
// can be worked now, each of which still needs one instance of this type. A
// briefings item counts only once every dependency has reached staged or done
// (a dependency missing from the board is treated as done); until then it
// cannot enter the pipeline and a spawned instance would sit idle. Items with
// an instance of this type already parked for them add nothing, since their
// rework returns to that instance. NO_TEST_NEEDED items (empty outputs.test)
// skip testing, so they add no Murdock demand. Items already in the agent's
// own stage are held by busy instances and add nothing.
//
// count = demand - idle, bounded so idle+busy+count never exceeds the stage's
// WIP limit, and never negative. Busy instances do not satisfy demand: in
// single-use mode each one retires when it finishes, and its own agentStop
// recomputes the fact at that point.
//
// count is additionally bounded so idle+busy+count never exceeds the pool's
// configured lane count N (from `pool init --single-use --lanes`), when N is
// set. A stage's WIP limit alone is not enough: the default WIP limit (3) is
// independent of N, so with N=1 a naive demand-minus-idle count could report
// spawning far more instances than the mission's memory budget allows. The
// lane cap is read fresh from poolDir on every call, so it also protects
// against a second agentStop landing while an earlier count's replacement is
// still starting — the earlier one's spawned-but-not-yet-.busy instance isn't
// visible to scanPool, so recomputing (e.g. via `ateam pool replenish`)
// immediately before each spawn is what keeps concurrent stops from both
// reporting the same headroom.
func computeReplenish(board []byte, poolDir, role string) (*replenishInfo, error) {
	stage, ok := agentStage[role]
	if !ok {
		return nil, fmt.Errorf("no pipeline stage for agent type %q", role)
	}
	var snap boardSnapshot
	if err := json.Unmarshal(board, &snap); err != nil {
		return nil, fmt.Errorf("parse board: %w", err)
	}

	upstream := map[string]bool{}
	for _, s := range pipelineStageOrder {
		if s == stage {
			break
		}
		upstream[s] = true
	}

	stageOf := map[string]string{}
	for _, item := range snap.Data.Items {
		stageOf[item.ID] = item.StageID
	}
	parked := parkedItemsForRole(poolDir, role)

	info := &replenishInfo{AgentType: role}
	for _, item := range snap.Data.Items {
		if !upstream[item.StageID] {
			continue
		}
		if role == "murdock" && strings.TrimSpace(item.Outputs.Test) == "" {
			continue
		}
		if item.StageID == "briefings" && !depsSatisfied(item.Dependencies, stageOf) {
			continue
		}
		if parked[item.ID] {
			info.Parked++
			continue
		}
		info.Demand++
	}
	for _, s := range snap.Data.Stages {
		if s.ID == stage {
			info.WipLimit = s.WipLimit
		}
	}

	idle, busy, err := scanPool(poolDir)
	if err != nil {
		return nil, err
	}
	for _, n := range idle {
		if agentType(n) == role {
			info.Idle++
		}
	}
	for _, n := range busy {
		if agentType(n) == role {
			info.Busy++
		}
	}

	lanes := poolLanes(poolDir)
	if lanes > 0 {
		info.Lanes = lanes
	}

	count := info.Demand - info.Idle
	if info.WipLimit != nil {
		if room := *info.WipLimit - info.Idle - info.Busy; room < count {
			count = room
		}
	}
	if lanes > 0 {
		if room := lanes - info.Idle - info.Busy; room < count {
			count = room
		}
	}
	if count < 0 {
		count = 0
	}
	info.Count = count
	return info, nil
}

// depsSatisfied reports whether every dependency has reached staged or done.
// A dependency absent from the board (completed items can be omitted, or it
// belongs to an archived mission) counts as satisfied.
func depsSatisfied(deps []string, stageOf map[string]string) bool {
	for _, d := range deps {
		if st, ok := stageOf[d]; ok && st != "staged" && st != "done" {
			return false
		}
	}
	return true
}

// parkedSuffix separates an instance name from the item it is parked for:
// "ba-3.parked-WI-007". scanPool ignores it, so a parked instance is never
// claimed for another item.
const parkedSuffix = ".parked-"

// leavesPipeline lists the stages after which an item needs no more lane work.
var leavesPipeline = map[string]bool{"staged": true, "done": true, "blocked": true}

// retiredInstance names an instance the orchestrator should shut down.
type retiredInstance struct {
	Instance string `json:"instance"`
	AgentID  string `json:"agentId,omitempty"`
}

// itemIDPattern bounds item ids used in pool file names and glob patterns.
var itemIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// validItemID guards item ids used in pool file names.
func validItemID(id string) bool {
	return itemIDPattern.MatchString(id)
}

// parkedItemsForRole returns the item ids that have an instance of role
// parked for them.
func parkedItemsForRole(poolDir, role string) map[string]bool {
	out := map[string]bool{}
	for instance, item := range scanParked(poolDir) {
		if agentType(instance) == role {
			out[item] = true
		}
	}
	return out
}

// scanParked maps each parked instance in poolDir to the item it is parked for.
func scanParked(poolDir string) map[string]string {
	out := map[string]string{}
	entries, err := os.ReadDir(poolDir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if i := strings.Index(e.Name(), parkedSuffix); i > 0 {
			out[e.Name()[:i]] = e.Name()[i+len(parkedSuffix):]
		}
	}
	return out
}

// parkForItem moves agentName's .busy marker to .parked-<itemID>, keeping its
// content (the agentId). An agent with no .busy marker is parked with an empty
// agentId, so its item's rework can still find it by name.
func parkForItem(poolDir, agentName, itemID string) error {
	busyFile := filepath.Join(poolDir, agentName+".busy")
	parkedFile := filepath.Join(poolDir, agentName+parkedSuffix+itemID)
	err := os.Rename(busyFile, parkedFile)
	if os.IsNotExist(err) {
		return os.WriteFile(parkedFile, nil, 0644)
	}
	return err
}

// claimParkedForItem claims the instance of role parked for itemID by moving
// its marker to .busy. It returns "" when none is parked for that item.
func claimParkedForItem(poolDir, role, itemID string) (instance, agentID string) {
	if !validItemID(itemID) {
		return "", ""
	}
	var candidates []string
	for _, pattern := range []string{role + parkedSuffix + itemID, role + "-*" + parkedSuffix + itemID} {
		matches, _ := filepath.Glob(filepath.Join(poolDir, pattern))
		candidates = append(candidates, matches...)
	}
	for _, parkedFile := range candidates {
		base := strings.TrimSuffix(filepath.Base(parkedFile), parkedSuffix+itemID)
		busyFile := filepath.Join(poolDir, base+".busy")
		if err := os.Rename(parkedFile, busyFile); err == nil {
			id := ""
			if content, readErr := os.ReadFile(busyFile); readErr == nil {
				id = strings.TrimSpace(string(content))
			}
			return base, id
		}
	}
	return "", ""
}

// retireParkedForItem deletes every marker parked for itemID and returns the
// instances it retired.
func retireParkedForItem(poolDir, itemID string) []retiredInstance {
	var out []retiredInstance
	if !validItemID(itemID) {
		return out
	}
	matches, _ := filepath.Glob(filepath.Join(poolDir, "*"+parkedSuffix+itemID))
	for _, parkedFile := range matches {
		content, _ := os.ReadFile(parkedFile)
		if err := os.Remove(parkedFile); err != nil {
			fmt.Fprintf(os.Stderr, "POOL_WARN: failed to retire %s: %v\n", filepath.Base(parkedFile), err)
			continue
		}
		out = append(out, retiredInstance{
			Instance: strings.TrimSuffix(filepath.Base(parkedFile), parkedSuffix+itemID),
			AgentID:  strings.TrimSpace(string(content)),
		})
	}
	return out
}

// singleUseResult is what agentStop adds to its response in a single-use pool.
type singleUseResult struct {
	replenish *replenishInfo
	// parkedFor is the item the completing agent is now parked for ("" when it
	// retired instead).
	parkedFor string
	// retire lists every instance this agentStop retired, the completing agent
	// included, for the orchestrator to shut down.
	retire []retiredInstance
}

// settleSingleUse parks or retires the completing agent and computes the
// replenish fact for its type. nextStage is the stage the API reports the item
// moved to ("" when it did not move). While the item is still in the pipeline
// the agent parks for it; once the item reaches staged, done, or blocked, the
// agent and every instance parked for the item retire. An invalid or missing
// item id falls back to retiring the agent.
//
// It returns nil, and leaves the slot to the deferred release, when the pool
// is not single-use or the agent is not a pipeline agent. A board fetch
// failure is reported on stderr and leaves replenish nil: the orchestrator
// treats a missing fact as "check the board yourself".
func settleSingleUse(c *client.Client, agentName, itemID, nextStage string) *singleUseResult {
	missionID := os.Getenv("ATEAM_MISSION_ID")
	if missionID == "" || agentName == "" {
		return nil
	}
	poolDir := filepath.Join("/tmp/.ateam-pool", filepath.Base(missionID))
	if !poolIsSingleUse(poolDir) {
		return nil
	}
	role := agentType(agentName)
	if _, ok := agentStage[role]; !ok {
		return nil
	}

	res := &singleUseResult{}
	inPipeline := validItemID(itemID) && !leavesPipeline[nextStage]
	if inPipeline {
		if err := parkForItem(poolDir, agentName, itemID); err != nil {
			fmt.Fprintf(os.Stderr, "POOL_WARN: failed to park %s for %s: %v\n", agentName, itemID, err)
		} else {
			res.parkedFor = itemID
		}
	}
	if res.parkedFor == "" {
		self := retiredInstance{Instance: agentName}
		if content, err := os.ReadFile(filepath.Join(poolDir, agentName+".busy")); err == nil {
			self.AgentID = strings.TrimSpace(string(content))
		}
		poolSelfRelease(agentName)
		res.retire = []retiredInstance{self}
		// Only retire the rest of the item's parked set when the item has
		// actually left the pipeline. A transient parking failure (e.g. a
		// permission error on rename) for an item that still needs rework
		// must not retire instances parked for it by earlier stages — they
		// still have the item's context and the item still needs them.
		if !inPipeline {
			res.retire = append(res.retire, retireParkedForItem(poolDir, itemID)...)
		}
	}

	board, err := c.Do("GET", "/api/board", map[string]string{}, map[string]string{}, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "POOL_WARN: could not read the board to compute replenish for %s: %v\n", role, err)
		return res
	}
	info, err := computeReplenish(board, poolDir, role)
	if err != nil {
		fmt.Fprintf(os.Stderr, "POOL_WARN: could not compute replenish for %s: %v\n", role, err)
		return res
	}
	res.replenish = info
	return res
}

// injectSingleUse merges replenish, parkedFor, and retire into the API
// response JSON.
func injectSingleUse(resp []byte, res *singleUseResult) []byte {
	if res == nil {
		return resp
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(resp, &obj); err != nil {
		return resp
	}
	data, _ := obj["data"].(map[string]interface{})
	if data == nil {
		data = map[string]interface{}{}
		obj["data"] = data
	}
	if res.replenish != nil {
		data["replenish"] = res.replenish
	}
	if res.parkedFor != "" {
		data["parkedFor"] = res.parkedFor
	}
	if len(res.retire) > 0 {
		data["retire"] = res.retire
	}
	out, err := json.Marshal(obj)
	if err != nil {
		return resp
	}
	return out
}
