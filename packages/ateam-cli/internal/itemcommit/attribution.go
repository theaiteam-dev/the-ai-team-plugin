package itemcommit

import (
	"sort"
	"strings"
)

// Item is a mission work item as seen by attribution.
type Item struct {
	ID      string
	Stage   string
	Outputs []string
}

// Input is everything Attribute needs to decide which changed paths belong in
// an item's commit.
type Input struct {
	Changed  []string
	Self     Item
	Others   []Item
	Baseline []string
}

// Result lists the paths to commit plus the two report-only lists.
type Result struct {
	Paths           []string
	Undeclared      []string
	ChangedBaseline []string
}

var reservedPrefixes = []string{".qa-evidence/", "specs/"}

var terminalStages = map[string]bool{"staged": true, "done": true, "archived": true}

// Attribute returns the changed paths the staging item should commit: its own
// declared outputs and paths no unfinished item declares. Baseline paths are
// never committed. Reserved paths (.qa-evidence/, specs/) are left for Tawnia
// unless the item declares them.
func Attribute(in Input) Result {
	baseline := toSet(in.Baseline)
	self := toSet(in.Self.Outputs)
	blocked := map[string]bool{}
	for _, other := range in.Others {
		if terminalStages[other.Stage] {
			continue
		}
		for _, p := range other.Outputs {
			blocked[p] = true
		}
	}

	var paths, undeclared, changedBaseline []string
	for _, p := range dedupe(in.Changed) {
		switch {
		case p == "":
		case baseline[p]:
			changedBaseline = append(changedBaseline, p)
		case self[p]:
			paths = append(paths, p)
		case blocked[p], isReserved(p):
		default:
			paths = append(paths, p)
			undeclared = append(undeclared, p)
		}
	}
	return Result{Paths: paths, Undeclared: undeclared, ChangedBaseline: changedBaseline}
}

// ParsePorcelain extracts paths from `git status --porcelain=v1 -z
// --untracked-files=all`. Renames and copies yield the new path, then the old.
func ParsePorcelain(out []byte) []string {
	entries := strings.Split(string(out), "\x00")
	var paths []string
	for i := 0; i < len(entries); i++ {
		entry := entries[i]
		if len(entry) < 4 {
			continue
		}
		paths = append(paths, entry[3:])
		if isRenameOrCopy(entry[:2]) && i+1 < len(entries) && entries[i+1] != "" {
			i++
			paths = append(paths, entries[i])
		}
	}
	return paths
}

func isRenameOrCopy(xy string) bool {
	return strings.ContainsAny(xy, "RC")
}

func isReserved(path string) bool {
	for _, prefix := range reservedPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func toSet(items []string) map[string]bool {
	set := make(map[string]bool, len(items))
	for _, item := range items {
		if item != "" {
			set[item] = true
		}
	}
	return set
}

func dedupe(items []string) []string {
	set := toSet(items)
	out := make([]string, 0, len(set))
	for item := range set {
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}
