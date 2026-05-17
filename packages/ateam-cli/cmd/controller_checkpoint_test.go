package cmd

// Tests for the `ateam controller checkpoint` subcommands (WI-005).
//
// Three subcommands, all under the `controller` parent declared by WI-004:
//
//   • `controller checkpoint get`     — read the persisted checkpoint
//   • `controller checkpoint put`     — upsert the full document (seeding / debug)
//   • `controller checkpoint confirm` — atomic server-side append to confirmedActionIds
//
// The wire contract is defined by WI-002:
//
//   GET  /api/controller-checkpoint/:missionId         → 200 {success,data:{...6 fields}} | 404 {error:'not_found'}
//   POST /api/controller-checkpoint/:missionId         → 200 {success,data:{...6 fields}} (envelope)
//   POST /api/controller-checkpoint/:missionId/confirm → 200 {success,data:{...6 fields}} | 404 {error:'not_found'}
//                                                        body: {actionId: string}
//
// Tests drive the cobra command tree directly via rootCmd.SetArgs + rootCmd.Execute
// against a mocked HTTP server. They are RED until WI-005's three new files exist:
//   packages/ateam-cli/cmd/controller_checkpoint_get.go
//   packages/ateam-cli/cmd/controller_checkpoint_put.go
//   packages/ateam-cli/cmd/controller_checkpoint_confirm.go

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	pflag "github.com/spf13/pflag"
)

// ---------------------------------------------------------------------------
// Mock API server — records every request and serves canned responses for the
// three checkpoint routes the CLI exercises.
// ---------------------------------------------------------------------------

type checkpointRequest struct {
	method  string
	path    string
	body    []byte
	headers http.Header
}

type checkpointMocks struct {
	server *httptest.Server

	mu       sync.Mutex
	requests []checkpointRequest

	// Override response bodies. nil → use the per-route default below.
	getBody       []byte
	getStatus     int // 0 → 200 unless getBody == nil, in which case 404 with not_found sentinel
	postBody      []byte
	postStatus    int // 0 → 200 with an echoed-back envelope of the captured request body
	confirmBody   []byte
	confirmStatus int // 0 → 200 with an envelope-wrapped stub doc
}

func newCheckpointMocks(t *testing.T) *checkpointMocks {
	t.Helper()
	m := &checkpointMocks{}

	mux := http.NewServeMux()

	// One handler covers both the read/upsert (/:missionId) and the confirm
	// (/:missionId/confirm) paths because Go's mux dispatches /api/controller-checkpoint/
	// to a single sub-tree.
	mux.HandleFunc("/api/controller-checkpoint/", func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		m.mu.Lock()
		m.requests = append(m.requests, checkpointRequest{
			method:  r.Method,
			path:    r.URL.Path,
			body:    raw,
			headers: r.Header.Clone(),
		})
		m.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")

		switch {
		case strings.HasSuffix(r.URL.Path, "/confirm") && r.Method == http.MethodPost:
			status := m.confirmStatus
			body := m.confirmBody
			if status == 0 {
				status = http.StatusOK
			}
			if body == nil {
				body = mustEnvelope(defaultCheckpointDoc())
			}
			w.WriteHeader(status)
			_, _ = w.Write(body)
			return

		case r.Method == http.MethodGet:
			status := m.getStatus
			body := m.getBody
			if status == 0 && body == nil {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":"not_found"}`))
				return
			}
			if status == 0 {
				status = http.StatusOK
			}
			w.WriteHeader(status)
			_, _ = w.Write(body)
			return

		case r.Method == http.MethodPost:
			status := m.postStatus
			body := m.postBody
			if status == 0 {
				status = http.StatusOK
			}
			if body == nil {
				// Default: echo the captured POST body back inside a success envelope
				// so tests can assert the round-trip without writing canned bodies.
				var doc map[string]interface{}
				_ = json.Unmarshal(raw, &doc)
				body = mustEnvelope(doc)
			}
			w.WriteHeader(status)
			_, _ = w.Write(body)
			return
		}

		w.WriteHeader(http.StatusMethodNotAllowed)
	})

	m.server = httptest.NewServer(mux)
	t.Cleanup(m.server.Close)
	return m
}

// requestsByMethod returns all recorded requests for the given HTTP method.
func (m *checkpointMocks) requestsByMethod(method string) []checkpointRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []checkpointRequest
	for _, r := range m.requests {
		if r.method == method {
			out = append(out, r)
		}
	}
	return out
}

// requestsByPathSuffix returns all recorded requests whose path ends with suffix.
func (m *checkpointMocks) requestsByPathSuffix(suffix string) []checkpointRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []checkpointRequest
	for _, r := range m.requests {
		if strings.HasSuffix(r.path, suffix) {
			out = append(out, r)
		}
	}
	return out
}

// totalRequests is a convenience for the "no HTTP call was made" assertion.
func (m *checkpointMocks) totalRequests() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.requests)
}

// mustEnvelope wraps doc in the kanban-viewer API envelope shape.
func mustEnvelope(doc interface{}) []byte {
	b, err := json.Marshal(map[string]interface{}{
		"success": true,
		"data":    doc,
	})
	if err != nil {
		panic(err)
	}
	return b
}

// defaultCheckpointDoc returns a complete, valid checkpoint document.
// Used as the canned body of GET responses (and confirm responses) when the
// test does not override the body.
func defaultCheckpointDoc() map[string]interface{} {
	return map[string]interface{}{
		"missionId":          "M-test-checkpoint",
		"tickedAt":           "2026-05-17T15:00:00Z",
		"activityCursor":     7,
		"pendingActionIds":   []string{"M-test-checkpoint:WI-001:dispatch:murdock:1"},
		"confirmedActionIds": []string{},
		"retryCounters":      map[string]int{},
		"lastLaneState":      map[string]string{"murdock-1": "busy"},
	}
}

// ---------------------------------------------------------------------------
// Cobra runners — share one reset routine so --base-url and --json don't leak
// between tests. Each returns (stdout, stderr, err).
// ---------------------------------------------------------------------------

func runCheckpointCmd(t *testing.T, args ...string) (stdout, stderr string, err error) {
	t.Helper()
	resetPersistentFlags(t)

	// Reset every flag on the three checkpoint subcommands (and their parent)
	// so a previous test's value never leaks into the next. This works even
	// before B.A. implements the commands — the lookups are guarded.
	for _, path := range [][]string{
		{"controller", "checkpoint"},
		{"controller", "checkpoint", "get"},
		{"controller", "checkpoint", "put"},
		{"controller", "checkpoint", "confirm"},
	} {
		if subCmd, _, lookupErr := rootCmd.Find(path); lookupErr == nil && subCmd != nil {
			subCmd.Flags().VisitAll(func(f *pflag.Flag) {
				_ = f.Value.Set(f.DefValue)
				f.Changed = false
			})
		}
	}

	var outBuf, errBuf bytes.Buffer
	rootCmd.SetOut(&outBuf)
	rootCmd.SetErr(&errBuf)
	rootCmd.SetArgs(args)
	err = rootCmd.Execute()
	return outBuf.String(), errBuf.String(), err
}

// commonArgs returns the always-present flags every checkpoint command needs
// (base URL into the mock, no-color, json). Specific tests can append more.
func commonArgs(baseURL string, missionID string, more ...string) []string {
	args := []string{
		"--base-url", baseURL,
		"--no-color",
		"--mission-id", missionID,
	}
	return append(args, more...)
}

// ===========================================================================
// AC1 — `ateam controller checkpoint get --json` prints the persisted
// checkpoint document for the active mission as valid JSON.
// ===========================================================================

func TestCheckpointGetReturnsJSONForActiveMission(t *testing.T) {
	const missionID = "M-test-get-happy"
	const projectID = "test-project-get"
	// Set ATEAM_PROJECT_ID BEFORE the command runs — internal/client.NewClient
	// reads it at construction time and injects X-Project-ID on every request.
	// If the impl bypasses internal/client (e.g. uses http.Get / DefaultClient),
	// the header is never sent and downstream services that enforce it return 403.
	t.Setenv("ATEAM_PROJECT_ID", projectID)
	m := newCheckpointMocks(t)

	// Seed the GET response with a known envelope shape.
	doc := defaultCheckpointDoc()
	doc["missionId"] = missionID
	doc["activityCursor"] = 42
	doc["pendingActionIds"] = []string{missionID + ":WI-007:dispatch:murdock:1"}
	m.getBody = mustEnvelope(doc)

	args := append([]string{"controller", "checkpoint", "get", "--json"},
		commonArgs(m.server.URL, missionID)...)
	stdout, stderr, err := runCheckpointCmd(t, args...)
	if err != nil {
		t.Fatalf("get returned error: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
	}

	// Output must be valid JSON.
	var parsed map[string]interface{}
	if jsonStr := extractFirstJSONObject(stdout); jsonStr == "" {
		t.Fatalf("get did not print a JSON object; stdout:\n%s\nstderr:\n%s", stdout, stderr)
	} else if uerr := json.Unmarshal([]byte(jsonStr), &parsed); uerr != nil {
		t.Fatalf("get output is not valid JSON (%v); stdout:\n%s", uerr, stdout)
	}

	// The printed document must contain every field WI-002's GET response
	// returns. Pin the values we seeded so we know the CLI is printing
	// SERVER data and not a hardcoded stub or empty default.
	if got, _ := parsed["missionId"].(string); got != missionID {
		t.Errorf("missionId: want %q, got %q", missionID, got)
	}
	if got, _ := parsed["activityCursor"].(float64); got != 42 {
		t.Errorf("activityCursor: want 42, got %v", parsed["activityCursor"])
	}
	pendings, _ := parsed["pendingActionIds"].([]interface{})
	if len(pendings) != 1 || pendings[0] != missionID+":WI-007:dispatch:murdock:1" {
		t.Errorf("pendingActionIds: want [%q], got %v",
			missionID+":WI-007:dispatch:murdock:1", parsed["pendingActionIds"])
	}
	// Confirm all six WI-002 fields are present (not just the ones we
	// asserted on individually).
	for _, field := range []string{
		"tickedAt", "activityCursor",
		"pendingActionIds", "confirmedActionIds",
		"retryCounters", "lastLaneState",
	} {
		if _, ok := parsed[field]; !ok {
			t.Errorf("get output missing required WI-002 field %q; output: %v", field, parsed)
		}
	}

	// And the CLI must have hit the GET route exactly once.
	gets := m.requestsByMethod(http.MethodGet)
	if len(gets) != 1 {
		t.Errorf("expected exactly 1 GET to /api/controller-checkpoint/<id>, got %d", len(gets))
	} else if !strings.HasSuffix(gets[0].path, "/api/controller-checkpoint/"+missionID) {
		t.Errorf("GET path: want suffix %q, got %q",
			"/api/controller-checkpoint/"+missionID, gets[0].path)
	}

	// X-Project-ID must be present on the request — this is the multi-tenant
	// scoping header every API call requires. If absent, the impl is bypassing
	// internal/client (which auto-injects it from $ATEAM_PROJECT_ID) and
	// production calls will be rejected 403 by any server that enforces it.
	if len(gets) > 0 {
		if got := gets[0].headers.Get("X-Project-ID"); got != projectID {
			t.Errorf("GET missing X-Project-ID header: want %q, got %q. "+
				"Likely cause: command uses http.Get / http.DefaultClient instead of internal/client.NewClient — "+
				"internal/client injects X-Project-ID from $ATEAM_PROJECT_ID on every request.",
				projectID, got)
		}
	}
}

// ===========================================================================
// AC2 — `get` exits non-zero with the literal stderr sentinel
//   "no checkpoint found for mission <id>"
// when the API returns 404 (distinct from generic errors).
// ===========================================================================

func TestCheckpointGetExitsNonZeroOn404WithStderrSentinel(t *testing.T) {
	const missionID = "M-test-get-404"
	m := newCheckpointMocks(t)
	// Default behaviour (getBody == nil) returns 404 {"error":"not_found"}.

	args := append([]string{"controller", "checkpoint", "get"},
		commonArgs(m.server.URL, missionID)...)
	stdout, stderr, err := runCheckpointCmd(t, args...)

	// Must exit non-zero.
	if err == nil {
		t.Fatalf("expected non-zero exit on 404, got nil error; stdout:\n%s\nstderr:\n%s", stdout, stderr)
	}

	// Stderr must contain the exact sentinel string so operators (and
	// downstream scripts) can distinguish "never ticked" from generic errors.
	// We check both the cobra-printed err.Error() AND the captured stderr —
	// either is acceptable as long as the literal phrase appears.
	wantPhrase := "no checkpoint found for mission " + missionID
	combined := stderr + "\n" + err.Error()
	if !strings.Contains(combined, wantPhrase) {
		t.Errorf("expected stderr/error to contain %q; got stderr:\n%s\nerr: %v",
			wantPhrase, stderr, err)
	}

	// Negative half of the "distinguishes 404 from real error" qualifier:
	// the sentinel must NOT appear on transport errors. We exercise the
	// transport-error case in a sibling test, but here we also assert the
	// command did NOT print a JSON document to stdout (404 ≠ success).
	if jsonStr := extractFirstJSONObject(stdout); jsonStr != "" {
		t.Errorf("on 404, get must not print a JSON document to stdout; got:\n%s", stdout)
	}
}

// ===========================================================================
// AC3 — `put --data '<doc>'` upserts the document via POST and prints the
// persisted (echoed-back) result.
// ===========================================================================

func TestCheckpointPutUpsertsAndPrintsPersistedDocument(t *testing.T) {
	const missionID = "M-test-put-happy"
	const projectID = "test-project-put"
	// Set ATEAM_PROJECT_ID BEFORE the command runs — see header assertion below.
	t.Setenv("ATEAM_PROJECT_ID", projectID)
	m := newCheckpointMocks(t)

	// The full document the operator passes via --data. Must include every
	// WI-002 required field — POST returns 400 if any is missing.
	doc := map[string]interface{}{
		"tickedAt":           "2026-05-17T16:30:00Z",
		"activityCursor":     9,
		"pendingActionIds":   []string{missionID + ":WI-003:dispatch:murdock:2"},
		"confirmedActionIds": []string{missionID + ":WI-002:dispatch:murdock:1"},
		"retryCounters":      map[string]int{"WI-003": 1},
		"lastLaneState":      map[string]string{"murdock-1": "busy", "ba-1": "idle"},
	}
	dataBytes, _ := json.Marshal(doc)

	args := append([]string{
		"controller", "checkpoint", "put",
		"--data", string(dataBytes),
		"--json",
	}, commonArgs(m.server.URL, missionID)...)
	stdout, stderr, err := runCheckpointCmd(t, args...)
	if err != nil {
		t.Fatalf("put returned error: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
	}

	// Exactly one POST to /api/controller-checkpoint/<missionId> (NOT /confirm).
	posts := m.requestsByMethod(http.MethodPost)
	if len(posts) != 1 {
		t.Fatalf("expected exactly 1 POST, got %d", len(posts))
	}
	if !strings.HasSuffix(posts[0].path, "/api/controller-checkpoint/"+missionID) {
		t.Errorf("POST path: want suffix %q, got %q",
			"/api/controller-checkpoint/"+missionID, posts[0].path)
	}
	if strings.HasSuffix(posts[0].path, "/confirm") {
		t.Errorf("put must NOT POST to /confirm (that's a separate subcommand); got %q", posts[0].path)
	}

	// Captured body must round-trip every field the operator supplied. POST
	// returns 400 VALIDATION_ERROR when any of the 6 fields is missing.
	var captured map[string]interface{}
	if uerr := json.Unmarshal(posts[0].body, &captured); uerr != nil {
		t.Fatalf("captured POST body is not valid JSON: %v\nraw: %s", uerr, posts[0].body)
	}
	for _, field := range []string{
		"tickedAt", "activityCursor",
		"pendingActionIds", "confirmedActionIds",
		"retryCounters", "lastLaneState",
	} {
		if _, ok := captured[field]; !ok {
			t.Errorf("POST body missing required field %q; body: %v", field, captured)
		}
	}
	if got, _ := captured["activityCursor"].(float64); got != 9 {
		t.Errorf("activityCursor: want 9, got %v", captured["activityCursor"])
	}
	if got, _ := captured["tickedAt"].(string); got != "2026-05-17T16:30:00Z" {
		t.Errorf("tickedAt: want %q, got %q", "2026-05-17T16:30:00Z", got)
	}

	// X-Project-ID must be present on the POST — see TestCheckpointGet... for
	// the full rationale. Absent header → impl is bypassing internal/client.
	if got := posts[0].headers.Get("X-Project-ID"); got != projectID {
		t.Errorf("PUT missing X-Project-ID header: want %q, got %q. "+
			"Likely cause: command uses http.DefaultClient instead of internal/client.NewClient.",
			projectID, got)
	}

	// The persisted (echoed-back) result must be printed to stdout. The mock
	// echoes the POST body inside a success envelope — the CLI must print
	// the document so operators see what was persisted.
	if jsonStr := extractFirstJSONObject(stdout); jsonStr == "" {
		t.Fatalf("put did not print the persisted document; stdout:\n%s", stdout)
	} else {
		var printed map[string]interface{}
		if uerr := json.Unmarshal([]byte(jsonStr), &printed); uerr != nil {
			t.Fatalf("printed document is not valid JSON: %v\nstdout:\n%s", uerr, stdout)
		}
		if got, _ := printed["activityCursor"].(float64); got != 9 {
			t.Errorf("printed activityCursor: want 9, got %v", printed["activityCursor"])
		}
	}
}

// ===========================================================================
// AC4 — `put --data` with malformed JSON exits non-zero BEFORE any HTTP call
// and prints a parse error pointing at the input.
// ===========================================================================

func TestCheckpointPutRejectsMalformedJSONBeforeHTTP(t *testing.T) {
	const missionID = "M-test-put-malformed"
	m := newCheckpointMocks(t)

	const malformed = `{"tickedAt":"2026-05-17T16:30:00Z", "activityCursor": 7,` // trailing comma, unterminated

	args := append([]string{
		"controller", "checkpoint", "put",
		"--data", malformed,
	}, commonArgs(m.server.URL, missionID)...)
	stdout, stderr, err := runCheckpointCmd(t, args...)

	// Non-zero exit.
	if err == nil {
		t.Fatalf("expected non-zero exit on malformed --data, got nil error; stdout:\n%s\nstderr:\n%s",
			stdout, stderr)
	}

	// NO HTTP call must have been made. The mock records every request; if
	// the count is > 0 the CLI is sending invalid data to the API instead of
	// validating client-side first.
	if got := m.totalRequests(); got != 0 {
		t.Errorf("malformed --data must NOT trigger any HTTP call (server-side validation is too late); got %d requests", got)
	}

	// Stderr (or the cobra error message) must point at the JSON parse
	// failure — the AC says "prints a parse error pointing at the input".
	// We match on "json" as a stable marker that survives any phrasing.
	combined := strings.ToLower(stderr + "\n" + err.Error())
	if !strings.Contains(combined, "json") {
		t.Errorf("expected stderr/error to mention json parsing; got stderr:\n%s\nerr: %v", stderr, err)
	}
}

// ===========================================================================
// AC5 — `confirm --action-id <id>` POSTs to
//   /api/controller-checkpoint/:missionId/confirm
// with body {actionId: <id>}, AND does NOT do a client-side read-modify-write
// (so it never GETs the full checkpoint first).
// ===========================================================================

func TestCheckpointConfirmPostsToConfirmEndpointWithNoReadModifyWrite(t *testing.T) {
	const missionID = "M-test-confirm-happy"
	const actionID = "M-test-confirm-happy:WI-014:dispatch:murdock:3"
	const projectID = "test-project-confirm"
	// Set ATEAM_PROJECT_ID BEFORE the command runs — see header assertion below.
	t.Setenv("ATEAM_PROJECT_ID", projectID)
	m := newCheckpointMocks(t)

	args := append([]string{
		"controller", "checkpoint", "confirm",
		"--action-id", actionID,
	}, commonArgs(m.server.URL, missionID)...)
	stdout, stderr, err := runCheckpointCmd(t, args...)
	if err != nil {
		t.Fatalf("confirm returned error: %v\nstdout:\n%s\nstderr:\n%s", err, stdout, stderr)
	}

	// Positive: exactly one POST, and it goes to the /confirm path.
	confirmPosts := m.requestsByPathSuffix("/confirm")
	if len(confirmPosts) != 1 {
		t.Fatalf("expected exactly 1 POST to .../confirm, got %d (all requests: %v)",
			len(confirmPosts), m.requests)
	}
	if confirmPosts[0].method != http.MethodPost {
		t.Errorf("confirm endpoint must be hit with POST, got %s", confirmPosts[0].method)
	}
	wantPath := "/api/controller-checkpoint/" + missionID + "/confirm"
	if !strings.HasSuffix(confirmPosts[0].path, wantPath) {
		t.Errorf("confirm POST path: want suffix %q, got %q", wantPath, confirmPosts[0].path)
	}

	// Body must be {"actionId": "<id>"} — the server expects this exact shape.
	var body map[string]interface{}
	if uerr := json.Unmarshal(confirmPosts[0].body, &body); uerr != nil {
		t.Fatalf("confirm POST body is not valid JSON: %v\nraw: %s", uerr, confirmPosts[0].body)
	}
	if got, _ := body["actionId"].(string); got != actionID {
		t.Errorf("confirm body actionId: want %q, got %q", actionID, got)
	}

	// Negative half of the "no read-modify-write" qualifier: the CLI must
	// NEVER GET /api/controller-checkpoint/<missionId> as part of confirm —
	// the server owns the mutation atomically.
	gets := m.requestsByMethod(http.MethodGet)
	if len(gets) > 0 {
		t.Errorf("confirm must NOT do a client-side read-modify-write; saw %d GET(s): %v",
			len(gets), gets)
	}

	// X-Project-ID must be present on the confirm POST — see TestCheckpointGet...
	// for the full rationale. Absent header → impl is bypassing internal/client.
	if got := confirmPosts[0].headers.Get("X-Project-ID"); got != projectID {
		t.Errorf("confirm POST missing X-Project-ID header: want %q, got %q. "+
			"Likely cause: command uses http.DefaultClient instead of internal/client.NewClient.",
			projectID, got)
	}
}

// ===========================================================================
// AC6 — `confirm` with missing or empty --action-id exits non-zero BEFORE any
// HTTP call. A 404 from the server is surfaced as the distinct sentinel
//   "no checkpoint found for mission <id>"
// (matches AC2's phrasing so consumers handle both commands the same way).
// ===========================================================================

func TestCheckpointConfirmActionIDValidationAndNotFoundSentinel(t *testing.T) {
	t.Run("missing --action-id exits non-zero before any HTTP call", func(t *testing.T) {
		const missionID = "M-test-confirm-missing"
		m := newCheckpointMocks(t)

		args := append([]string{"controller", "checkpoint", "confirm"},
			commonArgs(m.server.URL, missionID)...)
		stdout, stderr, err := runCheckpointCmd(t, args...)

		if err == nil {
			t.Fatalf("expected non-zero exit when --action-id is missing, got nil error;\nstdout:\n%s\nstderr:\n%s",
				stdout, stderr)
		}
		if got := m.totalRequests(); got != 0 {
			t.Errorf("missing --action-id must NOT trigger any HTTP call; got %d requests", got)
		}
		// Stderr/error must mention the missing flag so operators know what to fix.
		combined := strings.ToLower(stderr + "\n" + err.Error())
		if !strings.Contains(combined, "action-id") {
			t.Errorf("expected stderr/error to mention action-id; got stderr:\n%s\nerr: %v", stderr, err)
		}
	})

	t.Run("empty --action-id exits non-zero before any HTTP call", func(t *testing.T) {
		const missionID = "M-test-confirm-empty"
		m := newCheckpointMocks(t)

		args := append([]string{
			"controller", "checkpoint", "confirm",
			"--action-id", "",
		}, commonArgs(m.server.URL, missionID)...)
		stdout, stderr, err := runCheckpointCmd(t, args...)

		if err == nil {
			t.Fatalf("expected non-zero exit when --action-id is empty, got nil error;\nstdout:\n%s\nstderr:\n%s",
				stdout, stderr)
		}
		if got := m.totalRequests(); got != 0 {
			t.Errorf("empty --action-id must NOT trigger any HTTP call; got %d requests", got)
		}
	})

	t.Run("404 from server is surfaced as the not-found sentinel", func(t *testing.T) {
		const missionID = "M-test-confirm-404"
		const actionID = "M-test-confirm-404:WI-001:dispatch:murdock:1"
		m := newCheckpointMocks(t)
		// Force the /confirm route to return the WI-002 404 sentinel.
		m.confirmStatus = http.StatusNotFound
		m.confirmBody = []byte(`{"error":"not_found"}`)

		args := append([]string{
			"controller", "checkpoint", "confirm",
			"--action-id", actionID,
		}, commonArgs(m.server.URL, missionID)...)
		stdout, stderr, err := runCheckpointCmd(t, args...)

		if err == nil {
			t.Fatalf("expected non-zero exit on 404, got nil error;\nstdout:\n%s\nstderr:\n%s",
				stdout, stderr)
		}
		wantPhrase := "no checkpoint found for mission " + missionID
		combined := stderr + "\n" + err.Error()
		if !strings.Contains(combined, wantPhrase) {
			t.Errorf("expected stderr/error to contain %q; got stderr:\n%s\nerr: %v",
				wantPhrase, stderr, err)
		}
		// And the CLI did try the /confirm endpoint exactly once.
		confirmPosts := m.requestsByPathSuffix("/confirm")
		if len(confirmPosts) != 1 {
			t.Errorf("expected exactly 1 POST to .../confirm even on 404, got %d", len(confirmPosts))
		}
	})
}

// ===========================================================================
// AC7 — All three commands accept --mission-id so they can target non-active
// missions (e.g. archived missions in tests).  We verify by passing a
// distinct --mission-id and asserting the URL path includes IT, not anything
// derived from the environment.
// ===========================================================================

func TestCheckpointCommandsAcceptMissionIDFlag(t *testing.T) {
	// Use a mission ID that is clearly NOT the active one — if any command
	// derives the path from $ATEAM_MISSION_ID instead of --mission-id, the
	// URL won't contain this value and the test fails loudly.
	const flagMissionID = "M-archived-2026-04-01"

	t.Run("get uses --mission-id in the request path", func(t *testing.T) {
		m := newCheckpointMocks(t)
		// Seed a valid response so the command returns nil err and we can
		// focus the assertion on the request path.
		doc := defaultCheckpointDoc()
		doc["missionId"] = flagMissionID
		m.getBody = mustEnvelope(doc)
		// Stomp on the env to make sure the flag, not the env, wins.
		t.Setenv("ATEAM_MISSION_ID", "M-active-different")

		args := []string{
			"controller", "checkpoint", "get", "--json",
			"--base-url", m.server.URL, "--no-color",
			"--mission-id", flagMissionID,
		}
		_, _, err := runCheckpointCmd(t, args...)
		if err != nil {
			t.Fatalf("get returned error: %v", err)
		}
		gets := m.requestsByMethod(http.MethodGet)
		if len(gets) != 1 || !strings.HasSuffix(gets[0].path, "/"+flagMissionID) {
			t.Errorf("expected GET path to end with /%s, got %v", flagMissionID, gets)
		}
	})

	t.Run("put uses --mission-id in the request path", func(t *testing.T) {
		m := newCheckpointMocks(t)
		t.Setenv("ATEAM_MISSION_ID", "M-active-different")

		doc := defaultCheckpointDoc()
		dataBytes, _ := json.Marshal(doc)
		args := []string{
			"controller", "checkpoint", "put",
			"--data", string(dataBytes),
			"--json",
			"--base-url", m.server.URL, "--no-color",
			"--mission-id", flagMissionID,
		}
		_, _, err := runCheckpointCmd(t, args...)
		if err != nil {
			t.Fatalf("put returned error: %v", err)
		}
		posts := m.requestsByMethod(http.MethodPost)
		if len(posts) != 1 || !strings.HasSuffix(posts[0].path, "/"+flagMissionID) {
			t.Errorf("expected POST path to end with /%s, got %v", flagMissionID, posts)
		}
	})

	t.Run("confirm uses --mission-id in the request path", func(t *testing.T) {
		m := newCheckpointMocks(t)
		t.Setenv("ATEAM_MISSION_ID", "M-active-different")

		args := []string{
			"controller", "checkpoint", "confirm",
			"--action-id", flagMissionID + ":WI-001:dispatch:murdock:1",
			"--base-url", m.server.URL, "--no-color",
			"--mission-id", flagMissionID,
		}
		_, _, err := runCheckpointCmd(t, args...)
		if err != nil {
			t.Fatalf("confirm returned error: %v", err)
		}
		confirmPosts := m.requestsByPathSuffix("/confirm")
		wantSuffix := "/" + flagMissionID + "/confirm"
		if len(confirmPosts) != 1 || !strings.HasSuffix(confirmPosts[0].path, wantSuffix) {
			t.Errorf("expected confirm POST path to end with %s, got %v", wantSuffix, confirmPosts)
		}
	})
}
