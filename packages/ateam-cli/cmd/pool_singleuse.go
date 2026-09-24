package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ateam/internal/client"
)

// Single-use pool mode (issue #74).
//
// In the default (reuse) mode a completing agent's slot goes back to .idle and
// the same session takes the next item, so its context grows for the whole
// mission. In single-use mode the slot is retired instead: the marker is
// deleted, the used session is never claimed again, and agentStop reports how
// many fresh instances of that type the remaining board still needs
// (the "replenish" fact) so the orchestrator spawns replacements only while
// work is left.
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
	// WipLimit is the stage's WIP limit; nil means the stage is unlimited.
	WipLimit *int `json:"wipLimit"`
}

type boardSnapshot struct {
	Data struct {
		Stages []struct {
			ID       string `json:"id"`
			WipLimit *int   `json:"wipLimit"`
		} `json:"stages"`
		Items []struct {
			StageID string `json:"stageId"`
			Outputs struct {
				Test string `json:"test"`
			} `json:"outputs"`
		} `json:"items"`
	} `json:"data"`
}

// computeReplenish derives the replenish fact for the agent type role from a GET
// /api/board response and the current pool contents.
//
// demand = items not yet past the agent's stage (every stage before it), which
// each still need one instance of this type. NO_TEST_NEEDED items (empty
// outputs.test) skip testing, so they add no Murdock demand. Items already in
// the agent's own stage are held by busy instances and add nothing.
//
// count = demand - idle, bounded so idle+busy+count never exceeds the stage's
// WIP limit, and never negative. Busy instances do not satisfy demand: in
// single-use mode each one retires when it finishes, and its own agentStop
// recomputes the fact at that point.
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

	info := &replenishInfo{AgentType: role}
	for _, item := range snap.Data.Items {
		if !upstream[item.StageID] {
			continue
		}
		if role == "murdock" && strings.TrimSpace(item.Outputs.Test) == "" {
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

	count := info.Demand - info.Idle
	if info.WipLimit != nil {
		if room := *info.WipLimit - info.Idle - info.Busy; room < count {
			count = room
		}
	}
	if count < 0 {
		count = 0
	}
	info.Count = count
	return info, nil
}

// retireAndComputeReplenish retires agentName's slot and returns the replenish
// fact for its type. It returns nil, and leaves the slot to the deferred
// release, when the pool is not single-use or the agent is not a pipeline
// agent. A board fetch failure is reported on stderr and yields nil: the
// orchestrator treats a missing fact as "check the board yourself".
func retireAndComputeReplenish(c *client.Client, agentName string) *replenishInfo {
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
	poolSelfRelease(agentName)

	board, err := c.Do("GET", "/api/board", map[string]string{}, map[string]string{}, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "POOL_WARN: could not read the board to compute replenish for %s: %v\n", role, err)
		return nil
	}
	info, err := computeReplenish(board, poolDir, role)
	if err != nil {
		fmt.Fprintf(os.Stderr, "POOL_WARN: could not compute replenish for %s: %v\n", role, err)
		return nil
	}
	return info
}

// injectReplenish merges the replenish fact into the API response JSON.
func injectReplenish(resp []byte, info *replenishInfo) []byte {
	if info == nil {
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
	data["replenish"] = info
	out, err := json.Marshal(obj)
	if err != nil {
		return resp
	}
	return out
}
