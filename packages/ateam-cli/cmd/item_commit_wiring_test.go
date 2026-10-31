package cmd

// WI-335: wiring of itemcommit.Run into agentStop and board-move moveItem.
//
// Contract pinned here (implemented in agents-stop_agentStop.go and
// board-move_moveItem.go):
//   - The commit runs only after the API confirms the move AND the item landed
//     in "staged" (agentStop: data.nextStage == "staged", not wipExceeded;
//     moveItem: toStage == "staged", both --flags and --body paths).
//   - The JSON response gains data.itemCommit:
//     success    {committed: true, sha: "<sha>"}
//     failure    {committed: false, error: "<msg>"} (+ sha when a commit exists)
//   - A failed commit exits 0, prints an ITEM_COMMIT_FAILED line on stderr that
//     tells the agent to ALERT Hannibal, and POSTs /api/activity naming the item
//     and the error (agentStop: agent = the calling agent).
//   - Run is called exactly once. When Run returns a SHA with an error (the git
//     commit exists but the commitSha PATCH failed), that SHA is surfaced in
//     itemCommit.sha and on stderr, and Run is never re-run.
//
// The repo is the process cwd; the pool root is /tmp/.ateam-pool/<mission>, so
// every test uses a unique mission id and removes its pool dir.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"ateam/internal/itemcommit"
)

type icServer struct {
	srv     *httptest.Server
	mu      sync.Mutex
	calls   []string
	patches []map[string]any
	acts    []map[string]any
	// patchFails makes PATCH /api/items/{id} return 500.
	patchFails bool
	// stopResp / moveResp are the bodies for the move endpoints.
	stopResp map[string]any
	moveResp map[string]any
	// moveFails makes POST /api/board/move return a 409 error envelope.
	moveFails bool
}

func (s *icServer) record(c string) {
	s.mu.Lock()
	s.calls = append(s.calls, c)
	s.mu.Unlock()
}

func (s *icServer) count(prefix string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, c := range s.calls {
		if strings.HasPrefix(c, prefix) {
			n++
		}
	}
	return n
}

func icWire(id, stage string) map[string]any {
	return map[string]any{
		"id": id, "title": "Widget " + id, "type": "feature", "stageId": stage,
		"outputs":      map[string]string{"impl": "widget.txt"},
		"dependencies": []string{},
		"workLogs": []map[string]string{
			{"agent": "murdock-1", "action": "completed", "timestamp": "2026-10-11T10:00:00Z"},
		},
	}
}

func icStopResp(next string) map[string]any {
	return map[string]any{"success": true, "data": map[string]any{
		"itemId": "WI-001", "agent": "Amy", "nextStage": next,
		"workLogEntry": map[string]any{"id": 1, "agent": "Amy", "action": "completed", "summary": "x", "timestamp": "2026-01-21T14:00:00Z"},
	}}
}

func icMoveResp(stage string) map[string]any {
	return map[string]any{"success": true, "data": map[string]any{"itemId": "WI-001", "toStage": stage}}
}

func newICServer(t *testing.T) *icServer {
	t.Helper()
	s := &icServer{stopResp: icStopResp("staged"), moveResp: icMoveResp("staged")}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimSuffix(r.URL.Path, "/")
		s.record(r.Method + " " + path)
		w.Header().Set("Content-Type", "application/json")
		write := func(status int, v any) {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(v)
		}
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		switch {
		case r.Method == http.MethodPost && path == "/api/agents/stop":
			write(200, s.stopResp)
		case r.Method == http.MethodPost && path == "/api/board/move":
			if s.moveFails {
				write(409, map[string]any{"success": false, "error": map[string]any{"code": "INVALID_TRANSITION", "message": "nope"}})
				return
			}
			write(200, s.moveResp)
		case r.Method == http.MethodPost && path == "/api/activity":
			s.mu.Lock()
			s.acts = append(s.acts, body)
			s.mu.Unlock()
			write(200, map[string]any{"success": true, "data": map[string]any{}})
		case r.Method == http.MethodGet && path == "/api/missions/current":
			write(200, map[string]any{"success": true, "data": map[string]any{"id": os.Getenv("ATEAM_MISSION_ID"), "prdPath": "prd/ready/item-commits.md"}})
		case r.Method == http.MethodGet && path == "/api/items":
			write(200, map[string]any{"success": true, "data": []any{icWire("WI-001", "staged")}})
		case strings.HasPrefix(path, "/api/items/"):
			id := strings.TrimPrefix(path, "/api/items/")
			if r.Method == http.MethodPatch {
				s.mu.Lock()
				s.patches = append(s.patches, body)
				fail := s.patchFails
				s.mu.Unlock()
				if fail {
					write(500, map[string]any{"success": false, "error": map[string]any{"code": "INTERNAL", "message": "db down"}})
					return
				}
			}
			write(200, map[string]any{"success": true, "data": icWire(id, "staged")})
		default:
			write(404, map[string]any{"success": false, "error": map[string]any{"code": "NOT_FOUND", "message": path}})
		}
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func icGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	c := exec.Command("git", append([]string{"-C", dir}, args...)...)
	c.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
	out, err := c.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

type icEnv struct {
	root    string
	poolDir string
	mission string
	srv     *icServer
}

var icSeq int

// icSetup builds a repo on branch "mission" with a dirty widget.txt (declared
// by WI-001), records branch + baseline in /tmp/.ateam-pool/<unique mission>,
// chdirs into the repo, and isolates git config and mission env.
func icSetup(t *testing.T) icEnv {
	t.Helper()
	icSeq++
	mission := fmt.Sprintf("M-WI335-%d-%d", os.Getpid(), icSeq)
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("HOME", t.TempDir())
	t.Setenv("ATEAM_MISSION_ID", mission)
	t.Setenv("ATEAM_PROJECT_ID", "")
	t.Setenv("GIT_AUTHOR_NAME", "t")
	t.Setenv("GIT_AUTHOR_EMAIL", "t@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "t")
	t.Setenv("GIT_COMMITTER_EMAIL", "t@example.com")

	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	icGit(t, root, "init", "-b", "mission")
	if err := os.WriteFile(filepath.Join(root, "widget.txt"), []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	icGit(t, root, "add", ".")
	icGit(t, root, "commit", "-m", "base")

	poolDir := filepath.Join("/tmp/.ateam-pool", mission)
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(poolDir) })
	if err := itemcommit.RecordBranch(poolDir, root); err != nil {
		t.Fatal(err)
	}
	if err := itemcommit.RecordBaselineDirty(poolDir, root); err != nil {
		t.Fatal(err)
	}
	// The mission's work: modify the declared file.
	if err := os.WriteFile(filepath.Join(root, "widget.txt"), []byte("v2 mission work\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	prev, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(prev) })

	return icEnv{root: root, poolDir: poolDir, mission: mission, srv: newICServer(t)}
}

func (e icEnv) headCount(t *testing.T) string {
	return icGit(t, e.root, "rev-list", "--count", "HEAD")
}

func icResetMoveItemFlags() {
	boardMoveMoveItemCmdBody = ""
	boardMoveMoveItemCmdBodyFile = ""
	boardMoveMoveItemCmd_force = false
	boardMoveMoveItemCmd_itemId = ""
	boardMoveMoveItemCmd_toStage = ""
	for _, name := range []string{"body", "body-file", "force", "itemId", "toStage"} {
		if f := boardMoveMoveItemCmd.Flags().Lookup(name); f != nil {
			f.Changed = false
			if name == "force" {
				_ = f.Value.Set("false")
			} else {
				_ = f.Value.Set("")
			}
		}
	}
}

type icResult struct {
	stdout string
	stderr string
	err    error
	json   map[string]any
}

func (r icResult) itemCommit(t *testing.T) map[string]any {
	t.Helper()
	data, _ := r.json["data"].(map[string]any)
	ic, ok := data["itemCommit"].(map[string]any)
	if !ok {
		t.Fatalf("response has no data.itemCommit object; stdout=%s", r.stdout)
	}
	return ic
}

func (r icResult) hasItemCommit() bool {
	data, _ := r.json["data"].(map[string]any)
	_, ok := data["itemCommit"]
	return ok
}

// icCapture runs fn while capturing real stdout and stderr (the commands print
// to os.Stdout/os.Stderr directly).
func icCapture(t *testing.T, fn func() error) icResult {
	t.Helper()
	origOut, origErr := os.Stdout, os.Stderr
	outR, outW, _ := os.Pipe()
	errR, errW, _ := os.Pipe()
	os.Stdout, os.Stderr = outW, errW
	var outBuf, errBuf strings.Builder
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _, _ = io.Copy(&outBuf, outR) }()
	go func() { defer wg.Done(); _, _ = io.Copy(&errBuf, errR) }()
	err := fn()
	os.Stdout, os.Stderr = origOut, origErr
	_ = outW.Close()
	_ = errW.Close()
	wg.Wait()
	res := icResult{stdout: outBuf.String(), stderr: errBuf.String(), err: err}
	// The JSON document is the first line starting with "{".
	for _, line := range strings.Split(res.stdout, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "{") {
			_ = json.Unmarshal([]byte(line), &res.json)
			break
		}
	}
	return res
}

func icAgentStop(t *testing.T, e icEnv, extra ...string) icResult {
	t.Helper()
	resetAgentsStopAgentStopFlagsForTest()
	t.Cleanup(resetAgentsStopAgentStopFlagsForTest)
	args := append([]string{
		"agents-stop", "agentStop", "--base-url", e.srv.srv.URL, "--json", "--no-color",
		"--itemId", "WI-001", "--agent", "Amy", "--summary", "probed",
	}, extra...)
	return icCapture(t, func() error {
		rootCmd.SetArgs(args)
		return rootCmd.Execute()
	})
}

func icMoveItem(t *testing.T, e icEnv, extra ...string) icResult {
	t.Helper()
	icResetMoveItemFlags()
	t.Cleanup(icResetMoveItemFlags)
	args := append([]string{"board-move", "moveItem", "--base-url", e.srv.srv.URL, "--json", "--no-color"}, extra...)
	return icCapture(t, func() error {
		rootCmd.SetArgs(args)
		return rootCmd.Execute()
	})
}

func icLastMessage(t *testing.T, e icEnv) string {
	t.Helper()
	e.srv.mu.Lock()
	defer e.srv.mu.Unlock()
	if len(e.srv.acts) == 0 {
		t.Fatalf("no activity entry was POSTed")
	}
	m, _ := e.srv.acts[len(e.srv.acts)-1]["message"].(string)
	return m
}

func icBreakBranch(t *testing.T, e icEnv) {
	t.Helper()
	icGit(t, e.root, "switch", "-c", "other")
}

// AC1: agentStop that the API advances to staged creates the commit and the
// response reports it.
func TestWI335_AgentStopIntoStagedCommitsAndReportsSha(t *testing.T) {
	e := icSetup(t)
	before := e.headCount(t)

	res := icAgentStop(t, e)

	if res.err != nil {
		t.Fatalf("agentStop failed: %v", res.err)
	}
	ic := res.itemCommit(t)
	if ic["committed"] != true {
		t.Fatalf("expected committed:true, got %v", ic)
	}
	sha, _ := ic["sha"].(string)
	if sha == "" || sha != icGit(t, e.root, "rev-parse", "HEAD") {
		t.Errorf("itemCommit.sha=%q does not match HEAD", sha)
	}
	if e.headCount(t) == before {
		t.Error("no new commit was created")
	}
	if e.srv.count("POST /api/agents/stop") != 1 {
		t.Error("stop endpoint should be called once")
	}
	if len(e.srv.patches) != 1 || e.srv.patches[0]["commitSha"] != sha {
		t.Errorf("expected one commitSha PATCH with %s, got %v", sha, e.srv.patches)
	}
}

// AC2: moveItem --toStage staged commits, via the flags path.
func TestWI335_MoveItemFlagsToStagedCommits(t *testing.T) {
	e := icSetup(t)
	before := e.headCount(t)

	res := icMoveItem(t, e, "--itemId", "WI-001", "--toStage", "staged")

	if res.err != nil {
		t.Fatalf("moveItem failed: %v", res.err)
	}
	if ic := res.itemCommit(t); ic["committed"] != true || ic["sha"] == "" || ic["sha"] == nil {
		t.Fatalf("expected committed:true with sha, got %v", ic)
	}
	if e.headCount(t) == before {
		t.Error("no new commit was created")
	}
}

// AC2: the --body path triggers the commit too.
func TestWI335_MoveItemBodyToStagedCommits(t *testing.T) {
	e := icSetup(t)
	before := e.headCount(t)

	res := icMoveItem(t, e, "--body", `{"itemId":"WI-001","toStage":"staged"}`)

	if res.err != nil {
		t.Fatalf("moveItem --body failed: %v", res.err)
	}
	if ic := res.itemCommit(t); ic["committed"] != true {
		t.Fatalf("expected committed:true, got %v", ic)
	}
	if e.headCount(t) == before {
		t.Error("no new commit was created via --body")
	}
}

// AC2 (rework): a second move to staged adds a second commit; the first stays.
func TestWI335_ReworkMoveCreatesNewCommitKeepingEarlierOne(t *testing.T) {
	e := icSetup(t)
	first := icAgentStop(t, e).itemCommit(t)["sha"].(string)

	if err := os.WriteFile(filepath.Join(e.root, "widget.txt"), []byte("v3 rework\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	second := icMoveItem(t, e, "--itemId", "WI-001", "--toStage", "staged").itemCommit(t)["sha"].(string)

	if first == second {
		t.Fatal("rework must produce a new commit")
	}
	if icGit(t, e.root, "cat-file", "-t", first) != "commit" {
		t.Error("earlier commit vanished")
	}
	if got := icGit(t, e.root, "rev-parse", "HEAD~1"); got != first {
		t.Errorf("HEAD~1=%s, want first commit %s", got, first)
	}
}

// AC3: moves that do not land in staged make no commit and add no itemCommit.
func TestWI335_NonStagedMovesMakeNoCommit(t *testing.T) {
	cases := []struct {
		name string
		run  func(t *testing.T, e icEnv) icResult
	}{
		{"agentStop to implementing", func(t *testing.T, e icEnv) icResult {
			e.srv.stopResp = icStopResp("implementing")
			return icAgentStop(t, e)
		}},
		{"agentStop to done", func(t *testing.T, e icEnv) icResult {
			e.srv.stopResp = icStopResp("done")
			return icAgentStop(t, e)
		}},
		{"agentStop advance=false (no nextStage)", func(t *testing.T, e icEnv) icResult {
			e.srv.stopResp = icStopResp("")
			return icAgentStop(t, e, "--advance=false")
		}},
		{"agentStop rejection to testing", func(t *testing.T, e icEnv) icResult {
			e.srv.stopResp = icStopResp("testing")
			return icAgentStop(t, e, "--outcome", "rejected", "--return-to", "testing")
		}},
		{"agentStop wipExceeded on staged", func(t *testing.T, e icEnv) icResult {
			e.srv.stopResp = map[string]any{"success": true, "data": map[string]any{
				"itemId": "WI-001", "agent": "Amy", "wipExceeded": true, "blockedStage": "staged",
				"workLogEntry": map[string]any{"id": 1},
			}}
			return icAgentStop(t, e)
		}},
		{"moveItem to testing", func(t *testing.T, e icEnv) icResult {
			return icMoveItem(t, e, "--itemId", "WI-001", "--toStage", "testing")
		}},
		{"moveItem to done", func(t *testing.T, e icEnv) icResult {
			return icMoveItem(t, e, "--itemId", "WI-001", "--toStage", "done")
		}},
		{"moveItem --body to implementing", func(t *testing.T, e icEnv) icResult {
			return icMoveItem(t, e, "--body", `{"itemId":"WI-001","toStage":"implementing"}`)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := icSetup(t)
			before := e.headCount(t)
			res := tc.run(t, e)
			if res.err != nil {
				t.Fatalf("unexpected error: %v", res.err)
			}
			if res.hasItemCommit() {
				t.Errorf("itemCommit must be absent when the item did not land in staged: %s", res.stdout)
			}
			if e.headCount(t) != before {
				t.Error("a commit was created for a non-staged move")
			}
			if n := e.srv.count("PATCH "); n != 0 {
				t.Errorf("no item PATCH expected, saw %d", n)
			}
			if strings.Contains(res.stderr, "ITEM_COMMIT_FAILED") {
				t.Error("no commit failure marker expected")
			}
		})
	}
}

// AC4: a failed commit (branch mismatch) keeps the item in staged (no move back),
// reports in JSON, stderr and the activity feed, and exits 0.
func TestWI335_AgentStopCommitFailureReportsLoudlyExitsZero(t *testing.T) {
	e := icSetup(t)
	icBreakBranch(t, e)
	before := e.headCount(t)

	res := icAgentStop(t, e)

	if res.err != nil {
		t.Fatalf("commit failure must not change the exit code, got error: %v", res.err)
	}
	ic := res.itemCommit(t)
	if ic["committed"] != false {
		t.Fatalf("expected committed:false, got %v", ic)
	}
	if msg, _ := ic["error"].(string); msg == "" {
		t.Error("itemCommit.error must be non-empty")
	}
	if e.headCount(t) != before {
		t.Error("no commit should exist after a branch mismatch")
	}
	if !strings.Contains(res.stderr, "ITEM_COMMIT_FAILED") {
		t.Fatalf("stderr missing ITEM_COMMIT_FAILED: %q", res.stderr)
	}
	line := ""
	for _, l := range strings.Split(res.stderr, "\n") {
		if strings.Contains(l, "ITEM_COMMIT_FAILED") {
			line = l
		}
	}
	if !strings.Contains(line, "Hannibal") || !strings.Contains(line, "ALERT") {
		t.Errorf("ITEM_COMMIT_FAILED line must tell the agent to send ALERT to Hannibal: %q", line)
	}
	if !strings.Contains(line, "WI-001") {
		t.Errorf("ITEM_COMMIT_FAILED line must name the item: %q", line)
	}
	// Item is never moved back: only the single stop call, no move/reject call.
	if e.srv.count("POST /api/board/move") != 0 {
		t.Error("the CLI must not move the item after a commit failure")
	}
	if e.srv.count("POST /api/agents/stop") != 1 {
		t.Error("agentStop must be called exactly once")
	}
	// Activity entry names the item and the error, attributed to the caller.
	msg := icLastMessage(t, e)
	if !strings.Contains(msg, "WI-001") || !strings.Contains(msg, ic["error"].(string)) {
		t.Errorf("activity message must name the item and the error, got %q", msg)
	}
	if agent, _ := e.srv.acts[len(e.srv.acts)-1]["agent"].(string); agent != "Amy" {
		t.Errorf("activity agent=%q, want the calling agent Amy", agent)
	}
}

// AC4 for moveItem (both request paths): exit 0, JSON, stderr, activity.
func TestWI335_MoveItemCommitFailureReportsLoudlyExitsZero(t *testing.T) {
	paths := map[string][]string{
		"flags": {"--itemId", "WI-001", "--toStage", "staged"},
		"body":  {"--body", `{"itemId":"WI-001","toStage":"staged"}`},
	}
	for name, args := range paths {
		t.Run(name, func(t *testing.T) {
			e := icSetup(t)
			icBreakBranch(t, e)

			res := icMoveItem(t, e, args...)

			if res.err != nil {
				t.Fatalf("exit must stay 0, got %v", res.err)
			}
			if ic := res.itemCommit(t); ic["committed"] != false || ic["error"] == nil || ic["error"] == "" {
				t.Fatalf("expected committed:false with error, got %v", ic)
			}
			if !strings.Contains(res.stderr, "ITEM_COMMIT_FAILED") || !strings.Contains(res.stderr, "Hannibal") {
				t.Errorf("stderr must carry ITEM_COMMIT_FAILED + ALERT Hannibal: %q", res.stderr)
			}
			if msg := icLastMessage(t, e); !strings.Contains(msg, "WI-001") {
				t.Errorf("activity message must name the item: %q", msg)
			}
			if e.srv.count("POST /api/board/move") != 1 {
				t.Error("exactly one move call expected; no move back")
			}
		})
	}
}

// AC5: when the API rejects the move, no commit is attempted.
func TestWI335_APIRejectedMoveAttemptsNoCommit(t *testing.T) {
	e := icSetup(t)
	e.srv.moveFails = true
	before := e.headCount(t)

	res := icMoveItem(t, e, "--itemId", "WI-001", "--toStage", "staged")

	if res.err == nil {
		t.Fatal("moveItem should surface the API error")
	}
	if e.headCount(t) != before {
		t.Error("no commit may be created when the API rejected the move")
	}
	if n := e.srv.count("GET "); n != 0 {
		t.Errorf("no commit-side API reads expected after a rejected move, saw %d", n)
	}
	if n := e.srv.count("PATCH "); n != 0 {
		t.Errorf("no PATCH expected, saw %d", n)
	}
}

// Carry-forward (WI-334 probing): the git commit lands but the commitSha PATCH
// fails. Run returns the SHA with the error. The wiring must surface that SHA
// and must NOT re-run Run (a re-run reports NoChanges and loses the SHA).
func TestWI335_PatchFailureAfterCommitSurfacesShaAndNeverReruns(t *testing.T) {
	e := icSetup(t)
	e.srv.patchFails = true
	before := e.headCount(t)

	res := icAgentStop(t, e)

	if res.err != nil {
		t.Fatalf("exit must stay 0, got %v", res.err)
	}
	head := icGit(t, e.root, "rev-parse", "HEAD")
	if e.headCount(t) == before {
		t.Fatal("precondition: the git commit should exist even though the PATCH failed")
	}
	ic := res.itemCommit(t)
	if ic["committed"] != false {
		t.Errorf("recording failed, so committed must be false: %v", ic)
	}
	if ic["sha"] != head {
		t.Errorf("itemCommit.sha must carry the created commit %s so it can be PATCHed, got %v", head, ic["sha"])
	}
	if !strings.Contains(res.stderr, "ITEM_COMMIT_FAILED") || !strings.Contains(res.stderr, head) {
		t.Errorf("stderr must carry ITEM_COMMIT_FAILED and the SHA %s: %q", head, res.stderr)
	}
	if msg := icLastMessage(t, e); !strings.Contains(msg, head) {
		t.Errorf("activity entry must include the SHA %s, got %q", head, msg)
	}
	// Run executed once: one commit-side items GET and a single commitSha PATCH.
	if got := e.srv.count("GET /api/items/WI-001"); got != 1 {
		t.Errorf("Run must execute exactly once (item fetched %d times)", got)
	}
	if got := e.srv.count("PATCH /api/items/WI-001"); got != 1 {
		t.Errorf("no retry of the PATCH or a no-changes note PATCH expected, saw %d PATCH calls", got)
	}
	if e.headCount(t) != icAddOne(before) {
		t.Errorf("exactly one commit expected")
	}
}

func icAddOne(s string) string {
	var n int
	_, _ = fmt.Sscanf(s, "%d", &n)
	return fmt.Sprintf("%d", n+1)
}

// Preservation: pool release and the existing response fields survive the wiring.
func TestWI335_ExistingAgentStopResponseFieldsPreserved(t *testing.T) {
	e := icSetup(t)
	busy := filepath.Join(e.poolDir, "Amy.busy")
	if err := os.WriteFile(busy, nil, 0o644); err != nil {
		t.Fatal(err)
	}

	res := icAgentStop(t, e)

	data, _ := res.json["data"].(map[string]any)
	if data["nextStage"] != "staged" || data["workLogEntry"] == nil {
		t.Errorf("original API fields must be kept alongside itemCommit: %v", data)
	}
	if _, err := os.Stat(busy); !os.IsNotExist(err) {
		t.Error("pool .busy slot must still be released")
	}
	if _, err := os.Stat(filepath.Join(e.poolDir, "Amy.idle")); err != nil {
		t.Errorf("pool .idle slot expected after release: %v", err)
	}
}

// Failure path of the activity POST: a failed activity write must not change
// the exit code either (ADR 0011), and the JSON still reports the failure.
func TestWI335_ActivityPostFailureStillExitsZero(t *testing.T) {
	e := icSetup(t)
	icBreakBranch(t, e)
	e.srv.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/agents/stop":
			_ = json.NewEncoder(w).Encode(icStopResp("staged"))
		case r.URL.Path == "/api/activity":
			w.WriteHeader(500)
			_, _ = w.Write([]byte(`{"success":false,"error":{"code":"INTERNAL","message":"x"}}`))
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"id": e.mission, "prdPath": "p", "stageId": "staged", "title": "t", "outputs": map[string]string{}}})
		}
	})

	res := icAgentStop(t, e)

	if res.err != nil {
		t.Fatalf("activity failure must not alter the exit code: %v", res.err)
	}
	if res.itemCommit(t)["committed"] != false {
		t.Error("failure must still be reported in JSON")
	}
	if !strings.Contains(res.stderr, "ITEM_COMMIT_FAILED") {
		t.Error("stderr marker must still print")
	}
}
