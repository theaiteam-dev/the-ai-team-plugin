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
		lanes   int
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
		{
			// N=1 (a single lane) is tighter than the stage's default WIP
			// limit of 3, so the lane cap — not the WIP limit — must be what
			// bounds count.
			name:   "lane cap bounds count tighter than the stage WIP limit",
			role:   "ba",
			stages: []string{"ready", "ready", "ready", "ready", "ready"},
			wip:    map[string]int{"implementing": 3},
			lanes:  1,
			want:   replenishInfo{Demand: 5, Count: 1, Lanes: 1},
		},
		{
			name:    "lane cap already occupied by a busy instance: spawn none",
			role:    "ba",
			stages:  []string{"ready", "ready", "ready", "ready", "ready"},
			wip:     map[string]int{"implementing": 3},
			markers: []string{"ba-1.busy"},
			lanes:   1,
			want:    replenishInfo{Demand: 5, Busy: 1, Count: 0, Lanes: 1},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, poolDir := withTempPoolRoot(t, "replenish")
			enableSingleUse(t, poolDir)
			writeMarkers(t, poolDir, tc.markers...)
			if tc.lanes > 0 {
				if err := writeLanes(poolDir, tc.lanes); err != nil {
					t.Fatalf("writeLanes: %v", err)
				}
			}

			got, err := computeReplenish(boardJSON(t, tc.stages, tc.wip), poolDir, tc.role)
			if err != nil {
				t.Fatalf("computeReplenish: %v", err)
			}
			if got.AgentType != tc.role || got.Demand != tc.want.Demand || got.Idle != tc.want.Idle ||
				got.Busy != tc.want.Busy || got.Count != tc.want.Count || got.Lanes != tc.want.Lanes {
				t.Errorf("got %+v, want demand=%d idle=%d busy=%d count=%d lanes=%d",
					*got, tc.want.Demand, tc.want.Idle, tc.want.Busy, tc.want.Count, tc.want.Lanes)
			}
		})
	}
}

func TestHandlePoolManagementRejectionClaimsReworkAgentInSingleUse(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "rework-claim")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "ba-3.idle", "murdock-2.idle")

	next, nextID, alert := handlePoolManagement("lynch-1", "WI-001", "rejected", true, "implementing")
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

	next, _, alert := handlePoolManagement("lynch-1", "WI-001", "rejected", true, "blocked")
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

	_, _, alert := handlePoolManagement("lynch-1", "WI-001", "rejected", true, "testing")
	if !strings.Contains(alert, "murdock") {
		t.Errorf("expected a poolAlert naming murdock, got %q", alert)
	}
}

func TestHandlePoolManagementRejectionInReuseModeIsUnchanged(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "rework-reuse")
	writeMarkers(t, poolDir, "ba-3.idle")

	next, _, alert := handlePoolManagement("lynch-1", "WI-001", "rejected", true, "implementing")
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

func TestAgentStopSingleUseParksClaimsNextAndReportsReplenish(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "agentstop-single-use")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "murdock-1.busy", "ba-1.idle")

	// Two items still need testing, none idle: the Murdock replacement count
	// is 2.
	board := boardJSON(t, []string{"ready", "briefings", "implementing"}, nil)
	srv := routedServer(t, successResponse(), board)
	defer srv.Close()

	readStderr := captureStderr(t)
	out, err := runAgentStopJSON(t, srv.URL, "--agent", "murdock-1")
	stderr := readStderr()
	if err != nil {
		t.Fatalf("agentStop: %v (%s)", err, out)
	}

	if !exists(filepath.Join(poolDir, "murdock-1.parked-WI-001")) {
		t.Error("expected murdock-1 to be parked for WI-001")
	}
	if exists(filepath.Join(poolDir, "murdock-1.busy")) || exists(filepath.Join(poolDir, "murdock-1.idle")) {
		t.Error("a parked instance must not stay busy or return to idle")
	}
	if !exists(filepath.Join(poolDir, "ba-1.busy")) {
		t.Error("expected the forward handoff to claim ba-1")
	}

	var parsed struct {
		Data struct {
			ClaimedNext string            `json:"claimedNext"`
			PoolMode    string            `json:"poolMode"`
			ParkedFor   string            `json:"parkedFor"`
			Retire      []retiredInstance `json:"retire"`
			Replenish   replenishInfo     `json:"replenish"`
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
	if parsed.Data.ParkedFor != "WI-001" || len(parsed.Data.Retire) != 0 {
		t.Errorf("expected parkedFor=WI-001 and nothing retired, got parkedFor=%q retire=%v", parsed.Data.ParkedFor, parsed.Data.Retire)
	}
	r := parsed.Data.Replenish
	if r.AgentType != "murdock" || r.Demand != 2 || r.Idle != 0 || r.Count != 2 {
		t.Errorf("unexpected replenish fact: %+v", r)
	}
	if !strings.Contains(stderr, "POOL_REPLENISH: spawn 2 fresh murdock") {
		t.Errorf("expected a POOL_REPLENISH line on stderr, got: %s", stderr)
	}
}

// stopResponse is a successful /api/agents/stop response reporting nextStage.
func stopResponse(nextStage string) []byte {
	b, _ := json.Marshal(map[string]interface{}{
		"success": true,
		"data":    map[string]interface{}{"itemId": "WI-001", "nextStage": nextStage},
	})
	return b
}

func TestAgentStopToStagedRetiresEveryInstanceParkedForTheItem(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "agentstop-staged")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "amy-2.busy", "murdock-1.parked-WI-001", "ba-4.parked-WI-001",
		"lynch-3.parked-WI-001", "ba-5.parked-WI-002")

	srv := routedServer(t, stopResponse("staged"), boardJSON(t, nil, nil))
	defer srv.Close()

	readStderr := captureStderr(t)
	out, err := runAgentStopJSON(t, srv.URL, "--agent", "amy-2")
	stderr := readStderr()
	if err != nil {
		t.Fatalf("agentStop: %v (%s)", err, out)
	}

	var parsed struct {
		Data struct {
			ParkedFor string            `json:"parkedFor"`
			Retire    []retiredInstance `json:"retire"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("parse output: %v\n%s", err, out)
	}
	got := map[string]string{}
	for _, r := range parsed.Data.Retire {
		got[r.Instance] = r.AgentID
	}
	want := map[string]string{
		"amy-2":     "agentid-amy-2.busy",
		"murdock-1": "agentid-murdock-1.parked-WI-001",
		"ba-4":      "agentid-ba-4.parked-WI-001",
		"lynch-3":   "agentid-lynch-3.parked-WI-001",
	}
	if len(got) != len(want) {
		t.Fatalf("expected retire=%v, got %v", want, got)
	}
	for inst, id := range want {
		if got[inst] != id {
			t.Errorf("retire[%s]: want agentId %q, got %q", inst, id, got[inst])
		}
	}
	if parsed.Data.ParkedFor != "" {
		t.Errorf("an agent whose item reached staged must not park, got parkedFor=%q", parsed.Data.ParkedFor)
	}
	for _, f := range []string{"amy-2.busy", "amy-2.idle", "murdock-1.parked-WI-001", "ba-4.parked-WI-001", "lynch-3.parked-WI-001"} {
		if exists(filepath.Join(poolDir, f)) {
			t.Errorf("expected %s to be removed", f)
		}
	}
	if !exists(filepath.Join(poolDir, "ba-5.parked-WI-002")) {
		t.Error("an instance parked for another item must stay parked")
	}
	if !strings.Contains(stderr, "POOL_RETIRE:") {
		t.Errorf("expected a POOL_RETIRE line on stderr, got: %s", stderr)
	}
}

func TestAgentStopParkFailureRetiresOnlyTheCompletingAgent(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "park-fail")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "lynch-2.busy", "murdock-1.parked-WI-001")

	// Force parkForItem's os.Rename to fail with a non-NotExist error: make the
	// destination path an existing, non-empty directory. Renaming a regular
	// file onto that fails (EISDIR/ENOTEMPTY on Linux), which is what a
	// transient permission error on rename would also produce — a failure
	// distinct from the "target doesn't exist yet" case parkForItem already
	// handles.
	blocked := filepath.Join(poolDir, "lynch-2.parked-WI-001")
	if err := os.MkdirAll(blocked, 0755); err != nil {
		t.Fatalf("mkdir blocked parked path: %v", err)
	}
	if err := os.WriteFile(filepath.Join(blocked, "occupied"), nil, 0644); err != nil {
		t.Fatalf("write occupant: %v", err)
	}

	// nextStage=testing: the item is still in the pipeline (a rejection back
	// to testing), so lynch-2 would normally park rather than retire.
	srv := routedServer(t, stopResponse("testing"), boardJSON(t, []string{"testing"}, nil))
	defer srv.Close()

	readStderr := captureStderr(t)
	out, err := runAgentStopJSON(t, srv.URL, "--agent", "lynch-2")
	stderr := readStderr()
	if err != nil {
		t.Fatalf("agentStop: %v (%s)", err, out)
	}
	if !strings.Contains(stderr, "POOL_WARN: failed to park") {
		t.Errorf("expected a POOL_WARN about the failed park, got: %s", stderr)
	}

	var parsed struct {
		Data struct {
			ParkedFor string            `json:"parkedFor"`
			Retire    []retiredInstance `json:"retire"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("parse output: %v\n%s", err, out)
	}
	if parsed.Data.ParkedFor != "" {
		t.Errorf("expected parking to have failed (parkedFor empty), got %q", parsed.Data.ParkedFor)
	}
	if len(parsed.Data.Retire) != 1 || parsed.Data.Retire[0].Instance != "lynch-2" {
		t.Errorf("expected only lynch-2 in retire, got %v", parsed.Data.Retire)
	}
	if !exists(filepath.Join(poolDir, "murdock-1.parked-WI-001")) {
		t.Error("a transient park failure for an in-pipeline item must not retire other instances parked for the same item")
	}
}

func TestAgentStopRejectionRoutesReworkToTheParkedInstance(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "agentstop-rework-parked")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "lynch-2.busy", "murdock-1.parked-WI-001", "murdock-5.idle")

	srv := routedServer(t, stopResponse("testing"), boardJSON(t, []string{"testing"}, nil))
	defer srv.Close()

	out, err := runAgentStopJSON(t, srv.URL, "--agent", "lynch-2", "--outcome", "rejected", "--return-to", "testing", "--advance=false")
	if err != nil {
		t.Fatalf("agentStop: %v (%s)", err, out)
	}
	if !strings.Contains(out, `"claimedNext":"murdock-1"`) || !strings.Contains(out, `"claimedNextAgentId":"agentid-murdock-1.parked-WI-001"`) {
		t.Errorf("expected rework to claim the Murdock parked for WI-001, got %s", out)
	}
	if !exists(filepath.Join(poolDir, "murdock-5.idle")) {
		t.Error("the idle Murdock must stay idle when one is parked for the item")
	}
	if !exists(filepath.Join(poolDir, "lynch-2.parked-WI-001")) {
		t.Error("the rejecting Lynch must park for WI-001 so the reworked item returns to it")
	}
}

func TestAgentStopRejectionToBlockedRetiresTheItemsInstances(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "agentstop-rework-blocked")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "lynch-2.busy", "murdock-1.parked-WI-001")

	srv := routedServer(t, stopResponse("blocked"), boardJSON(t, nil, nil))
	defer srv.Close()

	out, err := runAgentStopJSON(t, srv.URL, "--agent", "lynch-2", "--outcome", "rejected", "--return-to", "testing", "--advance=false")
	if err != nil {
		t.Fatalf("agentStop: %v (%s)", err, out)
	}
	if !strings.Contains(out, `"instance":"lynch-2"`) || !strings.Contains(out, `"instance":"murdock-1"`) {
		t.Errorf("expected lynch-2 and murdock-1 in retire, got %s", out)
	}
	if strings.Contains(out, "claimedNext") || exists(filepath.Join(poolDir, "murdock-1.busy")) {
		t.Errorf("an item escalated to blocked must claim nothing, got %s", out)
	}
}

func TestHandlePoolManagementForwardClaimPrefersInstanceParkedForTheItem(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "forward-parked")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "ba-2.idle", "ba-1.parked-WI-001", "ba-3.parked-WI-010")

	next, nextID, alert := handlePoolManagement("murdock-4", "WI-001", "completed", true, "implementing")
	if next != "ba-1" || nextID != "agentid-ba-1.parked-WI-001" || alert != "" {
		t.Errorf("expected the B.A. parked for WI-001, got next=%q id=%q alert=%q", next, nextID, alert)
	}
	if !exists(filepath.Join(poolDir, "ba-3.parked-WI-010")) {
		t.Error("an instance parked for WI-010 must not be claimed for WI-001")
	}

	// No instance parked for the item: fall back to an idle one.
	next, _, _ = handlePoolManagement("murdock-4", "WI-002", "completed", true, "implementing")
	if next != "ba-2" {
		t.Errorf("expected the idle ba-2 when none is parked for WI-002, got %q", next)
	}
}

func TestPoolStatusReportsParkedInstances(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "status-parked")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "ba-1.idle", "murdock-1.parked-WI-001")

	out, err := runPoolCmd(t, "pool", "status", "--json")
	if err != nil {
		t.Fatalf("pool status: %v (%s)", err, out)
	}
	var parsed struct {
		Idle   []string          `json:"idle"`
		Parked map[string]string `json:"parked"`
	}
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("parse: %v\n%s", err, out)
	}
	if parsed.Parked["murdock-1"] != "WI-001" || len(parsed.Idle) != 1 {
		t.Errorf("expected murdock-1 parked for WI-001 and one idle, got %s", out)
	}
}

// itemBoardJSON builds a GET /api/board response from explicit items.
func itemBoardJSON(t *testing.T, items []map[string]interface{}) []byte {
	t.Helper()
	for _, it := range items {
		if _, ok := it["outputs"]; !ok {
			it["outputs"] = map[string]interface{}{"test": "src/__tests__/x.test.ts"}
		}
	}
	b, err := json.Marshal(map[string]interface{}{
		"success": true,
		"data":    map[string]interface{}{"stages": []interface{}{}, "items": items},
	})
	if err != nil {
		t.Fatalf("marshal board: %v", err)
	}
	return b
}

func TestComputeReplenishCountsOnlyDependencyReadyItems(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "replenish-deps")
	enableSingleUse(t, poolDir)

	board := itemBoardJSON(t, []map[string]interface{}{
		{"id": "WI-1", "stageId": "implementing"},
		{"id": "WI-2", "stageId": "staged"},
		// Waits on WI-1, which is still in the pipeline: no demand yet.
		{"id": "WI-3", "stageId": "briefings", "dependencies": []string{"WI-1"}},
		{"id": "WI-4", "stageId": "briefings", "dependencies": []string{"WI-1", "WI-2"}},
		// Every dependency staged, or absent from the board (done): demand.
		{"id": "WI-5", "stageId": "briefings", "dependencies": []string{"WI-2"}},
		{"id": "WI-6", "stageId": "briefings", "dependencies": []string{"WI-99"}},
		{"id": "WI-7", "stageId": "briefings"},
		{"id": "WI-8", "stageId": "ready"},
	})
	got, err := computeReplenish(board, poolDir, "murdock")
	if err != nil {
		t.Fatalf("computeReplenish: %v", err)
	}
	if got.Demand != 4 || got.Count != 4 {
		t.Errorf("expected demand=4 (WI-5..WI-8), got %+v", *got)
	}
}

func TestComputeReplenishSkipsItemsWithAParkedInstance(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "replenish-parked")
	enableSingleUse(t, poolDir)
	// WI-1 was rejected back to testing; the B.A. that worked it is parked and
	// will take it again, so only WI-2 needs a fresh B.A.
	writeMarkers(t, poolDir, "ba-3.parked-WI-1", "lynch-1.parked-WI-2")

	board := itemBoardJSON(t, []map[string]interface{}{
		{"id": "WI-1", "stageId": "testing"},
		{"id": "WI-2", "stageId": "testing"},
	})
	got, err := computeReplenish(board, poolDir, "ba")
	if err != nil {
		t.Fatalf("computeReplenish: %v", err)
	}
	if got.Demand != 1 || got.Parked != 1 || got.Count != 1 {
		t.Errorf("expected demand=1 parked=1 count=1, got %+v", *got)
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

func TestAgentStopAPIErrorKeepsTheSingleUseSlotForTheRetry(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "agentstop-api-error")
	enableSingleUse(t, poolDir)
	writeMarkers(t, poolDir, "murdock-1.busy")

	// The first stop fails (the agent skipped agentStart); the retry, after
	// the agent recovers its claim, succeeds.
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/agents/stop":
			calls++
			if calls == 1 {
				w.WriteHeader(http.StatusConflict)
				w.Write([]byte(`{"success":false,"error":{"code":"NOT_CLAIMED","message":"item is not claimed"}}`))
				return
			}
			w.Write(stopResponse("implementing"))
		case r.Method == "GET" && r.URL.Path == "/api/board":
			w.Write(boardJSON(t, []string{"implementing"}, nil))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	if out, err := runAgentStopJSON(t, srv.URL, "--agent", "murdock-1"); err == nil {
		t.Fatalf("expected the NOT_CLAIMED stop to fail, got %s", out)
	}
	if !exists(filepath.Join(poolDir, "murdock-1.busy")) {
		t.Fatal("a failed agentStop must not retire the single-use slot: the agent is still alive and will retry")
	}

	if out, err := runAgentStopJSON(t, srv.URL, "--agent", "murdock-1"); err != nil {
		t.Fatalf("retry agentStop: %v (%s)", err, out)
	}
	content, err := os.ReadFile(filepath.Join(poolDir, "murdock-1.parked-WI-001"))
	if err != nil {
		t.Fatalf("expected murdock-1 to be parked for WI-001 after the retry: %v", err)
	}
	if string(content) != "agentid-murdock-1.busy" {
		t.Errorf("the parked marker must keep the agentId for rework routing, got %q", content)
	}
}
