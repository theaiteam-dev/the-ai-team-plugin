package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"ateam/internal/itemcommit"

	"github.com/spf13/pflag"
)

// WI-341: `ateam items-commit commitItem --itemId WI-X` re-runs the item commit
// for an item sitting in `staged`, wrapping itemcommit.Run (WI-334).
//
// Contract pinned here:
//   - Output with --json: stdout holds ONE top-level JSON object (not wrapped
//     in an "itemCommit" key) with agentStop's itemCommitReport shape
//     (cmd/item_commit_wiring.go): committed always; sha, noChanges and error
//     only when set. Success: {committed,sha}. Nothing to commit (including
//     SHA already recorded): {committed:false,noChanges:true}. Failure:
//     {committed:false,error}. The key sets are asserted exactly.
//   - Item not in staged: non-nil error naming the current stage, no commit, no PATCH.
//   - Success: committed=true, sha=new HEAD, commitSha PATCHed.
//   - Nothing to commit: exit 0, committed=false, no error, no new commit,
//     human output says "nothing to commit".
//   - Failure: non-nil error, stderr has a line starting ITEM_COMMIT_FAILED that
//     mentions ALERT, an activity entry is POSTed to /api/activity, and with
//     --json stdout has committed=false and a non-empty error.
//   - Carry-forward from WI-334 probing (commit landed, commitSha PATCH failed):
//     when the tree has nothing left to commit, the command finds the newest
//     commit reachable from HEAD whose Item: trailer is exactly this item id and,
//     if the board's commitSha differs, PATCHes it and reports
//     committed=true with that sha. It makes no new commit. When the board
//     already holds that sha, it PATCHes nothing and reports committed=false.
//
// The pool dir is /tmp/.ateam-pool/<missionId> (as openDraft does), so each
// test uses a unique mission id from withTempPoolRoot.

const ciItem = "WI-341"

type ciStub struct {
	srv      *httptest.Server
	mu       sync.Mutex
	mission  string
	stage    string
	commitSh string
	outputs  map[string]string
	patches  []map[string]any
	activity []map[string]any
	notFound bool
}

func (s *ciStub) handle(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	path := strings.TrimSuffix(r.URL.Path, "/")
	wire := func() map[string]any {
		return map[string]any{
			"id": ciItem, "title": "Retry a failed item commit", "type": "feature",
			"stageId": s.stage, "outputs": s.outputs, "commitSha": nilIfEmpty(s.commitSh),
			"dependencies": []string{},
			"workLogs": []map[string]string{
				{"agent": "murdock-1", "action": "completed", "timestamp": "2026-10-11T10:00:00Z"},
				{"agent": "ba-1", "action": "completed", "timestamp": "2026-10-11T11:00:00Z"},
			},
		}
	}
	write := func(status int, v any) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	switch {
	case r.Method == http.MethodGet && path == "/api/missions/current":
		write(200, map[string]any{"success": true, "data": map[string]any{"id": s.mission, "prdPath": "prd/ready/item-commits.md"}})
	case r.Method == http.MethodGet && path == "/api/items":
		write(200, map[string]any{"success": true, "data": []any{wire()}})
	case path == "/api/items/"+ciItem:
		if s.notFound {
			write(404, map[string]any{"success": false, "error": map[string]any{"code": "ITEM_NOT_FOUND", "message": "no such item"}})
			return
		}
		if r.Method == http.MethodPatch {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			s.patches = append(s.patches, body)
			if sha, ok := body["commitSha"].(string); ok {
				s.commitSh = sha
			}
		}
		write(200, map[string]any{"success": true, "data": wire()})
	case r.Method == http.MethodPost && path == "/api/activity":
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		s.activity = append(s.activity, body)
		write(200, map[string]any{"success": true, "data": body})
	default:
		write(404, map[string]any{"success": false, "error": map[string]any{"code": "NOT_FOUND", "message": r.URL.Path}})
	}
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *ciStub) commitShaPatches() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for _, p := range s.patches {
		if sha, ok := p["commitSha"].(string); ok {
			out = append(out, sha)
		}
	}
	return out
}

func (s *ciStub) patchCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.patches)
}

func (s *ciStub) activityCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.activity)
}

type ciEnv struct {
	root string
	stub *ciStub
}

// ciSetup builds a repo on branch "mission/x" holding impl.txt, records branch
// and baseline in the pool dir, and starts the fake API with the item in `stage`.
func ciSetup(t *testing.T, stage string) *ciEnv {
	t.Helper()
	missionID, poolDir := withTempPoolRoot(t, "commititem")
	t.Setenv("ATEAM_PROJECT_ID", "")
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("HOME", t.TempDir())
	t.Setenv("GIT_AUTHOR_NAME", "t")
	t.Setenv("GIT_AUTHOR_EMAIL", "t@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "t")
	t.Setenv("GIT_COMMITTER_EMAIL", "t@example.com")
	root := chdirToRepo(t, "mission/x")
	writePRFile(t, filepath.Join(root, "impl.txt"), "orig\n")
	poolGit(t, root, "add", ".")
	poolGit(t, root, "commit", "-m", "base impl")
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := itemcommit.RecordBranch(poolDir, root); err != nil {
		t.Fatal(err)
	}
	if err := itemcommit.RecordBaselineDirty(poolDir, root); err != nil {
		t.Fatal(err)
	}
	stub := &ciStub{mission: missionID, stage: stage, outputs: map[string]string{"impl": "impl.txt"}}
	stub.srv = httptest.NewServer(http.HandlerFunc(stub.handle))
	t.Cleanup(stub.srv.Close)
	return &ciEnv{root: root, stub: stub}
}

func (e *ciEnv) dirty(t *testing.T) {
	t.Helper()
	writePRFile(t, filepath.Join(e.root, "impl.txt"), "changed\n")
}

func (e *ciEnv) git(t *testing.T, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", e.root}, args...)...).Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(string(out))
}

func (e *ciEnv) head(t *testing.T) string  { return e.git(t, "rev-parse", "HEAD") }
func (e *ciEnv) count(t *testing.T) string { return e.git(t, "rev-list", "--count", "HEAD") }

// commitWithTrailer makes a commit on the current branch that carries an
// Item: trailer, as a prior successful item commit would have.
func (e *ciEnv) commitWithTrailer(t *testing.T, file, content, itemTrailer string) string {
	t.Helper()
	writePRFile(t, filepath.Join(e.root, file), content)
	poolGit(t, e.root, "add", file)
	poolGit(t, e.root, "commit", "-m", "feat: earlier item commit", "-m", "Item: "+itemTrailer+"\nMission: "+e.stub.mission)
	return e.head(t)
}

type ciResult struct {
	stdout, stderr string
	err            error
}

func (e *ciEnv) run(t *testing.T) ciResult {
	t.Helper()
	resetPersistentFlags(t)
	if c, _, err := rootCmd.Find([]string{"items-commit", "commitItem"}); err == nil {
		c.Flags().VisitAll(func(f *pflag.Flag) { _ = f.Value.Set(f.DefValue); f.Changed = false })
	}
	var out, errb bytes.Buffer
	rootCmd.SetOut(&out)
	rootCmd.SetErr(&errb)
	rootCmd.SetArgs([]string{"items-commit", "commitItem", "--itemId", ciItem, "--base-url", e.stub.srv.URL, "--no-color", "--json"})
	err := rootCmd.Execute()
	return ciResult{out.String(), errb.String(), err}
}

// ciOutput is the decoded --json stdout. Keys records which top-level keys were
// present: the shape must match agentStop's itemCommitReport, whose sha,
// noChanges and error fields are omitted when empty/false.
type ciOutput struct {
	Committed bool
	SHA       string
	NoChanges bool
	Error     string
	Keys      map[string]bool
}

func parseCI(t *testing.T, r ciResult) ciOutput {
	t.Helper()
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(strings.TrimSpace(r.stdout)), &raw); err != nil {
		t.Fatalf("stdout is not one JSON object: %v\n%q", err, r.stdout)
	}
	// Shared-type parity: stdout must round-trip byte-for-byte (as JSON)
	// through agentStop's own itemCommitReport, so omitempty on sha/error/
	// noChanges cannot drift between the two paths.
	dec := json.NewDecoder(strings.NewReader(strings.TrimSpace(r.stdout)))
	dec.DisallowUnknownFields()
	var shared itemCommitReport
	if err := dec.Decode(&shared); err != nil {
		t.Fatalf("stdout does not decode into itemCommitReport: %v\n%s", err, r.stdout)
	}
	reencoded, err := json.Marshal(shared)
	if err != nil {
		t.Fatal(err)
	}
	var gotAny, wantAny any
	_ = json.Unmarshal([]byte(strings.TrimSpace(r.stdout)), &gotAny)
	_ = json.Unmarshal(reencoded, &wantAny)
	if !reflect.DeepEqual(gotAny, wantAny) {
		t.Errorf("stdout %s differs from itemCommitReport marshalling %s (empty sha/error must be omitted, noChanges set as agentStop does)", r.stdout, reencoded)
	}
	o := ciOutput{Keys: map[string]bool{}}
	for k := range raw {
		o.Keys[k] = true
		switch k {
		case "committed", "sha", "noChanges", "error":
		default:
			t.Fatalf("unexpected top-level key %q (itemCommitReport has committed, sha, noChanges, error): %s", k, r.stdout)
		}
	}
	if !o.Keys["committed"] {
		t.Fatalf("stdout JSON lacks top-level committed: %s", r.stdout)
	}
	var typed struct {
		Committed bool   `json:"committed"`
		SHA       string `json:"sha"`
		NoChanges bool   `json:"noChanges"`
		Error     string `json:"error"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(r.stdout)), &typed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	o.Committed, o.SHA, o.NoChanges, o.Error = typed.Committed, typed.SHA, typed.NoChanges, typed.Error
	return o
}

// wantKeys asserts the exact top-level key set.
func (o ciOutput) wantKeys(t *testing.T, keys ...string) {
	t.Helper()
	want := map[string]bool{}
	for _, k := range keys {
		want[k] = true
	}
	for k := range want {
		if !o.Keys[k] {
			t.Errorf("missing key %q; have %v", k, o.Keys)
		}
	}
	for k := range o.Keys {
		if !want[k] {
			t.Errorf("unexpected key %q (agentStop's itemCommit omits it here); have %v", k, o.Keys)
		}
	}
}

// AC1: a staged item with changes gets its commit, SHA recorded, same shape as itemCommit.
func TestCommitItem_StagedItemGetsCommitAndSha(t *testing.T) {
	e := ciSetup(t, "staged")
	e.dirty(t)
	before := e.count(t)

	r := e.run(t)
	if r.err != nil {
		t.Fatalf("commitItem failed: %v\n%s%s", r.err, r.stdout, r.stderr)
	}
	out := parseCI(t, r)
	head := e.head(t)
	if !out.Committed {
		t.Errorf("committed = false, want true")
	}
	if out.SHA != head {
		t.Errorf("sha = %q, want HEAD %s", out.SHA, head)
	}
	// agentStop omits noChanges and error on success; so must this command.
	out.wantKeys(t, "committed", "sha")
	if e.count(t) == before {
		t.Error("no commit created")
	}
	if msg := e.git(t, "log", "-1", "--format=%B"); !strings.Contains(msg, "Item: "+ciItem) {
		t.Errorf("commit lacks Item trailer:\n%s", msg)
	}
	if got := e.stub.commitShaPatches(); len(got) != 1 || got[0] != head {
		t.Errorf("commitSha PATCHes = %v, want [%s]", got, head)
	}
	if r.stderr != "" && strings.Contains(r.stderr, "ITEM_COMMIT_FAILED") {
		t.Errorf("success must not print ITEM_COMMIT_FAILED: %s", r.stderr)
	}
}

// AC2: only `staged` is accepted; every other stage refuses, names the stage, changes nothing.
func TestCommitItem_RefusesNonStagedItems(t *testing.T) {
	for _, stage := range []string{"briefings", "ready", "testing", "implementing", "review", "probing", "done", "blocked"} {
		t.Run(stage, func(t *testing.T) {
			e := ciSetup(t, stage)
			e.dirty(t)
			before := e.count(t)

			r := e.run(t)
			if r.err == nil {
				t.Fatalf("want error for stage %s, got success: %s", stage, r.stdout)
			}
			if !strings.Contains(r.err.Error()+r.stderr+r.stdout, stage) {
				t.Errorf("refusal must name current stage %q: err=%v stderr=%q stdout=%q", stage, r.err, r.stderr, r.stdout)
			}
			if e.count(t) != before {
				t.Error("a commit was made for a non-staged item")
			}
			if e.stub.patchCount() != 0 {
				t.Errorf("non-staged refusal must PATCH nothing, got %v", e.stub.patches)
			}
			if got := e.git(t, "status", "--porcelain"); !strings.Contains(got, "impl.txt") {
				t.Error("impl.txt must remain uncommitted and dirty")
			}
		})
	}
}

// AC3: already committed (clean tree, no earlier trailer commit): no new commit, says nothing to commit.
func TestCommitItem_NothingToCommitMakesNoCommit(t *testing.T) {
	e := ciSetup(t, "staged")
	before := e.count(t)

	r := e.run(t)
	if r.err != nil {
		t.Fatalf("nothing-to-commit must exit 0, got %v", r.err)
	}
	if e.count(t) != before {
		t.Error("a commit was made with nothing to commit")
	}
	out := parseCI(t, r)
	if out.Committed || !out.NoChanges {
		t.Errorf("committed=%v noChanges=%v, want false/true (agentStop reports noChanges:true)", out.Committed, out.NoChanges)
	}
	// Not a failure, and nothing was committed: no sha or error keys.
	out.wantKeys(t, "committed", "noChanges")
	if len(e.stub.commitShaPatches()) != 0 {
		t.Errorf("no sha to record, got %v", e.stub.commitShaPatches())
	}
}

func TestCommitItem_NothingToCommitHumanOutputSaysSo(t *testing.T) {
	e := ciSetup(t, "staged")
	resetPersistentFlags(t)
	var out, errb bytes.Buffer
	rootCmd.SetOut(&out)
	rootCmd.SetErr(&errb)
	rootCmd.SetArgs([]string{"items-commit", "commitItem", "--itemId", ciItem, "--base-url", e.stub.srv.URL, "--no-color"})
	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("exit must be 0: %v", err)
	}
	if got := strings.ToLower(out.String() + errb.String()); !strings.Contains(got, "nothing to commit") {
		t.Errorf("output must say there was nothing to commit:\n%s", got)
	}
}

// AC3 again, end to end: a second run after a successful one adds no commit.
func TestCommitItem_SecondRunAfterSuccessMakesNoNewCommit(t *testing.T) {
	e := ciSetup(t, "staged")
	e.dirty(t)
	if r := e.run(t); r.err != nil {
		t.Fatalf("first run: %v\n%s%s", r.err, r.stdout, r.stderr)
	}
	afterFirst := e.count(t)
	firstHead := e.head(t)

	r := e.run(t)
	if r.err != nil {
		t.Fatalf("second run: %v", r.err)
	}
	if e.count(t) != afterFirst || e.head(t) != firstHead {
		t.Error("second run created another commit")
	}
	if out := parseCI(t, r); out.Committed || !out.NoChanges {
		t.Errorf("second run committed=%v noChanges=%v, want false/true", out.Committed, out.NoChanges)
	} else {
		out.wantKeys(t, "committed", "noChanges")
	}
	if got := e.stub.commitShaPatches(); len(got) != 1 {
		t.Errorf("sha must be recorded once, PATCHes = %v", got)
	}
}

// Carry-forward (WI-334 probing): the commit landed but the commitSha PATCH
// failed. The retry must record the existing commit's SHA instead of reporting
// "nothing to commit" and leaving the board without a SHA.
func TestCommitItem_RecoversShaOfCommitWhosePatchFailed(t *testing.T) {
	e := ciSetup(t, "staged")
	sha := e.commitWithTrailer(t, "impl.txt", "committed earlier\n", ciItem)
	before := e.count(t)

	r := e.run(t)
	if r.err != nil {
		t.Fatalf("recovery run failed: %v\n%s%s", r.err, r.stdout, r.stderr)
	}
	if e.count(t) != before {
		t.Error("recovery must not make a new commit")
	}
	if got := e.stub.commitShaPatches(); len(got) != 1 || got[0] != sha {
		t.Errorf("commitSha PATCHes = %v, want [%s]", got, sha)
	}
	out := parseCI(t, r)
	if !out.Committed {
		t.Errorf("committed = false, want true (a SHA was recorded)")
	}
	if out.SHA != sha {
		t.Errorf("sha = %q, want %s", out.SHA, sha)
	}
	out.wantKeys(t, "committed", "sha")
}

// A reworked item has several Item: commits; the newest one wins.
func TestCommitItem_RecoveryPicksNewestMatchingCommit(t *testing.T) {
	e := ciSetup(t, "staged")
	old := e.commitWithTrailer(t, "impl.txt", "first pass\n", ciItem)
	e.stub.commitSh = old // the board has the first pass's sha
	newest := e.commitWithTrailer(t, "impl.txt", "rework pass\n", ciItem)
	e.commitWithTrailer(t, "other.txt", "other item\n", "WI-999")

	r := e.run(t)
	if r.err != nil {
		t.Fatalf("run: %v\n%s%s", r.err, r.stdout, r.stderr)
	}
	if got := e.stub.commitShaPatches(); len(got) != 1 || got[0] != newest {
		t.Errorf("commitSha PATCHes = %v, want the newest matching commit [%s] (not %s)", got, newest, old)
	}
}

// Preservation: when the board already holds the newest matching sha, nothing is PATCHed.
func TestCommitItem_RecoveryDoesNotRepatchAnUpToDateSha(t *testing.T) {
	e := ciSetup(t, "staged")
	sha := e.commitWithTrailer(t, "impl.txt", "done already\n", ciItem)
	e.stub.commitSh = sha
	before := e.count(t)

	r := e.run(t)
	if r.err != nil {
		t.Fatalf("run: %v", r.err)
	}
	if e.count(t) != before {
		t.Error("no new commit expected")
	}
	if got := e.stub.commitShaPatches(); len(got) != 0 {
		t.Errorf("up-to-date sha must not be PATCHed again, got %v", got)
	}
	if out := parseCI(t, r); out.Committed || !out.NoChanges {
		t.Errorf("committed=%v noChanges=%v, want false/true", out.Committed, out.NoChanges)
	} else {
		out.wantKeys(t, "committed", "noChanges")
	}
}

// Only/never: the trailer match is exact. WI-3410 and a body mention of
// "Item: WI-341" are not this item's commit.
func TestCommitItem_RecoveryMatchesTrailerExactlyOnly(t *testing.T) {
	e := ciSetup(t, "staged")
	e.commitWithTrailer(t, "a.txt", "other\n", "WI-3410")
	writePRFile(t, filepath.Join(e.root, "b.txt"), "x\n")
	poolGit(t, e.root, "add", "b.txt")
	poolGit(t, e.root, "commit", "-m", "chore: mention", "-m", "This follows up Item: "+ciItem+" discussion, see notes.")
	before := e.count(t)

	r := e.run(t)
	if r.err != nil {
		t.Fatalf("run: %v", r.err)
	}
	if got := e.stub.commitShaPatches(); len(got) != 0 {
		t.Errorf("no commit carries a %s trailer, got PATCHes %v", ciItem, got)
	}
	if e.count(t) != before {
		t.Error("no new commit expected")
	}
	if out := parseCI(t, r); out.Committed || !out.NoChanges {
		t.Errorf("committed=%v noChanges=%v, want false/true", out.Committed, out.NoChanges)
	} else {
		out.wantKeys(t, "committed", "noChanges")
	}
}

// AC1 scenario: after fixing a branch mismatch the retry succeeds. Before the fix it fails loudly.
func TestCommitItem_BranchMismatchFailsLoudlyThenRetrySucceeds(t *testing.T) {
	e := ciSetup(t, "staged")
	e.dirty(t)
	poolGit(t, e.root, "checkout", "-b", "other")
	before := e.count(t)

	r := e.run(t)
	if r.err == nil {
		t.Fatalf("want error on branch mismatch, got success: %s", r.stdout)
	}
	if e.count(t) != before {
		t.Error("no commit may land on the wrong branch")
	}
	var failedLine string
	for _, line := range strings.Split(r.stderr, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "ITEM_COMMIT_FAILED") {
			failedLine = line
		}
	}
	if failedLine == "" {
		t.Fatalf("stderr needs an ITEM_COMMIT_FAILED line:\n%q", r.stderr)
	}
	if !strings.Contains(failedLine, "ALERT") {
		t.Errorf("ITEM_COMMIT_FAILED line must tell the agent to ALERT Hannibal: %s", failedLine)
	}
	out := parseCI(t, r)
	if out.Committed {
		t.Errorf("committed = true, want false")
	}
	if out.Error == "" {
		t.Errorf("error must be non-empty on failure")
	}
	out.wantKeys(t, "committed", "error")
	if e.stub.activityCount() != 1 {
		t.Errorf("want one activity entry for the failure, got %d", e.stub.activityCount())
	}
	if len(e.stub.commitShaPatches()) != 0 {
		t.Error("no sha may be recorded for a failed commit")
	}

	poolGit(t, e.root, "checkout", "mission/x")
	r = e.run(t)
	if r.err != nil {
		t.Fatalf("retry after fixing the branch failed: %v\n%s%s", r.err, r.stdout, r.stderr)
	}
	if out := parseCI(t, r); !out.Committed {
		t.Errorf("retry committed = false, want true")
	}
	if got := e.stub.commitShaPatches(); len(got) != 1 || got[0] != e.head(t) {
		t.Errorf("retry must record the new HEAD, PATCHes = %v", got)
	}
}

// Success must not log a failure activity entry.
func TestCommitItem_SuccessLogsNoFailureActivity(t *testing.T) {
	e := ciSetup(t, "staged")
	e.dirty(t)
	if r := e.run(t); r.err != nil {
		t.Fatalf("run: %v", r.err)
	}
	if n := e.stub.activityCount(); n != 0 {
		t.Errorf("success logged %d activity entries, want 0 failure entries", n)
	}
}

// Failure path: item lookup fails (API 404). Error, no commit.
func TestCommitItem_UnknownItemErrors(t *testing.T) {
	e := ciSetup(t, "staged")
	e.dirty(t)
	e.stub.notFound = true
	before := e.count(t)

	r := e.run(t)
	if r.err == nil {
		t.Fatalf("want error for unknown item, got %s", r.stdout)
	}
	if e.count(t) != before {
		t.Error("no commit expected for an unknown item")
	}
}

// Command wiring: it is registered under the parent `items-commit`.
func TestCommitItem_IsRegisteredUnderItemsCommit(t *testing.T) {
	c, _, err := rootCmd.Find([]string{"items-commit", "commitItem"})
	if err != nil || c == nil || c.Name() != "commitItem" {
		t.Fatalf("items-commit commitItem not registered: cmd=%v err=%v", c, err)
	}
	if c.Flags().Lookup("itemId") == nil {
		t.Error("commitItem needs an --itemId flag")
	}
}
