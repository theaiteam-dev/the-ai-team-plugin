package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// WI-336: `ateam missions-pr describe` writes
// <repo>/.qa-evidence/<missionId>/pr-description.md and prints its path.
// Mission + prdPath come from GET /api/missions/current, items (with
// commitSha) from GET /api/items?missionId=<id>. Tests use a fake HTTP
// server and a temp git repo as cwd; they never touch the live API.

const (
	prMissionID   = "M-20261011-001"
	prMissionName = "Per-item commits"
	prPRDPath     = "prd/ready/item-commits.md"
	prSummary     = "Each work item is committed when it reaches staged, with trailers naming the item, mission, and PRD."
)

type prItem map[string]interface{}

type prFake struct {
	missionBody  string // raw JSON for /api/missions/current; "" = default
	itemsBody    string // raw JSON for /api/items; "" = built from items
	itemsStatus  int
	items        []prItem
	itemsQueries []string
}

func (f *prFake) serve(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/missions/current":
			if f.missionBody != "" {
				_, _ = w.Write([]byte(f.missionBody))
				return
			}
			b, _ := json.Marshal(map[string]interface{}{"success": true, "data": map[string]interface{}{
				"id": prMissionID, "name": prMissionName, "prdPath": prPRDPath, "state": "running",
			}})
			_, _ = w.Write(b)
		case "/api/items":
			f.itemsQueries = append(f.itemsQueries, r.URL.RawQuery)
			if f.itemsStatus != 0 {
				w.WriteHeader(f.itemsStatus)
				_, _ = w.Write([]byte(`{"success":false,"error":{"code":"INTERNAL","message":"boom"}}`))
				return
			}
			if f.itemsBody != "" {
				_, _ = w.Write([]byte(f.itemsBody))
				return
			}
			b, _ := json.Marshal(map[string]interface{}{"success": true, "data": f.items})
			_, _ = w.Write(b)
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// prRepo makes a temp git repo the cwd, with the PRD file in place.
func prRepo(t *testing.T) string {
	t.Helper()
	root := chdirToRepo(t, "main")
	writePRFile(t, filepath.Join(root, prPRDPath),
		"# Item commits\n\n## Executive Summary\n\n"+prSummary+"\n\n## Definition of Done\n\n- x\n")
	return root
}

func writePRFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func prDescPath(root string) string {
	return filepath.Join(root, ".qa-evidence", prMissionID, "pr-description.md")
}

func runPRDescribe(t *testing.T, srvURL string) (string, error) {
	t.Helper()
	var out, errb bytes.Buffer
	rootCmd.SetOut(&out)
	rootCmd.SetErr(&errb)
	rootCmd.SetArgs([]string{"missions-pr", "describe", "--base-url", srvURL, "--no-color"})
	err := rootCmd.Execute()
	return out.String() + errb.String(), err
}

// describeOK runs the command, requires success, and returns the file text.
func describeOK(t *testing.T, root string, f *prFake) string {
	t.Helper()
	srv := f.serve(t)
	out, err := runPRDescribe(t, srv.URL)
	if err != nil {
		t.Fatalf("describe failed: %v\n%s", err, out)
	}
	b, rerr := os.ReadFile(prDescPath(root))
	if rerr != nil {
		t.Fatalf("description file not written: %v", rerr)
	}
	return string(b)
}

func twoItems() []prItem {
	return []prItem{
		{"id": "WI-1", "title": "Add branch guard", "type": "feature", "commitSha": "abc1234"},
		{"id": "WI-2", "title": "Add message builder", "type": "feature", "commitSha": "def5678"},
	}
}

func lastParagraph(s string) string {
	s = strings.TrimRight(s, "\n")
	i := strings.LastIndex(s, "\n\n")
	return s[i+2:]
}

func TestPRDescribeListsEachItemWithSHAAndTitleFirstLine(t *testing.T) {
	root := prRepo(t)
	got := describeOK(t, root, &prFake{items: twoItems()})

	first := strings.SplitN(got, "\n", 2)[0]
	if strings.TrimSpace(first) == "" || !strings.Contains(first, prMissionName) {
		t.Errorf("first line must be a non-empty PR title containing the mission name, got %q", first)
	}
	for _, want := range []string{"WI-1", "Add branch guard", "abc1234", "WI-2", "Add message builder", "def5678"} {
		if !strings.Contains(got, want) {
			t.Errorf("description missing %q:\n%s", want, got)
		}
	}
	// Each SHA sits on the same line as its own item, not another's.
	for _, line := range strings.Split(got, "\n") {
		if strings.Contains(line, "WI-1") && strings.Contains(line, "def5678") {
			t.Errorf("WI-1 line carries WI-2's sha: %q", line)
		}
		if strings.Contains(line, "WI-2") && strings.Contains(line, "abc1234") {
			t.Errorf("WI-2 line carries WI-1's sha: %q", line)
		}
	}
	if !strings.Contains(got, prSummary) {
		t.Errorf("summary should be the PRD's Executive Summary paragraph:\n%s", got)
	}
}

func TestPRDescribeRequestsItemsForTheMission(t *testing.T) {
	root := prRepo(t)
	f := &prFake{items: twoItems()}
	describeOK(t, root, f)
	if len(f.itemsQueries) == 0 || !strings.Contains(f.itemsQueries[0], "missionId="+prMissionID) {
		t.Errorf("items must be fetched with missionId=%s, queries: %v", prMissionID, f.itemsQueries)
	}
}

func TestPRDescribeOrdersItemsByNumericID(t *testing.T) {
	root := prRepo(t)
	got := describeOK(t, root, &prFake{items: []prItem{
		{"id": "WI-10", "title": "ten", "type": "task", "commitSha": "aaaaaaa"},
		{"id": "WI-9", "title": "nine", "type": "task", "commitSha": "bbbbbbb"},
	}})
	if strings.Index(got, "WI-9") > strings.Index(got, "WI-10") {
		t.Errorf("WI-9 must be listed before WI-10:\n%s", got)
	}
}

func TestPRDescribeItemWithoutSHAIsListedAsNoCommit(t *testing.T) {
	root := prRepo(t)
	for name, sha := range map[string]interface{}{"absent": nil, "empty": ""} {
		item := prItem{"id": "WI-3", "title": "No changes item", "type": "task"}
		if name == "empty" {
			item["commitSha"] = sha
		}
		got := describeOK(t, root, &prFake{items: append(twoItems(), item)})
		var line string
		for _, l := range strings.Split(got, "\n") {
			if strings.Contains(l, "WI-3") {
				line = l
			}
		}
		if !strings.Contains(line, "no commit") {
			t.Errorf("[%s] WI-3 line should say 'no commit', got %q", name, line)
		}
		if !strings.Contains(got, "abc1234") {
			t.Errorf("[%s] items with SHAs must still show them", name)
		}
	}
}

func TestPRDescribeIncludesFrankieChecklistWhenReportExists(t *testing.T) {
	root := prRepo(t)
	writePRFile(t, filepath.Join(root, ".qa-evidence", prMissionID, "report.md"),
		"# Frankie report\n\n- [x] ✅ Item commit appears on branch\n- [ ] ❌ Squash keeps trailers\n")
	got := describeOK(t, root, &prFake{items: twoItems()})
	for _, want := range []string{"Item commit appears on branch", "Squash keeps trailers", "✅", "❌"} {
		if !strings.Contains(got, want) {
			t.Errorf("Frankie checklist missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(strings.ToLower(got), "did not run") {
		t.Errorf("must not claim Frankie did not run when report.md exists:\n%s", got)
	}
}

func TestPRDescribeSaysFrankieDidNotRunWhenNoReport(t *testing.T) {
	root := prRepo(t)
	got := describeOK(t, root, &prFake{items: twoItems()})
	if !strings.Contains(strings.ToLower(got), "frankie did not run") {
		t.Errorf("expected a 'Frankie did not run' statement:\n%s", got)
	}
	if strings.Contains(got, "✅") || strings.Contains(got, "❌") {
		t.Errorf("no checklist section expected without report.md:\n%s", got)
	}
}

func TestPRDescribeLastParagraphIsExactlyTheTrailers(t *testing.T) {
	root := prRepo(t)
	got := describeOK(t, root, &prFake{items: twoItems()})
	want := "Mission: " + prMissionID + "\nPRD: item-commits"
	if lp := lastParagraph(got); lp != want {
		t.Errorf("last paragraph = %q, want %q", lp, want)
	}
	if !strings.HasSuffix(got, "\n") {
		t.Errorf("file should end with a newline")
	}
}

func TestPRDescribeTrailersSurviveSquashCoAuthors(t *testing.T) {
	root := prRepo(t)
	got := describeOK(t, root, &prFake{items: twoItems()})
	squashed := strings.TrimRight(got, "\n") +
		"\nCo-authored-by: A One <a@example.com>\nCo-authored-by: B Two <b@example.com>\n"

	cmd := exec.Command("git", "interpret-trailers", "--parse")
	cmd.Stdin = strings.NewReader(squashed)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git interpret-trailers: %v", err)
	}
	s := string(out)
	for _, want := range []string{"Mission: " + prMissionID, "PRD: item-commits"} {
		if !strings.Contains(s, want) {
			t.Errorf("trailer %q lost after co-author append; parsed:\n%s", want, s)
		}
	}
}

func TestPRDescribePrintsPathAndRerunOverwrites(t *testing.T) {
	root := prRepo(t)
	srv := (&prFake{items: twoItems()}).serve(t)
	out, err := runPRDescribe(t, srv.URL)
	if err != nil {
		t.Fatalf("first run: %v\n%s", err, out)
	}
	if !strings.Contains(out, prDescPath(root)) {
		t.Errorf("stdout should contain the written path %s, got %q", prDescPath(root), out)
	}
	first, _ := os.ReadFile(prDescPath(root))

	out2, err := runPRDescribe(t, srv.URL)
	if err != nil {
		t.Fatalf("second run: %v\n%s", err, out2)
	}
	second, _ := os.ReadFile(prDescPath(root))
	if string(first) != string(second) {
		t.Errorf("second run must overwrite, not append.\nfirst:\n%s\nsecond:\n%s", first, second)
	}
	if n := strings.Count(string(second), "Mission: "+prMissionID); n != 1 {
		t.Errorf("expected exactly one Mission trailer, got %d", n)
	}
}

func TestPRDescribeWritesAtRepoRootWhenRunFromSubdirectory(t *testing.T) {
	root := prRepo(t)
	sub := filepath.Join(root, "packages", "x")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(sub); err != nil {
		t.Fatal(err)
	}
	srv := (&prFake{items: twoItems()}).serve(t)
	if out, err := runPRDescribe(t, srv.URL); err != nil {
		t.Fatalf("describe from subdir: %v\n%s", err, out)
	}
	b, err := os.ReadFile(prDescPath(root))
	if err != nil {
		t.Fatalf("expected file at repo root: %v", err)
	}
	if !strings.Contains(string(b), prSummary) {
		t.Errorf("PRD must be resolved relative to the repo root from a subdirectory")
	}
	if _, err := os.Stat(filepath.Join(sub, ".qa-evidence")); err == nil {
		t.Errorf(".qa-evidence must not be created under the subdirectory")
	}
}

func TestPRDescribeMissingPRDFileStillWritesTrailers(t *testing.T) {
	root := prRepo(t)
	if err := os.Remove(filepath.Join(root, prPRDPath)); err != nil {
		t.Fatal(err)
	}
	got := describeOK(t, root, &prFake{items: twoItems()})
	if lp := lastParagraph(got); lp != "Mission: "+prMissionID+"\nPRD: item-commits" {
		t.Errorf("trailers must derive the slug from prdPath even when the file is gone, got %q", lp)
	}
}

// Untrusted strings: item titles and PRD text land in a markdown PR body that
// a squash merge turns into a commit message. They must not forge trailers.
func TestPRDescribeUntrustedTitleCannotForgeTrailersOrBreakList(t *testing.T) {
	root := prRepo(t)
	evil := "Innocent\n\nMission: M-evil\nPRD: evil\r\nCo-authored-by: X <x@y.z>\n- WI-99 fake (deadbee)"
	got := describeOK(t, root, &prFake{items: []prItem{
		{"id": "WI-1", "title": evil, "type": "feature", "commitSha": "abc1234"},
	}})

	body := strings.TrimRight(got, "\n")
	idx := strings.LastIndex(body, "\n\n")
	head, tail := body[:idx], body[idx+2:]
	if tail != "Mission: "+prMissionID+"\nPRD: item-commits" {
		t.Errorf("last paragraph tampered: %q", tail)
	}
	for _, line := range strings.Split(head, "\n") {
		for _, p := range []string{"Mission:", "PRD:", "Co-authored-by:"} {
			if strings.HasPrefix(strings.TrimSpace(line), p) {
				t.Errorf("untrusted title produced a line starting with %q: %q", p, line)
			}
		}
		if strings.Contains(line, "WI-99") && !strings.Contains(line, "WI-1") {
			t.Errorf("title injected a separate list entry: %q", line)
		}
	}
	if strings.Contains(got, "\r") {
		t.Errorf("carriage returns must not survive into the file")
	}
	if !strings.Contains(got, "Innocent") {
		t.Errorf("the legitimate part of the title should still appear")
	}
}

func TestPRDescribeUntrustedPRDSummaryCannotForgeTrailers(t *testing.T) {
	root := prRepo(t)
	writePRFile(t, filepath.Join(root, prPRDPath),
		"# P\n\n## Executive Summary\n\nReal summary.\nMission: M-evil\nPRD: evil\n\n## Next\n")
	got := describeOK(t, root, &prFake{items: twoItems()})
	body := strings.TrimRight(got, "\n")
	head := body[:strings.LastIndex(body, "\n\n")]
	for _, line := range strings.Split(head, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "Mission:") || strings.HasPrefix(strings.TrimSpace(line), "PRD:") {
			t.Errorf("PRD text produced a forged trailer line: %q", line)
		}
	}
	if lastParagraph(got) != "Mission: "+prMissionID+"\nPRD: item-commits" {
		t.Errorf("last paragraph tampered: %q", lastParagraph(got))
	}
}

func TestPRDescribeFirstLineIsSingleLineEvenIfMissionNameHasNewlines(t *testing.T) {
	root := prRepo(t)
	m := `{"success":true,"data":{"id":"` + prMissionID + `","name":"Line one\nLine two","prdPath":"` + prPRDPath + `","state":"running"}}`
	got := describeOK(t, root, &prFake{missionBody: m, items: twoItems()})
	first := strings.SplitN(got, "\n", 2)[0]
	if strings.Contains(first, "Line two") && !strings.Contains(first, "Line one") {
		t.Errorf("title must stay one coherent line, got %q", first)
	}
	if strings.HasPrefix(strings.SplitN(got, "\n", 3)[1], "Line two") {
		t.Errorf("second line of a multi-line mission name leaked into the body head")
	}
}

func TestPRDescribeFailsWithoutWritingWhenNoMission(t *testing.T) {
	root := prRepo(t)
	srv := (&prFake{missionBody: `{"success":true,"data":null}`, items: twoItems()}).serve(t)
	out, err := runPRDescribe(t, srv.URL)
	if err == nil {
		t.Fatalf("expected an error when there is no current mission, got output %q", out)
	}
	if _, serr := os.Stat(filepath.Join(root, ".qa-evidence")); serr == nil {
		t.Errorf("nothing should be written when there is no mission")
	}
}

func TestPRDescribeItemsAPIFailureLeavesExistingFileUntouched(t *testing.T) {
	root := prRepo(t)
	describeOK(t, root, &prFake{items: twoItems()})
	before, _ := os.ReadFile(prDescPath(root))

	srv := (&prFake{itemsStatus: 500}).serve(t)
	if out, err := runPRDescribe(t, srv.URL); err == nil {
		t.Fatalf("expected error when the items API fails, got %q", out)
	}
	after, err := os.ReadFile(prDescPath(root))
	if err != nil {
		t.Fatalf("existing description must survive a failed run: %v", err)
	}
	if string(before) != string(after) {
		t.Errorf("failed run must not modify the existing file")
	}
}

func TestPRDescribeFailsOutsideAGitRepo(t *testing.T) {
	dir, _ := filepath.EvalSymlinks(t.TempDir())
	old, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(old) })
	srv := (&prFake{items: twoItems()}).serve(t)
	if out, err := runPRDescribe(t, srv.URL); err == nil {
		t.Fatalf("expected error outside a git repo, got %q", out)
	}
	if _, err := os.Stat(filepath.Join(dir, ".qa-evidence")); err == nil {
		t.Errorf("must not write .qa-evidence outside a repo")
	}
}

// Frankie's real report.md (agents/frankie.md, .qa-evidence/M-20260815-001)
// renders the DoD as a markdown table, not "- [ ]" lines.
func TestPRDescribeIncludesFrankieTableRowsWithResults(t *testing.T) {
	root := prRepo(t)
	writePRFile(t, filepath.Join(root, ".qa-evidence", prMissionID, "report.md"),
		"# Frankie QA report\n\n## Checklist\n\n"+
			"| # | Definition of Done statement | Result |\n"+
			"|---|---|---|\n"+
			"| 1 | A mission whose items all reach `staged` triggers Frankie's walk. | ✅ |\n"+
			"| 2 | Squash merge keeps the trailers. | ❌ |\n"+
			"| 3 | Bad issue reports why, no mission | ⚠️ NOT DRIVABLE | contract inspected only |\n\n"+
			"**No failing work items.**\n")
	got := describeOK(t, root, &prFake{items: twoItems()})

	find := func(sub string) string {
		for _, l := range strings.Split(got, "\n") {
			if strings.Contains(l, sub) {
				return l
			}
		}
		return ""
	}
	if l := find("triggers Frankie's walk"); !strings.Contains(l, "✅") {
		t.Errorf("row 1 must keep its ✅ on the same line, got %q", l)
	}
	if l := find("Squash merge keeps the trailers"); !strings.Contains(l, "❌") {
		t.Errorf("row 2 must keep its ❌ on the same line, got %q", l)
	}
	if l := find("Bad issue reports why"); !strings.Contains(l, "NOT DRIVABLE") {
		t.Errorf("row 3 must keep its ⚠️ result text, got %q", l)
	}
	for _, bad := range []string{"|---|", "Definition of Done statement"} {
		if strings.Contains(got, bad) {
			t.Errorf("header/separator row %q must not be copied into the description:\n%s", bad, got)
		}
	}
	if strings.Contains(strings.ToLower(got), "did not run") {
		t.Errorf("Frankie ran; must not say otherwise")
	}
	if lastParagraph(got) != "Mission: "+prMissionID+"\nPRD: item-commits" {
		t.Errorf("trailers must remain the last paragraph")
	}
}

// ---------------------------------------------------------------------------
// WI-336 rework (Frankie F3): FR-11 requires "a summary" in the PR description,
// and `describe --json` must emit JSON.
//
// Summary source (deterministic, from data the command already has):
//  1. the PRD's "## Executive Summary" paragraph, when the PRD has one;
//  2. otherwise a one-sentence fallback built from the PRD's first "# " heading
//     (or the mission name when the PRD file or heading is missing) plus the
//     item count, worded "<N> work item(s)" ("1 work item", "2 work items").
// The summary is the second paragraph: after the title line, before "## Items".
// ---------------------------------------------------------------------------

// isolateDescribeEnv keeps these tests independent of the developer's shell
// and git config.
func isolateDescribeEnv(t *testing.T) {
	t.Helper()
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("HOME", t.TempDir())
	for _, k := range []string{"ATEAM_MISSION_ID", "ATEAM_PROJECT_ID"} {
		t.Setenv(k, "")
		if err := os.Unsetenv(k); err != nil {
			t.Fatal(err)
		}
	}
}

// runPRDescribeStdout runs describe with extra args and returns stdout alone,
// so stderr noise cannot hide a malformed machine-readable output.
func runPRDescribeStdout(t *testing.T, srvURL string, extra ...string) string {
	t.Helper()
	resetPersistentFlags(t)
	t.Cleanup(func() { resetPersistentFlags(t) })
	var out, errb bytes.Buffer
	rootCmd.SetOut(&out)
	rootCmd.SetErr(&errb)
	rootCmd.SetArgs(append([]string{"missions-pr", "describe", "--base-url", srvURL, "--no-color"}, extra...))
	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("describe %v failed: %v\nstderr: %s", extra, err, errb.String())
	}
	return out.String()
}

func paragraphs(s string) []string {
	return strings.Split(strings.TrimRight(s, "\n"), "\n\n")
}

func TestPRDescribeSummaryIsSecondParagraphBeforeTheItemList(t *testing.T) {
	isolateDescribeEnv(t)
	root := prRepo(t)
	got := describeOK(t, root, &prFake{items: twoItems()})

	ps := paragraphs(got)
	if len(ps) < 4 {
		t.Fatalf("want title, summary, items, Frankie, trailers paragraphs; got %d:\n%s", len(ps), got)
	}
	if ps[0] != prMissionName {
		t.Errorf("paragraph 1 must be the title line, got %q", ps[0])
	}
	if ps[1] != prSummary {
		t.Errorf("paragraph 2 must be the summary %q, got %q", prSummary, ps[1])
	}
	if !strings.HasPrefix(ps[2], "## Items") {
		t.Errorf("the item list must come after the summary, got %q", ps[2])
	}
}

// Without an Executive Summary the description still carries a summary. Each
// row varies the source so a hardcoded sentence, or one that ignores the PRD
// heading, the mission name, or the item count, fails.
func TestPRDescribeFallsBackToHeadingAndItemCountWhenPRDHasNoExecutiveSummary(t *testing.T) {
	oneItem := twoItems()[:1]
	cases := []struct {
		name    string
		prd     *string // nil = delete the PRD file
		items   []prItem
		wantAll []string
	}{
		{"heading, no summary section, two items",
			strp("# Item Commits and Git Conventions\n\n## Definition of Done\n\n- x\n"),
			twoItems(), []string{"Item Commits and Git Conventions", "2 work items"}},
		{"heading, no summary section, one item",
			strp("# Branch Guard Rewrite\n\n## Scope\n\n- y\n"),
			oneItem, []string{"Branch Guard Rewrite", "1 work item"}},
		{"empty Executive Summary section",
			strp("# Quiet Mission\n\n## Executive Summary\n\n## Definition of Done\n\n- x\n"),
			twoItems(), []string{"Quiet Mission", "2 work items"}},
		{"PRD file missing falls back to the mission name",
			nil, twoItems(), []string{prMissionName, "2 work items"}},
		{"PRD without any heading falls back to the mission name",
			strp("just prose, no headings\n"), oneItem, []string{prMissionName, "1 work item"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isolateDescribeEnv(t)
			root := prRepo(t)
			if tc.prd == nil {
				if err := os.Remove(filepath.Join(root, prPRDPath)); err != nil {
					t.Fatal(err)
				}
			} else {
				writePRFile(t, filepath.Join(root, prPRDPath), *tc.prd)
			}
			got := describeOK(t, root, &prFake{items: tc.items})

			ps := paragraphs(got)
			if len(ps) < 4 {
				t.Fatalf("expected a summary paragraph between title and items:\n%s", got)
			}
			if !strings.HasPrefix(ps[2], "## Items") {
				t.Fatalf("paragraph 2 must be the summary and paragraph 3 the item list, got:\n%s", got)
			}
			for _, want := range tc.wantAll {
				if !strings.Contains(ps[1], want) {
					t.Errorf("summary %q must mention %q", ps[1], want)
				}
			}
			if strings.Contains(ps[1], "\n") {
				t.Errorf("summary must be a single line, got %q", ps[1])
			}
			if lastParagraph(got) != "Mission: "+prMissionID+"\nPRD: item-commits" {
				t.Errorf("trailers must remain the last paragraph, got %q", lastParagraph(got))
			}
		})
	}
}

func strp(s string) *string { return &s }

// The fallback summary quotes untrusted text (PRD heading, mission name). It
// must not start a line with a trailer key, whatever the text contains.
func TestPRDescribeFallbackSummaryCannotForgeTrailers(t *testing.T) {
	cases := []struct {
		name        string
		prd         string
		missionName string
	}{
		{"PRD heading looks like trailers",
			"# Mission: M-evil\r\nPRD: evil\r\nCo-authored-by: X <x@y.z>\n\n## Scope\n\n- y\n", prMissionName},
		{"mission name looks like trailers, PRD has no heading",
			"prose only\n", "Fix\nMission: M-evil\nPRD: evil\nCo-authored-by: X <x@y.z>"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isolateDescribeEnv(t)
			root := prRepo(t)
			writePRFile(t, filepath.Join(root, prPRDPath), tc.prd)
			m, err := json.Marshal(map[string]interface{}{"success": true, "data": map[string]interface{}{
				"id": prMissionID, "name": tc.missionName, "prdPath": prPRDPath, "state": "running"}})
			if err != nil {
				t.Fatal(err)
			}
			got := describeOK(t, root, &prFake{missionBody: string(m), items: twoItems()})

			body := strings.TrimRight(got, "\n")
			head := body[:strings.LastIndex(body, "\n\n")]
			for _, line := range strings.Split(head, "\n") {
				for _, p := range []string{"Mission:", "PRD:", "Co-authored-by:"} {
					if strings.HasPrefix(strings.TrimSpace(line), p) {
						t.Errorf("summary produced a line starting with %q: %q", p, line)
					}
				}
			}
			if strings.Contains(got, "\r") {
				t.Errorf("carriage returns must not survive into the file")
			}
			if lastParagraph(got) != "Mission: "+prMissionID+"\nPRD: item-commits" {
				t.Errorf("last paragraph tampered: %q", lastParagraph(got))
			}
			if ps := paragraphs(got); len(ps) < 4 || !strings.HasPrefix(ps[2], "## Items") {
				t.Errorf("a summary paragraph must still sit before the item list:\n%s", got)
			}
		})
	}
}

// Callers (agents/tawnia.md, docs/ORCHESTRATION.md) document that describe
// "prints its path", and openDraft reads the file rather than describe's
// stdout. So plain mode stays a bare path; only --json changes shape.
func TestPRDescribePlainModePrintsExactlyTheBarePath(t *testing.T) {
	isolateDescribeEnv(t)
	root := prRepo(t)
	srv := (&prFake{items: twoItems()}).serve(t)

	out := runPRDescribeStdout(t, srv.URL)
	if strings.TrimSpace(out) != prDescPath(root) {
		t.Errorf("plain stdout must be exactly the path %q, got %q", prDescPath(root), out)
	}
}

func TestPRDescribeJSONModeEmitsAnObjectWithPathAndTitle(t *testing.T) {
	isolateDescribeEnv(t)
	root := prRepo(t)
	srv := (&prFake{items: twoItems()}).serve(t)

	out := runPRDescribeStdout(t, srv.URL, "--json")

	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(out), &obj); err != nil {
		t.Fatalf("--json stdout must be a single JSON object, got %q (%v)", out, err)
	}
	if obj["path"] != prDescPath(root) {
		t.Errorf("json path = %v, want %q", obj["path"], prDescPath(root))
	}
	if obj["title"] != prMissionName {
		t.Errorf("json title = %v, want the PR title %q", obj["title"], prMissionName)
	}
	b, err := os.ReadFile(prDescPath(root))
	if err != nil {
		t.Fatalf("--json must still write the file: %v", err)
	}
	if first := strings.SplitN(string(b), "\n", 2)[0]; first != obj["title"] {
		t.Errorf("json title %v must equal the file's first line %q", obj["title"], first)
	}
}

// A multi-line mission name must not leak a newline into the JSON title.
func TestPRDescribeJSONTitleIsTheFlattenedFirstLine(t *testing.T) {
	isolateDescribeEnv(t)
	root := prRepo(t)
	m := `{"success":true,"data":{"id":"` + prMissionID + `","name":"Line one\nLine two","prdPath":"` + prPRDPath + `","state":"running"}}`
	srv := (&prFake{missionBody: m, items: twoItems()}).serve(t)

	out := runPRDescribeStdout(t, srv.URL, "--json")

	var obj struct {
		Title string `json:"title"`
	}
	if err := json.Unmarshal([]byte(out), &obj); err != nil {
		t.Fatalf("--json stdout must be JSON, got %q (%v)", out, err)
	}
	b, _ := os.ReadFile(prDescPath(root))
	if want := strings.SplitN(string(b), "\n", 2)[0]; obj.Title != want || strings.Contains(obj.Title, "\n") {
		t.Errorf("json title %q must equal the single-line file title %q", obj.Title, want)
	}
}
