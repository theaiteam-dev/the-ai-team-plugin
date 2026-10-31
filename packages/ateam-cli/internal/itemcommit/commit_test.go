package itemcommit

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ateam/internal/client"
)

// Contract pinned by these tests (implemented in commit.go, WI-334):
//
//	type Options struct {
//	    Client    *client.Client // API client (tests point it at an httptest stub)
//	    ItemID    string
//	    Agent     string // recorded on the no-changes work-log note
//	    Dir       string // working directory; may be a repo subdirectory
//	    PoolRoot  string // parent of the per-mission pool dir ("/tmp/.ateam-pool" when empty)
//	    MissionID string // when empty: $ATEAM_MISSION_ID, then GET /api/missions/current
//	}
//	type CommitResult struct {
//	    SHA       string   // new HEAD SHA; empty when nothing was committed
//	    NoChanges bool     // attributed path set was empty
//	    Paths     []string // committed paths
//	}
//	func Run(opts Options) (CommitResult, error)

const testMission = "M-T1"

type stubItem struct {
	ID, Title, Type, Stage string
	Outputs                map[string]string
	WorkLogs               []map[string]string
}

type apiStub struct {
	t       *testing.T
	srv     *httptest.Server
	mu      sync.Mutex
	items   map[string]stubItem
	prdPath string
	patches map[string][]map[string]any
	missing map[string]bool // item ids whose GET returns 404
	gets    []string
}

func defaultLog() []map[string]string {
	return []map[string]string{
		{"agent": "murdock-1", "action": "completed", "timestamp": "2026-10-11T10:00:00Z"},
		{"agent": "ba-1", "action": "completed", "timestamp": "2026-10-11T11:00:00Z"},
	}
}

func newStub(t *testing.T, items ...stubItem) *apiStub {
	t.Helper()
	s := &apiStub{t: t, items: map[string]stubItem{}, prdPath: "prd/ready/item-commits.md",
		patches: map[string][]map[string]any{}, missing: map[string]bool{}}
	for _, it := range items {
		if it.Type == "" {
			it.Type = "feature"
		}
		if it.Stage == "" {
			it.Stage = "staged"
		}
		if it.WorkLogs == nil {
			it.WorkLogs = defaultLog()
		}
		s.items[it.ID] = it
	}
	s.srv = httptest.NewServer(http.HandlerFunc(s.handle))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *apiStub) json(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (it stubItem) wire() map[string]any {
	return map[string]any{
		"id": it.ID, "title": it.Title, "type": it.Type, "stageId": it.Stage,
		"outputs": it.Outputs, "workLogs": it.WorkLogs, "dependencies": []string{},
	}
}

func (s *apiStub) handle(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gets = append(s.gets, r.Method+" "+r.URL.Path)
	path := strings.TrimSuffix(r.URL.Path, "/")
	switch {
	case r.Method == http.MethodGet && path == "/api/missions/current":
		s.json(w, 200, map[string]any{"success": true, "data": map[string]any{"id": testMission, "prdPath": s.prdPath}})
	case r.Method == http.MethodGet && path == "/api/items":
		var all []map[string]any
		for _, it := range s.items {
			all = append(all, it.wire())
		}
		s.json(w, 200, map[string]any{"success": true, "data": all})
	case strings.HasPrefix(path, "/api/items/"):
		id := strings.TrimPrefix(path, "/api/items/")
		it, ok := s.items[id]
		if !ok || s.missing[id] {
			s.json(w, 404, map[string]any{"success": false, "error": map[string]any{"code": "ITEM_NOT_FOUND", "message": "no such item"}})
			return
		}
		if r.Method == http.MethodPatch {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			s.patches[id] = append(s.patches[id], body)
			s.json(w, 200, map[string]any{"success": true, "data": it.wire()})
			return
		}
		s.json(w, 200, map[string]any{"success": true, "data": it.wire()})
	default:
		s.json(w, 404, map[string]any{"success": false, "error": map[string]any{"code": "NOT_FOUND", "message": r.URL.Path}})
	}
}

func (s *apiStub) patchesFor(id string) []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]map[string]any(nil), s.patches[id]...)
}

func (s *apiStub) totalPatches() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, p := range s.patches {
		n += len(p)
	}
	return n
}

type env struct {
	root     string
	poolRoot string
	poolDir  string
	stub     *apiStub
}

func (e env) opts(id string) Options {
	return Options{
		Client:    client.NewClient(e.stub.srv.URL, ""),
		ItemID:    id,
		Agent:     "ba-1",
		Dir:       e.root,
		PoolRoot:  e.poolRoot,
		MissionID: testMission,
	}
}

// setup builds a repo on branch "mission" with a.txt b.txt c.txt d.txt committed,
// records branch + baseline in a temp pool dir, and strips ambient mission env.
func setup(t *testing.T, items ...stubItem) env {
	t.Helper()
	t.Setenv("ATEAM_MISSION_ID", testMission)
	t.Setenv("ATEAM_PROJECT_ID", "")
	root := newRepo(t, "mission")
	for _, f := range []string{"a.txt", "b.txt", "c.txt", "d.txt"} {
		write(t, filepath.Join(root, f), "orig "+f+"\n")
	}
	git(t, root, "add", ".")
	git(t, root, "commit", "-m", "base files")
	poolRoot := t.TempDir()
	poolDir := filepath.Join(poolRoot, testMission)
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := RecordBranch(poolDir, root); err != nil {
		t.Fatal(err)
	}
	if err := RecordBaselineDirty(poolDir, root); err != nil {
		t.Fatal(err)
	}
	return env{root: root, poolRoot: poolRoot, poolDir: poolDir, stub: newStub(t, items...)}
}

func item(id, title string, outputs ...string) stubItem {
	o := map[string]string{}
	keys := []string{"impl", "test", "types"}
	for i, p := range outputs {
		o[keys[i]] = p
	}
	return stubItem{ID: id, Title: title, Type: "feature", Stage: "staged", Outputs: o, WorkLogs: defaultLog()}
}

func expectedMessage(t *testing.T, it stubItem, undeclared []string) string {
	t.Helper()
	var wl []WorkLogEntry
	for _, e := range it.WorkLogs {
		wl = append(wl, WorkLogEntry{Agent: e["agent"], Action: e["action"], Timestamp: e["timestamp"]})
	}
	msg, err := BuildMessage(CommitItem{ID: it.ID, Title: it.Title, Type: it.Type}, wl, testMission, "prd/ready/item-commits.md", undeclared)
	if err != nil {
		t.Fatal(err)
	}
	return msg
}

func commitCount(t *testing.T, root string) string {
	return git(t, root, "rev-list", "--count", "HEAD")
}

func filesInHead(t *testing.T, root string) []string {
	out := git(t, root, "show", "--name-only", "--format=", "HEAD")
	if out == "" {
		return nil
	}
	return strings.Split(out, "\n")
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := map[string]int{}
	for _, x := range a {
		m[x]++
	}
	for _, x := range b {
		m[x]--
	}
	for _, v := range m {
		if v != 0 {
			return false
		}
	}
	return true
}

// AC1 + AC2 + AC6: only the item's paths are committed, others stay dirty or
// staged, message comes from BuildMessage, SHA is PATCHed, committed paths are
// clean in status.
func TestRun_CommitsOnlyAttributedPaths(t *testing.T) {
	self := item("WI-1", "Add widget", "a.txt", "new.txt")
	other := item("WI-2", "Other work", "b.txt", "c.txt")
	other.Stage = "implementing"
	e := setup(t, self, other)

	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	write(t, filepath.Join(e.root, "new.txt"), "brand new\n") // untracked, declared
	if err := os.Remove(filepath.Join(e.root, "gone.txt")); err != nil {
		t.Fatal(err)
	}
	self.Outputs["types"] = "gone.txt" // a declared deletion
	e.stub.items["WI-1"] = self
	write(t, filepath.Join(e.root, "b.txt"), "unrelated edit\n")
	write(t, filepath.Join(e.root, "c.txt"), "staged by someone else\n")
	git(t, e.root, "add", "c.txt")
	before := commitCount(t, e.root)

	res, err := Run(e.opts("WI-1"))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	head := git(t, e.root, "rev-parse", "HEAD")
	if res.SHA != head {
		t.Errorf("result SHA %q, want HEAD %q", res.SHA, head)
	}
	if got := filesInHead(t, e.root); !sameSet(got, []string{"a.txt", "new.txt", "gone.txt"}) {
		t.Errorf("commit holds %v, want exactly a.txt new.txt gone.txt", got)
	}
	if n := commitCount(t, e.root); n == before {
		t.Error("no commit was created")
	}
	if got := git(t, e.root, "log", "-1", "--format=%B"); strings.TrimSpace(got) != strings.TrimSpace(expectedMessage(t, self, nil)) {
		t.Errorf("message\n%s\nwant\n%s", got, expectedMessage(t, self, nil))
	}

	status := git(t, e.root, "status", "--porcelain")
	for _, f := range []string{"a.txt", "new.txt", "gone.txt"} {
		if strings.Contains(status, f) {
			t.Errorf("status still lists committed path %s:\n%s", f, status)
		}
	}
	if !strings.Contains(status, "M b.txt") || strings.Contains(status, "M  b.txt") {
		t.Errorf("b.txt must stay modified and unstaged:\n%s", status)
	}
	if !strings.Contains(status, "M  c.txt") {
		t.Errorf("c.txt must stay staged:\n%s", status)
	}
	if got := git(t, e.root, "show", ":c.txt"); got != "staged by someone else" {
		t.Errorf("staged content of c.txt changed to %q", got)
	}
	if got := git(t, e.root, "show", ":a.txt"); got != "mine" {
		t.Errorf("index a.txt = %q, want it to match the new HEAD", got)
	}

	patches := e.stub.patchesFor("WI-1")
	if len(patches) != 1 || patches[0]["commitSha"] != head {
		t.Errorf("PATCHes for WI-1 = %v, want one {commitSha:%s}", patches, head)
	}
}

// AC2 preservation: a follow-up `git add -A && git commit` by someone else must
// not revert the item commit (the real index was refreshed for committed paths).
func TestRun_NextCommitDoesNotRevertItemCommit(t *testing.T) {
	e := setup(t, item("WI-1", "Add widget", "a.txt"))
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	if _, err := Run(e.opts("WI-1")); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(e.root, "b.txt"), "later\n")
	git(t, e.root, "add", "-A")
	git(t, e.root, "commit", "-m", "later work")
	if got := git(t, e.root, "show", "HEAD:a.txt"); got != "mine" {
		t.Errorf("a.txt at HEAD = %q: the later commit reverted the item commit", got)
	}
	if files := filesInHead(t, e.root); !sameSet(files, []string{"b.txt"}) {
		t.Errorf("later commit touched %v, want only b.txt", files)
	}
}

// ADR 0012: baseline-dirty paths are never committed, even when undeclared or declared by the item.
func TestRun_NeverCommitsBaselineDirtyPaths(t *testing.T) {
	self := item("WI-1", "Add widget", "a.txt", "d.txt")
	e := setup(t, self)
	// dirty d.txt BEFORE the baseline is taken: re-record on a fresh pool dir.
	write(t, filepath.Join(e.root, "d.txt"), "pre-mission edit\n")
	write(t, filepath.Join(e.root, "e-pre.txt"), "pre-mission untracked\n")
	fresh := t.TempDir()
	e.poolRoot = fresh
	e.poolDir = filepath.Join(fresh, testMission)
	if err := RecordBranch(e.poolDir, e.root); err != nil {
		t.Fatal(err)
	}
	if err := RecordBaselineDirty(e.poolDir, e.root); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")

	if _, err := Run(e.opts("WI-1")); err != nil {
		t.Fatal(err)
	}
	if got := filesInHead(t, e.root); !sameSet(got, []string{"a.txt"}) {
		t.Errorf("commit holds %v, want only a.txt", got)
	}
	status := git(t, e.root, "status", "--porcelain")
	if !strings.Contains(status, "M d.txt") || !strings.Contains(status, "?? e-pre.txt") {
		t.Errorf("baseline-dirty files must stay dirty:\n%s", status)
	}
}

// Undeclared path nobody owns is committed and listed in the message body.
func TestRun_UndeclaredPathIncludedAndNamedInMessage(t *testing.T) {
	self := item("WI-1", "Add widget", "a.txt")
	e := setup(t, self)
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	write(t, filepath.Join(e.root, "helper.txt"), "nobody declared me\n")
	if _, err := Run(e.opts("WI-1")); err != nil {
		t.Fatal(err)
	}
	if got := filesInHead(t, e.root); !sameSet(got, []string{"a.txt", "helper.txt"}) {
		t.Errorf("commit holds %v", got)
	}
	if got := git(t, e.root, "log", "-1", "--format=%B"); strings.TrimSpace(got) != strings.TrimSpace(expectedMessage(t, self, []string{"helper.txt"})) {
		t.Errorf("message\n%s", got)
	}
}

// AC3: branch mismatch -> failure, no commit, no SHA, tree intact.
func TestRun_BranchMismatchFailsWithoutCommitting(t *testing.T) {
	e := setup(t, item("WI-1", "Add widget", "a.txt"))
	git(t, e.root, "checkout", "-q", "-b", "elsewhere")
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	before := git(t, e.root, "rev-parse", "HEAD")

	res, err := Run(e.opts("WI-1"))
	if err == nil {
		t.Fatal("want an error on branch mismatch")
	}
	if !strings.Contains(err.Error(), "branch mismatch") {
		t.Errorf("error should carry the CheckBranch message, got: %v", err)
	}
	if res.SHA != "" {
		t.Errorf("SHA = %q, want empty", res.SHA)
	}
	if after := git(t, e.root, "rev-parse", "HEAD"); after != before {
		t.Error("HEAD moved despite branch mismatch")
	}
	if e.stub.totalPatches() != 0 {
		t.Errorf("no PATCH expected, got %v", e.stub.patches)
	}
	if b, _ := os.ReadFile(filepath.Join(e.root, "a.txt")); string(b) != "mine\n" {
		t.Error("working-tree change was lost")
	}
}

// AC4: empty attributed set -> no commit, work-log note only.
func TestRun_NoChangesRecordsWorkLogNote(t *testing.T) {
	other := item("WI-2", "Other", "b.txt")
	other.Stage = "implementing"
	e := setup(t, item("WI-1", "Add widget", "a.txt"), other)
	write(t, filepath.Join(e.root, "b.txt"), "someone else's\n") // owned by unfinished WI-2
	before := commitCount(t, e.root)

	res, err := Run(e.opts("WI-1"))
	if err != nil {
		t.Fatalf("no-changes must not be an error: %v", err)
	}
	if !res.NoChanges || res.SHA != "" {
		t.Errorf("result = %+v, want NoChanges and no SHA", res)
	}
	if commitCount(t, e.root) != before {
		t.Error("a commit was made with nothing attributed")
	}
	patches := e.stub.patchesFor("WI-1")
	if len(patches) != 1 {
		t.Fatalf("want exactly one PATCH, got %v", patches)
	}
	if _, has := patches[0]["commitSha"]; has {
		t.Error("commitSha must not be sent")
	}
	note, ok := patches[0]["workLogNote"].(map[string]any)
	if !ok {
		t.Fatalf("workLogNote missing: %v", patches[0])
	}
	if note["agent"] != "ba-1" {
		t.Errorf("note agent = %v, want ba-1", note["agent"])
	}
	if s, _ := note["summary"].(string); !strings.Contains(strings.ToLower(s), "no changes") {
		t.Errorf("note summary %q should say there were no changes to commit", s)
	}
}

// AC5: two simultaneous commits for different items both succeed.
func TestRun_ConcurrentCommitsBothSucceed(t *testing.T) {
	e := setup(t, item("WI-1", "First", "a.txt"), item("WI-2", "Second", "b.txt"))
	write(t, filepath.Join(e.root, "a.txt"), "one\n")
	write(t, filepath.Join(e.root, "b.txt"), "two\n")
	before := commitCount(t, e.root)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	start := make(chan struct{})
	for i, id := range []string{"WI-1", "WI-2"} {
		wg.Add(1)
		go func(i int, id string) {
			defer wg.Done()
			<-start
			_, errs[i] = Run(e.opts(id))
		}(i, id)
	}
	close(start)
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Errorf("run %d failed: %v", i, err)
		}
	}
	if got := commitCount(t, e.root); got != fmt.Sprint(atoiT(t, before)+2) {
		t.Errorf("commit count %s, want %d", got, atoiT(t, before)+2)
	}
	if got := git(t, e.root, "show", "HEAD:a.txt") + git(t, e.root, "show", "HEAD:b.txt"); got != "onetwo" {
		t.Errorf("HEAD contents %q", got)
	}
	log := git(t, e.root, "log", "-2", "--format=%H", "--name-only")
	if strings.Count(log, "a.txt") != 1 || strings.Count(log, "b.txt") != 1 {
		t.Errorf("each file must appear in exactly one commit:\n%s", log)
	}
	if got := git(t, e.root, "status", "--porcelain"); got != "" {
		t.Errorf("status not clean:\n%s", got)
	}
	if len(e.stub.patchesFor("WI-1")) != 1 || len(e.stub.patchesFor("WI-2")) != 1 {
		t.Error("each item needs its own commitSha PATCH")
	}
}

func atoiT(t *testing.T, s string) int {
	var n int
	if _, err := fmt.Sscanf(s, "%d", &n); err != nil {
		t.Fatal(err)
	}
	return n
}

// AC5: retry when git's index.lock is held briefly.
func TestRun_RetriesWhileIndexLockHeld(t *testing.T) {
	e := setup(t, item("WI-1", "Add widget", "a.txt"))
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	lock := filepath.Join(e.root, ".git", "index.lock")
	if err := os.WriteFile(lock, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(400 * time.Millisecond)
		_ = os.Remove(lock)
	}()
	if _, err := Run(e.opts("WI-1")); err != nil {
		t.Fatalf("should retry past a transient index.lock: %v", err)
	}
	if got := git(t, e.root, "show", "HEAD:a.txt"); got != "mine" {
		t.Errorf("HEAD a.txt = %q", got)
	}
}

// AC5: called from a subdirectory, commits against the repo root.
func TestRun_FromSubdirectoryCommitsAtRepoRoot(t *testing.T) {
	e := setup(t, item("WI-1", "Add widget", "a.txt", "sub/deep.txt"))
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	write(t, filepath.Join(e.root, "sub", "deep.txt"), "deep\n")
	opts := e.opts("WI-1")
	opts.Dir = filepath.Join(e.root, "sub")
	if _, err := Run(opts); err != nil {
		t.Fatal(err)
	}
	if got := filesInHead(t, e.root); !sameSet(got, []string{"a.txt", "sub/deep.txt"}) {
		t.Errorf("commit holds %v", got)
	}
}

// AC7: no ATEAM_MISSION_ID and no explicit MissionID -> GET /api/missions/current.
func TestRun_ResolvesMissionFromAPIWhenEnvUnset(t *testing.T) {
	e := setup(t, item("WI-1", "Add widget", "a.txt"))
	os.Unsetenv("ATEAM_MISSION_ID")
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	opts := e.opts("WI-1")
	opts.MissionID = ""
	if _, err := Run(opts); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := git(t, e.root, "log", "-1", "--format=%B"); !strings.Contains(got, "Mission: "+testMission) {
		t.Errorf("message lacks resolved mission id:\n%s", got)
	}
	found := false
	for _, g := range e.stub.gets {
		if g == "GET /api/missions/current" {
			found = true
		}
	}
	if !found {
		t.Errorf("never called GET /api/missions/current: %v", e.stub.gets)
	}
}

// Rework: a second call adds a second commit (never amends) with the same Item trailer.
func TestRun_ReworkAddsSecondCommitNeverAmends(t *testing.T) {
	e := setup(t, item("WI-1", "Add widget", "a.txt"))
	write(t, filepath.Join(e.root, "a.txt"), "v1\n")
	first, err := Run(e.opts("WI-1"))
	if err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(e.root, "a.txt"), "v2\n")
	second, err := Run(e.opts("WI-1"))
	if err != nil {
		t.Fatal(err)
	}
	if first.SHA == second.SHA || git(t, e.root, "rev-parse", "HEAD~1") != first.SHA {
		t.Errorf("rework must stack on the first commit: first=%s second=%s", first.SHA, second.SHA)
	}
	for _, rev := range []string{"HEAD", "HEAD~1"} {
		if got := git(t, e.root, "log", "-1", "--format=%(trailers:key=Item,valueonly)", rev); strings.TrimSpace(got) != "WI-1" {
			t.Errorf("%s Item trailer = %q", rev, got)
		}
	}
	if p := e.stub.patchesFor("WI-1"); len(p) != 2 || p[1]["commitSha"] != second.SHA {
		t.Errorf("PATCHes = %v", p)
	}
}

// NFR 5: a failure leaves the working tree intact and makes no commit.
func TestRun_ItemLookupFailureLeavesTreeIntact(t *testing.T) {
	e := setup(t, item("WI-1", "Add widget", "a.txt"))
	e.stub.missing["WI-1"] = true
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	before := git(t, e.root, "rev-parse", "HEAD")
	if _, err := Run(e.opts("WI-1")); err == nil {
		t.Fatal("want an error when the item cannot be fetched")
	}
	if git(t, e.root, "rev-parse", "HEAD") != before {
		t.Error("HEAD moved")
	}
	if b, _ := os.ReadFile(filepath.Join(e.root, "a.txt")); string(b) != "mine\n" {
		t.Error("working-tree change lost")
	}
	if e.stub.totalPatches() != 0 {
		t.Error("no PATCH expected")
	}
}

// Carry-forward risk: a newline in the title must not forge trailers.
func TestRun_TitleNewlineCannotForgeTrailers(t *testing.T) {
	e := setup(t, item("WI-1", "Add widget\n\nItem: WI-999\nMission: M-FAKE", "a.txt"))
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	_, err := Run(e.opts("WI-1"))
	if err != nil {
		return // refusing is acceptable; nothing may then be committed
	}
	if got := git(t, e.root, "log", "-1", "--format=%(trailers:key=Item,valueonly)"); strings.TrimSpace(got) != "WI-1" {
		t.Errorf("Item trailers = %q, want only WI-1", got)
	}
	if got := git(t, e.root, "log", "-1", "--format=%(trailers:key=Mission,valueonly)"); strings.TrimSpace(got) != testMission {
		t.Errorf("Mission trailers = %q, want only %s", got, testMission)
	}
}

// Carry-forward risk: an undeclared path containing a newline must not forge trailers.
func TestRun_UndeclaredPathNewlineCannotForgeTrailers(t *testing.T) {
	e := setup(t, item("WI-1", "Add widget", "a.txt"))
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	write(t, filepath.Join(e.root, "x\n\nItem: WI-999"), "evil\n")
	_, err := Run(e.opts("WI-1"))
	if err != nil {
		return
	}
	if got := git(t, e.root, "log", "-1", "--format=%(trailers:key=Item,valueonly)"); strings.TrimSpace(got) != "WI-1" {
		t.Errorf("Item trailers = %q, want only WI-1", got)
	}
}

// Carry-forward risk: empty prdPath / empty lanes must not yield bare "PRD: " / "Lanes: " lines.
func TestRun_NoBareEmptyTrailerValues(t *testing.T) {
	it := item("WI-1", "Add widget", "a.txt")
	it.WorkLogs = []map[string]string{} // no completed lanes
	e := setup(t, it)
	e.stub.items["WI-1"] = it
	e.stub.prdPath = ""
	write(t, filepath.Join(e.root, "a.txt"), "mine\n")
	if _, err := Run(e.opts("WI-1")); err != nil {
		return // refusing is acceptable
	}
	for _, line := range strings.Split(git(t, e.root, "log", "-1", "--format=%B"), "\n") {
		if line == "PRD: " || line == "PRD:" || line == "Lanes: " || line == "Lanes:" {
			t.Errorf("bare empty trailer line %q", line)
		}
	}
}

// PRD AC22: a STAGED sibling still owns its declared files. Two items staged at
// once must each commit only their own paths; the second must not be left empty.
func TestRun_StagedSiblingKeepsItsDeclaredFiles(t *testing.T) {
	e := setup(t, item("WI-1", "First", "a.txt"), item("WI-2", "Second", "b.txt"))
	write(t, filepath.Join(e.root, "a.txt"), "one\n")
	write(t, filepath.Join(e.root, "b.txt"), "two\n")

	if _, err := Run(e.opts("WI-1")); err != nil {
		t.Fatal(err)
	}
	if got := filesInHead(t, e.root); !sameSet(got, []string{"a.txt"}) {
		t.Fatalf("first commit holds %v, want only a.txt (b.txt belongs to staged WI-2)", got)
	}
	if status := git(t, e.root, "status", "--porcelain"); !strings.Contains(status, "M b.txt") {
		t.Fatalf("b.txt must stay modified for WI-2:\n%s", status)
	}

	res, err := Run(e.opts("WI-2"))
	if err != nil {
		t.Fatal(err)
	}
	if res.NoChanges || res.SHA == "" {
		t.Fatalf("WI-2 must have something to commit, got %+v", res)
	}
	if got := filesInHead(t, e.root); !sameSet(got, []string{"b.txt"}) {
		t.Errorf("second commit holds %v, want only b.txt", got)
	}
	if got := git(t, e.root, "log", "-1", "--format=%(trailers:key=Item,valueonly)"); strings.TrimSpace(got) != "WI-2" {
		t.Errorf("Item trailer = %q", got)
	}
}
