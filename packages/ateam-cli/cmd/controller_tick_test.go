package cmd

// Tests for `ateam controller tick` (WI-004).
//
// The controller tick command reads board / deps / health / checkpoint / pool
// state and emits a small JSON action plan that Claude executes. These tests
// verify the contract end-to-end through the cobra command, with a mocked
// kanban-viewer API and a temp pool directory.
//
// 8 test functions, one per AC, with subtests for positive / negative branches
// of "only/never" qualifiers and cross-product cases. The work-item carries a
// test-ceiling exception — the planner is a single decision loop and is
// intentionally not split.

import (
	"bytes"
	"encoding/json"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	pflag "github.com/spf13/pflag"
)

// ---------------------------------------------------------------------------
// Mock API server
//
// One mux serves every API endpoint the controller reads or writes.
// Tests set fields on tickAPIMocks BEFORE calling runTick — defaults model a
// clean idle mission with nothing to do.
// ---------------------------------------------------------------------------

type tickAPIMocks struct {
	mu sync.Mutex

	server *httptest.Server

	// Overrides for GET response bodies (raw JSON). nil → default below.
	missionBody          []byte
	itemsByStage         map[string][]byte
	depsBody             []byte
	healthBody           []byte
	checkpointBody       []byte
	boardBody            []byte
	checkpointStatus     int
	checkpointPostStatus int
	activityPostStatus   int
	activityListBody     []byte

	// Behavior overrides.
	missionMalformed bool

	// Captured requests.
	getRequestsByPath map[string]int
	postBodiesByPath  map[string][]map[string]interface{}
}

func newTickAPIMocks(t *testing.T) *tickAPIMocks {
	t.Helper()
	m := &tickAPIMocks{
		itemsByStage:      make(map[string][]byte),
		checkpointStatus:  http.StatusOK,
		getRequestsByPath: make(map[string]int),
		postBodiesByPath:  make(map[string][]map[string]interface{}),
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/missions/current/health-report", func(w http.ResponseWriter, r *http.Request) {
		m.recordGet(r.URL.Path)
		body := m.healthBody
		if body == nil {
			body = mustJSON(map[string]interface{}{
				"success": true,
				"data": map[string]interface{}{
					"staleClaims": []interface{}{},
					"stuckItems":  []interface{}{},
				},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})

	mux.HandleFunc("/api/board", func(w http.ResponseWriter, r *http.Request) {
		m.recordGet(r.URL.Path)
		body := m.boardBody
		if body == nil {
			// Default: no WIP limits (all stages unlimited).
			body = mustJSON(map[string]interface{}{
				"success": true,
				"data":    map[string]interface{}{"stages": []interface{}{}},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})

	mux.HandleFunc("/api/missions/current", func(w http.ResponseWriter, r *http.Request) {
		m.recordGet(r.URL.Path)
		if m.missionMalformed {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("{not-valid-json"))
			return
		}
		body := m.missionBody
		if body == nil {
			body = mustJSON(map[string]interface{}{
				"success": true,
				"data": map[string]interface{}{
					"id":    "M-001",
					"name":  "Test mission",
					"state": "running",
				},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})

	mux.HandleFunc("/api/items", func(w http.ResponseWriter, r *http.Request) {
		stage := r.URL.Query().Get("stage")
		m.recordGet("/api/items?stage=" + stage)
		m.mu.Lock()
		body, ok := m.itemsByStage[stage]
		m.mu.Unlock()
		if !ok {
			body = mustJSON(map[string]interface{}{
				"success": true,
				"data":    []interface{}{},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})

	mux.HandleFunc("/api/deps/check", func(w http.ResponseWriter, r *http.Request) {
		m.recordGet(r.URL.Path)
		body := m.depsBody
		if body == nil {
			body = mustJSON(map[string]interface{}{
				"success": true,
				"data": map[string]interface{}{
					"readyItems":   []string{},
					"blockedItems": []interface{}{},
				},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})

	mux.HandleFunc("/api/controller-checkpoint/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			// Capture the upsert payload so dry-run tests can prove nothing was written.
			body := map[string]interface{}{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			m.recordPost(r.URL.Path, body)
			m.mu.Lock()
			status := m.checkpointPostStatus
			m.mu.Unlock()
			if status != 0 {
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"success":false}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true,"data":{}}`))
			return
		}
		m.recordGet(r.URL.Path)
		m.mu.Lock()
		status := m.checkpointStatus
		body := m.checkpointBody
		m.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if status != http.StatusOK {
			w.WriteHeader(status)
			if body != nil {
				_, _ = w.Write(body)
			} else {
				_, _ = w.Write([]byte(`{"success":false}`))
			}
			return
		}
		if status == http.StatusNotFound || body == nil {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not_found"}`))
			return
		}
		_, _ = w.Write(body)
	})

	mux.HandleFunc("/api/activity", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			body := map[string]interface{}{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			m.recordPost(r.URL.Path, body)
			m.mu.Lock()
			status := m.activityPostStatus
			m.mu.Unlock()
			if status != 0 {
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"success":false}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"success":true}`))
			return
		}
		m.recordGet(r.URL.Path)
		body := m.activityListBody
		if body == nil {
			body = mustJSON(map[string]interface{}{
				"success": true,
				"data":    []interface{}{},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})

	m.server = httptest.NewServer(mux)
	t.Cleanup(m.server.Close)
	return m
}

func (m *tickAPIMocks) recordGet(path string) {
	m.mu.Lock()
	m.getRequestsByPath[path]++
	m.mu.Unlock()
}

func (m *tickAPIMocks) recordPost(path string, body map[string]interface{}) {
	m.mu.Lock()
	m.postBodiesByPath[path] = append(m.postBodiesByPath[path], body)
	m.mu.Unlock()
}

func (m *tickAPIMocks) getCount(path string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.getRequestsByPath[path]
}

func (m *tickAPIMocks) postsTo(path string) []map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Use HasPrefix because controller-checkpoint paths include the missionId.
	var out []map[string]interface{}
	for k, v := range m.postBodiesByPath {
		if k == path || strings.HasPrefix(k, path) {
			out = append(out, v...)
		}
	}
	return out
}

func mustJSON(v interface{}) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// ---------------------------------------------------------------------------
// Helpers: items / deps / health / checkpoint response builders
// ---------------------------------------------------------------------------

func itemsResponse(items ...map[string]interface{}) []byte {
	data := make([]interface{}, 0, len(items))
	for _, it := range items {
		data = append(data, it)
	}
	return mustJSON(map[string]interface{}{
		"success": true,
		"data":    data,
	})
}

func depsReadyResponse(readyItemIds ...string) []byte {
	ready := make([]interface{}, 0, len(readyItemIds))
	for _, id := range readyItemIds {
		ready = append(ready, id)
	}
	return mustJSON(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"readyItems":   ready,
			"blockedItems": []interface{}{},
		},
	})
}

func missionResponse(id, state string, finalReview interface{}) []byte {
	return mustJSON(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"id":          id,
			"name":        "Test mission",
			"state":       state,
			"finalReview": finalReview,
		},
	})
}

// ---------------------------------------------------------------------------
// Helpers: run the tick command + capture output / exit
// ---------------------------------------------------------------------------

// runTick executes the rootCmd with `controller tick` against the given mock
// server URL. It returns combined stdout/stderr, the parsed JSON plan (if any),
// and any error returned by cobra.
//
// Native-teams mode is selected by the caller via t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1").
// Tests that use native-teams must also call withTempPoolRoot to redirect the
// pool dir into a per-test temp location.
func runTick(t *testing.T, baseURL string, extra ...string) (output string, plan map[string]interface{}, err error) {
	t.Helper()
	resetPersistentFlags(t)
	// Best-effort reset of tick-local flags. We do not know the exact module
	// variable names B.A. will use, so we drive the reset through cobra's
	// pflag iterator — which works for any tick-local flag.
	if tickCmd, _, lookupErr := rootCmd.Find([]string{"controller", "tick"}); lookupErr == nil && tickCmd != nil {
		tickCmd.Flags().VisitAll(func(f *pflag.Flag) {
			_ = f.Value.Set(f.DefValue)
			f.Changed = false
		})
	}

	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)

	args := append([]string{
		"controller", "tick",
		"--base-url", baseURL,
		"--json",
		"--no-color",
	}, extra...)
	rootCmd.SetArgs(args)

	err = rootCmd.Execute()
	output = buf.String()

	if jsonStr := extractFirstJSONObject(output); jsonStr != "" {
		_ = json.Unmarshal([]byte(jsonStr), &plan)
	}
	return output, plan, err
}

// extractFirstJSONObject returns the first {...} JSON object substring in s,
// or "" if no balanced object can be found. It is needed because cobra may
// print a human banner or error line before the JSON plan.
func extractFirstJSONObject(s string) string {
	start := strings.Index(s, "{")
	if start < 0 {
		return ""
	}
	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(s); i++ {
		c := s[i]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if c == '\\' {
				escaped = true
				continue
			}
			if c == '"' {
				inString = false
			}
			continue
		}
		switch c {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1]
			}
		}
	}
	return ""
}

// scenario describes the mock state needed for a typical "happy dispatch" tick.
// Tests can mutate this before runTick.
type scenario struct {
	missionID string
	readyItem map[string]interface{}
	depsReady bool
	poolIdle  bool // murdock-1.idle exists in native pool dir
	poolDir   string
}

func setupHappyDispatch(t *testing.T, m *tickAPIMocks) scenario {
	t.Helper()
	missionID, poolDir := withTempPoolRoot(t, "tick")
	_ = os.MkdirAll(poolDir, 0o755)
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if err := os.WriteFile(idleFile, nil, 0o644); err != nil {
		t.Fatalf("seed idle file: %v", err)
	}
	t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

	readyItem := map[string]interface{}{
		"id":      "WI-014",
		"title":   "Add rate-limiting middleware",
		"stageId": "ready",
		"type":    "feature",
	}
	m.missionBody = missionResponse(missionID, "running", nil)
	m.itemsByStage["ready"] = itemsResponse(readyItem)
	m.depsBody = depsReadyResponse("WI-014")

	return scenario{
		missionID: missionID,
		readyItem: readyItem,
		depsReady: true,
		poolIdle:  true,
		poolDir:   poolDir,
	}
}

// findActionByKind returns the first action in plan["actions"] whose "kind"
// field equals kind, or nil if none.
func findActionByKind(plan map[string]interface{}, kind string) map[string]interface{} {
	actions, _ := plan["actions"].([]interface{})
	for _, a := range actions {
		am, ok := a.(map[string]interface{})
		if !ok {
			continue
		}
		if am["kind"] == kind {
			return am
		}
	}
	return nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// ===========================================================================
// AC 1 — JSON shape: missionId, mode, state, nextWakeSeconds, summary,
// actions, messages, needsJudgment
// ===========================================================================

func TestTickJSONShape(t *testing.T) {
	m := newTickAPIMocks(t)
	setupHappyDispatch(t, m)

	output, plan, err := runTick(t, m.server.URL, "--dry-run")
	if err != nil {
		t.Fatalf("tick failed: %v\noutput:\n%s", err, output)
	}
	if plan == nil {
		t.Fatalf("expected JSON plan in stdout, got:\n%s", output)
	}

	// Required top-level keys must all be present.
	for _, key := range []string{"missionId", "mode", "state", "nextWakeSeconds", "summary", "actions", "messages", "needsJudgment"} {
		if _, ok := plan[key]; !ok {
			t.Errorf("plan missing required key %q. plan: %v", key, plan)
		}
	}

	// Type checks: missionId/mode/state/summary are strings; nextWakeSeconds is
	// a number; actions and messages are arrays; needsJudgment is null or object.
	if _, ok := plan["missionId"].(string); !ok {
		t.Errorf("missionId must be a string, got %T", plan["missionId"])
	}
	mode, ok := plan["mode"].(string)
	if !ok {
		t.Errorf("mode must be a string, got %T", plan["mode"])
	}
	if mode != "native-teams" && mode != "legacy" {
		t.Errorf("mode must be 'native-teams' or 'legacy', got %q", mode)
	}
	if _, ok := plan["state"].(string); !ok {
		t.Errorf("state must be a string, got %T", plan["state"])
	}
	if _, ok := plan["summary"].(string); !ok {
		t.Errorf("summary must be a string, got %T", plan["summary"])
	}
	// JSON numbers decode to float64 — but the contract is "int". A non-integer
	// float (e.g. 7.5) would fail the int-cast in any Go consumer downstream.
	if nws, ok := plan["nextWakeSeconds"].(float64); ok {
		if nws != float64(int64(nws)) {
			t.Errorf("nextWakeSeconds must be an integer, got %v", nws)
		}
	} else if plan["nextWakeSeconds"] != nil {
		// null is allowed (e.g. when needsJudgment is set) but any other
		// non-numeric value is a contract violation.
		t.Errorf("nextWakeSeconds must be an integer or null, got %T", plan["nextWakeSeconds"])
	}
	if _, ok := plan["actions"].([]interface{}); !ok {
		t.Errorf("actions must be an array, got %T", plan["actions"])
	}
	if _, ok := plan["messages"].([]interface{}); !ok {
		t.Errorf("messages must be an array, got %T", plan["messages"])
	}
	switch plan["needsJudgment"].(type) {
	case nil, map[string]interface{}:
		// ok
	default:
		t.Errorf("needsJudgment must be null or an object, got %T", plan["needsJudgment"])
	}

	// NFR1: response budget < 8 KB.
	if len(output) > 8192 {
		t.Errorf("tick response exceeded 8 KB budget: %d bytes", len(output))
	}
}

// ===========================================================================
// AC 2 — Deterministic action IDs of the form
// <missionId>:<itemId>:<kind>:<agent>:<sequence>; identical across re-runs
// before the checkpoint is updated.
// ===========================================================================

func TestTickActionIDIsDeterministic(t *testing.T) {
	m := newTickAPIMocks(t)
	s := setupHappyDispatch(t, m)

	idPattern := regexp.MustCompile(
		`^` + regexp.QuoteMeta(s.missionID) + `:WI-014:dispatch:g\d+:murdock(-\d+)?:\d+$`,
	)

	// Run twice with the same (empty) checkpoint and identical mock state.
	// Both runs use --dry-run so the checkpoint is NOT updated between calls.
	_, plan1, err1 := runTick(t, m.server.URL, "--dry-run")
	if err1 != nil {
		t.Fatalf("first tick failed: %v", err1)
	}
	dispatch1 := findActionByKind(plan1, "dispatch")
	if dispatch1 == nil {
		t.Fatalf("first tick did not emit a dispatch action; plan: %v", plan1)
	}
	id1, _ := dispatch1["id"].(string)
	if !idPattern.MatchString(id1) {
		t.Errorf("dispatch id %q does not match <missionId>:<itemId>:<kind>:<agent>:<sequence>", id1)
	}

	_, plan2, err2 := runTick(t, m.server.URL, "--dry-run")
	if err2 != nil {
		t.Fatalf("second tick failed: %v", err2)
	}
	dispatch2 := findActionByKind(plan2, "dispatch")
	if dispatch2 == nil {
		t.Fatalf("second tick did not emit a dispatch action; plan: %v", plan2)
	}
	id2, _ := dispatch2["id"].(string)

	if id1 != id2 {
		t.Errorf("re-running tick before checkpoint update changed the action id: %q vs %q", id1, id2)
	}
}

func TestTickUsesConcreteInstanceForOrphanDispatch(t *testing.T) {
	m := newTickAPIMocks(t)
	missionID, poolDir := withTempPoolRoot(t, "orphan-instance")
	t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	if err := os.WriteFile(filepath.Join(poolDir, "ba-1.idle"), nil, 0o644); err != nil {
		t.Fatalf("seed ba idle: %v", err)
	}
	m.missionBody = missionResponse(missionID, "running", nil)
	m.itemsByStage["implementing"] = itemsResponse(map[string]interface{}{
		"id":            "WI-022",
		"title":         "Orphan impl",
		"stageId":       "implementing",
		"type":          "feature",
		"assignedAgent": "",
	})

	_, plan, err := runTick(t, m.server.URL, "--dry-run")
	if err != nil {
		t.Fatalf("tick returned error: %v", err)
	}
	dispatch := findActionByKind(plan, "dispatch")
	if dispatch == nil {
		t.Fatalf("expected orphan dispatch action, plan: %v", plan)
	}
	if got := dispatch["agent"]; got != "ba-1" {
		t.Fatalf("orphan dispatch must target concrete idle instance ba-1, got %v; plan: %v", got, plan)
	}
}

func TestTickCheckpointIdempotencyForPendingActions(t *testing.T) {
	t.Run("pending dispatch is not re-emitted", func(t *testing.T) {
		m := newTickAPIMocks(t)
		s := setupHappyDispatch(t, m)
		pendingID := s.missionID + ":WI-014:dispatch:g0:murdock-1:1"
		m.checkpointBody = mustJSON(map[string]interface{}{
			"success": true,
			"data": map[string]interface{}{
				"tickedAt":           "2026-05-20T00:00:00Z",
				"activityCursor":     0,
				"pendingActionIds":   []string{pendingID},
				"confirmedActionIds": []string{},
				"retryCounters":      map[string]int{},
				"lastLaneState":      map[string]string{},
			},
		})

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick returned error: %v", err)
		}
		if findActionByKind(plan, "dispatch") != nil {
			t.Fatalf("pending dispatch must not be re-emitted; plan: %v", plan)
		}
	})

	t.Run("checkpoint write preserves unresolved pending IDs and drops confirmed ones", func(t *testing.T) {
		m := newTickAPIMocks(t)
		s := setupHappyDispatch(t, m)
		oldPending := s.missionID + ":WI-999:move:controller:1"
		confirmed := s.missionID + ":WI-998:dispatch:g0:murdock-1:1"
		m.checkpointBody = mustJSON(map[string]interface{}{
			"success": true,
			"data": map[string]interface{}{
				"tickedAt":           "2026-05-20T00:00:00Z",
				"activityCursor":     7,
				"pendingActionIds":   []string{oldPending, confirmed},
				"confirmedActionIds": []string{confirmed},
				"retryCounters":      map[string]int{},
				"lastLaneState":      map[string]string{},
			},
		})

		_, plan, err := runTick(t, m.server.URL)
		if err != nil {
			t.Fatalf("tick returned error: %v", err)
		}
		dispatch := findActionByKind(plan, "dispatch")
		if dispatch == nil {
			t.Fatalf("expected dispatch action, plan: %v", plan)
		}
		posts := m.postsTo("/api/controller-checkpoint/")
		if len(posts) == 0 {
			t.Fatalf("expected checkpoint post")
		}
		lastPost := posts[len(posts)-1]
		strs := func(key string) []string {
			arr, _ := lastPost[key].([]interface{})
			var out []string
			for _, v := range arr {
				out = append(out, v.(string))
			}
			return out
		}
		gotPending := strs("pendingActionIds")
		gotConfirmed := strs("confirmedActionIds")
		// Non-dispatch pending IDs are preserved for Claude to confirm.
		if !containsString(gotPending, oldPending) {
			t.Fatalf("checkpoint pending IDs must preserve unresolved %q, got %v", oldPending, gotPending)
		}
		if containsString(gotPending, confirmed) {
			t.Fatalf("checkpoint pending IDs must not retain confirmed %q, got %v", confirmed, gotPending)
		}
		// Dispatch actions are auto-confirmed by the controller (the pool slot is
		// claimed at tick time) — they land in confirmedActionIds, never pending.
		dispatchID := dispatch["id"].(string)
		if containsString(gotPending, dispatchID) {
			t.Fatalf("auto-confirmed dispatch %q must NOT be in pending, got %v", dispatchID, gotPending)
		}
		if !containsString(gotConfirmed, dispatchID) {
			t.Fatalf("checkpoint confirmed IDs must include auto-confirmed dispatch %q, got %v", dispatchID, gotConfirmed)
		}
	})
}

// ===========================================================================
// AC 3 — Tick emits dispatch ONLY when WIP limits AND dependency readiness
// both allow them. Also exercises the read endpoints (cross-product with AC
// list: missions/current, items?stage=, deps/check, health-report,
// controller-checkpoint, activity, plus pool dir for native-teams).
// ===========================================================================

func TestTickGatesDispatchOnWIPAndDeps(t *testing.T) {
	t.Run("emits dispatch when an idle agent + a ready item + satisfied deps line up", func(t *testing.T) {
		m := newTickAPIMocks(t)
		setupHappyDispatch(t, m)

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionByKind(plan, "dispatch") == nil {
			t.Errorf("expected a dispatch action when capacity and deps allow it; plan: %v", plan)
		}

		// Each read endpoint listed in the AC must have been called at least
		// once. The pool filesystem is verified by the fact that dispatch
		// chose murdock-1 (the only idle file we wrote).
		for _, path := range []string{
			"/api/missions/current",
			"/api/items?stage=ready",
			"/api/deps/check",
			"/api/missions/current/health-report",
		} {
			if m.getCount(path) == 0 {
				t.Errorf("expected at least one GET %s, saw none", path)
			}
		}
		// The checkpoint path is /api/controller-checkpoint/<missionId>; check
		// any GET under that prefix was made.
		var checkpointHit bool
		m.mu.Lock()
		for path := range m.getRequestsByPath {
			if strings.HasPrefix(path, "/api/controller-checkpoint/") {
				checkpointHit = true
				break
			}
		}
		m.mu.Unlock()
		if !checkpointHit {
			t.Error("expected at least one GET /api/controller-checkpoint/<id>, saw none")
		}
	})

	t.Run("skips dispatch when no idle agent is available (WIP proxy: empty pool)", func(t *testing.T) {
		m := newTickAPIMocks(t)
		s := setupHappyDispatch(t, m)
		// Remove the idle agent — every murdock instance is busy.
		_ = os.Remove(filepath.Join(s.poolDir, "murdock-1.idle"))
		busy := filepath.Join(s.poolDir, "murdock-1.busy")
		if err := os.WriteFile(busy, nil, 0o644); err != nil {
			t.Fatalf("seed busy file: %v", err)
		}

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionByKind(plan, "dispatch") != nil {
			t.Errorf("dispatch must NOT be emitted when no agent instance is idle; plan: %v", plan)
		}
	})

	t.Run("skips dispatch when the item's dependencies are not yet satisfied", func(t *testing.T) {
		m := newTickAPIMocks(t)
		setupHappyDispatch(t, m)
		// /api/deps/check reports no items are ready (WI-014 has unmet deps).
		m.depsBody = depsReadyResponse() // empty readyItems

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionByKind(plan, "dispatch") != nil {
			t.Errorf("dispatch must NOT be emitted when deps are not ready; plan: %v", plan)
		}
	})
}

// ===========================================================================
// AC 4 — Tick emits final-review EXACTLY ONCE when every item is in 'done'
// and the mission has no finalReview recorded. Subsequent ticks with
// finalReview present do NOT re-emit. ("only/never" qualifier — positive
// and negative both required.)
// ===========================================================================

func TestTickFinalReviewExactlyOnce(t *testing.T) {
	t.Run("emits final-review when all items are done and finalReview is null", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "fr-positive")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "running", nil) // finalReview = null
		// All items are done; no items in any other pipeline stage.
		m.itemsByStage["done"] = itemsResponse(
			map[string]interface{}{"id": "WI-001", "stageId": "done"},
			map[string]interface{}{"id": "WI-002", "stageId": "done"},
		)

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		fr := findActionByKind(plan, "final-review")
		if fr == nil {
			t.Fatalf("expected a final-review action when all items are done and finalReview is null; plan: %v", plan)
		}
		// Final-review action carries its own deterministic id.
		if id, _ := fr["id"].(string); id == "" {
			t.Errorf("final-review action must carry a non-empty id; got %v", fr)
		}
	})

	t.Run("does NOT emit final-review when finalReview is already recorded", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "fr-negative")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "completed", "# Already reviewed\n\nAPPROVED")
		m.itemsByStage["done"] = itemsResponse(
			map[string]interface{}{"id": "WI-001", "stageId": "done"},
		)

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionByKind(plan, "final-review") != nil {
			t.Errorf("final-review must NOT be re-emitted when finalReview is already recorded; plan: %v", plan)
		}
	})

	t.Run("does NOT emit final-review when not all items are done", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "fr-not-done")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "running", nil)
		// One item is still in testing — mission is not complete.
		m.itemsByStage["testing"] = itemsResponse(
			map[string]interface{}{"id": "WI-001", "stageId": "testing"},
		)
		m.itemsByStage["done"] = itemsResponse(
			map[string]interface{}{"id": "WI-002", "stageId": "done"},
		)

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionByKind(plan, "final-review") != nil {
			t.Errorf("final-review must NOT be emitted while items remain outside 'done'; plan: %v", plan)
		}
	})
}

// ===========================================================================
// AC 5 — nextWakeSeconds cadence:
//   - <= 5 when ready items exist AND lanes are free
//   - 30 .. 60 when all lanes busy
//   - 120 .. 300 when only waiting on dependencies
// ===========================================================================

func TestTickCadence(t *testing.T) {
	t.Run("ready items + free lanes → nextWakeSeconds <= 5", func(t *testing.T) {
		m := newTickAPIMocks(t)
		setupHappyDispatch(t, m)

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		nws, ok := plan["nextWakeSeconds"].(float64)
		if !ok {
			t.Fatalf("nextWakeSeconds must be a number, got %T (%v)", plan["nextWakeSeconds"], plan["nextWakeSeconds"])
		}
		if nws > 5 {
			t.Errorf("expected nextWakeSeconds <= 5 when there is ready work + free lanes, got %v", nws)
		}
	})

	t.Run("all lanes busy → 30 <= nextWakeSeconds <= 60", func(t *testing.T) {
		m := newTickAPIMocks(t)
		s := setupHappyDispatch(t, m)
		// Make every murdock busy (no idle file).
		_ = os.Remove(filepath.Join(s.poolDir, "murdock-1.idle"))
		busy := filepath.Join(s.poolDir, "murdock-1.busy")
		if err := os.WriteFile(busy, nil, 0o644); err != nil {
			t.Fatalf("seed busy file: %v", err)
		}
		// There IS work to do (the ready item is still there), but no capacity.
		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		nws, _ := plan["nextWakeSeconds"].(float64)
		if nws < 30 || nws > 60 {
			t.Errorf("expected nextWakeSeconds in [30,60] when all lanes are busy, got %v", nws)
		}
	})

	t.Run("waiting on deps (no ready items) → 120 <= nextWakeSeconds <= 300", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, _ := withTempPoolRoot(t, "deps-wait")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		m.missionBody = missionResponse(missionID, "running", nil)
		// Briefings has items waiting on deps. Nothing in ready or any pipeline stage.
		m.itemsByStage["briefings"] = itemsResponse(
			map[string]interface{}{"id": "WI-099", "stageId": "briefings"},
		)
		m.depsBody = depsReadyResponse() // no items ready

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		nws, _ := plan["nextWakeSeconds"].(float64)
		if nws < 120 || nws > 300 {
			t.Errorf("expected nextWakeSeconds in [120,300] when waiting on deps, got %v", nws)
		}
	})
}

// ===========================================================================
// AC 6 — Without --dry-run, every action is appended to ActivityLog AND the
// checkpoint is written. With --dry-run, the JSON plan is printed but NO
// ActivityLog write or checkpoint write occurs.  (Positive + negative.)
// ===========================================================================

func TestTickActivityLogAndCheckpointWrites(t *testing.T) {
	t.Run("--dry-run does NOT write activity or checkpoint", func(t *testing.T) {
		m := newTickAPIMocks(t)
		setupHappyDispatch(t, m)

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		// Plan still emits a dispatch action.
		if findActionByKind(plan, "dispatch") == nil {
			t.Fatalf("dry-run should still emit the planned actions in stdout; plan: %v", plan)
		}
		// But NO POST to /api/activity or POST /api/controller-checkpoint/<id>.
		if posts := m.postsTo("/api/activity"); len(posts) != 0 {
			t.Errorf("--dry-run must not POST to /api/activity, got %d posts", len(posts))
		}
		if posts := m.postsTo("/api/controller-checkpoint/"); len(posts) != 0 {
			t.Errorf("--dry-run must not POST a checkpoint update, got %d posts", len(posts))
		}
	})

	t.Run("without --dry-run, every emitted action is logged AND the checkpoint is persisted", func(t *testing.T) {
		m := newTickAPIMocks(t)
		setupHappyDispatch(t, m)

		_, plan, err := runTick(t, m.server.URL) // no --dry-run
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		dispatch := findActionByKind(plan, "dispatch")
		if dispatch == nil {
			t.Fatalf("expected a dispatch action; plan: %v", plan)
		}

		// Exactly one activity-log entry per emitted action.
		actions, _ := plan["actions"].([]interface{})
		activityPosts := m.postsTo("/api/activity")
		if len(activityPosts) < len(actions) {
			t.Errorf("expected at least %d POSTs to /api/activity (one per action), got %d",
				len(actions), len(activityPosts))
		}

		// The rationale ('why') is written to ActivityLog for auditability, but
		// is deliberately NOT emitted in the model-facing JSON (kept lean — the
		// executor never reads it). Verify both halves: absent from JSON, present
		// in the activity feed (keyed by the dispatched item id).
		if _, hasWhy := dispatch["why"]; hasWhy {
			t.Errorf("dispatch action must NOT carry 'why' in the JSON plan (it belongs in ActivityLog); got %v", dispatch)
		}
		dispatchItemID, _ := dispatch["itemId"].(string)
		var sawRationale bool
		for _, p := range activityPosts {
			msg, _ := p["message"].(string)
			if strings.Contains(msg, dispatchItemID) {
				sawRationale = true
				break
			}
		}
		if !sawRationale {
			t.Errorf("expected an activity-log entry referencing dispatched item %q; posts were: %v", dispatchItemID, activityPosts)
		}

		// Checkpoint must have been written with a COMPLETE document —
		// WI-002's POST /api/controller-checkpoint/:missionId route requires
		// all 6 fields (tickedAt, activityCursor, pendingActionIds,
		// confirmedActionIds, retryCounters, lastLaneState) and returns 400
		// VALIDATION_ERROR if any is missing or named wrong. The controller
		// also discards POST errors silently, so a wrong-shape body would
		// fail invisibly in production. This test pins the contract
		// directly: every field must be present, the field name must be
		// `tickedAt` (NOT `lastTickAt`), and the emitted dispatch id must be
		// auto-confirmed (in confirmedActionIds, not pending) since the
		// controller claims the pool slot itself.
		checkpointPosts := m.postsTo("/api/controller-checkpoint/")
		if len(checkpointPosts) == 0 {
			t.Fatalf("expected at least one POST /api/controller-checkpoint/<id> after a non-dry-run tick")
		}
		cp := checkpointPosts[0]

		for _, field := range []string{
			"tickedAt",
			"activityCursor",
			"pendingActionIds",
			"confirmedActionIds",
			"retryCounters",
			"lastLaneState",
		} {
			if _, ok := cp[field]; !ok {
				t.Errorf("checkpoint POST body is missing required field %q (WI-002 returns 400 without it); body: %v", field, cp)
			}
		}

		// The wrong field name `lastTickAt` (instead of `tickedAt`) must not
		// appear — WI-002 will reject it, but the controller discards the
		// error. Pinning the absence of the wrong name catches the bug.
		if _, hasWrong := cp["lastTickAt"]; hasWrong {
			t.Errorf("checkpoint POST body uses wrong field name 'lastTickAt' — WI-002's contract is 'tickedAt'")
		}

		// confirmedActionIds must include the emitted dispatch action's id:
		// dispatch is auto-confirmed by the controller (it claims the pool slot
		// itself), so the next tick detects duplication and skips re-emitting.
		dispatchID, _ := dispatch["id"].(string)
		confirmed, ok := cp["confirmedActionIds"].([]interface{})
		if !ok {
			t.Errorf("checkpoint confirmedActionIds must be an array, got %T (%v)", cp["confirmedActionIds"], cp["confirmedActionIds"])
		} else {
			var found bool
			for _, id := range confirmed {
				if s, _ := id.(string); s == dispatchID {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("checkpoint confirmedActionIds %v does not contain the auto-confirmed dispatch id %q", confirmed, dispatchID)
			}
		}
	})

	// AC6 + AC2 cross-product: when a prior checkpoint exists at 200 OK, the
	// planner must DECODE THE ENVELOPE — the kanban-viewer wraps every response
	// in `{"success":true,"data":{...}}` (WI-002 contract). Without unwrapping
	// `data`, every field on `checkpointData` silently stays at its zero value,
	// nextSequence() returns 1 forever, and every dispatch the controller emits
	// re-uses sequence :1 across ticks — violating AC2 (action IDs identify a
	// unique plan iteration) and breaking idempotent confirmation in Claude.
	//
	// All other subtests in this function exercise the 404 path (no checkpoint
	// yet). This subtest is the only test in the file that covers the 200 OK
	// envelope-decode path. It must FAIL against an implementation that
	// `json.Unmarshal`s the response body directly into `checkpointData`.
	t.Run("200 OK checkpoint envelope is decoded so nextSequence reflects prior pendingActionIds", func(t *testing.T) {
		m := newTickAPIMocks(t)
		s := setupHappyDispatch(t, m)

		// Seed a prior checkpoint in the API envelope shape exactly as the
		// real GET /api/controller-checkpoint/:missionId route returns it.
		// One prior pending action ("prev-id") means nextSequence() must
		// return len(pendingActionIds)+1 = 2 on this tick.
		m.checkpointBody = mustJSON(map[string]interface{}{
			"success": true,
			"data": map[string]interface{}{
				"tickedAt":           "2026-05-17T15:00:00Z",
				"activityCursor":     3,
				"pendingActionIds":   []string{"prev-id"},
				"confirmedActionIds": []string{},
				"retryCounters":      map[string]interface{}{},
				"lastLaneState":      map[string]interface{}{},
			},
		})

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		dispatch := findActionByKind(plan, "dispatch")
		if dispatch == nil {
			t.Fatalf("expected a dispatch action with WI-014 ready and murdock-1 idle; plan: %v", plan)
		}
		id, _ := dispatch["id"].(string)

		// The sequence suffix MUST be :2 — one prior pendingActionId + 1.
		// Against the envelope-bug impl, pendingActionIds is silently empty,
		// nextSequence returns 1, and the id ends in `:1`. That is the bug
		// this test catches.
		if !strings.HasSuffix(id, ":2") {
			t.Errorf("dispatch id should end with \":2\" (one prior pendingActionId → nextSequence=2), got %q. "+
				"Likely cause: fetchCheckpointOrEmpty unmarshals the envelope `{success,data}` "+
				"directly into checkpointData instead of decoding `data`, leaving PendingActionIDs nil.", id)
		}

		// Pin the full ID shape so a failure points at the exact discrepancy
		// — same mission/item/kind/agent as the deterministic-ID test, just
		// with the sequence bumped to 2 because of the prior checkpoint.
		// Agent field is now the specific pool instance (e.g. murdock-1), not generic "murdock"
		wantID := s.missionID + ":WI-014:dispatch:g0:murdock-1:2"
		if id != wantID {
			t.Errorf("dispatch id mismatch: want %q, got %q", wantID, id)
		}
	})
}

// ===========================================================================
// Controller-side pool claim (#2): a real native-teams dispatch tick claims the
// idle slot itself (.idle → .busy) so Claude only sends the START message —
// dropping the per-dispatch `ateam pool claim` round-trip. --dry-run must never
// mutate the pool.
// ===========================================================================

func slotState(t *testing.T, poolDir, instance string) (idle, busy bool) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(poolDir, instance+".idle")); err == nil {
		idle = true
	}
	if _, err := os.Stat(filepath.Join(poolDir, instance+".busy")); err == nil {
		busy = true
	}
	return idle, busy
}

func TestTickClaimsPoolSlotOnDispatch(t *testing.T) {
	t.Run("real tick claims the idle slot (.idle → .busy)", func(t *testing.T) {
		m := newTickAPIMocks(t)
		s := setupHappyDispatch(t, m)

		_, plan, err := runTick(t, m.server.URL) // no --dry-run
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionByKind(plan, "dispatch") == nil {
			t.Fatalf("expected a dispatch action; plan: %v", plan)
		}
		idle, busy := slotState(t, s.poolDir, "murdock-1")
		if idle || !busy {
			t.Fatalf("controller must claim murdock-1 at dispatch time (want idle=false busy=true), got idle=%v busy=%v", idle, busy)
		}
	})

	t.Run("--dry-run never mutates the pool", func(t *testing.T) {
		m := newTickAPIMocks(t)
		s := setupHappyDispatch(t, m)

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionByKind(plan, "dispatch") == nil {
			t.Fatalf("dry-run should still emit a dispatch action; plan: %v", plan)
		}
		idle, busy := slotState(t, s.poolDir, "murdock-1")
		if !idle || busy {
			t.Fatalf("--dry-run must not claim the slot (want idle=true busy=false), got idle=%v busy=%v", idle, busy)
		}
	})
}

// ===========================================================================
// Reclaim (#2 safety net): the controller claims a slot BEFORE Claude sends the
// START, so a dropped SendMessage would leak a .busy slot. reclaimStuckSlots
// releases a slot whose dispatched item still has no assignedAgent past the
// reclaim threshold, and drops the stale confirmed dispatch action so the next
// tick re-dispatches.
// ===========================================================================

// confirmedCheckpointBody returns a checkpoint GET envelope seeding the given
// confirmed action IDs (and no pending IDs).
func confirmedCheckpointBody(confirmedIDs ...string) []byte {
	ids := make([]interface{}, 0, len(confirmedIDs))
	for _, id := range confirmedIDs {
		ids = append(ids, id)
	}
	return mustJSON(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"tickedAt":           "2026-05-20T00:00:00Z",
			"activityCursor":     0,
			"pendingActionIds":   []string{},
			"confirmedActionIds": ids,
			"retryCounters":      map[string]int{},
			"lastLaneState":      map[string]string{},
		},
	})
}

// seedBusySlot writes <instance>.busy with an mtime ageSeconds in the past so
// reclaim can be exercised deterministically without sleeping.
func seedBusySlot(t *testing.T, poolDir, instance string, ageSeconds float64) {
	t.Helper()
	busy := filepath.Join(poolDir, instance+".busy")
	if err := os.WriteFile(busy, nil, 0o644); err != nil {
		t.Fatalf("seed busy slot: %v", err)
	}
	past := time.Now().Add(-time.Duration(ageSeconds * float64(time.Second)))
	if err := os.Chtimes(busy, past, past); err != nil {
		t.Fatalf("backdate busy slot: %v", err)
	}
}

// lastCheckpointConfirmed returns the confirmedActionIds from the most recent
// checkpoint POST body, or nil if none was posted.
func lastCheckpointConfirmed(t *testing.T, m *tickAPIMocks) []string {
	t.Helper()
	posts := m.postsTo("/api/controller-checkpoint/")
	if len(posts) == 0 {
		return nil
	}
	arr, _ := posts[len(posts)-1]["confirmedActionIds"].([]interface{})
	var out []string
	for _, v := range arr {
		out = append(out, v.(string))
	}
	return out
}

func TestTickReclaimsStuckSlot(t *testing.T) {
	t.Run("stale busy slot with unstarted item is released and de-confirmed", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "reclaim-stuck")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
		if err := os.MkdirAll(poolDir, 0o755); err != nil {
			t.Fatalf("mkdir pool: %v", err)
		}
		seedBusySlot(t, poolDir, "murdock-1", 300) // .busy for 5 min, > 120s threshold

		dispatchID := missionID + ":WI-014:dispatch:g0:murdock-1:1"
		m.missionBody = missionResponse(missionID, "running", nil)
		// Item is still in ready with no assignedAgent — the START never started.
		m.itemsByStage["ready"] = itemsResponse(map[string]interface{}{
			"id": "WI-014", "title": "Add rate-limiting", "stageId": "ready",
			"type": "feature", "assignedAgent": "",
		})
		m.checkpointBody = confirmedCheckpointBody(dispatchID)

		_, plan, err := runTick(t, m.server.URL) // no --dry-run
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}

		idle, busy := slotState(t, poolDir, "murdock-1")
		if !idle || busy {
			t.Fatalf("reclaim must release the stuck slot (want idle=true busy=false), got idle=%v busy=%v", idle, busy)
		}
		// A reclaim must schedule a prompt re-tick so the freed slot is
		// re-dispatched quickly rather than after the long idle cadence.
		if nw, _ := plan["nextWakeSeconds"].(float64); nw != 5 {
			t.Fatalf("reclaim should re-tick promptly (nextWakeSeconds=5), got %v", plan["nextWakeSeconds"])
		}
		if confirmed := lastCheckpointConfirmed(t, m); containsString(confirmed, dispatchID) {
			t.Fatalf("reclaim must drop the stale dispatch id from confirmedActionIds, still present: %v", confirmed)
		}
		var sawReclaim bool
		for _, p := range m.postsTo("/api/activity") {
			if msg, _ := p["message"].(string); strings.Contains(msg, "reclaim stuck slot murdock-1") {
				sawReclaim = true
			}
		}
		if !sawReclaim {
			t.Errorf("expected a reclaim activity-log entry for murdock-1")
		}
	})

	t.Run("fresh busy slot (below threshold) is NOT reclaimed", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "reclaim-fresh")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
		if err := os.MkdirAll(poolDir, 0o755); err != nil {
			t.Fatalf("mkdir pool: %v", err)
		}
		seedBusySlot(t, poolDir, "murdock-1", 5) // just claimed — worker still starting

		dispatchID := missionID + ":WI-014:dispatch:g0:murdock-1:1"
		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["ready"] = itemsResponse(map[string]interface{}{
			"id": "WI-014", "title": "Add rate-limiting", "stageId": "ready",
			"type": "feature", "assignedAgent": "",
		})
		m.checkpointBody = confirmedCheckpointBody(dispatchID)

		_, _, err := runTick(t, m.server.URL)
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if _, busy := slotState(t, poolDir, "murdock-1"); !busy {
			t.Fatalf("a slot busy for only 5s must not be reclaimed")
		}
		if confirmed := lastCheckpointConfirmed(t, m); !containsString(confirmed, dispatchID) {
			t.Fatalf("a non-reclaimed dispatch id must remain confirmed, got %v", confirmed)
		}
	})

	t.Run("busy slot whose worker started (assignedAgent set) is NOT reclaimed", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "reclaim-working")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
		if err := os.MkdirAll(poolDir, 0o755); err != nil {
			t.Fatalf("mkdir pool: %v", err)
		}
		seedBusySlot(t, poolDir, "murdock-1", 600) // long-running but legitimate

		dispatchID := missionID + ":WI-014:dispatch:g0:murdock-1:1"
		m.missionBody = missionResponse(missionID, "running", nil)
		// Worker picked it up: moved to testing and set assignedAgent.
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id": "WI-014", "title": "Add rate-limiting", "stageId": "testing",
			"type": "feature", "assignedAgent": "murdock-1",
		})
		m.checkpointBody = confirmedCheckpointBody(dispatchID)

		_, _, err := runTick(t, m.server.URL)
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if _, busy := slotState(t, poolDir, "murdock-1"); !busy {
			t.Fatalf("a busy slot with active work (assignedAgent set) must never be reclaimed")
		}
		if confirmed := lastCheckpointConfirmed(t, m); !containsString(confirmed, dispatchID) {
			t.Fatalf("an in-progress dispatch id must remain confirmed, got %v", confirmed)
		}
	})
}

// ===========================================================================
// Rejection-generation IDs + planner-side cap: an item that hit the rejection
// cap is routed to `blocked` by the controller (not re-dispatched), and a
// legitimate rework bounce (a new generation) IS re-dispatchable despite a
// prior-generation dispatch sitting in the checkpoint.
// ===========================================================================

func TestTickPlannerSideRejectionCap(t *testing.T) {
	t.Run("item at the rejection cap is blocked, not dispatched", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "cap-block")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
		t.Setenv("ATEAM_REJECTION_CAP", "4")
		if err := os.MkdirAll(poolDir, 0o755); err != nil {
			t.Fatalf("mkdir pool: %v", err)
		}
		_ = os.WriteFile(filepath.Join(poolDir, "ba-1.idle"), nil, 0o644)
		m.missionBody = missionResponse(missionID, "running", nil)
		m.itemsByStage["implementing"] = itemsResponse(map[string]interface{}{
			"id": "WI-020", "title": "cycler", "stageId": "implementing",
			"type": "feature", "assignedAgent": "", "rejectionCount": 4,
		})

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if d := findActionForItem(plan, "dispatch", "WI-020"); d != nil {
			t.Fatalf("an item at the rejection cap must NOT be dispatched; got %v", d)
		}
		block := findActionForItem(plan, "move", "WI-020")
		if block == nil {
			t.Fatalf("expected a move-to-blocked action for the capped item; plan: %v", plan)
		}
		if block["toStage"] != "blocked" {
			t.Fatalf("capped item must be routed to 'blocked', got toStage=%v", block["toStage"])
		}
	})

	t.Run("a reworked item (new generation) is re-dispatched despite a prior-gen dispatch in the checkpoint", func(t *testing.T) {
		m := newTickAPIMocks(t)
		missionID, poolDir := withTempPoolRoot(t, "rework-redispatch")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
		if err := os.MkdirAll(poolDir, 0o755); err != nil {
			t.Fatalf("mkdir pool: %v", err)
		}
		_ = os.WriteFile(filepath.Join(poolDir, "murdock-1.idle"), nil, 0o644)
		m.missionBody = missionResponse(missionID, "running", nil)
		// Item bounced back to testing: rejectionCount=1 (generation 1), no agent.
		m.itemsByStage["testing"] = itemsResponse(map[string]interface{}{
			"id": "WI-021", "title": "reworked", "stageId": "testing",
			"type": "feature", "assignedAgent": "", "rejectionCount": 1,
		})
		// The generation-0 dispatch from the first pass is already confirmed.
		m.checkpointBody = confirmedCheckpointBody(missionID + ":WI-021:dispatch:g0:murdock-1:1")

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		d := findActionForItem(plan, "dispatch", "WI-021")
		if d == nil {
			t.Fatalf("a reworked item (gen 1) must be re-dispatchable even though gen 0 is confirmed; plan: %v", plan)
		}
		if id, _ := d["id"].(string); !strings.Contains(id, ":dispatch:g1:") {
			t.Fatalf("re-dispatch must carry the new generation g1, got id=%q", id)
		}
	})
}

// ===========================================================================
// Per-stage WIP gate: the ready-dispatch loop respects the entry stage's WIP
// limit, not just idle pool capacity.
// ===========================================================================

func boardWIPResponse(stageLimits map[string]int) []byte {
	stages := make([]interface{}, 0, len(stageLimits))
	for id, lim := range stageLimits {
		stages = append(stages, map[string]interface{}{
			"id": id, "name": id, "order": 0, "wipLimit": lim,
		})
	}
	return mustJSON(map[string]interface{}{
		"success": true,
		"data":    map[string]interface{}{"stages": stages},
	})
}

func TestTickGatesDispatchOnStageWIP(t *testing.T) {
	m := newTickAPIMocks(t)
	missionID, poolDir := withTempPoolRoot(t, "wip-gate")
	t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	// Two idle lanes — physical capacity alone would allow 2 dispatches.
	_ = os.WriteFile(filepath.Join(poolDir, "murdock-1.idle"), nil, 0o644)
	_ = os.WriteFile(filepath.Join(poolDir, "murdock-2.idle"), nil, 0o644)
	m.missionBody = missionResponse(missionID, "running", nil)
	// testing WIP = 1 (currently empty).
	m.boardBody = boardWIPResponse(map[string]int{"testing": 1})
	m.itemsByStage["ready"] = itemsResponse(
		map[string]interface{}{"id": "WI-100", "title": "a", "stageId": "ready", "type": "feature"},
		map[string]interface{}{"id": "WI-101", "title": "b", "stageId": "ready", "type": "feature"},
	)
	m.depsBody = depsReadyResponse("WI-100", "WI-101")

	_, plan, err := runTick(t, m.server.URL, "--dry-run")
	if err != nil {
		t.Fatalf("tick failed: %v", err)
	}
	count := 0
	actions, _ := plan["actions"].([]interface{})
	for _, a := range actions {
		if am, _ := a.(map[string]interface{}); am != nil && am["kind"] == "dispatch" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("testing WIP=1 must allow exactly 1 dispatch despite 2 idle lanes + 2 ready items, got %d; plan: %v", count, plan)
	}
}

// ===========================================================================
// Runaway backstop: an active mission past the wall-clock budget halts dispatch
// and escalates, rather than ticking hot forever (the 40-hour-runaway class).
// ===========================================================================

func missionResponseStarted(id, state, startedAt string) []byte {
	return mustJSON(map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"id": id, "name": "Test mission", "state": state,
			"finalReview": nil, "startedAt": startedAt,
		},
	})
}

func TestTickRunawayBackstop(t *testing.T) {
	t.Run("mission past the wall-clock budget halts dispatch and escalates", func(t *testing.T) {
		m := newTickAPIMocks(t)
		s := setupHappyDispatch(t, m) // a ready item + idle lane that WOULD dispatch
		t.Setenv("ATEAM_MAX_MISSION_HOURS", "24")
		started := time.Now().Add(-25 * time.Hour).UTC().Format(time.RFC3339)
		m.missionBody = missionResponseStarted(s.missionID, "running", started)

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionByKind(plan, "dispatch") != nil {
			t.Fatalf("a runaway mission must NOT dispatch; plan: %v", plan)
		}
		nj, _ := plan["needsJudgment"].(map[string]interface{})
		if nj == nil || nj["kind"] != "runaway-backstop" {
			t.Fatalf("expected needsJudgment kind=runaway-backstop; got %v", plan["needsJudgment"])
		}
		// Idles (~hourly) rather than re-arming hot.
		if nw, _ := plan["nextWakeSeconds"].(float64); nw < 600 {
			t.Fatalf("runaway backstop should idle the loop (long nextWake), got %v", plan["nextWakeSeconds"])
		}
	})

	t.Run("mission within budget dispatches normally", func(t *testing.T) {
		m := newTickAPIMocks(t)
		s := setupHappyDispatch(t, m)
		t.Setenv("ATEAM_MAX_MISSION_HOURS", "24")
		started := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
		m.missionBody = missionResponseStarted(s.missionID, "running", started)

		_, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err != nil {
			t.Fatalf("tick failed: %v", err)
		}
		if findActionByKind(plan, "dispatch") == nil {
			t.Fatalf("a mission within budget must still dispatch; plan: %v", plan)
		}
	})
}

// ===========================================================================
// AC 7 — Fail-closed: when the API is unreachable or returns malformed JSON,
// tick returns a non-zero exit AND emits a needsJudgment payload with NO
// dispatch actions.
// ===========================================================================

func TestTickFailsClosedOnAPIError(t *testing.T) {
	t.Run("API unreachable → non-zero exit + needsJudgment + no dispatch", func(t *testing.T) {
		// Start a server then immediately close it; its URL is now unreachable.
		stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		unreachable := stub.URL
		stub.Close()

		_, _ = withTempPoolRoot(t, "fail-closed-unreachable")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		output, plan, err := runTick(t, unreachable, "--dry-run")
		if err == nil {
			t.Errorf("expected non-zero exit when API is unreachable, got nil error; output:\n%s", output)
		}
		if plan == nil {
			t.Fatalf("expected a JSON plan even on API failure (fail-closed payload); output:\n%s", output)
		}
		if findActionByKind(plan, "dispatch") != nil {
			t.Errorf("must NOT emit dispatch when API is unreachable; plan: %v", plan)
		}
		switch plan["needsJudgment"].(type) {
		case nil:
			t.Errorf("expected needsJudgment object on API failure, got null; plan: %v", plan)
		case map[string]interface{}:
			// ok
		default:
			t.Errorf("needsJudgment must be an object on API failure, got %T", plan["needsJudgment"])
		}
	})

	t.Run("malformed JSON from API → non-zero exit + needsJudgment + no dispatch", func(t *testing.T) {
		m := newTickAPIMocks(t)
		m.missionMalformed = true
		_, _ = withTempPoolRoot(t, "fail-closed-malformed")
		t.Setenv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")

		output, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err == nil {
			t.Errorf("expected non-zero exit when API returns malformed JSON, got nil error; output:\n%s", output)
		}
		if plan == nil {
			t.Fatalf("expected a JSON plan even on JSON parse failure; output:\n%s", output)
		}
		if findActionByKind(plan, "dispatch") != nil {
			t.Errorf("must NOT emit dispatch when the API returns malformed JSON; plan: %v", plan)
		}
		if _, ok := plan["needsJudgment"].(map[string]interface{}); !ok {
			t.Errorf("expected needsJudgment object on JSON parse failure, got %T", plan["needsJudgment"])
		}
	})

	t.Run("checkpoint read 500 → non-zero exit + needsJudgment + no dispatch", func(t *testing.T) {
		m := newTickAPIMocks(t)
		setupHappyDispatch(t, m)
		m.checkpointStatus = http.StatusInternalServerError
		m.checkpointBody = []byte(`{"success":false,"error":{"message":"boom"}}`)

		output, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err == nil {
			t.Fatalf("expected checkpoint read failure to fail closed, got nil error; output:\n%s", output)
		}
		if findActionByKind(plan, "dispatch") != nil {
			t.Fatalf("checkpoint read failure must not emit dispatch; plan: %v", plan)
		}
		if _, ok := plan["needsJudgment"].(map[string]interface{}); !ok {
			t.Fatalf("expected needsJudgment object, got %T; plan: %v", plan["needsJudgment"], plan)
		}
	})

	t.Run("stage item fetch malformed → non-zero exit + needsJudgment + no dispatch", func(t *testing.T) {
		m := newTickAPIMocks(t)
		setupHappyDispatch(t, m)
		m.itemsByStage["testing"] = []byte(`{not-json`)

		output, plan, err := runTick(t, m.server.URL, "--dry-run")
		if err == nil {
			t.Fatalf("expected stage fetch failure to fail closed, got nil error; output:\n%s", output)
		}
		if findActionByKind(plan, "dispatch") != nil {
			t.Fatalf("stage fetch failure must not emit dispatch; plan: %v", plan)
		}
	})

	t.Run("activity write non-2xx → non-zero exit after fail-closed write error", func(t *testing.T) {
		m := newTickAPIMocks(t)
		setupHappyDispatch(t, m)
		m.activityPostStatus = http.StatusInternalServerError

		output, _, err := runTick(t, m.server.URL)
		if err == nil {
			t.Fatalf("expected activity write failure to return non-zero, got nil; output:\n%s", output)
		}
		if !strings.Contains(err.Error(), "HTTP 500") {
			t.Fatalf("expected HTTP 500 error, got %v", err)
		}
	})

	t.Run("checkpoint write non-2xx → non-zero exit after fail-closed write error", func(t *testing.T) {
		m := newTickAPIMocks(t)
		setupHappyDispatch(t, m)
		m.checkpointPostStatus = http.StatusInternalServerError

		output, _, err := runTick(t, m.server.URL)
		if err == nil {
			t.Fatalf("expected checkpoint write failure to return non-zero, got nil; output:\n%s", output)
		}
		if !strings.Contains(err.Error(), "HTTP 500") {
			t.Fatalf("expected HTTP 500 error, got %v", err)
		}
	})
}

// ===========================================================================
// AC 8 — Tick's planner package import graph excludes any tooling that would
// invoke Claude Code primitives (Task/TeamCreate/SendMessage/ScheduleWakeup).
//
// Strategy: parse all production .go files in internal/controller/ for their
// imports and assert none match a blocklist of suspicious package fragments.
// As defense-in-depth, also scan cmd/controller_tick.go for the literal
// symbol names (excluding string literals like `"kind":"message"`).
// ===========================================================================

func TestTickImportGraphExcludesClaudeCodePrimitives(t *testing.T) {
	pkgDir := filepath.Join("..", "internal", "controller")
	files, err := filepath.Glob(filepath.Join(pkgDir, "*.go"))
	if err != nil {
		t.Fatalf("glob %s: %v", pkgDir, err)
	}
	if len(files) == 0 {
		t.Fatalf("expected at least one Go file in %s — the planner must live there per WI-004 context", pkgDir)
	}

	// Forbidden package-path fragments. These are deliberately broad — any
	// future Go package wrapping Claude Code primitives would have one of
	// these substrings in its import path.
	blocklist := regexp.MustCompile(`(?i)(claude|anthropic|task[-_]?dispatch|teamcreate|sendmessage|schedule[-_]?wakeup|spawn[-_]?task)`)

	fset := token.NewFileSet()
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fset, f, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatalf("parse %s: %v", f, err)
		}
		for _, imp := range parsed.Imports {
			path := strings.Trim(imp.Path.Value, `"`)
			if blocklist.MatchString(path) {
				t.Errorf("%s imports %q — controller package must not import Claude Code dispatch tooling", f, path)
			}
		}
	}

	// Defense-in-depth: scan the tick command source for function-call usage
	// of forbidden symbols. We match on `Symbol(` to avoid matching the JSON
	// string literal `"kind":"message"` (which is legitimate output content).
	src, err := os.ReadFile("controller_tick.go")
	if err != nil {
		t.Fatalf("read controller_tick.go: %v", err)
	}
	forbiddenCalls := []string{"Task(", "TaskCreate(", "TeamCreate(", "ScheduleWakeup(", "SendMessage("}
	for _, call := range forbiddenCalls {
		if bytes.Contains(src, []byte(call)) {
			t.Errorf("controller_tick.go contains forbidden call %q — the controller must not invoke Claude Code primitives directly", call)
		}
	}

	// And confirm the controller package directory exists at all — if B.A.
	// puts the planner somewhere else the test catches the divergence early.
	if info, statErr := os.Stat(pkgDir); statErr != nil {
		t.Errorf("expected planner package at %s, stat err: %v", pkgDir, statErr)
	} else if !info.IsDir() {
		t.Errorf("expected %s to be a directory", pkgDir)
	}

	// Final sanity: log the file count so a regression that empties the dir
	// surfaces with useful context in the test output.
	t.Logf("scanned %d files in %s", len(files), pkgDir)
}
