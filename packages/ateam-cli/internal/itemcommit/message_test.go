package itemcommit_test

import (
	"os/exec"
	"strings"
	"testing"

	"ateam/internal/itemcommit"
)

const (
	missionID = "M-20261011-001"
	prdPath   = "prd/ready/item-commits.md"
)

func entry(agent, action, ts string) itemcommit.WorkLogEntry {
	return itemcommit.WorkLogEntry{Agent: agent, Action: action, Timestamp: ts}
}

// reworkedLog is the AC's example, with 'started' and 'note' noise interleaved.
func reworkedLog() []itemcommit.WorkLogEntry {
	return []itemcommit.WorkLogEntry{
		entry("murdock-2", "started", "2026-10-11T10:00:00Z"),
		entry("murdock-2", "completed", "2026-10-11T10:05:00Z"),
		entry("ba-1", "started", "2026-10-11T10:06:00Z"),
		entry("ba-1", "completed", "2026-10-11T10:20:00Z"),
		entry("lynch-1", "started", "2026-10-11T10:21:00Z"),
		entry("lynch-1", "rejected", "2026-10-11T10:30:00Z"),
		entry("ba-4", "completed", "2026-10-11T10:40:00Z"),
		entry("hannibal", "note", "2026-10-11T10:41:00Z"),
		entry("lynch-3", "completed", "2026-10-11T10:50:00Z"),
		entry("amy-2", "started", "2026-10-11T10:51:00Z"),
		entry("amy-2", "completed", "2026-10-11T11:00:00Z"),
	}
}

func build(t *testing.T, item itemcommit.CommitItem, log []itemcommit.WorkLogEntry, undeclared []string) string {
	t.Helper()
	msg, err := itemcommit.BuildMessage(item, log, missionID, prdPath, undeclared)
	if err != nil {
		t.Fatalf("BuildMessage returned error: %v", err)
	}
	return msg
}

func parseTrailers(t *testing.T, msg string) string {
	t.Helper()
	cmd := exec.Command("git", "interpret-trailers", "--parse")
	cmd.Stdin = strings.NewReader(msg)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git interpret-trailers failed: %v", err)
	}
	return strings.TrimSpace(string(out))
}

func lastParagraph(msg string) string {
	paras := strings.Split(strings.TrimSpace(msg), "\n\n")
	return paras[len(paras)-1]
}

func TestBuildMessage_SubjectUsesTypePrefixAndVerbatimTitle(t *testing.T) {
	cases := []struct {
		itype, title, want string
	}{
		{"feature", "Add order totals", "feat: Add order totals"},
		{"enhancement", "Add order totals", "feat: Add order totals"},
		{"bug", "Add order totals", "fix: Add order totals"},
		{"task", "Add order totals", "chore: Add order totals"},
		// Title is copied unchanged: no trimming to length, no lowercasing, no reword.
		{"feature", "Fix: Handle  Mixed CASE & a very long title that goes well past seventy-two characters in total length", "feat: Fix: Handle  Mixed CASE & a very long title that goes well past seventy-two characters in total length"},
	}
	for _, c := range cases {
		t.Run(c.itype+"/"+c.title[:8], func(t *testing.T) {
			msg := build(t, itemcommit.CommitItem{ID: "WI-042", Type: c.itype, Title: c.title}, reworkedLog(), nil)
			subject := strings.SplitN(msg, "\n", 2)[0]
			if subject != c.want {
				t.Errorf("subject = %q, want %q", subject, c.want)
			}
		})
	}
}

func TestBuildMessage_UnknownTypeReturnsError(t *testing.T) {
	_, err := itemcommit.BuildMessage(
		itemcommit.CommitItem{ID: "WI-042", Type: "epic", Title: "Add order totals"},
		reworkedLog(), missionID, prdPath, nil)
	if err == nil {
		t.Fatal("expected an error for an item type outside feature|bug|enhancement|task")
	}
}

func TestBuildMessage_FinalParagraphIsExactlyTheFourTrailers(t *testing.T) {
	msg := build(t, itemcommit.CommitItem{ID: "WI-042", Type: "feature", Title: "Add order totals"}, reworkedLog(), nil)
	want := "Item: WI-042\nMission: M-20261011-001\nPRD: item-commits\nLanes: murdock-2 ba-1 lynch-1 ba-4 lynch-3 amy-2"
	if got := lastParagraph(msg); got != want {
		t.Errorf("final paragraph =\n%s\nwant\n%s", got, want)
	}
}

func TestBuildMessage_LanesFollowTimestampOrderNotInputOrder(t *testing.T) {
	log := reworkedLog()
	// Reverse the slice: the API gives no ordering guarantee.
	for i, j := 0, len(log)-1; i < j; i, j = i+1, j-1 {
		log[i], log[j] = log[j], log[i]
	}
	msg := build(t, itemcommit.CommitItem{ID: "WI-042", Type: "feature", Title: "Add order totals"}, log, nil)
	if !strings.Contains(lastParagraph(msg), "Lanes: murdock-2 ba-1 lynch-1 ba-4 lynch-3 amy-2") {
		t.Errorf("lanes not in timestamp order:\n%s", lastParagraph(msg))
	}
}

func TestBuildMessage_LanesKeepRepeatsForRework(t *testing.T) {
	log := []itemcommit.WorkLogEntry{
		entry("ba-1", "completed", "2026-10-11T10:00:00Z"),
		entry("lynch-1", "rejected", "2026-10-11T10:10:00Z"),
		entry("ba-1", "completed", "2026-10-11T10:20:00Z"),
		entry("ba-1", "completed", "2026-10-11T10:30:00Z"),
	}
	msg := build(t, itemcommit.CommitItem{ID: "WI-1", Type: "bug", Title: "T"}, log, nil)
	if !strings.HasSuffix(lastParagraph(msg), "Lanes: ba-1 lynch-1 ba-1 ba-1") {
		t.Errorf("repeats collapsed or reordered:\n%s", lastParagraph(msg))
	}
}

func TestBuildMessage_StartedAndNoteEntriesAddNoLanes(t *testing.T) {
	log := []itemcommit.WorkLogEntry{
		entry("murdock-9", "started", "2026-10-11T10:00:00Z"),
		entry("hannibal", "note", "2026-10-11T10:01:00Z"),
		entry("murdock-2", "completed", "2026-10-11T10:05:00Z"),
	}
	msg := build(t, itemcommit.CommitItem{ID: "WI-1", Type: "task", Title: "T"}, log, nil)
	got := lastParagraph(msg)
	if !strings.HasSuffix(got, "Lanes: murdock-2") {
		t.Errorf("expected Lanes: murdock-2 only, got:\n%s", got)
	}
	if strings.Contains(msg, "murdock-9") || strings.Contains(msg, "hannibal") {
		t.Errorf("started/note agents leaked into message:\n%s", msg)
	}
}

func TestBuildMessage_UndeclaredPathsListedUnderNamingLine(t *testing.T) {
	paths := []string{"src/routes/index.ts", "app/shell.tsx"}
	msg := build(t, itemcommit.CommitItem{ID: "WI-042", Type: "feature", Title: "Add order totals"}, reworkedLog(), paths)
	want := "Undeclared paths included:\n- src/routes/index.ts\n- app/shell.tsx"
	if !strings.Contains(msg, "\n\n"+want+"\n\n") {
		t.Errorf("body missing undeclared section as its own paragraph %q in:\n%s", want, msg)
	}
	// Body sits between subject and trailers.
	if !strings.HasPrefix(msg, "feat: Add order totals\n\nUndeclared paths included:") {
		t.Errorf("unexpected layout:\n%s", msg)
	}
}

func TestBuildMessage_NoUndeclaredPathsMeansNoSection(t *testing.T) {
	for name, paths := range map[string][]string{"nil": nil, "empty": {}} {
		t.Run(name, func(t *testing.T) {
			msg := build(t, itemcommit.CommitItem{ID: "WI-042", Type: "feature", Title: "Add order totals"}, reworkedLog(), paths)
			if strings.Contains(strings.ToLower(msg), "undeclared") {
				t.Errorf("undeclared section present with no paths:\n%s", msg)
			}
			wantPrefix := "feat: Add order totals\n\nItem: WI-042\n"
			if !strings.HasPrefix(msg, wantPrefix) {
				t.Errorf("expected subject then trailers only, got:\n%s", msg)
			}
		})
	}
}

func TestBuildMessage_NeverContainsCoAuthoredBy(t *testing.T) {
	msg := build(t, itemcommit.CommitItem{ID: "WI-042", Type: "feature", Title: "Add order totals"}, reworkedLog(), []string{"a.ts"})
	if strings.Contains(strings.ToLower(msg), "co-authored-by") {
		t.Errorf("message contains Co-authored-by:\n%s", msg)
	}
}

func TestBuildMessage_GitParsesTheFourTrailers(t *testing.T) {
	msg := build(t, itemcommit.CommitItem{ID: "WI-042", Type: "feature", Title: "Add order totals"}, reworkedLog(), nil)
	want := "Item: WI-042\nMission: M-20261011-001\nPRD: item-commits\nLanes: murdock-2 ba-1 lynch-1 ba-4 lynch-3 amy-2"
	if got := parseTrailers(t, msg); got != want {
		t.Errorf("git trailers =\n%s\nwant\n%s", got, want)
	}
}

func TestBuildMessage_UndeclaredBodyDoesNotLeakIntoParsedTrailers(t *testing.T) {
	// A path containing ': ' looks like a trailer; it must stay in the body paragraph.
	paths := []string{"docs/Note: draft.md"}
	msg := build(t, itemcommit.CommitItem{ID: "WI-042", Type: "feature", Title: "Add order totals"}, reworkedLog(), paths)
	want := "Item: WI-042\nMission: M-20261011-001\nPRD: item-commits\nLanes: murdock-2 ba-1 lynch-1 ba-4 lynch-3 amy-2"
	if got := parseTrailers(t, msg); got != want {
		t.Errorf("git trailers =\n%s\nwant\n%s", got, want)
	}
}

func TestBuildMessage_TrailersSurviveAppendedCoAuthoredBy(t *testing.T) {
	// GitHub appends Co-authored-by lines on squash; trailers must stay one block.
	msg := build(t, itemcommit.CommitItem{ID: "WI-042", Type: "feature", Title: "Add order totals"}, reworkedLog(), nil)
	squashed := strings.TrimRight(msg, "\n") + "\nCo-authored-by: A <a@example.com>\nCo-authored-by: B <b@example.com>\n"
	got := parseTrailers(t, squashed)
	for _, k := range []string{"Item: WI-042", "Mission: M-20261011-001", "PRD: item-commits", "Lanes: murdock-2"} {
		if !strings.Contains(got, k) {
			t.Errorf("trailer %q lost after appended Co-authored-by:\n%s", k, got)
		}
	}
}

func TestBuildMessage_PRDTrailerUsesPRDSlugOfThePath(t *testing.T) {
	msg, err := itemcommit.BuildMessage(
		itemcommit.CommitItem{ID: "WI-1", Type: "bug", Title: "T"}, reworkedLog(), missionID, "prd/drafts/daemon-dispatch.md", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(lastParagraph(msg), "PRD: daemon-dispatch\n") {
		t.Errorf("PRD trailer wrong:\n%s", lastParagraph(msg))
	}
}

func TestPRDSlug(t *testing.T) {
	cases := []struct{ in, want string }{
		{"prd/ready/item-commits.md", "item-commits"},
		{"item-commits.md", "item-commits"},
		{"/abs/path/to/prd/ready/item-commits.md", "item-commits"},
		{"prd/ready/v1.2-plan.md", "v1.2-plan"},
		{"prd/ready/no-extension", "no-extension"},
		{"prd/ready/item-commits.md.bak", "item-commits.md"},
	}
	for _, c := range cases {
		if got := itemcommit.PRDSlug(c.in); got != c.want {
			t.Errorf("PRDSlug(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
