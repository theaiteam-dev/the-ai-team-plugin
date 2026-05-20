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
	missionBody      []byte
	itemsByStage     map[string][]byte
	depsBody         []byte
	healthBody       []byte
	checkpointBody   []byte
	checkpointStatus int
	activityListBody []byte

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
	missionID  string
	readyItem  map[string]interface{}
	depsReady  bool
	poolIdle   bool // murdock-1.idle exists in native pool dir
	poolDir    string
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
		`^` + regexp.QuoteMeta(s.missionID) + `:WI-014:dispatch:murdock(-\d+)?:\d+$`,
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

		// Each activity log entry must include the action's "why" rationale —
		// the AC explicitly requires this for auditability.
		actionWhy, _ := dispatch["why"].(string)
		if actionWhy == "" {
			t.Fatalf("dispatch action is missing a 'why' field; got %v", dispatch)
		}
		var sawWhy bool
		for _, p := range activityPosts {
			msg, _ := p["message"].(string)
			if strings.Contains(msg, actionWhy) {
				sawWhy = true
				break
			}
		}
		if !sawWhy {
			t.Errorf("expected an activity-log entry containing the action 'why' (%q); posts were: %v", actionWhy, activityPosts)
		}

		// Checkpoint must have been written with a COMPLETE document —
		// WI-002's POST /api/controller-checkpoint/:missionId route requires
		// all 6 fields (tickedAt, activityCursor, pendingActionIds,
		// confirmedActionIds, retryCounters, lastLaneState) and returns 400
		// VALIDATION_ERROR if any is missing or named wrong. The controller
		// also discards POST errors silently, so a wrong-shape body would
		// fail invisibly in production. This test pins the contract
		// directly: every field must be present, the field name must be
		// `tickedAt` (NOT `lastTickAt`), and `pendingActionIds` must include
		// the emitted dispatch id so Claude can confirm idempotently.
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

		// pendingActionIds must include the emitted dispatch action's id so
		// the next tick can detect duplication and skip re-emitting.
		dispatchID, _ := dispatch["id"].(string)
		pending, ok := cp["pendingActionIds"].([]interface{})
		if !ok {
			t.Errorf("checkpoint pendingActionIds must be an array, got %T (%v)", cp["pendingActionIds"], cp["pendingActionIds"])
		} else {
			var found bool
			for _, id := range pending {
				if s, _ := id.(string); s == dispatchID {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("checkpoint pendingActionIds %v does not contain the emitted dispatch id %q", pending, dispatchID)
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
		wantID := s.missionID + ":WI-014:dispatch:murdock-1:2"
		if id != wantID {
			t.Errorf("dispatch id mismatch: want %q, got %q", wantID, id)
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
