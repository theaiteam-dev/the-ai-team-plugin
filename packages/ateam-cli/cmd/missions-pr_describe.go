package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"ateam/internal/client"
	"ateam/internal/itemcommit"
)

type prMission struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	PRDPath string `json:"prdPath"`
}

type prDescribeItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	CommitSha string `json:"commitSha"`
}

var whitespaceRun = regexp.MustCompile(`\s+`)

// flattenLine collapses every whitespace run (including CR and LF) to a single
// space so untrusted text can never start a new line in the description.
func flattenLine(s string) string {
	return strings.TrimSpace(whitespaceRun.ReplaceAllString(s, " "))
}

var missionsPrDescribeCmd = &cobra.Command{
	Use:   "describe",
	Short: "Write the mission PR title and description to .qa-evidence/<missionId>/pr-description.md",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		c := client.NewClient(baseURL, os.Getenv("ATEAM_TOKEN"))

		cwd, err := os.Getwd()
		if err != nil {
			return err
		}
		root, err := itemcommit.RepoRoot(cwd)
		if err != nil {
			return err
		}
		mission, err := fetchCurrentMission(c)
		if err != nil {
			return err
		}
		items, err := fetchMissionItems(c, mission.ID)
		if err != nil {
			return err
		}

		evidenceDir := filepath.Join(root, ".qa-evidence", mission.ID)
		checklist, frankieRan := readFrankieChecklist(evidenceDir)
		summary := readPRDSummary(root, mission.PRDPath)
		if summary == "" {
			summary = fallbackSummary(readPRDHeading(root, mission.PRDPath), mission.Name, len(items))
		}
		doc := buildPRDescription(mission, items, summary, checklist, frankieRan)

		path := filepath.Join(evidenceDir, "pr-description.md")
		if err := writeFileAtomic(path, doc); err != nil {
			return err
		}
		if jsonMode, _ := cmd.Root().PersistentFlags().GetBool("json"); jsonMode {
			return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]string{
				"path":  path,
				"title": flattenLine(mission.Name),
			})
		}
		fmt.Fprintln(cmd.OutOrStdout(), path)
		return nil
	},
}

// readPRDHeading returns the text of the PRD's first "# " heading, or "" when
// the PRD is missing or has none.
func readPRDHeading(root, prdPath string) string {
	if prdPath == "" {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(root, prdPath))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if t := strings.TrimSpace(line); strings.HasPrefix(t, "# ") {
			return flattenLine(strings.TrimPrefix(t, "# "))
		}
	}
	return ""
}

// fallbackSummary builds a one-line summary when the PRD has no Executive
// Summary. The subject is embedded mid-sentence and flattened so untrusted
// text can never start a line (and so never forge a trailer).
func fallbackSummary(heading, missionName string, itemCount int) string {
	subject := flattenLine(heading)
	if subject == "" {
		subject = flattenLine(missionName)
	}
	noun := "work items"
	if itemCount == 1 {
		noun = "work item"
	}
	return flattenLine(fmt.Sprintf("Delivers %s in %d %s.", subject, itemCount, noun))
}

func fetchCurrentMission(c *client.Client) (prMission, error) {
	resp, err := c.Do("GET", "/api/missions/current", map[string]string{}, map[string]string{}, nil)
	if err != nil {
		return prMission{}, err
	}
	var env struct {
		Data *prMission `json:"data"`
	}
	if err := json.Unmarshal(resp, &env); err != nil {
		return prMission{}, fmt.Errorf("parsing current mission: %w", err)
	}
	if env.Data == nil || env.Data.ID == "" {
		return prMission{}, errors.New("no current mission")
	}
	if err := validateMissionID(env.Data.ID); err != nil {
		return prMission{}, err
	}
	return *env.Data, nil
}

func fetchMissionItems(c *client.Client, missionID string) ([]prDescribeItem, error) {
	resp, err := c.Do("GET", "/api/items", map[string]string{}, map[string]string{"missionId": missionID}, nil)
	if err != nil {
		return nil, err
	}
	var env struct {
		Data []prDescribeItem `json:"data"`
	}
	if err := json.Unmarshal(resp, &env); err != nil {
		return nil, fmt.Errorf("parsing mission items: %w", err)
	}
	sort.SliceStable(env.Data, func(i, j int) bool {
		return itemNumber(env.Data[i].ID) < itemNumber(env.Data[j].ID)
	})
	return env.Data, nil
}

func itemNumber(id string) int {
	n, err := strconv.Atoi(id[strings.LastIndex(id, "-")+1:])
	if err != nil {
		return int(^uint(0) >> 1)
	}
	return n
}

// readPRDSummary returns the paragraph under "## Executive Summary", or ""
// when the PRD is missing or has no such section.
func readPRDSummary(root, prdPath string) string {
	if prdPath == "" {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(root, prdPath))
	if err != nil {
		return ""
	}
	var para []string
	inSection := false
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case !inSection:
			inSection = strings.EqualFold(trimmed, "## Executive Summary")
		case strings.HasPrefix(trimmed, "#"):
			return flattenLine(strings.Join(para, " "))
		case trimmed == "" && len(para) > 0:
			return flattenLine(strings.Join(para, " "))
		case trimmed != "":
			para = append(para, trimmed)
		}
	}
	return flattenLine(strings.Join(para, " "))
}

// readFrankieChecklist returns the checklist lines of Frankie's report and
// whether the report exists.
func readFrankieChecklist(evidenceDir string) ([]string, bool) {
	data, err := os.ReadFile(filepath.Join(evidenceDir, "report.md"))
	if err != nil {
		return nil, false
	}
	var lines []string
	for _, line := range strings.Split(string(data), "\n") {
		if t := strings.TrimSpace(line); isChecklistLine(t) {
			lines = append(lines, flattenLine(t))
		}
	}
	return lines, true
}

// isChecklistLine matches "- [x] ..." list entries and table rows that carry a
// result marker. Table headers and separator rows carry no marker.
func isChecklistLine(line string) bool {
	if strings.HasPrefix(line, "- [") {
		return true
	}
	return strings.HasPrefix(line, "|") && strings.ContainsAny(line, "✅❌⚠")
}

func buildPRDescription(m prMission, items []prDescribeItem, summary string, checklist []string, frankieRan bool) string {
	var b strings.Builder
	b.WriteString(flattenLine(m.Name) + "\n\n")
	if summary != "" {
		b.WriteString(summary + "\n\n")
	}
	b.WriteString("## Items\n\n")
	for _, it := range items {
		sha := flattenLine(it.CommitSha)
		if sha == "" {
			sha = "no commit"
		}
		fmt.Fprintf(&b, "- %s %s (%s)\n", flattenLine(it.ID), flattenLine(it.Title), sha)
	}
	b.WriteString("\n## Frankie\n\n")
	if frankieRan {
		for _, line := range checklist {
			b.WriteString(line + "\n")
		}
	} else {
		b.WriteString("Frankie did not run for this mission.\n")
	}
	b.WriteString("\nMission: " + m.ID + "\nPRD: " + itemcommit.PRDSlug(m.PRDPath) + "\n")
	return b.String()
}

// writeFileAtomic writes to a temp file in the target directory and renames
// it into place, so a failure never leaves a half-written description.
func writeFileAtomic(path, content string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".pr-description-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func init() {
	missionsPrCmd.AddCommand(missionsPrDescribeCmd)
}
