package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"ateam/internal/client"
	"ateam/internal/itemcommit"
)

const stagedStage = "staged"

// itemCommitReport is the data.itemCommit object added to the move response.
type itemCommitReport struct {
	Committed bool   `json:"committed"`
	SHA       string `json:"sha,omitempty"`
	NoChanges bool   `json:"noChanges,omitempty"`
	// Recorded is true when the commitSha reached the board. A report with a
	// sha and Recorded false means the commit exists but was not recorded.
	Recorded bool     `json:"recorded,omitempty"`
	Error    string   `json:"error,omitempty"`
	Paths    []string `json:"-"` // committed paths, used only for the recovery note
}

// commitStagedItem runs itemcommit.Run exactly once for an item the API has
// just confirmed in "staged". It never returns an error: a failed commit is
// reported in the result, on stderr (ITEM_COMMIT_FAILED) and in the activity
// feed, and must not change the caller's exit code (ADR 0011).
func commitStagedItem(c *client.Client, itemID, agent string) itemCommitReport {
	dir, err := os.Getwd()
	if err != nil {
		return reportItemCommitFailure(c, itemID, agent, itemCommitReport{Error: fmt.Sprintf("resolve working directory: %v", err)})
	}
	res, err := itemcommit.Run(itemcommit.Options{Client: c, ItemID: itemID, Agent: agent, Dir: dir})
	if err != nil {
		return reportItemCommitFailure(c, itemID, agent, itemCommitReport{SHA: res.SHA, Recorded: res.Recorded, Paths: res.Paths, Error: err.Error()})
	}
	return itemCommitReport{Committed: res.SHA != "", SHA: res.SHA, Recorded: res.Recorded, NoChanges: res.NoChanges}
}

// itemCommitNote says what state a failed commit left behind. It is empty when
// no commit was made. When the commitSha was recorded, the failure was the index
// refresh, which only `git reset` fixes; otherwise commitItem records the sha.
func itemCommitNote(report itemCommitReport) string {
	if report.SHA == "" {
		return ""
	}
	if report.Recorded {
		return fmt.Sprintf(" (commit %s exists and its commitSha was recorded; the index refresh failed, run `git reset -q -- %s`)", report.SHA, shellJoin(report.Paths))
	}
	return fmt.Sprintf(" (commit %s exists; its commitSha was not recorded)", report.SHA)
}

// shellJoin joins args for display, single-quoting any that a shell would split or expand.
func shellJoin(args []string) string {
	parts := make([]string, len(args))
	for i, a := range args {
		if a != "" && strings.Trim(a, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/-+=,:@%") == "" {
			parts[i] = a
		} else {
			parts[i] = "'" + strings.ReplaceAll(a, "'", `'\''`) + "'"
		}
	}
	return strings.Join(parts, " ")
}

func reportItemCommitFailure(c *client.Client, itemID, agent string, report itemCommitReport) itemCommitReport {
	report.Committed = false
	shaNote := itemCommitNote(report)
	fmt.Fprintf(os.Stderr, "\nITEM_COMMIT_FAILED: %s: %s%s — send ALERT to Hannibal; the item stays in staged.\n", itemID, report.Error, shaNote)

	if agent == "" {
		agent = "ateam"
	}
	message := fmt.Sprintf("ITEM_COMMIT_FAILED for %s: %s%s", itemID, report.Error, shaNote)
	body := map[string]interface{}{"agent": agent, "level": "error", "message": message}
	if _, err := c.Do("POST", "/api/activity", nil, nil, body); err != nil {
		fmt.Fprintf(os.Stderr, "ACTIVITY_WARN: could not record item commit failure for %s: %v\n", itemID, err)
	}
	return report
}

// injectItemCommit merges the report into resp's data object.
func injectItemCommit(resp []byte, report itemCommitReport) []byte {
	var obj map[string]interface{}
	if err := json.Unmarshal(resp, &obj); err != nil {
		return resp
	}
	data, _ := obj["data"].(map[string]interface{})
	if data == nil {
		data = map[string]interface{}{}
		obj["data"] = data
	}
	data["itemCommit"] = report
	out, err := json.Marshal(obj)
	if err != nil {
		return resp
	}
	return out
}

// commitIfStaged commits the item and adds data.itemCommit to resp when the
// move the API just confirmed targeted staged; any other target leaves resp
// untouched. The agent recorded on a failure is the caller, which for a direct
// move is the orchestrator.
func commitIfStaged(c *client.Client, resp []byte, toStage, itemID string) []byte {
	if toStage != stagedStage || itemID == "" {
		return resp
	}
	return injectItemCommit(resp, commitStagedItem(c, itemID, "Hannibal"))
}
