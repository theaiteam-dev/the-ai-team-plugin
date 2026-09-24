package cmd

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// boardJSON builds a GET /api/board response with the given item stages. An
// entry of "testing!" marks a NO_TEST_NEEDED item (empty outputs.test) in
// that stage. wip maps stage id → WIP limit; stages absent from it are
// unlimited.
func boardJSON(t *testing.T, stages []string, wip map[string]int) []byte {
	t.Helper()
	items := []map[string]interface{}{}
	for _, s := range stages {
		test := "src/__tests__/x.test.ts"
		if strings.HasSuffix(s, "!") {
			s = strings.TrimSuffix(s, "!")
			test = ""
		}
		items = append(items, map[string]interface{}{
			"stageId": s,
			"outputs": map[string]interface{}{"test": test, "impl": "src/x.ts"},
		})
	}
	stageRows := []map[string]interface{}{}
	for _, id := range []string{"briefings", "ready", "testing", "implementing", "review", "probing", "staged", "done", "blocked"} {
		row := map[string]interface{}{"id": id, "wipLimit": nil}
		if n, ok := wip[id]; ok {
			row["wipLimit"] = n
		}
		stageRows = append(stageRows, row)
	}
	b, err := json.Marshal(map[string]interface{}{
		"success": true,
		"data":    map[string]interface{}{"stages": stageRows, "items": items},
	})
	if err != nil {
		t.Fatalf("marshal board: %v", err)
	}
	return b
}

func writeMarkers(t *testing.T, poolDir string, names ...string) {
	t.Helper()
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(poolDir, n), []byte("agentid-"+n), 0644); err != nil {
			t.Fatalf("write marker %s: %v", n, err)
		}
	}
}

func enableSingleUse(t *testing.T, poolDir string) {
	t.Helper()
	writeMarkers(t, poolDir)
	if err := os.WriteFile(filepath.Join(poolDir, singleUseMarker), []byte("single-use\n"), 0644); err != nil {
		t.Fatalf("write mode marker: %v", err)
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func TestPoolInitSingleUseRecordsModeAndPersists(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "init-single-use")
	_ = os.RemoveAll(poolDir)

	out, err := runPoolCmd(t, "pool", "init", "--single-use", "--json")
	if err != nil {
		t.Fatalf("pool init --single-use: %v (%s)", err, out)
	}
	if !strings.Contains(out, `"singleUse": true`) {
		t.Errorf("expected singleUse true in output, got %s", out)
	}
	if !poolIsSingleUse(poolDir) {
		t.Fatal("expected the mode marker to exist after init --single-use")
	}

	// Re-running init without the flag (e.g. resume recovery) must not turn
	// the mode off mid-mission.
	out, err = runPoolCmd(t, "pool", "init", "--json")
	if err != nil {
		t.Fatalf("second pool init: %v (%s)", err, out)
	}
	if !strings.Contains(out, `"singleUse": true`) || !poolIsSingleUse(poolDir) {
		t.Errorf("expected single-use mode to persist across a plain init, got %s", out)
	}
}

func TestPoolStatusReportsSingleUse(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "status-single-use")
	enableSingleUse(t, poolDir)

	out, err := runPoolCmd(t, "pool", "status", "--json")
	if err != nil {
		t.Fatalf("pool status: %v (%s)", err, out)
	}
	if !strings.Contains(out, `"singleUse": true`) {
		t.Errorf("expected singleUse true in pool status, got %s", out)
	}
}

func TestPoolInitDefaultIsReuseMode(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "init-reuse")
	_ = os.RemoveAll(poolDir)

	out, err := runPoolCmd(t, "pool", "init", "--json")
	if err != nil {
		t.Fatalf("pool init: %v (%s)", err, out)
	}
	if !strings.Contains(out, `"singleUse": false`) || poolIsSingleUse(poolDir) {
		t.Errorf("expected reuse mode by default, got %s", out)
	}
}

func TestPoolSelfReleaseRetiresSlotInSingleUseMode(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "retire")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "murdock-1.busy")

	poolSelfRelease("murdock-1")

	if exists(filepath.Join(poolDir, "murdock-1.busy")) || exists(filepath.Join(poolDir, "murdock-1.idle")) {
		t.Error("expected the slot to be retired (no .busy and no .idle), but a marker remains")
	}
	// A second call (the deferred release after an early retire) is a no-op.
	poolSelfRelease("murdock-1")
}

func TestPoolSelfReleaseReturnsSlotToIdleInReuseMode(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "reuse-release")
	writeMarkers(t, poolDir, "murdock-1.busy")

	poolSelfRelease("murdock-1")

	if !exists(filepath.Join(poolDir, "murdock-1.idle")) {
		t.Error("expected reuse mode to return the slot to .idle")
	}
}

func TestComputeReplenish(t *testing.T) {
	cases := []struct {
		name    string
		role    string
		stages  []string
		wip     map[string]int
		markers []string
		want    replenishInfo
	}{
		{
			name:   "items upstream and no idle instance: spawn one per item",
			role:   "ba",
			stages: []string{"briefings", "ready", "testing", "implementing", "review"},
			want:   replenishInfo{Demand: 3, Count: 3},
		},
		{
			name:    "idle instances already cover demand: spawn none",
			role:    "ba",
			stages:  []string{"testing"},
			markers: []string{"ba-2.idle"},
			want:    replenishInfo{Demand: 1, Idle: 1, Count: 0},
		},
		{
			name:    "no work left upstream: spawn none",
			role:    "amy",
			stages:  []string{"probing", "staged", "done", "blocked"},
			markers: []string{"amy-3.busy"},
			want:    replenishInfo{Demand: 0, Busy: 1, Count: 0},
		},
		{
			name:    "stage WIP limit caps idle+busy+new",
			role:    "lynch",
			stages:  []string{"ready", "ready", "testing", "implementing"},
			wip:     map[string]int{"review": 2},
			markers: []string{"lynch-4.busy"},
			want:    replenishInfo{Demand: 4, Busy: 1, Count: 1},
		},
		{
			name:   "NO_TEST_NEEDED items add no Murdock demand",
			role:   "murdock",
			stages: []string{"ready", "ready!", "briefings!"},
			want:   replenishInfo{Demand: 1, Count: 1},
		},
		{
			name:   "NO_TEST_NEEDED items still count for B.A.",
			role:   "ba",
			stages: []string{"ready!", "briefings!"},
			want:   replenishInfo{Demand: 2, Count: 2},
		},
		{
			name:    "other agent types in the pool are not counted",
			role:    "ba",
			stages:  []string{"testing"},
			markers: []string{"murdock-1.idle", "lynch-1.idle", "ba-5.busy"},
			want:    replenishInfo{Demand: 1, Busy: 1, Count: 1},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, poolDir := withTempPoolRoot(t, "replenish")
			enableSingleUse(t, poolDir)
			writeMarkers(t, poolDir, tc.markers...)

			got, err := computeReplenish(boardJSON(t, tc.stages, tc.wip), poolDir, tc.role)
			if err != nil {
				t.Fatalf("computeReplenish: %v", err)
			}
			if got.AgentType != tc.role || got.Demand != tc.want.Demand || got.Idle != tc.want.Idle ||
				got.Busy != tc.want.Busy || got.Count != tc.want.Count {
				t.Errorf("got %+v, want demand=%d idle=%d busy=%d count=%d",
					*got, tc.want.Demand, tc.want.Idle, tc.want.Busy, tc.want.Count)
			}
		})
	}
}

func TestHandlePoolManagementRejectionClaimsReworkAgentInSingleUse(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "rework-claim")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "ba-3.idle", "murdock-2.idle")

	next, nextID, alert := handlePoolManagement("lynch-1", "rejected", true, "implementing")
	if next != "ba-3" || nextID != "agentid-ba-3.idle" || alert != "" {
		t.Errorf("expected ba-3 claimed for rework, got next=%q id=%q alert=%q", next, nextID, alert)
	}
	if exists(filepath.Join(poolDir, "murdock-2.busy")) {
		t.Error("a return to implementing must not claim a Murdock")
	}
}

func TestHandlePoolManagementRejectionToBlockedClaimsNothing(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "rework-blocked")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "ba-3.idle")

	next, _, alert := handlePoolManagement("lynch-1", "rejected", true, "blocked")
	if next != "" || alert != "" {
		t.Errorf("expected no claim for an item escalated to blocked, got next=%q alert=%q", next, alert)
	}
	if !exists(filepath.Join(poolDir, "ba-3.idle")) {
		t.Error("ba-3 should stay idle")
	}
}

func TestHandlePoolManagementRejectionAlertsWhenNoReworkAgent(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "rework-alert")
	enableSingleUse(t, poolDir)

	_, _, alert := handlePoolManagement("lynch-1", "rejected", true, "testing")
	if !strings.Contains(alert, "murdock") {
		t.Errorf("expected a poolAlert naming murdock, got %q", alert)
	}
}

func TestHandlePoolManagementRejectionInReuseModeIsUnchanged(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "rework-reuse")
	writeMarkers(t, poolDir, "ba-3.idle")

	next, _, alert := handlePoolManagement("lynch-1", "rejected", true, "implementing")
	if next != "" || alert != "" {
		t.Errorf("reuse mode must not claim on rejection, got next=%q alert=%q", next, alert)
	}
}

// runAgentStopJSON runs agentStop in --json mode and returns what it printed to
// os.Stdout (the command writes its JSON there directly, not to cobra's Out).
func runAgentStopJSON(t *testing.T, serverURL string, extraArgs ...string) (string, error) {
	t.Helper()
	t.Cleanup(func() { resetPersistentFlags(t) })
	orig := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = w
	_, runErr := executeAgentStop(t, serverURL, append(extraArgs, "--json")...)
	os.Stdout = orig
	_ = w.Close()
	buf := make([]byte, 65536)
	n, _ := r.Read(buf)
	return strings.TrimSpace(string(buf[:n])), runErr
}

// routedServer answers POST /api/agents/stop with stopResp and GET /api/board
// with board.
func routedServer(t *testing.T, stopResp, board []byte) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/agents/stop":
			w.Write(stopResp)
		case r.Method == "GET" && r.URL.Path == "/api/board":
			w.Write(board)
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestAgentStopSingleUseRetiresClaimsNextAndReportsReplenish(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "agentstop-single-use")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "murdock-1.busy", "ba-1.idle")

	// Two items still need testing, none idle: the retiring Murdock's
	// replacement count is 2.
	board := boardJSON(t, []string{"ready", "briefings", "implementing"}, nil)
	srv := routedServer(t, successResponse(), board)
	defer srv.Close()

	readStderr := captureStderr(t)
	out, err := runAgentStopJSON(t, srv.URL, "--agent", "murdock-1")
	stderr := readStderr()
	if err != nil {
		t.Fatalf("agentStop: %v (%s)", err, out)
	}

	if exists(filepath.Join(poolDir, "murdock-1.busy")) || exists(filepath.Join(poolDir, "murdock-1.idle")) {
		t.Error("expected murdock-1 to be retired")
	}
	if !exists(filepath.Join(poolDir, "ba-1.busy")) {
		t.Error("expected the forward handoff to claim ba-1")
	}

	var parsed struct {
		Data struct {
			ClaimedNext string        `json:"claimedNext"`
			PoolMode    string        `json:"poolMode"`
			Replenish   replenishInfo `json:"replenish"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("parse output: %v\n%s", err, out)
	}
	if parsed.Data.ClaimedNext != "ba-1" {
		t.Errorf("expected claimedNext=ba-1, got %q", parsed.Data.ClaimedNext)
	}
	if parsed.Data.PoolMode != "single-use" {
		t.Errorf("expected poolMode=single-use, got %q", parsed.Data.PoolMode)
	}
	r := parsed.Data.Replenish
	if r.AgentType != "murdock" || r.Demand != 2 || r.Idle != 0 || r.Count != 2 {
		t.Errorf("unexpected replenish fact: %+v", r)
	}
	if !strings.Contains(stderr, "POOL_REPLENISH: spawn 2 fresh murdock") {
		t.Errorf("expected a POOL_REPLENISH line on stderr, got: %s", stderr)
	}
}

func TestAgentStopReuseModeReportsNoReplenish(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "agentstop-reuse")
	writeMarkers(t, poolDir, "murdock-1.busy")

	srv := routedServer(t, successResponse(), boardJSON(t, []string{"ready"}, nil))
	defer srv.Close()

	out, err := runAgentStopJSON(t, srv.URL, "--agent", "murdock-1")
	if err != nil {
		t.Fatalf("agentStop: %v (%s)", err, out)
	}
	if !strings.Contains(out, `"success":true`) {
		t.Fatalf("expected the agentStop JSON on stdout, got %q", out)
	}
	if strings.Contains(out, "replenish") {
		t.Errorf("reuse mode must not report replenish, got %s", out)
	}
	if !strings.Contains(out, `"poolMode":"reuse"`) {
		t.Errorf("reuse mode must report poolMode=reuse, got %s", out)
	}
	if !exists(filepath.Join(poolDir, "murdock-1.idle")) {
		t.Error("reuse mode must return the slot to idle")
	}
}

func TestAgentStopWithoutPoolReportsNoPoolMode(t *testing.T) {
	t.Setenv("ATEAM_MISSION_ID", "M-no-pool-"+strings.ReplaceAll(t.Name(), "/", "_"))

	srv := routedServer(t, successResponse(), boardJSON(t, []string{"ready"}, nil))
	defer srv.Close()

	out, err := runAgentStopJSON(t, srv.URL, "--agent", "murdock-1")
	if err != nil {
		t.Fatalf("agentStop: %v (%s)", err, out)
	}
	if strings.Contains(out, "poolMode") {
		t.Errorf("a mission with no pool must not report poolMode, got %s", out)
	}
}
