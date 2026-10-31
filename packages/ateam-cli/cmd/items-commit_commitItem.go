package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"

	"github.com/spf13/cobra"

	"ateam/internal/client"
	"ateam/internal/itemcommit"
)

var commitItemID string

var itemsCommitCommitItemCmd = &cobra.Command{
	Use:   "commitItem",
	Short: "Re-run the item commit for an item sitting in staged",
	Long: `Re-runs the item commit for an item in the staged stage, so a failed
automatic commit (ITEM_COMMIT_FAILED) can be retried once its cause is fixed.

Items in any other stage are refused. When nothing is left to commit, the
command finds the newest commit reachable from HEAD whose "Item:" trailer is
exactly this item id and records its SHA on the board if the board differs.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json")
		c := client.NewClient(baseURL, os.Getenv("ATEAM_TOKEN"))
		cmd.SilenceUsage = true
		return runCommitItem(c, commitItemID, jsonMode, cmd.OutOrStdout(), cmd.ErrOrStderr())
	},
}

func init() {
	itemsCommitCommitItemCmd.Flags().StringVar(&commitItemID, "itemId", "", "Work item ID (e.g. WI-007)")
	_ = itemsCommitCommitItemCmd.MarkFlagRequired("itemId")
	itemsCommitCmd.AddCommand(itemsCommitCommitItemCmd)
}

type commitItemBoardItem struct {
	Stage     string `json:"stageId"`
	CommitSha string `json:"commitSha"`
}

func runCommitItem(c *client.Client, itemID string, jsonMode bool, stdout, stderr io.Writer) error {
	item, err := fetchCommitItem(c, itemID)
	if err != nil {
		return err
	}
	if item.Stage != stagedStage {
		return fmt.Errorf("item %s is in stage %q; only items in %q can be committed", itemID, item.Stage, stagedStage)
	}
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}

	res, runErr := itemcommit.Run(itemcommit.Options{Client: c, ItemID: itemID, Agent: "items-commit", Dir: cwd})
	if runErr != nil {
		return reportCommitItemFailure(c, itemID, res.SHA, runErr, jsonMode, stdout, stderr)
	}
	if res.SHA != "" {
		return printCommitItem(stdout, jsonMode, itemCommitReport{Committed: true, SHA: res.SHA})
	}

	out, err := recoverCommitSha(c, itemID, cwd, item.CommitSha)
	if err != nil {
		return reportCommitItemFailure(c, itemID, "", err, jsonMode, stdout, stderr)
	}
	return printCommitItem(stdout, jsonMode, out)
}

func fetchCommitItem(c *client.Client, itemID string) (commitItemBoardItem, error) {
	raw, err := c.Do("GET", "/api/items/{id}", map[string]string{"id": itemID}, nil, nil)
	if err != nil {
		return commitItemBoardItem{}, fmt.Errorf("fetch item %s: %w", itemID, err)
	}
	var env struct {
		Data commitItemBoardItem `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return commitItemBoardItem{}, fmt.Errorf("decode item %s: %w", itemID, err)
	}
	return env.Data, nil
}

// recoverCommitSha handles a tree with nothing left to commit. If an earlier
// commit for this item landed but its SHA never reached the board, it records
// that SHA; otherwise nothing changes.
func recoverCommitSha(c *client.Client, itemID, dir, boardSha string) (itemCommitReport, error) {
	root, err := itemcommit.RepoRoot(dir)
	if err != nil {
		return itemCommitReport{}, err
	}
	sha, err := newestItemCommit(root, itemID)
	if err != nil {
		return itemCommitReport{}, err
	}
	if sha == "" || sha == boardSha {
		return itemCommitReport{NoChanges: true}, nil
	}
	if _, err := c.Do("PATCH", "/api/items/{id}", map[string]string{"id": itemID}, nil, map[string]any{"commitSha": sha}); err != nil {
		return itemCommitReport{}, fmt.Errorf("found commit %s but recording commitSha failed: %w", sha, err)
	}
	return itemCommitReport{Committed: true, SHA: sha}, nil
}

// newestItemCommit returns the newest commit reachable from HEAD whose Item:
// trailer equals itemID exactly, or "" when there is none.
func newestItemCommit(root, itemID string) (string, error) {
	pattern := "^Item: " + regexp.QuoteMeta(itemID) + "$"
	cmd := exec.Command("git", "-C", root, "log", "-E", "--grep="+pattern,
		"--format=%H%x09%(trailers:key=Item,valueonly,separator=%x09)")
	raw, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return "", fmt.Errorf("git log: %w: %s", err, strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("git log: %w", err)
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Split(strings.TrimRight(line, "\r"), "\t")
		if len(fields) < 2 {
			continue
		}
		for _, trailer := range fields[1:] {
			if strings.TrimSpace(trailer) == itemID {
				return fields[0], nil
			}
		}
	}
	return "", nil
}

func reportCommitItemFailure(c *client.Client, itemID, sha string, cause error, jsonMode bool, stdout, stderr io.Writer) error {
	fmt.Fprintf(stderr, "ITEM_COMMIT_FAILED: %s: %v. ALERT Hannibal; fix the cause and re-run `ateam items-commit commitItem --itemId %s`.\n", itemID, cause, itemID)
	activity := map[string]any{
		"agent":   "items-commit",
		"message": fmt.Sprintf("ITEM_COMMIT_FAILED for %s: %v", itemID, cause),
		"level":   "error",
	}
	if _, err := c.Do("POST", "/api/activity", nil, nil, activity); err != nil {
		fmt.Fprintf(stderr, "could not log the failure to the activity feed: %v\n", err)
	}
	if jsonMode {
		_ = printCommitItem(stdout, true, itemCommitReport{SHA: sha, Error: cause.Error()})
	}
	return fmt.Errorf("item commit failed for %s: %w", itemID, cause)
}

func printCommitItem(w io.Writer, jsonMode bool, out itemCommitReport) error {
	if jsonMode {
		return json.NewEncoder(w).Encode(out)
	}
	if out.Committed {
		_, err := fmt.Fprintf(w, "Committed %s\n", out.SHA)
		return err
	}
	_, err := fmt.Fprintln(w, "Nothing to commit")
	return err
}
