package itemcommit

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// CommitItem is the slice of a work item a commit message needs.
type CommitItem struct {
	ID, Title, Type string
}

// WorkLogEntry is one work log row. Timestamp is RFC3339; Action is
// started|completed|rejected|note.
type WorkLogEntry struct {
	Agent, Action, Timestamp string
}

var typePrefixes = map[string]string{
	"feature":     "feat",
	"enhancement": "feat",
	"bug":         "fix",
	"task":        "chore",
}

// PRDSlug returns the PRD file's base name without its final extension.
func PRDSlug(prdPath string) string {
	base := filepath.Base(prdPath)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

// BuildMessage builds an item commit message: Conventional Commits subject,
// optional undeclared-paths body, and Item/Mission/PRD/Lanes trailers as the
// final paragraph. It never emits Co-authored-by.
func BuildMessage(item CommitItem, workLog []WorkLogEntry, missionID, prdPath string, undeclared []string) (string, error) {
	prefix, ok := typePrefixes[item.Type]
	if !ok {
		return "", fmt.Errorf("unknown item type %q for %s", item.Type, item.ID)
	}
	lanes, err := lanesFrom(workLog)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	b.WriteString(prefix + ": " + item.Title + "\n\n")
	if len(undeclared) > 0 {
		b.WriteString("Undeclared paths included:\n- " + strings.Join(undeclared, "\n- ") + "\n\n")
	}
	b.WriteString("Item: " + item.ID + "\n")
	b.WriteString("Mission: " + missionID + "\n")
	b.WriteString("PRD: " + PRDSlug(prdPath) + "\n")
	b.WriteString("Lanes: " + lanes)
	return b.String(), nil
}

type datedEntry struct {
	entry WorkLogEntry
	at    time.Time
}

func lanesFrom(workLog []WorkLogEntry) (string, error) {
	dated := make([]datedEntry, 0, len(workLog))
	for _, e := range workLog {
		if e.Action != "completed" && e.Action != "rejected" {
			continue
		}
		at, err := time.Parse(time.RFC3339, e.Timestamp)
		if err != nil {
			return "", fmt.Errorf("work log entry for %s has invalid timestamp %q: %w", e.Agent, e.Timestamp, err)
		}
		dated = append(dated, datedEntry{e, at})
	}
	sort.SliceStable(dated, func(i, j int) bool { return dated[i].at.Before(dated[j].at) })

	agents := make([]string, len(dated))
	for i, d := range dated {
		agents[i] = d.entry.Agent
	}
	return strings.Join(agents, " "), nil
}
